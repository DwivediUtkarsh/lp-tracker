#!/usr/bin/env tsx
/**
 * src/scripts/listTokens.ts
 *
 * • Reads SOLANA_RPC from .env (via config.ts)
 * • Lists all Raydium & Orca classic LP exposures for a wallet
 * • Prints a console.table of DEX / Pool / tokenA qty / tokenB qty
 */

import { PublicKey } from '@solana/web3.js'
import { RPC_ENDPOINT } from '../config.js'
import { ReliableConnection } from '../utils/solana.js'
import { getRaydiumExposures } from '../services/raydiumService.js'
import { getOrcaExposures }    from '../services/orcaService.js'

async function main() {
  const [, , walletArg] = process.argv
  if (!walletArg) {
    console.error('Usage: npx tsx src/scripts/listTokens.ts <WALLET_PUBKEY>')
    process.exit(1)
  }

  const wallet = new PublicKey(walletArg)
  console.log('🔗 RPC:', RPC_ENDPOINT)
  console.log('👛 Wallet:', wallet.toBase58(), '\n')

  const conn = new ReliableConnection(RPC_ENDPOINT)

  // Fetch both DEX exposures in parallel
  const [raydium, orca] = await Promise.all([
    getRaydiumExposures(conn, wallet),
    getOrcaExposures(conn,    wallet),
  ])

  const exposures = [...raydium, ...orca]
  if (!exposures.length) {
    console.log('No classic LP positions detected.')
    return
  }

  // Format for console.table
  const rows = exposures.map((e) => ({
    DEX:   e.dex.toUpperCase(),
    Pool:  e.pool,
    [`${e.tokenA} qty`]: e.qtyA.toFixed(6),
    [`${e.tokenB} qty`]: e.qtyB.toFixed(6),
  }))

  console.table(rows)
}

main().catch((err) => {
  console.error('Error listing LP exposures:', err)
  process.exit(1)
})
