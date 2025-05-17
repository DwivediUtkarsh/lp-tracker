// ── src/services/raydiumFeeCalc.ts ────────────────────────────────────────────
// Exact-fee calculator for Raydium CLMM positions (Uniswap-v3 maths)
// (c) 2025 utkarsh-dwivedi – MIT

import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import {
  AnchorProvider,
  Program,
  BorshAccountsCoder,
  Idl,
} from '@project-serum/anchor';
import BN from 'bn.js';
import pMap from 'p-map';
import { Decimal } from 'decimal.js';

import idlJson from './idl/raydium-clmm_v4.json' assert { type: 'json' };
import {
  getRaydiumPositions,   // ← your helper from raydiumHeliusService.ts
} from './raydiumHeliusService.js';
import { getTokenPrices }   from './priceService.js';
import { getTokenMetadata } from '../utils/tokenUtils.js';
import { ReliableConnection } from '../utils/solana.js';

/*──────────────────────── constants & helpers ───────────────────────────────*/
export const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey(
  'CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK',
);

const coder   = new BorshAccountsCoder(idlJson as Idl);
const TICKS_PER_ARRAY = 60;     // hard-coded in Raydium program
const Q64  = new BN(1).ushln(64);
const Q128 = new BN(1).ushln(128);

/* Encode signed i32 → big-endian 4 bytes */
function i32be(n: number) {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(n);
  return buf;
}

/* Derive tick-array PDA exactly like on-chain code: ["tick_array", poolId, i32_be] */
function tickArrayPda(pool: PublicKey, startIndex: number): PublicKey {
  return PublicKey.findProgramAddressSync(
    [Buffer.from('tick_array'), pool.toBuffer(), i32be(startIndex)],
    RAYDIUM_CLMM_PROGRAM_ID,
  )[0];
}

/* Given any tick, return start-tick of its 60-tick array (identical to Rust) */
function arrayStart(tick: number, spacing: number): number {
  const group = TICKS_PER_ARRAY * spacing;
  let start   = Math.floor(tick / group);
  if (tick < 0 && tick % group !== 0) start -= 1;
  return start * group;
}

/*──────────────────────── fee-growth maths (Uniswap v3) ─────────────────────*/
function feeGrowthInside(
  tickLower: any,
  tickUpper: any,
  tickCurrent: number,
  global0: BN,
  global1: BN,
): { in0: BN; in1: BN } {
  const below0 = tickCurrent >= tickLower.tick
    ? new BN(tickLower.feeGrowthOutside0X64.toString())
    : global0.sub(new BN(tickLower.feeGrowthOutside0X64.toString())).umod(Q128);

  const below1 = tickCurrent >= tickLower.tick
    ? new BN(tickLower.feeGrowthOutside1X64.toString())
    : global1.sub(new BN(tickLower.feeGrowthOutside1X64.toString())).umod(Q128);

  const above0 = tickCurrent < tickUpper.tick
    ? new BN(tickUpper.feeGrowthOutside0X64.toString())
    : global0.sub(new BN(tickUpper.feeGrowthOutside0X64.toString())).umod(Q128);

  const above1 = tickCurrent < tickUpper.tick
    ? new BN(tickUpper.feeGrowthOutside1X64.toString())
    : global1.sub(new BN(tickUpper.feeGrowthOutside1X64.toString())).umod(Q128);

  return {
    in0: global0.sub(below0).sub(above0).umod(Q128),
    in1: global1.sub(below1).sub(above1).umod(Q128),
  };
}

/*──────────────────────── public API ─────────────────────────────────────────*/
export interface RaydiumReward {
  positionAddress: string;
  poolAddress:     string;
  tokenAAddress:   string;
  tokenBAddress:   string;
  tokenASymbol:    string;
  tokenBSymbol:    string;
  feeA:            number;
  feeB:            number;
  feeAUsd?:        number;
  feeBUsd?:        number;
  totalUsd?:       number;
}

/**
 * Exact, on-chain-consistent fee calculation for every Raydium CLMM position
 * owned by `owner`.
 */
