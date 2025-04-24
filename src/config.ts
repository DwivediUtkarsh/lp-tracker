import dotenv from 'dotenv'
dotenv.config()

export const RPC_ENDPOINT =
  process.env.SOLANA_RPC ||
  'https://api.mainnet-beta.solana.com'          // fallback

export const QUICKNODE_RPC = RPC_ENDPOINT
export const DATABASE_URL   = process.env.DATABASE_URL!