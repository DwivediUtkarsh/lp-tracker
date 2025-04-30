/* --------------------------------------------------------------------------
   Orca Whirlpool – discover ALL positions owned by <wallet>
   Method ②:  getProgramAccounts filter on the Position "owner" field
   --------------------------------------------------------------------------

   npm i @orca-so/whirlpools-sdk @metaplex-foundation/mpl-token-metadata
-----------------------------------------------------------------------------*/
import { Connection, PublicKey } from '@solana/web3.js'
import { Exposure } from '../types/Exposure.js'
import { getTokenMetadata } from '../utils/tokenUtils.js'
import {
  WhirlpoolContext,
  buildWhirlpoolClient,
  ORCA_WHIRLPOOL_PROGRAM_ID
} from "@orca-so/whirlpools-sdk";

// Constants
const POSITION_ACCOUNT_SIZE = 216  // bytes, current on main-net
const OWNER_OFFSET = 8  // discriminator size

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
 * Enhanced method to fetch Whirlpool positions via direct owner lookup
 * and extract token details and fees from each position
 */
export async function fetchWhirlpoolExposuresByOwner(
  connection: Connection,
  owner: PublicKey
): Promise<Exposure[]> {
  console.log('[whirlpool|direct] Scanning for positions owned by', owner.toBase58())

  // Initialize SDK client
  const walletAdapter = new ReadOnlyWallet(owner);
  const ctx = WhirlpoolContext.from(
    connection,
    walletAdapter,
    ORCA_WHIRLPOOL_PROGRAM_ID
  );
  const client = buildWhirlpoolClient(ctx);

  // Get all position accounts owned by this wallet
  const positionAccounts = await connection.getProgramAccounts(
    ORCA_WHIRLPOOL_PROGRAM_ID,
    {
      filters: [
        { dataSize: POSITION_ACCOUNT_SIZE },
        { memcmp: { offset: OWNER_OFFSET, bytes: owner.toBase58() } }
      ]
    }
  )
  
  console.log(`[whirlpool|direct] Found ${positionAccounts.length} positions`)
  
  if (positionAccounts.length === 0) return []

  const exposures: Exposure[] = []

  // Process each position with full details
  for (const { pubkey } of positionAccounts) {
    try {
      // Get position data using the SDK
      const position = await client.getPosition(pubkey);
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
      
      console.log(`  ✅ Added position ${pubkey.toBase58()}: ${symA}-${symB} (fees A=${qtyA}, B=${qtyB})`)
    } catch (err) {
      console.error(`[whirlpool|direct] failed to decode ${pubkey.toBase58()}`, err)
    }
  }

  return exposures
} 