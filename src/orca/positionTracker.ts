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

export async function getOrcaExposure(
  connection: ReliableConnection,
  owner: PublicKey
): Promise<Exposure[]> {
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(owner, {
    programId: TOKEN_PROGRAM_ID
  })

  const exposures: Exposure[] = []

  for (const { account } of tokenAccounts.value) {
    if (!isParsed(account.data)) continue    // ensure correct shape

    const info = account.data.parsed.info
    const mint = info.mint as string
    const rawAmount = BigInt(info.tokenAmount.amount)

    // Skip if not an Orca LP mint or zero balance
    if (!(mint in pools) || rawAmount === 0n) continue

    const poolMeta = pools[mint as keyof typeof pools]
    const decimals = BigInt(poolMeta.decimals)
    const divisor = 10n ** decimals
    const lpBalance = Number(rawAmount) / Number(divisor)

    // Simplified share calculation (stub reserves)
    const share = lpBalance / poolMeta.reserveA

    exposures.push({
      pool: poolMeta.name,
      tokenA: poolMeta.tokenA,
      tokenB: poolMeta.tokenB,
      qtyA: share * poolMeta.reserveA,
      qtyB: share * poolMeta.reserveB
    })
  }

  return exposures
}
