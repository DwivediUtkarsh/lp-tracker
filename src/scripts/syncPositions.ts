/**
 * Script to sync LP positions from blockchain to database
 * Usage: npm run sync:positions <WALLET_PUBKEY>
 */

import { PublicKey } from '@solana/web3.js';
import { syncWhirlpoolPositions } from '../services/snapshotSyncService.js';
import { ReliableConnection } from '../utils/solana.js';
import { RPC_ENDPOINT } from '../config.js';
import { getPositionsForWallet } from '../db/models.js';
import { pool } from '../utils/database.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  // Parse command line arguments
  const [, , walletArg, options] = process.argv;
  
  if (!walletArg) {
    console.error('Usage: npm run sync:positions <WALLET_PUBKEY> [--mark-inactive]');
    process.exit(1);
  }
  
  try {
    // Set up connection and wallet
    const wallet = new PublicKey(walletArg);
    const walletAddress = wallet.toBase58();
    console.log('🔗 RPC endpoint:', RPC_ENDPOINT);
    console.log('👛 Wallet:', walletAddress, '\n');
    
    // Create connection
    const conn = new ReliableConnection(RPC_ENDPOINT);
    
    console.log('Starting positions sync...');
    
    // Parse options
    const markInactive = options === '--mark-inactive';
    
    // Run the sync
    const syncResult = await syncWhirlpoolPositions(conn, wallet, {
      markInactivePositions: markInactive
    });
    
    // Show sync results
    console.log('\n🔄 Sync completed:');
    console.log('- Elapsed time:', (syncResult.elapsedMs / 1000).toFixed(2), 'seconds');
    console.log('- Positions found:', syncResult.totalPositionsFound);
    console.log('- New positions added:', syncResult.newPositionsAdded);
    console.log('- Positions updated:', syncResult.positionsUpdated);
    console.log('- Pools added:', syncResult.poolsAdded);
    console.log('- Tokens added:', syncResult.tokensAdded);
    
    if (syncResult.errors.length > 0) {
      console.log('\n⚠️ Errors encountered:');
      syncResult.errors.forEach((err, i) => {
        console.log(`  ${i + 1}. ${err}`);
      });
    }
    
    // Fetch and display the current positions from database
    console.log('\n📊 Current positions in database:');
    const dbPositions = await getPositionsForWallet(walletAddress);
    
    if (dbPositions.length === 0) {
      console.log('No positions found in database for this wallet.');
    } else {
      console.table(
        dbPositions.map(pos => ({
          ID: pos.id,
          Pair: `${pos.token_a_symbol}-${pos.token_b_symbol}`,
          Pool: pos.pool_address.slice(0, 8) + '...',
          Position: pos.position_address ? pos.position_address.slice(0, 8) + '...' : 'N/A',
          TokenA: pos.token_a_symbol,
          AmountA: Number(pos.token_a_qty).toFixed(6),
          TokenB: pos.token_b_symbol,
          AmountB: Number(pos.token_b_qty).toFixed(6),
          Active: pos.is_active ? 'Yes' : 'No'
        }))
      );
    }
    
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