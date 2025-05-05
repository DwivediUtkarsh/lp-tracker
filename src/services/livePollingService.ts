/**
 * LivePollingService
 * 
 * This service periodically polls Helius for new transactions and updates the database
 * with the latest fee events, liquidity events, and swap events.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { ReliableConnection } from '../utils/solana.js';
import { 
  getPositionsForWallet,
  getOrCreateWallet,
  LPPosition
} from '../db/models.js';
import { query, pool } from '../utils/database.js';
import { parseWhirlpoolTransaction, fetchWalletTransactions } from './historicalIndexingService.js';
import { getTokenPrices } from './priceService.js';
import { syncWhirlpoolPositions } from './snapshotSyncService.js';

// Polling interval in milliseconds (default: 5 minutes)
const DEFAULT_POLLING_INTERVAL = 5 * 60 * 1000;

/**
 * Stores the most recent transaction signature per wallet
 * Used to fetch only newer transactions in subsequent polls
 */
const walletLastSignatures: { [walletAddress: string]: string } = {};

/**
 * Process new transactions for a wallet
 */
async function processNewTransactions(
  conn: ReliableConnection,
  walletAddress: string,
  options: {
    batchSize?: number;
    pollJustOnce?: boolean;
  } = {}
): Promise<{
  newTransactions: number;
  newEvents: {
    feeEvents: number;
    liquidityEvents: number;
    swapEvents: number;
  };
}> {
  const result = {
    newTransactions: 0,
    newEvents: {
      feeEvents: 0,
      liquidityEvents: 0,
      swapEvents: 0
    }
  };

  try {
    // Get wallet from database
    const wallet = await getOrCreateWallet(walletAddress);
    
    // Get positions for this wallet
    let positions = await getPositionsForWallet(walletAddress);
    
    if (positions.length === 0) {
      console.log(`No positions found for wallet ${walletAddress}. Attempting to sync positions first...`);
      // Try to sync the latest positions in case there are new ones
      try {
        const syncResult = await syncWhirlpoolPositions(conn, new PublicKey(walletAddress));
        console.log(`Position sync result: ${syncResult.totalPositionsFound} positions found, ${syncResult.newPositionsAdded} added.`);
        
        // Refetch positions after sync
        if (syncResult.totalPositionsFound > 0) {
          positions = await getPositionsForWallet(walletAddress);
          console.log(`Refreshed positions, now have ${positions.length} positions.`);
        }
        
        // Still no positions? Then skip polling
        if (positions.length === 0) {
          console.log(`Still no positions found after sync. Skipping transaction polling.`);
          return result;
        }
      } catch (syncError) {
        console.error(`Error syncing positions: ${syncError}`);
        return result;
      }
    }
    
    // Get the latest signature we've processed for this wallet
    const lastSignature = walletLastSignatures[walletAddress];
    
    // Fetch only new transactions since the last one we processed
    const batchSize = options.batchSize || 100;
    const transactions = await fetchWalletTransactions(walletAddress, batchSize, lastSignature);
    
    if (transactions.length === 0) {
      console.log(`No new transactions found for wallet ${walletAddress}`);
      return result;
    }
    
    console.log(`Found ${transactions.length} new transactions for wallet ${walletAddress}`);
    result.newTransactions = transactions.length;
    
    // NOTE: We'll update the last signature AFTER processing completes successfully
    // This prevents a race condition where processing fails but we've already updated the signature
    // (Will be moved to after transaction processing)
    
    // Create a map of position addresses to position objects for easier lookup
    // Use let instead of const to allow reassignment later
    let positionMap: {[address: string]: any} = {};
    positions.forEach(pos => {
      if (pos.position_address) {
        positionMap[pos.position_address] = pos;
      }
    });
    
    // Create a map of pool addresses to positions
    // Use let instead of const to allow reassignment later
    let poolPositionMap: {[address: string]: any[]} = {};
    positions.forEach(pos => {
      if (pos.pool_address) {
        if (!poolPositionMap[pos.pool_address]) {
          poolPositionMap[pos.pool_address] = [];
        }
        poolPositionMap[pos.pool_address].push(pos);
      }
    });
    
    // Get token prices for any relevant tokens
    const tokenAddresses = new Set<string>();
    positions.forEach(pos => {
      tokenAddresses.add(pos.token_a_address);
      tokenAddresses.add(pos.token_b_address);
    });
    
    const tokenPrices = await getTokenPrices(Array.from(tokenAddresses));
    
    // Process each transaction
    for (const tx of transactions) {
      const parsedTx = parseWhirlpoolTransaction(tx);
      
      if (!parsedTx.type) continue; // Not a Whirlpool transaction we care about
      
      // Find matching position(s)
      let matchedPositions: any[] = [];
      
      // First try by position address if available
      if (parsedTx.positionAddress && positionMap[parsedTx.positionAddress]) {
        matchedPositions = [positionMap[parsedTx.positionAddress]];
      } 
      // Then try by pool address if available
      else if (parsedTx.poolAddress && poolPositionMap[parsedTx.poolAddress]) {
        matchedPositions = poolPositionMap[parsedTx.poolAddress];
      }
      // If still no match, try syncing positions to discover any new ones
      else {
        console.log(`No direct position match found for tx ${tx.signature.slice(0, 8)}... - attempting to sync new positions`);
        
        try {
          // Attempt to sync the latest positions to discover any new ones
          const syncResult = await syncWhirlpoolPositions(conn, new PublicKey(walletAddress));
          
          if (syncResult.newPositionsAdded > 0 || syncResult.positionsUpdated > 0) {
            console.log(`Synced ${syncResult.newPositionsAdded} new positions. Refreshing positions map...`);
            
            // Refresh our position data
            positions = await getPositionsForWallet(walletAddress);
            
            // Rebuild the maps
            positionMap = {};
            positions.forEach(pos => {
              if (pos.position_address) {
                positionMap[pos.position_address] = pos;
              }
            });
            
            poolPositionMap = {};
            positions.forEach(pos => {
              if (pos.pool_address) {
                if (!poolPositionMap[pos.pool_address]) {
                  poolPositionMap[pos.pool_address] = [];
                }
                poolPositionMap[pos.pool_address].push(pos);
              }
            });
            
            // Try matching again
            if (parsedTx.positionAddress && positionMap[parsedTx.positionAddress]) {
              matchedPositions = [positionMap[parsedTx.positionAddress]];
            } else if (parsedTx.poolAddress && poolPositionMap[parsedTx.poolAddress]) {
              matchedPositions = poolPositionMap[parsedTx.poolAddress];
            }
          }
        } catch (syncError) {
          console.error(`Error syncing positions during tx processing: ${syncError}`);
        }
        
        // If we still don't have a match after syncing, use any position as a fallback
        if (matchedPositions.length === 0 && positions.length > 0) {
          console.log(`Still no match after sync - using first position as fallback`);
          matchedPositions = [positions[0]];
        }
      }
      
      if (matchedPositions.length === 0) {
        console.log(`No matching positions found for transaction ${tx.signature.slice(0, 8)}...`);
        continue;
      }
      
      // Process the transaction for each matched position
      // This will be similar to the processing in historicalIndexingService
      // But we'll defer to that service's implementation
      const { feeEvents, liquidityEvents, swapEvents } = await processMatchedPositions(
        matchedPositions,
        parsedTx,
        tx,
        tokenPrices
      );
      
      result.newEvents.feeEvents += feeEvents;
      result.newEvents.liquidityEvents += liquidityEvents;
      result.newEvents.swapEvents += swapEvents;
    }
    
    // NOW it's safe to update the last signature since processing completed successfully
    if (transactions.length > 0) {
      console.log(`Updating last signature to: ${transactions[0].signature.slice(0, 8)}...`);
      walletLastSignatures[walletAddress] = transactions[0].signature;
    }
    
    return result;
  } catch (error) {
    console.error('Error processing new transactions:', error);
    return result;
  }
}

