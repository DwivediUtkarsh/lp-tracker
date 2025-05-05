// ── src/services/whirlpoolRewardsService.ts ────────────────────────────
// Helius‑backed exact fee calculator for Orca Whirlpool LP positions
// (c) 2025 utkarsh‑dwivedi – MIT

import 'dotenv/config';
import { Connection, PublicKey } from '@solana/web3.js';
import { AnchorProvider } from '@coral-xyz/anchor';
import BN from 'bn.js';
import { Decimal } from 'decimal.js';
import pMap from 'p-map';

import {
  WhirlpoolContext,
  buildWhirlpoolClient,
  PDAUtil,
  TickArrayUtil,
  WhirlpoolData,
  PositionData,
} from '@orca-so/whirlpools-sdk';

import { getTokenPrices }  from './priceService.js';
import { getTokenMetadata } from '../utils/tokenUtils.js';
import { ReliableConnection } from '../utils/solana.js';

const PROGRAM_ID = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');

const Q64  = new BN(1).ushln(64);   // 2⁶⁴  – shift divisor
const Q128 = new BN(1).ushln(128);  // 2¹²⁸ – wrap‑around modulus
const TICKS_PER_ARRAY = 88;

/*──────────────────────── connection helpers ────────────────────────*/
function heliusUrl() {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error('HELIUS_API_KEY missing');
  return `https://mainnet.helius-rpc.com/?api-key=${key}`;
}

function newCtx(owner: PublicKey) {
  const conn   = new Connection(heliusUrl(), { commitment: 'processed' });
  const wallet = {
    publicKey: owner,
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (xs: any[]) => xs,
  } as any;
  const provider = new AnchorProvider(conn, wallet, AnchorProvider.defaultOptions());
  return WhirlpoolContext.withProvider(provider, PROGRAM_ID);
}

