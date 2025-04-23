import { PublicKey } from '@solana/web3.js'
import dotenv from 'dotenv'
import { ReliableConnection } from './utils/solana.js'
import { getRaydiumExposure } from './raydium/positionTracker.js'
import { getOrcaExposure } from './orca/positionTracker.js'
import { getWhirlpoolExposure } from './orca/whirlpoolTracker.js'
import { Exposure } from './types/Exposure.js'

dotenv.config()

async function main() {
  const walletArg = process.argv[2]
  if (!walletArg) {
    console.error('Usage: npm run dev <WALLET_PUBKEY>')
    process.exit(1)
  }

  const wallet = new PublicKey(walletArg)
  const endpoint = process.env.SOLANA_RPC ?? 'https://api.mainnet-beta.solana.com'
  const conn = new ReliableConnection(endpoint)

  console.log(`🔗 RPC: ${endpoint}`)
  console.log(`👛 Wallet: ${wallet.toBase58()}\n`)

  const ray   = (await getRaydiumExposure(conn, wallet)).map(mapDex('raydium'))
  const orcC  = (await getOrcaExposure(conn, wallet)).map(mapDex('orca-classic'))
  const orcW  = await getWhirlpoolExposure(conn, wallet)              // already tagged
  const all: Exposure[] = [...ray, ...orcC, ...orcW]

  if (all.length === 0) {
    console.log('No LP or Whirlpool positions detected.')
    return
  }

  console.table(
    all.map(p => ({
      DEX: p.dex.toUpperCase(),
      Pool: p.pool,
      [`${p.tokenA} qty`]: p.qtyA.toFixed(6),
      [`${p.tokenB} qty`]: p.qtyB.toFixed(6),
    }))
  )
}

function mapDex(dex: Exposure['dex']) {
  return (e: Omit<Exposure, 'dex'>): Exposure => ({ dex, ...e })
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