/**
 * Process matched positions for a transaction
 * This leverages similar logic from the historical indexing service
 */
async function processMatchedPositions(
  positions: any[],
  parsedTx: any,
  tx: any,
  tokenPrices: {[address: string]: number}
): Promise<{
  feeEvents: number;
  liquidityEvents: number;
  swapEvents: number;
}> {
  // Import these functions to avoid duplicating code
  const { 
    recordFeeEvent, 
    recordLiquidityEvent,
    recordSwapEvent
  } = await import('../db/models.js');
  
  const result = {
    feeEvents: 0,
    liquidityEvents: 0,
    swapEvents: 0
  };
  
  // Process events for matched positions (similar to historicalIndexingService)
  for (const position of positions) {
    if (parsedTx.type === 'collectFees' && parsedTx.tokenAmounts) {
      try {
        const feeEvent = await recordFeeEvent({
          position_id: position.id,
          transaction_hash: tx.signature,
          timestamp: new Date(tx.timestamp * 1000),
          token_a_amount: parsedTx.tokenAmounts.tokenA?.amount || 0,
          token_b_amount: parsedTx.tokenAmounts.tokenB?.amount || 0,
          token_a_price_usd: tokenPrices[position.token_a_address] || 0,
          token_b_price_usd: tokenPrices[position.token_b_address] || 0,
          fee_amount_usd: 
            (parsedTx.tokenAmounts.tokenA?.amount || 0) * (tokenPrices[position.token_a_address] || 0) +
            (parsedTx.tokenAmounts.tokenB?.amount || 0) * (tokenPrices[position.token_b_address] || 0),
          block_number: tx.slot
        });
        
        if (feeEvent) {
          console.log(`Recorded fee collection event for position ${position.position_address?.slice(0, 8)}... (ID: ${position.id})`);
          console.log(`  Tokens: ${parsedTx.tokenAmounts.tokenA?.amount || 0} ${position.token_a_symbol}, ${parsedTx.tokenAmounts.tokenB?.amount || 0} ${position.token_b_symbol}`);
          result.feeEvents++;
        }
      } catch (error) {
        console.error(`Error recording fee event: ${error}`);
      }
    } else if (
      (parsedTx.type === 'increaseLiquidity' || 
      parsedTx.type === 'decreaseLiquidity') && 
      parsedTx.tokenAmounts
    ) {
      try {
        await recordLiquidityEvent({
          position_id: position.id,
          transaction_hash: tx.signature,
          timestamp: new Date(tx.timestamp * 1000),
          event_type: parsedTx.type === 'increaseLiquidity' ? 'increase' : 'decrease',
          token_a_amount: parsedTx.tokenAmounts.tokenA?.amount || 0,
          token_b_amount: parsedTx.tokenAmounts.tokenB?.amount || 0,
          token_a_price_usd: tokenPrices[position.token_a_address] || 0,
          token_b_price_usd: tokenPrices[position.token_b_address] || 0,
          total_value_usd:
            (parsedTx.tokenAmounts.tokenA?.amount || 0) * (tokenPrices[position.token_a_address] || 0) +
            (parsedTx.tokenAmounts.tokenB?.amount || 0) * (tokenPrices[position.token_b_address] || 0),
          block_number: tx.slot
        });
        
        console.log(`Recorded liquidity ${parsedTx.type === 'increaseLiquidity' ? 'increase' : 'decrease'} event for position ${position.position_address?.slice(0, 8)}... (ID: ${position.id})`);
        console.log(`  Tokens: ${parsedTx.tokenAmounts.tokenA?.amount || 0} ${position.token_a_symbol}, ${parsedTx.tokenAmounts.tokenB?.amount || 0} ${position.token_b_symbol}`);
        result.liquidityEvents++;
      } catch (error) {
        console.error(`Error recording liquidity event: ${error}`);
      }
    } else if (parsedTx.type === 'swap' && position.pool_id) {
      // Only record one swap event per pool to avoid duplicates
      if (result.swapEvents > 0) continue;
      
      try {
        await recordSwapEvent({
          pool_id: position.pool_id,
          transaction_hash: tx.signature,
          timestamp: new Date(tx.timestamp * 1000),
          token_in_id: position.token_a_id, // Assumption
          token_out_id: position.token_b_id, // Assumption
          amount_in: 0, // Unknown without detailed parsing
          amount_out: 0, // Unknown without detailed parsing
          block_number: tx.slot
        });
        
        console.log(`Recorded swap event for pool ${position.pool_address?.slice(0, 8)}...`);
        result.swapEvents++;
      } catch (error) {
        console.error(`Error recording swap event: ${error}`);
      }
    }
  }
  
  return result;
}

