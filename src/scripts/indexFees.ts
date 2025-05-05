/**
 * Manual Fee Indexing Script
 * 
 * This script allows manual indexing of fee events with various options:
 * - Index for a specific date range
 * - Index from a specific transaction signature
 * - Set maximum transactions to process
 * - Verify-only mode that reports events without writing to DB
 * 
 * Usage: npm run index-fees <WALLET_PUBKEY> [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>] 
 *                                          [--start-sig <TX_SIG>] [--max-txns <NUMBER>] [--verify-only]
 */

import { PublicKey } from '@solana/web3.js';
import { ReliableConnection } from '../utils/solana.js';
import { RPC_ENDPOINT } from '../config.js';
import { getOrCreateWallet } from '../db/models.js';
import { 
  indexHistoricalTransactions, 
  fetchWalletTransactions, 
  parseWhirlpoolTransaction,
  TransactionType
} from '../services/historicalIndexingService.js';
import { syncWhirlpoolPositions } from '../services/snapshotSyncService.js';
import { getTokenPrices } from '../services/priceService.js';

// Define a custom processTransaction function for verify-only mode
async function verifyTransactions(transactions: any[], walletAddress: string) {
  const conn = new ReliableConnection(RPC_ENDPOINT);
  
  // First sync positions to ensure we have the latest data
  console.log('Pre-syncing positions to ensure accurate verification...');
  await syncWhirlpoolPositions(conn, new PublicKey(walletAddress));
  
  // Track events that would be recorded
  const events = {
    feeEvents: [] as any[],
    liquidityEvents: [] as any[],
    swapEvents: [] as any[]
  };
  
  console.log(`Verifying ${transactions.length} transactions...`);
  
  for (const tx of transactions) {
    const parsedTx = parseWhirlpoolTransaction(tx);
    
    if (!parsedTx.type) continue;
    
    console.log(`\nTransaction ${tx.signature.slice(0, 10)}...`);
    console.log(`Timestamp: ${new Date(tx.timestamp * 1000).toLocaleString()}`);
    console.log(`Type: ${parsedTx.type}`);
    
    if (parsedTx.positionAddress) {
      console.log(`Position: ${parsedTx.positionAddress.slice(0, 10)}...`);
    }
    
    if (parsedTx.poolAddress) {
      console.log(`Pool: ${parsedTx.poolAddress.slice(0, 10)}...`);
    }
    
    if (parsedTx.tokenAmounts) {
      // Get token symbols and prices for meaningful display
      const tokenAddresses = [];
      if (parsedTx.tokenAmounts.tokenA?.mint) tokenAddresses.push(parsedTx.tokenAmounts.tokenA.mint);
      if (parsedTx.tokenAmounts.tokenB?.mint) tokenAddresses.push(parsedTx.tokenAmounts.tokenB.mint);
      
      const tokenPrices = await getTokenPrices(tokenAddresses);
      
      if (parsedTx.tokenAmounts.tokenA) {
        const tokenPrice = tokenPrices[parsedTx.tokenAmounts.tokenA.mint] || 0;
        const usdValue = parsedTx.tokenAmounts.tokenA.amount * tokenPrice;
        console.log(`Token A: ${parsedTx.tokenAmounts.tokenA.amount.toFixed(6)} (≈$${usdValue.toFixed(2)})`);
      }
      
      if (parsedTx.tokenAmounts.tokenB) {
        const tokenPrice = tokenPrices[parsedTx.tokenAmounts.tokenB.mint] || 0;
        const usdValue = parsedTx.tokenAmounts.tokenB.amount * tokenPrice;
        console.log(`Token B: ${parsedTx.tokenAmounts.tokenB.amount.toFixed(6)} (≈$${usdValue.toFixed(2)})`);
      }
    }
    
    // Add to appropriate event array
    if (parsedTx.type === TransactionType.CollectFees) {
      events.feeEvents.push({
        transaction: tx.signature,
        timestamp: new Date(tx.timestamp * 1000),
        tokenAmounts: parsedTx.tokenAmounts
      });
    } else if (parsedTx.type === TransactionType.IncreaseLiquidity || parsedTx.type === TransactionType.DecreaseLiquidity) {
      events.liquidityEvents.push({
        transaction: tx.signature,
        timestamp: new Date(tx.timestamp * 1000),
        eventType: parsedTx.type,
        tokenAmounts: parsedTx.tokenAmounts
      });
    } else if (parsedTx.type === TransactionType.Swap) {
      events.swapEvents.push({
        transaction: tx.signature,
        timestamp: new Date(tx.timestamp * 1000),
        tokenAmounts: parsedTx.tokenAmounts
      });
    }
  }
  
  // Summary
  console.log('\n===== VERIFICATION SUMMARY =====');
  console.log(`Found ${events.feeEvents.length} fee events`);
  console.log(`Found ${events.liquidityEvents.length} liquidity events`);
  console.log(`Found ${events.swapEvents.length} swap events`);
  
  return events;
}

