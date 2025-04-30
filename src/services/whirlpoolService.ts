// ── src/services/whirlpoolService.ts ───────────────────────────────────────
/**
 * This service handles interactions with Orca Whirlpool liquidity pools.
 * It directly fetches position data for a wallet using the Orca SDK's fetchPositionsForOwner function.
 */
import { PublicKey } from "@solana/web3.js";
import { ReliableConnection } from "../utils/solana.js";
import { Exposure } from "../types/Exposure.js";
import { fetchPositionsForOwner, setWhirlpoolsConfig } from '@orca-so/whirlpools';
import { createSolanaRpc, mainnet, address } from '@solana/kit';
import { getTokenMetadata } from "../utils/tokenUtils.js";

/**
 * Fetches all Orca Whirlpool LP positions for a wallet owner.
 * 
 * The function:
 * 1. Sets up a connection to the Orca Whirlpool SDK
 * 2. Uses the fetchPositionsForOwner function to find all positions by owner
 * 3. Extracts position details including token amounts and fees
 * 
 * @param conn - ReliableConnection to Solana network
 * @param owner - PublicKey of the wallet to scan
 * @returns Array of Exposure objects representing Whirlpool positions
 */
export async function getWhirlpoolExposures(
  conn: ReliableConnection,
  owner: PublicKey
): Promise<Exposure[]> {
  console.log("[whirlpool] scanning for positions owned by", owner.toBase58());

  try {
    // Configure for mainnet
    await setWhirlpoolsConfig('solanaMainnet');
    
    // Create a Solana RPC client using the connection endpoint
    const mainnetRpc = createSolanaRpc(mainnet(conn.endpoint));

    // Convert the PublicKey to the format expected by @solana/kit
    const ownerAddress = address(owner.toString());

    // Fetch all positions owned by this wallet using the SDK
    const positions = await fetchPositionsForOwner(mainnetRpc, ownerAddress);
    console.log(`[whirlpool] found ${positions.length} positions`);
    
    if (positions.length === 0) {
      return [];
    }

    const exposures: Exposure[] = [];

    // Process each position
    for (const position of positions) {
      try {
        // Skip position bundles and only process individual positions
        if (!('data' in position) || !('whirlpool' in position.data)) {
          console.log(`Skipping position bundle: ${position.address.toString()}`);
          continue;
        }

        console.log(`✓ Processing Whirlpool position ${position.address.toString()}`);

        // Get the whirlpool address
        const whirlpoolAddress = position.data.whirlpool.toString();

        // TODO: In a full implementation, we would fetch the pool details
        // and token information. For now, we'll use placeholder values
        // until we can fetch the complete information.
        
        // For demonstration, use address prefixes as temporary identifiers
        const mintAPrefix = whirlpoolAddress.slice(0, 4);
        const mintBPrefix = whirlpoolAddress.slice(4, 8);

        // Get fee amounts (convert from raw values to human-readable)
        // In a full implementation, we would use proper decimals from token info
        const qtyA = Number(position.data.feeOwedA) / 10 ** 6; // Assuming 6 decimals
        const qtyB = Number(position.data.feeOwedB) / 10 ** 6; // Assuming 6 decimals

        // Create exposure object with position details
        exposures.push({
          dex: "orca-whirlpool",
          pool: `${mintAPrefix}-${mintBPrefix}`,
          tokenA: mintAPrefix,
          tokenB: mintBPrefix,
          qtyA,
          qtyB,
        });
      } catch (error) {
        console.error(
          `[whirlpool] error processing position ${position.address.toString()}:`,
          error
        );
      }
    }

    return exposures;
  } catch (error) {
    console.error("[whirlpool] error fetching positions:", error);
    return [];
  }
}