export async function getRaydiumUncollectedFees(
  connection: Connection | ReliableConnection,
  owner: PublicKey,
  existingPositions?: any[]  // Accept already fetched positions
): Promise<RaydiumReward[]> {
  /* 1️⃣ Use pre-fetched positions or discover them */
  const expos = existingPositions || await getRaydiumPositions(owner.toBase58());
  if (expos.length === 0) return [];

  /* 2️⃣ Spin an Anchor Provider for read-only fetches */
  const conn = connection instanceof ReliableConnection 
    ? connection.getConnection() 
    : connection;
    
  const provider = new AnchorProvider(
    conn,
    { publicKey: owner, signTransaction: async (tx: any) => tx, signAllTransactions: async (xs: any[]) => xs } as any,
    AnchorProvider.defaultOptions(),
  );

  try {
    console.log(`Calculating uncollected fees for wallet: ${owner.toString()}`);
    
    // Debug log to see what positions we have
    console.log(`Found ${expos.length} positions to calculate fees for`);

    /* 3️⃣ Process each position, six at a time with increased delay between batches */
    const rows = await pMap(
      expos,
      async (ex): Promise<RaydiumReward | null> => {
        try {
          // Skip positions without a valid position address
          if (!ex.positionAddress) {
            console.error('[raydium-fees] missing positionAddress');
            return null;
          }

          console.log(`[raydium-fees] processing position: ${ex.positionAddress}`);

          /* ─ position & pool state ─ */
          const posAcc = await conn.getAccountInfo(new PublicKey(ex.positionAddress));
          if (!posAcc) {
            console.log(`[raydium-fees] position account not found: ${ex.positionAddress}`);
            return null;
          }
          
          const pos = coder.decode('PersonalPositionState', posAcc.data) as any;
          
          // Log the position object structure for debugging
          console.log(`[raydium-fees] position data keys: ${Object.keys(pos).join(', ')}`);
          
          const poolAcc = await conn.getAccountInfo(pos.poolId);
          if (!poolAcc) {
            console.log(`[raydium-fees] pool account not found: ${pos.poolId}`);
            return null;
          }
          
          const pool = coder.decode('PoolState', poolAcc.data) as any;
          
          // Log the pool object structure for debugging
          console.log(`[raydium-fees] pool data keys: ${Object.keys(pool).join(', ')}`);

          /* ─ derive & fetch both tick arrays ─ */
          const spacing = pool.tickSpacing as number;
          const lowerArrPda = tickArrayPda(
            pos.poolId as PublicKey,
            arrayStart(pos.tickLowerIndex, spacing),
          );
          const upperArrPda = tickArrayPda(
            pos.poolId as PublicKey,
            arrayStart(pos.tickUpperIndex, spacing),
          );

          // Add a delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 500));

          const [lowerAcc, upperAcc] = await conn.getMultipleAccountsInfo([
            lowerArrPda,
            upperArrPda,
          ]);
          if (!lowerAcc || !upperAcc) {
            console.log(`[raydium-fees] tick arrays not found`);
            return null;
          }
          
          const lowerArr = coder.decode('TickArrayState', lowerAcc.data) as any;
          const upperArr = coder.decode('TickArrayState', upperAcc.data) as any;

          /* locate individual ticks inside the arrays */
          const lowerTick = lowerArr.ticks.find((t: any) => t.tick === pos.tickLowerIndex);
          const upperTick = upperArr.ticks.find((t: any) => t.tick === pos.tickUpperIndex);
          if (!lowerTick || !upperTick) {
            console.log(`[raydium-fees] tick data not found`);
            return null;
          }

          /* ─ calculate additional fees since last checkpoint ─ */
          const global0 = new BN(pool.feeGrowthGlobal0X64.toString());
          const global1 = new BN(pool.feeGrowthGlobal1X64.toString());
          const inside  = feeGrowthInside(
            lowerTick, upperTick, pool.tickCurrent, global0, global1,
          );                                                         // algorithm identical to Rust

          const delta0 = inside.in0
            .sub(new BN(pos.feeGrowthInside0LastX64.toString()))
            .umod(Q128);
          const delta1 = inside.in1
            .sub(new BN(pos.feeGrowthInside1LastX64.toString()))
            .umod(Q128);

          const L  = new BN(pos.liquidity.toString());
          const add0 = delta0.mul(L).shrn(64);   // Q64.64 → integer
          const add1 = delta1.mul(L).shrn(64);

          const fee0 = add0.add(new BN(pos.tokenFeesOwed0.toString()));
          const fee1 = add1.add(new BN(pos.tokenFeesOwed1.toString()));

          /* ─ humanise amounts ─ */
          const dec0 = pool.mintDecimals0 as number;
          const dec1 = pool.mintDecimals1 as number;
          const human0 = new Decimal(fee0.toString()).div(new Decimal(10).pow(dec0)).toNumber();
          const human1 = new Decimal(fee1.toString()).div(new Decimal(10).pow(dec1)).toNumber();

          /* ─ token meta & USD values ─ */
          const [meta0, meta1] = await Promise.all([
            getTokenMetadata(pool.tokenMint0.toString()),
            getTokenMetadata(pool.tokenMint1.toString()),
          ]);
          const prices = await getTokenPrices([
            pool.tokenMint0.toString(),
            pool.tokenMint1.toString(),
          ]);
          const fee0Usd = human0 * (prices[pool.tokenMint0.toString()] || 0);
          const fee1Usd = human1 * (prices[pool.tokenMint1.toString()] || 0);

          console.log(`[raydium-fees] calculated fees for ${ex.positionAddress}: ${human0} ${meta0?.symbol || 'token0'}, ${human1} ${meta1?.symbol || 'token1'}`);

          return {
            positionAddress: ex.positionAddress,
            poolAddress:     pos.poolId.toString(),
            tokenAAddress:   pool.tokenMint0.toString(),
            tokenBAddress:   pool.tokenMint1.toString(),
            tokenASymbol:    meta0?.symbol ?? pool.tokenMint0.toString().slice(0,4),
            tokenBSymbol:    meta1?.symbol ?? pool.tokenMint1.toString().slice(0,4),
            feeA:            human0,
            feeB:            human1,
            feeAUsd:         fee0Usd,
            feeBUsd:         fee1Usd,
            totalUsd:        fee0Usd + fee1Usd,
          };
        } catch (e) {
          console.error('[raydium-fees] skip', e);
          return null;
        }
      },
      { concurrency: 2 },  // Reduce concurrency to avoid rate limiting
    );

    return rows.filter(Boolean) as RaydiumReward[];
  } catch (e) {
    console.error('[raydium-fees] error', e);
    return [];
  }
} 