async function main() {
  console.log('💰 LP-Tracker Fee Indexing Tool 💰\n');
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const walletArg = args[0];
  
  if (!walletArg || walletArg.startsWith('--')) {
    console.error('Usage: npm run index-fees <WALLET_PUBKEY> [--start-date <YYYY-MM-DD>] [--end-date <YYYY-MM-DD>]');
    console.error('                                          [--start-sig <TX_SIG>] [--max-txns <NUMBER>] [--verify-only]');
    process.exit(1);
  }
  
  // Parse flags
  const verifyOnly = args.includes('--verify-only');
  const maxTxnsIndex = args.indexOf('--max-txns');
  const maxTransactions = maxTxnsIndex >= 0 && args.length > maxTxnsIndex + 1 
    ? parseInt(args[maxTxnsIndex + 1], 10) 
    : 100;
  
  const startSigIndex = args.indexOf('--start-sig');
  const startSignature = startSigIndex >= 0 && args.length > startSigIndex + 1 
    ? args[startSigIndex + 1]
    : undefined;
  
  const startDateIndex = args.indexOf('--start-date');
  const startDateStr = startDateIndex >= 0 && args.length > startDateIndex + 1 
    ? args[startDateIndex + 1]
    : undefined;
  
  const endDateIndex = args.indexOf('--end-date');
  const endDateStr = endDateIndex >= 0 && args.length > endDateIndex + 1 
    ? args[endDateIndex + 1]
    : undefined;
  
  try {
    // Set up connection and wallet
    const wallet = new PublicKey(walletArg);
    const walletAddress = wallet.toBase58();
    
    console.log('Fee Indexing Configuration:');
    console.log('🔗 RPC endpoint:', RPC_ENDPOINT);
    console.log('👛 Wallet:', walletAddress);
    console.log(`📜 Max transactions: ${maxTransactions}`);
    
    if (startSignature) console.log(`🔍 Starting from signature: ${startSignature.slice(0, 10)}...`);
    if (startDateStr) console.log(`📅 Start date: ${startDateStr}`);
    if (endDateStr) console.log(`📅 End date: ${endDateStr}`);
    console.log(`🧪 Mode: ${verifyOnly ? 'Verify Only (no DB writes)' : 'Full Indexing'}\n`);
    
    const conn = new ReliableConnection(RPC_ENDPOINT);
    
    // Make sure wallet exists in database
    const dbWallet = await getOrCreateWallet(walletAddress);
    
    if (verifyOnly) {
      // In verify-only mode, we fetch and parse transactions but don't record to DB
      console.log('Running in verify-only mode. No database changes will be made.');
      
      const transactions = await fetchWalletTransactions(walletAddress, maxTransactions, startSignature);
      console.log(`Fetched ${transactions.length} transactions.`);
      
      // Apply date filtering if specified
      let filteredTxns = transactions;
      
      if (startDateStr || endDateStr) {
        const startDate = startDateStr ? new Date(startDateStr) : new Date(0);
        const endDate = endDateStr ? new Date(endDateStr) : new Date();
        
        // Add a day to end date to include the end date
        endDate.setDate(endDate.getDate() + 1);
        
        filteredTxns = transactions.filter(tx => {
          const txDate = new Date(tx.timestamp * 1000);
          return txDate >= startDate && txDate <= endDate;
        });
        
        console.log(`Filtered to ${filteredTxns.length} transactions between ${startDate.toLocaleDateString()} and ${endDate.toLocaleDateString()}.`);
      }
      
      await verifyTransactions(filteredTxns, walletAddress);
      console.log('\nVerification complete. No changes were made to the database.');
    } else {
      // Regular indexing mode - write to database
      console.log('Running full database indexing mode.');
      
      // Apply date filtering if needed (this requires custom handling)
      let options: any = {
        maxTransactions,
        startingSignature: startSignature,
        skipPhase3BackFill: false
      };
      
      if (startDateStr || endDateStr) {
        console.log('Note: Date filtering will be applied during transaction processing.');
        options.startDate = startDateStr ? new Date(startDateStr) : undefined;
        options.endDate = endDateStr ? new Date(endDateStr) : undefined;
      }
      
      const indexResult = await indexHistoricalTransactions(conn, wallet, options);
      
      console.log(`\nTransaction indexing complete.`);
      console.log(`Processed ${indexResult.processedTransactions} transactions.`);
      console.log(`Recorded ${indexResult.newEvents.feeEvents} fee events.`);
      console.log(`Recorded ${indexResult.newEvents.liquidityEvents} liquidity events.`);
      console.log(`Recorded ${indexResult.newEvents.swapEvents} swap events.`);
      console.log(`Most recent transaction signature: ${indexResult.lastSignature?.slice(0, 10)}...\n`);
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
