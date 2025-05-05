import * as dotenv from 'dotenv'
dotenv.config()

console.log('Loading environment config...')

// List of public RPC endpoints to try if the main one fails
export const FALLBACK_RPC_ENDPOINTS = [
  'https://api.mainnet-beta.solana.com',
  'https://solana-api.projectserum.com',
  'https://rpc.ankr.com/solana'
]

export const RPC_ENDPOINT =
  process.env.SOLANA_RPC ||
  FALLBACK_RPC_ENDPOINTS[0]

console.log(`Using Solana RPC endpoint: ${RPC_ENDPOINT}`)
export const QUICKNODE_RPC = RPC_ENDPOINT
export const DATABASE_URL = process.env.DATABASE_URL!

// Check if we have a database URL configured
if (!DATABASE_URL) {
  console.warn('⚠️ DATABASE_URL not set in environment variables')
}