/**
 * Script to index historical Whirlpool transactions for a wallet
 * Usage: npm run index:history <WALLET_PUBKEY> [--max-transactions=1000]
 */

import { PublicKey } from '@solana/web3.js';
import { indexHistoricalTransactions } from '../services/historicalIndexingService.js';
import { ReliableConnection } from '../utils/solana.js';
import { RPC_ENDPOINT } from '../config.js';
import { pool } from '../utils/database.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  // Parse command line arguments
  const [, , walletArg, maxTransactionsArg] = process.argv;
  
  if (!walletArg) {
    console.error('Usage: npm run index:history <WALLET_PUBKEY> [--max-transactions=1000]');
    process.exit(1);
  }

  // Parse max transactions argument if provided
  let maxTransactions = 1000; // Default
  if (maxTransactionsArg && maxTransactionsArg.startsWith('--max-transactions=')) {
    const value = maxTransactionsArg.split('=')[1];
    maxTransactions = parseInt(value, 10);
    if (isNaN(maxTransactions) || maxTransactions <= 0) {
      console.error('Invalid max transactions value. Using default of 1000.');
      maxTransactions = 1000;
    }
  }
  
  try {
    // Set up connection and wallet
    const wallet = new PublicKey(walletArg);
    const walletAddress = wallet.toBase58();
    console.log('🔗 RPC endpoint:', RPC_ENDPOINT);
    console.log('👛 Wallet:', walletAddress);
    console.log(`🔍 Indexing up to ${maxTransactions} transactions\n`);
    
    // Create connection
    const conn = new ReliableConnection(RPC_ENDPOINT);
    
    console.log('Starting historical transaction indexing...');
    const startTime = Date.now();
    
    // Run the indexing
    const result = await indexHistoricalTransactions(conn, wallet, {
      maxTransactions
    });
    
    // Show indexing results
    const duration = (Date.now() - startTime) / 1000;
    console.log('\n✅ Indexing completed:');
    console.log('- Elapsed time:', duration.toFixed(2), 'seconds');
    console.log('- Transactions processed:', result.processedTransactions);
    console.log('- New fee events:', result.newEvents.feeEvents);
    console.log('- New liquidity events:', result.newEvents.liquidityEvents);
    console.log('- New swap events:', result.newEvents.swapEvents);
    
    // Close the database connection
    await pool.end();
    
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error('Error:', error.message);
    } else {
      console.error('Error:', String(error));
    }
    // Make sure we close the DB connection on error
    await pool.end();
    process.exit(1);
  }
}

main().catch(console.error); 