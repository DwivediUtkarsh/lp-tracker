import { PublicKey, Connection } from "@solana/web3.js";
import { ReliableConnection, TOKEN_PROGRAM_ID } from "../utils/solana.js";
import { Exposure } from "../types/Exposure.js";
import fetch from "node-fetch";

interface PoolMeta {
  name: string;
  tokenA: string;
  tokenB: string;
  lpMint: string;
  reserveA: number;
  reserveB: number;
  decimals: number;
  id: string; // AMM ID
}

// In‑memory cache that can be refreshed daily
let raydiumPools: Record<string, PoolMeta> = {};
const POOLS_URL =
  "https://api.raydium.io/v2/sdk/liquidity/mainnet.json";

export async function preloadRaydiumPools(force = false): Promise<void> {
  if (!force && Object.keys(raydiumPools).length) return;
  const res = await fetch(POOLS_URL);
  const json = (await res.json()) as PoolMeta[];
  raydiumPools = Object.fromEntries(
    json.map((p) => [p.lpMint, p])
  );
  console.log(`[raydium] cached ${json.length} pools`);
}

export async function getRaydiumExposures(
  conn: ReliableConnection,
  owner: PublicKey
): Promise<Exposure[]> {
  await preloadRaydiumPools();
  const { value } = await conn.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  });
  const exposures: Exposure[] = [];
  for (const { account } of value) {
    const info = (account.data as any).parsed.info;
    const mint = info.mint as string;
    const raw = BigInt(info.tokenAmount.amount);
    if (raw === 0n) continue;

    const pool = raydiumPools[mint];
    if (!pool) continue;

    const lpBal = Number(raw) / 10 ** pool.decimals;
    const share = lpBal / pool.reserveA /* pretend total LP = reserveA */;

    exposures.push({
      dex: "raydium",
      pool: pool.name,
      tokenA: pool.tokenA,
      tokenB: pool.tokenB,
      qtyA: share * pool.reserveA,
      qtyB: share * pool.reserveB,
    });
  }
  return exposures;
}
