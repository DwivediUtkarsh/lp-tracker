// ── src/services/whirlpoolRewardsService.ts ────────────────────────────
// Helius‑backed exact fee calculator for Orca Whirlpool LP positions
// (c) 2025 utkarsh‑dwivedi – MIT

import 'dotenv/config'; // loads HELEIUS_API_KEY from .env
import { Connection, PublicKey } from '@solana/web3.js'; // Solana RPC types
import { AnchorProvider } from '@coral-xyz/anchor'; // Anchor provider for WhirlpoolContext
import BN from 'bn.js'; // Big number library for fixed-point arithmetic
import { Decimal } from 'decimal.js'; // precise decimal calculations
import pMap from 'p-map'; // promise map with concurrency control

import {
  WhirlpoolContext,
  buildWhirlpoolClient,
  PDAUtil,
  TickArrayUtil,
  WhirlpoolData,
  PositionData,
} from '@orca-so/whirlpools-sdk'; // Orca SDK types and utilities

import { getTokenPrices }  from './priceService.js'; // fetch USD prices for tokens
import { getTokenMetadata } from '../utils/tokenUtils.js'; // fetch on-chain token metadata
import { ReliableConnection } from '../utils/solana.js'; // custom reliable Solana connection

// Program ID for Orca Whirlpool on Solana
const PROGRAM_ID = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');

// Fixed-point conversion constants
const Q64  = new BN(1).ushln(64);   // 2^64 – shift divisor for Q64.64 fixed-point
const Q128 = new BN(1).ushln(128);  // 2^128 – modulus for wrap-around arithmetic
const TICKS_PER_ARRAY = 88;         // number of ticks stored per array segment

/*──────────────────────── connection helpers ────────────────────────*/
// Build Helius RPC URL using API key
function heliusUrl() {
  const key = process.env.HELIUS_API_KEY;
  if (!key) throw new Error('HELIUS_API_KEY missing');
  return `https://mainnet.helius-rpc.com/?api-key=${key}`;
}

// Create an Anchor-based WhirlpoolContext for a given owner public key
function newCtx(owner: PublicKey) {
  const conn   = new Connection(heliusUrl(), { commitment: 'processed' });
  const wallet = {
    publicKey: owner,                   // only publicKey is required by AnchorProvider
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (xs: any[]) => xs,
  } as any;
  const provider = new AnchorProvider(conn, wallet, AnchorProvider.defaultOptions());
  return WhirlpoolContext.withProvider(provider, PROGRAM_ID);
}

/*──────────────────────── retry utilities ──────────────────────────*/
// Generic exponential-backoff retry for HTTP 429 rate-limit errors
async function retry<T>(fn: () => Promise<T>, max = 5, wait = 500): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e: any) {
      // Only retry on 429 errors up to max attempts
      if (i >= max || !e.message?.includes('429')) throw e;
      const delay = wait * 2 ** i;
      console.log(`429 – retry in ${delay} ms …`);
      await new Promise(r => setTimeout(r, delay));
    }
  }
}

// Specialized retry for mint metadata fetch failures
async function retryMint<T>(fn: () => Promise<T>, max = 3, wait = 500): Promise<T> {
  for (let i = 0; ; i++) {
    try { return await fn(); }
    catch (e: any) {
      // Retry on specific mint fetch errors
      if (i >= max || (!e.message?.includes('Unable to fetch Mint') && !e.message?.includes('account not found'))) throw e;
      console.log(`Mint fetch error – retry in ${wait} ms …`);
      await new Promise(r => setTimeout(r, wait));
    }
  }
}

// Cache token decimals to reduce repeated metadata calls
const tokenDecimalsCache: Record<string, number> = {};

