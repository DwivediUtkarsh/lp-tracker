/**
 * utils/solana.ts
 * ----------------
 * A very small wrapper around @solana/web3.js Connection that:
 *  1. Performs basic retry w/ exponential backoff on flaky RPC calls
 *  2. Exposes helper to fetch all token accounts for a wallet
 *
 * Keeping this isolated lets us: (a) unit-test without hitting main-net
 * and (b) swap in a load-balanced RPC provider later with zero code-mods.
 */

import {
    Connection,
    PublicKey,
    TokenAccountsFilter,
    Commitment,
    ParsedAccountData,
  } from '@solana/web3.js'
  
  const MAX_RETRIES = 3
  const BACKOFF_MS = 500
  const DEFAULT_TIMEOUT_MS = 15000 // 15 second timeout
  
  export class ReliableConnection {
    constructor(
      readonly endpoint: string,
      readonly commitment: Commitment = 'confirmed',
      readonly timeoutMs: number = DEFAULT_TIMEOUT_MS
    ) {
      this.conn = new Connection(endpoint, commitment)
    }
    private conn: Connection
  
    // Generic retry wrapper with timeout
    private async retry<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
      try {
        console.log(`RPC request attempt ${attempt + 1}/${MAX_RETRIES + 1}`)
        
        // Create a promise that resolves with the RPC result
        const resultPromise = fn()
        
        // Create a promise that rejects after timeout
        const timeoutPromise = new Promise<never>((_, reject) => {
          setTimeout(() => {
            reject(new Error(`Request timed out after ${this.timeoutMs}ms`))
          }, this.timeoutMs)
        })
        
        // Race between the timeout and the actual request
        return await Promise.race([resultPromise, timeoutPromise])
      } catch (err) {
        console.error(`RPC error (attempt ${attempt + 1}/${MAX_RETRIES + 1}):`, err)
        if (attempt >= MAX_RETRIES) throw err
        const backoffTime = BACKOFF_MS * 2 ** attempt
        console.log(`Backing off for ${backoffTime}ms before retry`)
        await new Promise((r) => setTimeout(r, backoffTime))
        return this.retry(fn, attempt + 1)
      }
    }
  
    async getParsedTokenAccountsByOwner(
      owner: PublicKey,
      filter: TokenAccountsFilter,
    ) {
      console.log(`Getting parsed token accounts for ${owner.toString()}`)
      return this.retry(() =>
        this.conn.getParsedTokenAccountsByOwner(owner, filter),
      )
    }
  }
  
  /**
   * Shorthand constant for the SPL-Token program ID
   * (saves a slow network fetch every call)
   */
  export const TOKEN_PROGRAM_ID = new PublicKey(
    'TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA',
  )
  
  // Utility-type guard for the `ParsedAccountData` subtype we expect
  export function isParsed(accountData: unknown): accountData is ParsedAccountData {
    return (
      typeof accountData === 'object' &&
      accountData !== null &&
      'program' in accountData
    )
  }
  