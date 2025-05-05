/**
 * Complete Resync Script
 * 
 * This script performs a full resync of all data for a wallet:
 * 1. Syncs current Whirlpool positions to DB
 * 2. Indexes all historical transactions
 * 3. Starts a polling service for real-time updates (optional)
 * 
 * Usage: npm run resync <WALLET_PUBKEY> [--with-polling] [--max-txns <NUMBER>]
 */

import { PublicKey } from '@solana/web3.js';
import { ReliableConnection } from '../utils/solana.js';
import { RPC_ENDPOINT } from '../config.js';
import { syncWhirlpoolPositions } from '../services/snapshotSyncService.js';
import { indexHistoricalTransactions } from '../services/historicalIndexingService.js';
import { startPollingForWallet } from '../services/livePollingService.js';
import { getOrCreateWallet } from '../db/models.js';

async function main() {
  console.log('🔄 LP-Tracker Full Resync Tool 🔄\n');
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const walletArg = args[0];
  
  if (!walletArg || walletArg.startsWith('--')) {
    console.error('Usage: npm run resync <WALLET_PUBKEY> [--with-polling] [--max-txns <NUMBER>]');
    process.exit(1);
  }
  
  // Parse flags
  const withPolling = args.includes('--with-polling');
  const maxTxnsIndex = args.indexOf('--max-txns');
  const maxTransactions = maxTxnsIndex >= 0 && args.length > maxTxnsIndex + 1 
    ? parseInt(args[maxTxnsIndex + 1], 10) 
    : 1000;
  
  try {
    // Set up connection and wallet
    const wallet = new PublicKey(walletArg);
    const walletAddress = wallet.toBase58();
    
    console.log('Resync Configuration:');
    console.log('🔗 RPC endpoint:', RPC_ENDPOINT);
    console.log('👛 Wallet:', walletAddress);
    console.log(`📜 Max transactions: ${maxTransactions}`);
    console.log(`🔄 Live polling: ${withPolling ? 'Enabled' : 'Disabled'}\n`);
    
    const conn = new ReliableConnection(RPC_ENDPOINT);
    
    // 1. Make sure wallet exists in database
    console.log('Step 1: Ensuring wallet exists in database...');
    const dbWallet = await getOrCreateWallet(walletAddress);
    console.log(`Wallet record: ID ${dbWallet.id}\n`);
    
    // 2. Sync positions
    console.log('Step 2: Syncing current Whirlpool positions...');
    const positionSync = await syncWhirlpoolPositions(conn, wallet, {
      markInactivePositions: true, // Mark old positions as inactive
      updatePrices: true          // Get latest prices
    });
    
    console.log(`Position sync complete. Found ${positionSync.totalPositionsFound} positions.`);
    console.log(`Added ${positionSync.newPositionsAdded} new positions.`);
    console.log(`Updated ${positionSync.positionsUpdated} existing positions.`);
    if (positionSync.errors.length > 0) {
      console.log(`⚠️ ${positionSync.errors.length} errors occurred during position sync.`);
    }
    console.log(`Sync completed in ${positionSync.elapsedMs}ms\n`);
    
    // 3. Index historical transactions
    console.log('Step 3: Indexing historical transactions...');
    console.log(`Will process up to ${maxTransactions} transactions.`);
    
    const indexResult = await indexHistoricalTransactions(conn, wallet, {
      maxTransactions,
      skipPhase3BackFill: false // We want to process all transactions for a full resync
    });
    
    console.log(`Transaction indexing complete.`);
    console.log(`Processed ${indexResult.processedTransactions} transactions.`);
    console.log(`Recorded ${indexResult.newEvents.feeEvents} fee events.`);
    console.log(`Recorded ${indexResult.newEvents.liquidityEvents} liquidity events.`);
    console.log(`Recorded ${indexResult.newEvents.swapEvents} swap events.`);
    console.log(`Most recent transaction signature: ${indexResult.lastSignature?.slice(0, 10)}...\n`);
    
    // 4. Start polling service if requested
    if (withPolling) {
      console.log('Step 4: Starting live polling service...');
      
      const stopPolling = await startPollingForWallet(conn, walletAddress, {
        batchSize: 25,
        pollInterval: 60 * 1000 // Poll every minute
      });
      
      console.log('Polling service started. Press Ctrl+C to stop.\n');
      
      // Set up graceful shutdown
      process.on('SIGINT', () => {
        console.log('\nShutting down polling service...');
        if (stopPolling) stopPolling();
        console.log('Goodbye!');
        process.exit(0);
      });
      
      // Keep the process alive
      setInterval(() => {}, 1000);
    } else {
      console.log('Resync complete! To start live polling, use the --with-polling flag.');
    }
    
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error('Error:', error.message);
      console.error(error.stack);
    } else {
      console.error('Error:', String(error));
    }
    process.exit(1);
  }
}

main().catch(console.error);