/*──────────────────────── tick array loaders ───────────────────────*/
// Batch-fetch tick arrays for multiple positions in one RPC call
async function batchLoadTickArrays(
  ctx: WhirlpoolContext,
  positions: Array<{ pool: PublicKey, spacing: number, lowerTick: number, upperTick: number }>
): Promise<Record<string, { lower: any, upper: any }>> {
  if (positions.length === 0) return {}; // nothing to load

  const tickArrayPDAs: PublicKey[] = [];
  const positionTickArrayMap: Record<string, { lowerIndex: number, upperIndex: number }> = {};

  // Compute all PDAs and track their indices for mapping
  positions.forEach((pos, i) => {
    const lowerPda = PDAUtil.getTickArrayFromTickIndex(pos.lowerTick, pos.spacing, pos.pool, PROGRAM_ID);
    const upperPda = PDAUtil.getTickArrayFromTickIndex(pos.upperTick, pos.spacing, pos.pool, PROGRAM_ID);
    tickArrayPDAs.push(lowerPda.publicKey, upperPda.publicKey);
    positionTickArrayMap[`${pos.pool.toBase58()}-${pos.lowerTick}-${pos.upperTick}`] = {
      lowerIndex: i * 2,
      upperIndex: i * 2 + 1,
    };
  });

  // Single RPC call to fetch all tick arrays
  const rawTickArrays = await retry(() => ctx.fetcher.getTickArrays(tickArrayPDAs));

  // Map RPC results back to each position key
  const result: Record<string, { lower: any, upper: any }> = {};
  positions.forEach(pos => {
    const key = `${pos.pool.toBase58()}-${pos.lowerTick}-${pos.upperTick}`;
    const { lowerIndex, upperIndex } = positionTickArrayMap[key];
    result[key] = {
      lower: rawTickArrays[lowerIndex],
      upper: rawTickArrays[upperIndex],
    };
  });

  return result;
}

// Single-position loader leveraging batch loader for backward compatibility
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
// Extract fee growth data for a single tick boundary
function getTick(tarr: any, index: number, spacing: number) {
  const util  = TickArrayUtil as any;
  if (typeof util.getTickFromArray === 'function')
    return util.getTickFromArray(tarr, index, spacing);

  // Manual fallback: compute slot from raw data structure
  const data  = tarr.data ?? tarr;
  const start = data.startTickIndex;
  const slot  = Math.floor((index - start) / spacing);
  return data.ticks?.[slot] ?? { feeGrowthOutsideA: '0', feeGrowthOutsideB: '0' };
}

// Compute uncollected fees for one token side (0 = A, 1 = B)
function feesForSide(
  side: 0 | 1,
  pool: WhirlpoolData,
  pos:  PositionData,
  lowArr: any,
  upArr:  any,
): BN {
  const L = new BN(pos.liquidity.toString());
  if (L.isZero()) return new BN(0); // no liquidity → no fees

  // Global cumulative fee growth counter
  const global = new BN(
    (side === 0 ? pool.feeGrowthGlobalA : pool.feeGrowthGlobalB).toString(),
  );

  // Fee growth just outside lower & upper ticks
  const low = getTick(lowArr, pos.tickLowerIndex, pool.tickSpacing);
  const up  = getTick(upArr , pos.tickUpperIndex, pool.tickSpacing);

  const lowOut = new BN((side === 0 ? low.feeGrowthOutsideA : low.feeGrowthOutsideB).toString());
  const upOut  = new BN((side === 0 ? up .feeGrowthOutsideA : up .feeGrowthOutsideB).toString());

  // Determine fee growth below & above current tick
  const below = pool.tickCurrentIndex >= pos.tickLowerIndex
    ? lowOut
    : global.sub(lowOut).umod(Q128);

  const above = pool.tickCurrentIndex <  pos.tickUpperIndex
    ? upOut
    : global.sub(upOut).umod(Q128);

  // Fee growth inside the range = global – below – above
  const inside = global.sub(below).sub(above).umod(Q128);

  // Previous checkpoint to subtract already accounted fees
  const checkpoint = new BN(
    (side === 0 ? pos.feeGrowthCheckpointA : pos.feeGrowthCheckpointB).toString(),
  );
  const delta = inside.sub(checkpoint).umod(Q128);

  // Scale by liquidity and shift down 64 bits to convert Q64.64 to integer
  return delta.mul(L).shrn(64);
}

