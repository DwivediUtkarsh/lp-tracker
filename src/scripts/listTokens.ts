#!/usr/bin/env tsx
/**
 * src/scripts/listTokens.ts
 * Improved: retries multiple RPC endpoints on timeout.
 */
console.log('🛠 listTokens script invoked')

import { Connection, PublicKey } from '@solana/web3.js'

// List of RPC endpoints to try, in order
const RPC_ENDPOINTS = [
  process.env.SOLANA_RPC,
  'https://api.mainnet-beta.solana.com',
  'https://solana-api.projectserum.com',
  'https://rpc.ankr.com/solana',
].filter(Boolean) as string[]

async function tryFetchTokens(walletAddress: string) {
  const owner = new PublicKey(walletAddress)

  for (const endpoint of RPC_ENDPOINTS) {
    console.log(`🔗 Trying RPC: ${endpoint}`)
    const conn = new Connection(endpoint, 'confirmed')

    try {
      const { value } = await conn.getParsedTokenAccountsByOwner(owner, {
        programId: new PublicKey(
          'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
        ),
      })

      console.log(`\n✅ Success on ${endpoint}`)
      console.log(`\nFound ${value.length} token accounts\n`)
      for (const { account } of value) {
        const info = (account.data as any).parsed.info
        const amount = Number(info.tokenAmount.amount)
        if (amount > 0) {
          console.log(`${info.mint}   balance = ${amount}`)
        }
      }
      return  // stop after first successful fetch

    } catch (err: any) {
      console.warn(`⚠️ RPC failed (${endpoint}): ${err.message}`)
      // small backoff before trying next
      await new Promise((r) => setTimeout(r, 1000))
      continue
    }
  }

  console.error('\n❌ All RPC endpoints failed. Check your network or try custom SOLANA_RPC.')
  process.exit(1)
}

async function main() {
  const [, , wallet] = process.argv
  if (!wallet) {
    console.error('Usage: npx tsx src/scripts/listTokens.ts <WALLET_ADDRESS>')
    process.exit(1)
  }
  await tryFetchTokens(wallet)
}

main()
