import { PublicKey, Connection } from '@solana/web3.js';
import { getWhirlpoolExposures } from './whirlpoolService.js';
import { ReliableConnection } from '../utils/solana.js';
import { 
  getOrCreateWallet, 
  getOrCreateToken, 
  getOrCreatePool,
  getOrCreatePosition,
  updatePositionLiquidity 
} from '../db/models.js';
import { Exposure } from '../types/Exposure.js';
import { getTokenMetadata } from '../utils/tokenUtils.js';
import { Pool, Token } from '../db/models.js';
import { query } from '../utils/database.js';

/**
 * Syncs all current Whirlpool positions for a wallet to the database
 * @param connection Solana connection
 * @param walletAddress Wallet public key to fetch positions for
 * @param options Optional configuration
 * @returns Summary of the sync operation
 */
export async function syncWhirlpoolPositions(
  connection: ReliableConnection,
  walletAddress: PublicKey,
  options: {
    updatePrices?: boolean;
    markInactivePositions?: boolean;
  } = {}
) {
  const startTime = Date.now();
  console.log(`Starting Whirlpool positions sync for wallet: ${walletAddress.toBase58()}`);
  
  // Create a summary object
  const summary = {
    syncedAt: new Date(),
    walletAddress: walletAddress.toBase58(),
    totalPositionsFound: 0,
    newPositionsAdded: 0,
    positionsUpdated: 0,
    poolsAdded: 0,
    tokensAdded: 0,
    errors: [] as string[],
    elapsedMs: 0
  };
  
  try {
    // Get or create wallet in the database
    const wallet = await getOrCreateWallet(walletAddress.toBase58());
    
    // Fetch all current positions from blockchain
    const exposures = await getWhirlpoolExposures(connection, walletAddress);
    summary.totalPositionsFound = exposures.length;
    
    if (exposures.length === 0) {
      console.log('No Whirlpool positions found for this wallet');
      summary.elapsedMs = Date.now() - startTime;
      return summary;
    }
    
    console.log(`Found ${exposures.length} Whirlpool positions. Processing...`);
    
    // Process each position
    for (const exposure of exposures) {
      try {
        // Create or get tokens
        const tokenA = await getOrCreateToken({
          symbol: exposure.tokenA,
          address: exposure.tokenAAddress
        });
        
        const tokenB = await getOrCreateToken({
          symbol: exposure.tokenB,
          address: exposure.tokenBAddress
        });
        
        // Fetch additional token metadata if missing
        if (!tokenA.name || !tokenA.decimals) {
          try {
            const tokenMetadata = await getTokenMetadata(connection.getConnection(), exposure.tokenAAddress);
            if (tokenMetadata) {
              await updateTokenMetadata(tokenA, tokenMetadata);
              summary.tokensAdded++;
            }
          } catch (err) {
            console.error(`Error fetching metadata for ${exposure.tokenA}:`, err);
          }
        }
        
        if (!tokenB.name || !tokenB.decimals) {
          try {
            const tokenMetadata = await getTokenMetadata(connection.getConnection(), exposure.tokenBAddress);
            if (tokenMetadata) {
              await updateTokenMetadata(tokenB, tokenMetadata);
              summary.tokensAdded++;
            }
          } catch (err) {
            console.error(`Error fetching metadata for ${exposure.tokenB}:`, err);
          }
        }
        
        // Create or get pool
        // Define interface for pool data including optional fields
        interface PoolCreateData {
          address: string;
          protocol: string;
          token_a_id: number;
          token_b_id: number;
          fee_rate?: number;
          tick_spacing?: number;
        }
        
        // Create the pool data object with proper typing
        const poolData: PoolCreateData = {
          address: exposure.poolAddress || exposure.pool, // Use the actual pool address if available
          protocol: exposure.dex, // 'whirlpool'
          token_a_id: tokenA.id!,
          token_b_id: tokenB.id!,
        };
        
        // Add fee rate and tick spacing if available in the exposure data
        if (exposure.feeRate) {
          poolData.fee_rate = exposure.feeRate;
        }
        
        if (exposure.tickSpacing) {
          poolData.tick_spacing = exposure.tickSpacing;
        }
        
        const pool = await getOrCreatePool(poolData);
        
        if (pool && !pool.id) {
          summary.poolsAdded++;
        }
        
        // Use the correct position NFT address
        const positionAddress = exposure.positionAddress;
        
        // Create or update position
        const positionData = {
          wallet_id: wallet.id!,
          position_address: positionAddress,
          pool_id: pool.id!,
          token_a_qty: exposure.qtyA,
          token_b_qty: exposure.qtyB,
          is_active: true
          // Note: Lower/upper tick indexes and liquidity amount will be set in future enhancements
        };
        
        const existingPosition = await getOrCreatePosition(positionData);
        
        if (existingPosition && !existingPosition.id) {
          summary.newPositionsAdded++;
        } else {
          // Update the position only if quantities changed
          if (
            existingPosition.token_a_qty !== exposure.qtyA || 
            existingPosition.token_b_qty !== exposure.qtyB
          ) {
            await updatePositionLiquidity(
              existingPosition.id!,
              existingPosition.liquidity || 0,
              exposure.qtyA,
              exposure.qtyB
            );
            summary.positionsUpdated++;
          }
        }
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : String(error);
        console.error(`Error processing position for ${exposure.tokenA}/${exposure.tokenB}:`, errorMsg);
        summary.errors.push(`Position ${exposure.tokenA}/${exposure.tokenB}: ${errorMsg}`);
      }
    }
    
    // Mark positions as inactive if they're in the DB but not in the current fetch
    // (only if requested by options)
    if (options.markInactivePositions) {
      await markInactivePositions(wallet.id!, exposures);
    }

    summary.elapsedMs = Date.now() - startTime;
    console.log(`Sync completed in ${summary.elapsedMs}ms`);
    return summary;
    
  } catch (error) {
    const errorMsg = error instanceof Error ? error.message : String(error);
    console.error('Error syncing Whirlpool positions:', errorMsg);
    summary.errors.push(`Global error: ${errorMsg}`);
    summary.elapsedMs = Date.now() - startTime;
    return summary;
  }
}