/*──────────────────────── exported API ───────────────────────────────*/
// Structure for returned uncollected fee data
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

// Main function: fetches all uncollected fees for a wallet owner's positions
export async function getUncollectedFees(
  conn: ReliableConnection,
  owner: PublicKey,
): Promise<WhirlpoolReward[]> {
  // Load position exposures (from whirlpoolService)
  const { getWhirlpoolExposures } = await import('./whirlpoolService.js');
  const expos = await getWhirlpoolExposures(conn, owner);
  if (expos.length === 0) return []; // no positions → empty result

  // Setup on-chain context & client
  const ctx    = newCtx(owner);
  const client = buildWhirlpoolClient(ctx);

  // Process each exposure in parallel with limited concurrency
  const rows = await pMap(
    expos,
    async ex => {
      try {
        // Fetch position & pool data
        const pos  = (await client.getPosition(new PublicKey(ex.positionAddress))).getData();
        const pool = await client.getPool(pos.whirlpool);
        const pd   = pool.getData();

        // Load tick arrays for fee calculation
        const { lower, upper } = await loadTickArrays(
          ctx, pool.getAddress(), pd.tickSpacing, pos.tickLowerIndex, pos.tickUpperIndex,
        );

        // Base owed fees stored in position
        const owedA = new BN(pos.feeOwedA.toString());
        const owedB = new BN(pos.feeOwedB.toString());

        // Calculate additional uncollected fees
        const feeA = owedA.add(feesForSide(0, pd, pos, lower, upper));
        const feeB = owedB.add(feesForSide(1, pd, pos, lower, upper));

        // Fetch token metadata for symbols & decimals
        const tA   = pool.getTokenAInfo();
        const tB   = pool.getTokenBInfo();
        const [mA, mB] = await Promise.all([
          getTokenMetadata(ctx.connection, tA.mint.toBase58()),
          getTokenMetadata(ctx.connection, tB.mint.toBase58()),
        ]);

        // Convert raw fees to human-readable amounts
        const humanA = new Decimal(feeA.toString()).div(new Decimal(10).pow(tA.decimals)).toNumber();
        const humanB = new Decimal(feeB.toString()).div(new Decimal(10).pow(tB.decimals)).toNumber();

        // Return structured result
        return {
          positionAddress: ex.positionAddress,
          poolAddress:     pool.getAddress().toBase58(),
          tokenAAddress:   tA.mint.toBase58(),
          tokenBAddress:   tB.mint.toBase58(),
          tokenASymbol:    mA?.symbol ?? tA.mint.toBase58().slice(0, 4),
          tokenBSymbol:    mB?.symbol ?? tB.mint.toBase58().slice(0, 4),
          feeA: humanA,
          feeB: humanB,
        } satisfies WhirlpoolReward;
      } catch (e) {
        console.error('[whirlpool‑rewards] skip', ex.positionAddress, e);
        return null;
      }
    },
    { concurrency: 6 },
  );

  const list = rows.filter(Boolean) as WhirlpoolReward[];

  // Fetch prices and compute USD values
  const mints  = [...new Set(list.flatMap(r => [r.tokenAAddress, r.tokenBAddress]))];
  const prices = await getTokenPrices(mints);
  list.forEach(r => {
    if (prices[r.tokenAAddress]) r.feeAUsd = r.feeA * prices[r.tokenAAddress];
    if (prices[r.tokenBAddress]) r.feeBUsd = r.feeB * prices[r.tokenBAddress];
    r.totalUsd = (r.feeAUsd ?? 0) + (r.feeBUsd ?? 0);
  });

  return list;
}