/**
 * Start the polling service for a single wallet
 */
export async function startPollingForWallet(
  conn: ReliableConnection,
  walletAddress: string,
  options: {
    pollInterval?: number;
    batchSize?: number;
    pollJustOnce?: boolean;
  } = {}
): Promise<(() => void) | void> {
  // Process transactions immediately on start
  console.log(`Starting transaction polling for wallet: ${walletAddress}`);
  
  const processTransactions = async () => {
    const startTime = Date.now();
    console.log(`[${new Date().toISOString()}] Polling for new transactions...`);
    
    try {
      const result = await processNewTransactions(conn, walletAddress, {
        batchSize: options.batchSize,
        pollJustOnce: options.pollJustOnce
      });
      
      const duration = (Date.now() - startTime) / 1000;
      console.log(`Polling completed in ${duration.toFixed(2)}s`);
      
      if (result.newTransactions > 0) {
        console.log(`Processed ${result.newTransactions} new transactions`);
        console.log(`New events: ${result.newEvents.feeEvents} fees, ${result.newEvents.liquidityEvents} liquidity, ${result.newEvents.swapEvents} swaps`);
      } else {
        console.log('No new transactions found');
      }
    } catch (error) {
      console.error('Error during transaction polling:', error);
    }
  };
  
  // Run once immediately
  await processTransactions();
  
  // If pollJustOnce is true, don't set up the interval
  if (options.pollJustOnce) {
    console.log('One-time polling completed');
    return;
  }
  
  // Set up polling interval
  const pollInterval = options.pollInterval || DEFAULT_POLLING_INTERVAL;
  console.log(`Setting up polling interval: ${pollInterval / 1000}s`);
  
  const intervalId = setInterval(processTransactions, pollInterval);
  
  // Return a function to stop polling (for cleanup)
  return () => {
    console.log(`Stopping transaction polling for wallet: ${walletAddress}`);
    clearInterval(intervalId);
  };
}

/**
 * Start the polling service for multiple wallets
 */
export async function startPollingService(
  conn: ReliableConnection,
  walletAddresses: string[],
  options: {
    pollInterval?: number;
    batchSize?: number;
  } = {}
): Promise<() => void> {
  const stopFunctions: Array<() => void> = [];
  
  // Start polling for each wallet
  for (const walletAddress of walletAddresses) {
    const stopFn = await startPollingForWallet(conn, walletAddress, options);
    if (stopFn) stopFunctions.push(stopFn);
  }
  
  // Return a function to stop all polling
  return () => {
    console.log('Stopping all transaction polling');
    stopFunctions.forEach(stopFn => stopFn());
  };
} 