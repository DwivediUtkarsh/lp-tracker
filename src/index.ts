import { PublicKey } from '@solana/web3.js'
import { RPC_ENDPOINT } from './config.js'
import { ReliableConnection } from './utils/solana.js'
import { getRaydiumExposures } from './services/raydiumService.js'
import { getOrcaExposures }    from './services/orcaService.js'
import { getWhirlpoolExposures } from './services/whirlpoolService.js'

async function main() {
  const [, , walletArg] = process.argv
  if (!walletArg) {
    console.error('Usage: npm run dev <WALLET_PUBKEY>')
    process.exit(1)
  }

  const wallet = new PublicKey(walletArg)
  console.log('🔗 RPC endpoints:', RPC_ENDPOINT)
  console.log('👛 Wallet:', wallet.toBase58(), '\n')

  const conn = new ReliableConnection(RPC_ENDPOINT)

  const [raydium, orca, whirl] = await Promise.all([
    getRaydiumExposures(conn, wallet),
    getOrcaExposures(conn, wallet),
    getWhirlpoolExposures(conn, wallet),
  ])

  const rows = [...raydium, ...orca, ...whirl]
  if (!rows.length) {
    console.log('No LP positions detected.')
    return
  }

  console.table(
    rows.map((r) => ({
      DEX: r.dex,
      Pool: r.pool,
      [`${r.tokenA} qty`]: r.qtyA.toFixed(6),
      [`${r.tokenB} qty`]: r.qtyB.toFixed(6),
    })),
  )
}

main().catch(console.error)
