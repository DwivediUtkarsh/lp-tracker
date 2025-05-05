/**
 * Script to poll for new Whirlpool transactions for specified wallets
 * Usage: npm run poll:transactions <WALLET_PUBKEY> [<WALLET_PUBKEY_2> ...] [--interval=300] [--once]
 */

import { PublicKey } from '@solana/web3.js';
import { startPollingForWallet } from '../services/livePollingService.js';
import { ReliableConnection } from '../utils/solana.js';
import { RPC_ENDPOINT } from '../config.js';
import { pool } from '../utils/database.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  // Parse command line arguments
  const args = process.argv.slice(2);
  
  // Extract options
  const optionArgs = args.filter(arg => arg.startsWith('--'));
  const walletArgs = args.filter(arg => !arg.startsWith('--'));
  
  if (walletArgs.length === 0) {
    console.error('Usage: npm run poll:transactions <WALLET_PUBKEY> [<WALLET_PUBKEY_2> ...] [--interval=300] [--once]');
    process.exit(1);
  }
  
  // Parse interval option
  let pollInterval = 5 * 60 * 1000; // Default: 5 minutes (300 seconds)
  const intervalArg = optionArgs.find(opt => opt.startsWith('--interval='));
  if (intervalArg) {
    const seconds = parseInt(intervalArg.split('=')[1], 10);
    if (!isNaN(seconds) && seconds > 0) {
      pollInterval = seconds * 1000;
    } else {
      console.warn('Invalid interval value. Using default of 300 seconds (5 minutes).');
    }
  }
  
  // Parse once option
  const pollOnce = optionArgs.includes('--once');
  
  try {
    // Create connection
    const conn = new ReliableConnection(RPC_ENDPOINT);
    console.log('🔗 RPC endpoint:', RPC_ENDPOINT);
    
    // Process each wallet
    const wallets = walletArgs.map(arg => {
      try {
        const pubkey = new PublicKey(arg);
        return pubkey.toBase58();
      } catch (e) {
        console.error(`Invalid wallet address: ${arg}`);
        return null;
      }
    }).filter(Boolean) as string[];
    
    if (wallets.length === 0) {
      console.error('No valid wallet addresses provided');
      process.exit(1);
    }
    
    console.log(`👛 Polling transactions for ${wallets.length} wallet(s):`);
    wallets.forEach(wallet => console.log(`  - ${wallet}`));
    
    if (pollOnce) {
      console.log('🔍 Running one-time polling (--once flag detected)');
    } else {
      console.log(`⏱️ Polling interval: ${pollInterval / 1000} seconds`);
    }
    
    // Start polling for each wallet
    if (pollOnce) {
      // If polling just once, process sequentially and exit
      for (const wallet of wallets) {
        await startPollingForWallet(conn, wallet, {
          pollInterval,
          pollJustOnce: true
        });
      }
      console.log('One-time polling completed for all wallets');
      await pool.end();
      process.exit(0);
    } else {
      // For continuous polling, start all wallets in parallel
      const pollingPromises = wallets.map(wallet => 
        startPollingForWallet(conn, wallet, {
          pollInterval,
          pollJustOnce: false
        })
      );
      
      // Wait for all initial polling to complete
      await Promise.all(pollingPromises);
    }
    
    // Keep the process running for continuous polling
    console.log('Continuous polling has started. Press Ctrl+C to exit.');
    
    // Handle process termination
    process.on('SIGINT', async () => {
      console.log('Stopping polling and closing database connection...');
      await pool.end();
      process.exit(0);
    });
    
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