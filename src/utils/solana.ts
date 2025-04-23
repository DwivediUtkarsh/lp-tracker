
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
  
  export class ReliableConnection {
    constructor(
      readonly endpoint: string,
      readonly commitment: Commitment = 'confirmed',
    ) {
      this.conn = new Connection(endpoint, commitment)
    }
    private conn: Connection
  
    // Generic retry wrapper
    private async retry<T>(fn: () => Promise<T>, attempt = 0): Promise<T> {
      try {
        return await fn()
      } catch (err) {
        if (attempt >= MAX_RETRIES) throw err
        await new Promise((r) => setTimeout(r, BACKOFF_MS * 2 ** attempt))
        return this.retry(fn, attempt + 1)
      }
    }
  
    async getParsedTokenAccountsByOwner(
      owner: PublicKey,
      filter: TokenAccountsFilter,
    ) {
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
  