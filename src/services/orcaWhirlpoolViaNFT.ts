// File: src/services/orcaWhirlpoolViaNFT.ts

/**
 * Method ①: NFT-scan → Position PDA → on-chain math
 * — see steps in comments below
 */

import { Connection, PublicKey } from '@solana/web3.js'
import { TOKEN_PROGRAM_ID } from '@solana/spl-token'
import { Exposure } from '../types/Exposure.js'
import { getTokenMetadata } from '../utils/tokenUtils.js'
import {
  WhirlpoolContext,
  buildWhirlpoolClient,
  PDAUtil,
  ORCA_WHIRLPOOL_PROGRAM_ID
} from "@orca-so/whirlpools-sdk";

/**
 * A no-op wallet adapter that satisfies the SDK's Wallet interface for read-only operations
 */
class ReadOnlyWallet {
  readonly publicKey: PublicKey;
  constructor(pubkey: PublicKey) {
    this.publicKey = pubkey;
  }
  async signTransaction(tx: any) { return tx; }
  async signAllTransactions(txs: any[]) { return txs; }
}

/**
 * Enhanced method to fetch Whirlpool positions via NFTs
 * with complete token and fee details
 */
export async function fetchWhirlpoolsViaNFT(
  connection: Connection,
  owner: PublicKey
): Promise<Exposure[]> {
  console.log('[whirlpool|NFT] Scanning token accounts…')

  // Initialize SDK client
  const walletAdapter = new ReadOnlyWallet(owner);
  const ctx = WhirlpoolContext.from(
    connection,
    walletAdapter,
    ORCA_WHIRLPOOL_PROGRAM_ID
  );
  const client = buildWhirlpoolClient(ctx);

  // 1️⃣ Get all parsed token accounts for owner
  const { value: tokenAccts } = await connection.getParsedTokenAccountsByOwner(
    owner,
    { programId: TOKEN_PROGRAM_ID }
  )

  // 2️⃣ Filter for NFTs (amount=1, decimals=0)
  const nftAccts = tokenAccts.filter(({ account }) => {
    const info = (account.data as any).parsed.info
    return info.tokenAmount.amount === '1' && info.tokenAmount.decimals === 0
  })
  console.log(`[whirlpool|NFT] Found ${nftAccts.length} NFT-like tokens`)

  const exposures: Exposure[] = []

  for (const { account } of nftAccts) {
    try {
      const info = (account.data as any).parsed.info
      const mintPubkey = new PublicKey(info.mint)

      // 3️⃣ Derive Position PDA from this NFT mint
      const positionPDA = PDAUtil.getPosition(
        ORCA_WHIRLPOOL_PROGRAM_ID,
        mintPubkey
      )

      // Get the position using SDK client
      const position = await client.getPosition(positionPDA.publicKey)
        .catch(() => null)
      
      if (!position) {
        continue // Not a whirlpool position NFT
      }

      console.log(`  ✓ Found position for NFT: ${mintPubkey.toBase58()}`)

      // Get position data and extract details
      const positionData = position.getData();
      
      // Get pool information and token details
      const pool = await client.getPool(positionData.whirlpool);
      const tokenAInfo = pool.getTokenAInfo();
      const tokenBInfo = pool.getTokenBInfo();
      const mintA = tokenAInfo.mint.toBase58();
      const mintB = tokenBInfo.mint.toBase58();

      // Get token symbols from on-chain metadata (or fallback to shortened mint)
      const symA = (await getTokenMetadata(mintA)).symbol ?? mintA.slice(0, 4);
      const symB = (await getTokenMetadata(mintB)).symbol ?? mintB.slice(0, 4);

      // Calculate uncollected fees for both tokens, converting to human-readable amounts
      const qtyA = Number(positionData.feeOwedA) / 10 ** tokenAInfo.decimals;
      const qtyB = Number(positionData.feeOwedB) / 10 ** tokenBInfo.decimals;

      // Create and add the exposure entry
      exposures.push({
        dex: 'orca-whirlpool',
        pool: `${symA}-${symB}`,
        tokenA: symA,
        tokenB: symB,
        qtyA,
        qtyB,
      })

      console.log(`  ✅ Added position ${positionPDA.publicKey.toBase58()}: ${symA}-${symB} (fees A=${qtyA}, B=${qtyB})`)
    } catch (err) {
      console.error('[whirlpool|NFT] Error processing NFT:', err)
    }
  }

  return exposures
} 