/*──────────────────────── retry utilities ──────────────────────────*/
async function retry<T>(fn: () => Promise<T>, max = 5, wait = 500): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e: any) {
      if (i >= max || !e.message?.includes('429')) throw e;
      const delay = wait * 2 ** i;
      console.log(`429 – retry in ${delay} ms …`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// Special retry for mint fetch errors that happen when metadata PDAs are being refreshed
async function retryMint<T>(fn: () => Promise<T>, max = 3, wait = 500): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e: any) {
      if (i >= max || (!e.message?.includes('Unable to fetch Mint') && !e.message?.includes('account not found'))) throw e;
      console.log(`Mint fetch error – retry in ${wait} ms …`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

// Global cache for token decimals to avoid repeated lookups
const tokenDecimalsCache: Record<string, number> = {};

// Batch load tick arrays for multiple positions to reduce RPC calls
async function batchLoadTickArrays(
  ctx: WhirlpoolContext,
  positions: Array<{ pool: PublicKey, spacing: number, lowerTick: number, upperTick: number }>
): Promise<Record<string, { lower: any, upper: any }>> {
  // Skip if no positions
  if (positions.length === 0) return {};
  
  // Construct all tick array PDAs
  const tickArrayPDAs: PublicKey[] = [];
  const positionTickArrayMap: Record<string, { lowerIndex: number, upperIndex: number }> = {};
  
  positions.forEach((pos, i) => {
    const lowerPda = PDAUtil.getTickArrayFromTickIndex(pos.lowerTick, pos.spacing, pos.pool, PROGRAM_ID);
    const upperPda = PDAUtil.getTickArrayFromTickIndex(pos.upperTick, pos.spacing, pos.pool, PROGRAM_ID);
    
    tickArrayPDAs.push(lowerPda.publicKey);
    tickArrayPDAs.push(upperPda.publicKey);
    
    const key = `${pos.pool.toBase58()}-${pos.lowerTick}-${pos.upperTick}`;
    positionTickArrayMap[key] = {
      lowerIndex: i * 2,     // index in the result array for lower tick array
      upperIndex: i * 2 + 1  // index in the result array for upper tick array
    };
  });
  
  // Fetch all tick arrays in a single RPC call
  const rawTickArrays = await retry(() => ctx.fetcher.getTickArrays(tickArrayPDAs));
  
  // Map the results back to respective positions
  const result: Record<string, { lower: any, upper: any }> = {};
  positions.forEach(pos => {
    const key = `${pos.pool.toBase58()}-${pos.lowerTick}-${pos.upperTick}`;
    const indices = positionTickArrayMap[key];
    if (indices) {
      result[key] = {
        lower: rawTickArrays[indices.lowerIndex],
        upper: rawTickArrays[indices.upperIndex]
      };
    }
  });
  
  return result;
}

// Keep original function for backward compatibility, but use batch function internally
async function loadTickArrays(
  ctx: WhirlpoolContext,
  whirlpool: PublicKey,
  spacing: number,
  lower: number,
  upper: number,
) {
  const positions = [{ pool: whirlpool, spacing, lowerTick: lower, upperTick: upper }];
  const batchResults = await batchLoadTickArrays(ctx, positions);
  const key = `${whirlpool.toBase58()}-${lower}-${upper}`;
  return batchResults[key] || { lower: null, upper: null };
}

/*──────────────────────── single‑token fee maths ─────────────────────*/
function getTick(tarr: any, index: number, spacing: number) {
  const util  = TickArrayUtil as any;
  if (typeof util.getTickFromArray === 'function')
    return util.getTickFromArray(tarr, index, spacing);

  /* manual fallback */
  const data  = tarr.data ?? tarr;
  const start = data.startTickIndex;
  const slot  = Math.floor((index - start) / spacing);
  return data.ticks?.[slot] ?? { feeGrowthOutsideA: '0', feeGrowthOutsideB: '0' };
}

function feesForSide(
  side: 0 | 1,
  pool: WhirlpoolData,
  pos:  PositionData,
  lowArr: any,
  upArr:  any,
): BN {
  const L = new BN(pos.liquidity.toString());
  if (L.isZero()) return new BN(0);

  const global = new BN(
    (side === 0 ? pool.feeGrowthGlobalA : pool.feeGrowthGlobalB).toString(),
  );

  const low = getTick(lowArr, pos.tickLowerIndex, pool.tickSpacing);
  const up  = getTick(upArr , pos.tickUpperIndex, pool.tickSpacing);

  const lowOut = new BN((side === 0 ? low.feeGrowthOutsideA : low.feeGrowthOutsideB).toString());
  const upOut  = new BN((side === 0 ? up .feeGrowthOutsideA : up .feeGrowthOutsideB).toString());

  /* feeGrowthBelow / Above */
  const below = pool.tickCurrentIndex >= pos.tickLowerIndex
    ? lowOut
    : global.sub(lowOut).umod(Q128);

  const above = pool.tickCurrentIndex <  pos.tickUpperIndex
    ? upOut
    : global.sub(upOut).umod(Q128);

  const inside = global.sub(below).sub(above).umod(Q128);

  const checkpoint = new BN(
    (side === 0 ? pos.feeGrowthCheckpointA : pos.feeGrowthCheckpointB).toString(),
  );

  const delta = inside.sub(checkpoint).umod(Q128);

  return delta.mul(L).shrn(64);        // >>> 64 to convert Q64.64 → integer
}

/*──────────────────────── exported API ───────────────────────────────*/
export interface WhirlpoolReward {
  positionAddress: string;
  poolAddress:      string;
  tokenAAddress:    string;
  tokenBAddress:    string;
  tokenASymbol:     string;
  tokenBSymbol:     string;
  feeA:             number;
  feeB:             number;
  feeAUsd?:         number;
  feeBUsd?:         number;
  totalUsd?:        number;
}

export async function getUncollectedFees(
  conn: ReliableConnection,
  owner: PublicKey,
): Promise<WhirlpoolReward[]> {
  // Get positions from existing helper
  const { getWhirlpoolExposures } = await import('./whirlpoolService.js');
  const expos = await getWhirlpoolExposures(conn, owner);
  if (expos.length === 0) return [];

  const ctx    = newCtx(owner);
  const client = buildWhirlpoolClient(ctx);
  
  // First, collect all position data and pool data in parallel
  const positionData = await pMap(
    expos,
    async ex => {
      try {
        const posPubkey = new PublicKey(ex.positionAddress); 
        const position = await retryMint(
          () => client.getPosition(posPubkey),
          3, // max 3 retries
          500 // 500ms delay
        );
        
        const pos = position.getData();
        const pool = await client.getPool(pos.whirlpool);
        const pd = pool.getData();
        
        return {
          ex,
          success: true, 
          position: pos,
          pool: pd,
          poolAddress: pool.getAddress(),
          tickSpacing: pd.tickSpacing,
          tokenAInfo: pool.getTokenAInfo(),
          tokenBInfo: pool.getTokenBInfo(),
        };
      } catch (e) {
        console.error('[whirlpool‑rewards] error loading position', ex.positionAddress, e);
        return { ex, success: false };
      }
    },
    { concurrency: 4 }
  );
  
  // Filter out failed position fetches
  const validPositions = positionData.filter(p => p.success) as Array<any>;
  if (validPositions.length === 0) return [];
  
  // Batch load all tick arrays in a single RPC call
  const tickArrayBatchParams = validPositions.map(p => ({
    pool: p.poolAddress,
    spacing: p.tickSpacing,
    lowerTick: p.position.tickLowerIndex,
    upperTick: p.position.tickUpperIndex
  }));
  
  const tickArraysMap = await batchLoadTickArrays(ctx, tickArrayBatchParams);
  
  // Batch load all token metadata for unique token mints
  const tokenMints = new Set<string>();
  validPositions.forEach(p => {
    tokenMints.add(p.tokenAInfo.mint.toBase58());
    tokenMints.add(p.tokenBInfo.mint.toBase58());
  });
  
  // Convert to array and fetch all metadata in parallel
  const tokenMetadataMap: Record<string, any> = {};
  await Promise.all(Array.from(tokenMints).map(async (mint) => {
    try {
      const metadata = await retryMint(() => getTokenMetadata(ctx.connection, mint));
      tokenMetadataMap[mint] = metadata;
    } catch (e) {
      console.error(`[whirlpool-rewards] error fetching metadata for ${mint}`, e);
    }
  }));
  
  // Calculate fees for each position using the pre-fetched data
  const rows = validPositions.map(p => {
    try {
      // Get tick arrays for this position
      const key = `${p.poolAddress.toBase58()}-${p.position.tickLowerIndex}-${p.position.tickUpperIndex}`;
      const { lower, upper } = tickArraysMap[key] || { lower: null, upper: null };
      
      if (!lower || !upper) {
        throw new Error(`Missing tick array data for position ${p.ex.positionAddress}`);
      }
      
      // Calculate fees
      const owedA = new BN(p.position.feeOwedA.toString());
      const owedB = new BN(p.position.feeOwedB.toString());
      
      const feeA = owedA.add(feesForSide(0, p.pool, p.position, lower, upper));
      const feeB = owedB.add(feesForSide(1, p.pool, p.position, lower, upper));
      
      // Get or cache token decimals
      const tokenAMint = p.tokenAInfo.mint.toBase58();
      const tokenBMint = p.tokenBInfo.mint.toBase58();
      
      if (!tokenDecimalsCache[tokenAMint]) {
        tokenDecimalsCache[tokenAMint] = p.tokenAInfo.decimals;
      }
      
      if (!tokenDecimalsCache[tokenBMint]) {
        tokenDecimalsCache[tokenBMint] = p.tokenBInfo.decimals;
      }
      
      // Convert to human readable using cached decimals
      const humanA = new Decimal(feeA.toString())
        .div(new Decimal(10).pow(tokenDecimalsCache[tokenAMint]))
        .toNumber();
        
      const humanB = new Decimal(feeB.toString())
        .div(new Decimal(10).pow(tokenDecimalsCache[tokenBMint]))
        .toNumber();

      return {
        positionAddress: p.ex.positionAddress,
        poolAddress: p.poolAddress.toBase58(),
        tokenAAddress: tokenAMint,
        tokenBAddress: tokenBMint,
        tokenASymbol: tokenMetadataMap[tokenAMint]?.symbol ?? tokenAMint.slice(0, 4),
        tokenBSymbol: tokenMetadataMap[tokenBMint]?.symbol ?? tokenBMint.slice(0, 4),
        feeA: humanA,
        feeB: humanB,
      } satisfies WhirlpoolReward;
    } catch (e) {
      console.error('[whirlpool‑rewards] skip fee calculation', p.ex.positionAddress, e);
      return null;
    }
  }).filter(Boolean) as WhirlpoolReward[];

  /* USD enrichment */
  const mints  = [...new Set(rows.flatMap(r => [r.tokenAAddress, r.tokenBAddress]))]; 
  const prices = await getTokenPrices(mints);
  
  rows.forEach((r: WhirlpoolReward) => {
    if (prices[r.tokenAAddress]) r.feeAUsd = r.feeA * prices[r.tokenAAddress];
    if (prices[r.tokenBAddress]) r.feeBUsd = r.feeB * prices[r.tokenBAddress];
    r.totalUsd = (r.feeAUsd ?? 0) + (r.feeBUsd ?? 0);
  });

  return rows;
}
