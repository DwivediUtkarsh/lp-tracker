// src/services/orcaService.ts

import { PublicKey } from '@solana/web3.js'
import { ReliableConnection, TOKEN_PROGRAM_ID } from '../utils/solana.js'
import orcaPoolsRaw from '../orca/pools.json' assert { type: 'json' }
import { Exposure } from '../types/Exposure.js'

// 1) Mirror your pools.json shape in a TypeScript interface
interface PoolMeta {
  name:     string
  tokenA:   string
  tokenB:   string
  reserveA: number
  reserveB: number
  decimals: number
  ammId:    string
}

// 2) Cast the raw import to a lookup map
const orcaPools = orcaPoolsRaw as Record<string, PoolMeta>

/**
 * Fetches all SPL token accounts for `owner`, then for each account:
 * - If `mint` matches a key in orcaPools, compute stubbed exposure
 * - Otherwise skip
 */
export async function getOrcaExposures(
  conn: ReliableConnection,
  owner: PublicKey,
): Promise<Exposure[]> {
  // Fetch all parsed token accounts via your utility wrapper
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

    // Only pools defined in pools.json
    const pool = orcaPools[mint]
    if (!pool) continue

    const lpBal = Number(raw) / 10 ** dec
    // Phase-1 stub math: assume 1 M LP = full pool
    const share = lpBal / 1_000_000

    exposures.push({
      dex:    'orca-classic',
      pool:   pool.name,
      tokenA: pool.tokenA,
      tokenB: pool.tokenB,
      qtyA:   share * pool.reserveA,
      qtyB:   share * pool.reserveB,
    })
  }

  return exposures
}