/**
 * Helper function to update token metadata in the database
 */
async function updateTokenMetadata(token: Token, metadata: any): Promise<void> {
  if (!token.id) return;
  
  // Create update query for the token
  const updates: any = {};
  
  if (metadata.name && !token.name) {
    updates.name = metadata.name;
  }
  
  if (metadata.decimals && !token.decimals) {
    updates.decimals = metadata.decimals;
  }
  
  if (metadata.symbol && token.symbol === token.address.slice(0, 4)) {
    updates.symbol = metadata.symbol;
  }
  
  // Update the token in the database if we have updates
  if (Object.keys(updates).length > 0) {
    try {
      // Build SET clause for the SQL update
      const setClauses = Object.entries(updates)
        .map(([key, _], index) => `${key} = $${index + 1}`)
        .join(', ');
      
      // Build the values array
      const values = Object.values(updates);
      values.push(token.id);
      
      // Execute the update query
      await query(
        `UPDATE tokens SET ${setClauses}, updated_at = CURRENT_TIMESTAMP WHERE id = $${values.length}`,
        values
      );
      
      console.log(`Updated token metadata for ${token.symbol} (${token.address.slice(0, 8)}...)`);
    } catch (error) {
      console.error(`Error updating token metadata for ${token.symbol}:`, error);
    }
  }
}

/**
 * Mark positions as inactive if they're not in the current fetch
 */
async function markInactivePositions(walletId: number, currentExposures: Exposure[]): Promise<void> {
  try {
    // Get all position addresses from the current exposures
    const activeAddresses = currentExposures.map(exp => exp.positionAddress);
    
    // If no active positions, no need to continue
    if (activeAddresses.length === 0) {
      console.log('No active positions to compare against');
      return;
    }
    
    // Create placeholders for SQL query
    const placeholders = activeAddresses.map((_, i) => `$${i + 2}`).join(', ');
    
    // Mark as inactive all positions for this wallet that are not in the active list
    const result = await query(
      `UPDATE lp_positions 
       SET is_active = FALSE, updated_at = CURRENT_TIMESTAMP 
       WHERE wallet_id = $1 
       AND position_address NOT IN (${placeholders})
       AND is_active = TRUE
       RETURNING id`,
      [walletId, ...activeAddresses]
    );
    
    const inactiveCount = result.rowCount;
    if (inactiveCount && inactiveCount > 0) {
      console.log(`Marked ${inactiveCount} positions as inactive`);
    } else {
      console.log('No positions were marked as inactive');
    }
  } catch (error) {
    console.error('Error marking inactive positions:', error);
  }
} 