// src/services/raydiumService.ts
import { PublicKey } from '@solana/web3.js'
import { ReliableConnection, TOKEN_PROGRAM_ID } from '../utils/solana.js'
import raydiumPoolsRaw from '../raydium/pools.json' assert { type: 'json' }
import { Exposure } from '../types/Exposure.js'

interface PoolMeta {
  name:     string
  tokenA:   string
  tokenB:   string
  reserveA: number
  reserveB: number
  decimals: number
  ammId:    string
}

const raydiumPools = raydiumPoolsRaw as Record<string, PoolMeta>

export async function getRaydiumExposures(
  conn: ReliableConnection,
  owner: PublicKey,
): Promise<Exposure[]> {
  const { value } = await conn.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  })

  const exposures: Exposure[] = []

  for (const { account } of value) {
    const info = (account.data as any).parsed.info
    const mint = info.mint as string
    const raw  = BigInt(info.tokenAmount.amount)
    const dec  = info.tokenAmount.decimals as number
    if (raw === 0n) continue

    // only pools we know about
    const pool = raydiumPools[mint]
    if (!pool) continue

    const lpBal = Number(raw) / 10 ** dec
    // placeholder share math—Phase 2 will replace with real on-chain reserves
    const share = lpBal / 1_000_000

    exposures.push({
      dex:    'raydium',
      pool:   pool.name,
      tokenA: pool.tokenA,
      tokenB: pool.tokenB,
      qtyA:   share * pool.reserveA,
      qtyB:   share * pool.reserveB,
    })
  }

  return exposures
}
