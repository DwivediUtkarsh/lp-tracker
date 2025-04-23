/**
 * raydium/positionTracker.ts
 * --------------------------
 * Phase-1 logic to derive underlying token exposure from Raydium LP tokens
 *
 * Steps:
 *   1. Fetch ALL SPL-token accounts for the wallet
 *   2. Identify which token mints are Raydium pool LP mints
 *   3. For each LP balance: calculate share = (LP balance / totalSupply)
 *      –  We approximate: underlyingA = share * reserveA (snapshot)
 *      –  same for underlyingB
 *
 * Big simplifications in Phase-1:
 *   • totalSupply assumed 1:1 with reserve snapshot (we’ll read mint data later)
 *   • reserves are pulled from pools.json, not on-chain
 */

import { PublicKey } from '@solana/web3.js'
import pools from './pools.json' assert { type: 'json' }
import { ReliableConnection, TOKEN_PROGRAM_ID, isParsed } from '../utils/solana.js'

export interface Exposure {
  pool: string
  tokenA: string
  tokenB: string
  qtyA: number
  qtyB: number
}

export async function getRaydiumExposure(
  connection: ReliableConnection,
  owner: PublicKey,
): Promise<Exposure[]> {
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID,
  })

  const exposures: Exposure[] = []

  for (const { account } of tokenAccounts.value) {
    // Skip unexpected account shapes (edge-case safety)
    if (!isParsed(account.data)) continue

    const info = account.data.parsed.info
    const mint = info.mint as string
    const rawAmount = BigInt(info.tokenAmount.amount)

    // Step 1: is this mint one of our Raydium pool LP tokens?
    if (!(mint in pools) || rawAmount === 0n) continue

    const poolMeta = pools[mint as keyof typeof pools]
    const decimals = BigInt(poolMeta.decimals)
    const divisor = 10n**decimals

    // Convert balance to float w/ decimals (fine for Phase-1)
    const lpBalance = Number(rawAmount) / Number(divisor)

    // **Simplified share calculation**
    // Raydium LP tokens are proportional shares of pool reserves.
    // In real math we'd fetch:
    //   • lpMint.totalSupply
    //   • pool.reserveA, pool.reserveB (on-chain)
    // and compute: share = lpBalance / totalSupply
    // For prototype we assume totalSupply = reserveA (after decimals)
    const share = lpBalance / poolMeta.reserveA

    exposures.push({
      pool: poolMeta.name,
      tokenA: poolMeta.tokenA,
      tokenB: poolMeta.tokenB,
      qtyA: share * poolMeta.reserveA,
      qtyB: share * poolMeta.reserveB,
    })
  }

  return exposures
}
