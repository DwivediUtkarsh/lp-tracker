/**
 * Script to view historical transactions stored in the database
 * Usage: npm run view:history <WALLET_ADDRESS> [--limit=50] [--event-type=fee|liquidity|swap]
 */

import { PublicKey } from '@solana/web3.js';
import { pool, query } from '../utils/database.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

async function main() {
  try {
    // Parse command line arguments
    const args = process.argv.slice(2);
    let walletArg = args[0];
    
    if (!walletArg) {
      console.error('Usage: npm run view:history <WALLET_ADDRESS> [--limit=50] [--event-type=fee|liquidity|swap]');
      process.exit(1);
    }

    // Parse optional arguments
    let limit = 50; // Default
    let eventType = 'all'; // Default
    
    for (let i = 1; i < args.length; i++) {
      const arg = args[i];
      if (arg.startsWith('--limit=')) {
        const value = arg.split('=')[1];
        limit = parseInt(value, 10);
        if (isNaN(limit) || limit <= 0) {
          console.error('Invalid limit value. Using default of 50.');
          limit = 50;
        }
      } else if (arg.startsWith('--event-type=')) {
        eventType = arg.split('=')[1].toLowerCase();
        if (!['fee', 'liquidity', 'swap', 'all'].includes(eventType)) {
          console.error('Invalid event type. Must be fee, liquidity, swap, or all. Using "all".');
          eventType = 'all';
        }
      }
    }
  
    console.log('Loading environment config...');
    console.log(`Using Solana RPC endpoint: ${process.env.SOLANA_RPC_URL}`);
    
    // Validate wallet address
    let walletAddress: string;
    try {
      walletAddress = new PublicKey(walletArg).toBase58();
    } catch (error) {
      console.error('Invalid wallet address');
      process.exit(1);
      return;
    }
    
    console.log('📊 Retrieving Historical Data 📊');
    console.log('-------------------------------');
    console.log(`Wallet: ${walletAddress}`);
    console.log(`Event Type: ${eventType}`);
    console.log(`Limit: ${limit} records per type`);
    console.log('-------------------------------\n');
    
    console.log('Connected to PostgreSQL database');
    
    // First get wallet ID from database
    const walletResult = await query('SELECT id, address FROM wallets WHERE address = $1', [walletAddress]);
    
    if (walletResult.rows.length === 0) {
      console.error('Wallet not found in database. Have you synced positions yet?');
      process.exit(1);
      return;
    }
    
    const walletId = walletResult.rows[0].id;
    
    // Get positions for this wallet
    const positionsResult = await query(`
      SELECT 
        pos.id, 
        pos.position_address, 
        t_a.symbol as token_a_symbol, 
        t_b.symbol as token_b_symbol,
        pos.token_a_qty,
        pos.token_b_qty
      FROM 
        lp_positions pos
        JOIN pools p ON pos.pool_id = p.id
        JOIN tokens t_a ON p.token_a_id = t_a.id
        JOIN tokens t_b ON p.token_b_id = t_b.id
      WHERE 
        pos.wallet_id = $1
    `, [walletId]);
    
    if (positionsResult.rows.length === 0) {
      console.error('No positions found for this wallet. Have you synced positions yet?');
      process.exit(1);
      return;
    }
    
    console.log(`Found ${positionsResult.rows.length} positions for wallet ${walletAddress}`);
    
    // Create position map for lookup
    const positionMap = {};
    positionsResult.rows.forEach(pos => {
      positionMap[pos.id] = pos;
    });
    
    // Show fee events if requested
    if (eventType === 'all' || eventType === 'fee') {
      console.log('\n📝 Fee Collection Events 📝');
      console.log('===========================');
      
      const feeEvents = await query(`
        SELECT 
          e.*
        FROM 
          lp_fee_events e
          JOIN lp_positions pos ON e.position_id = pos.id
        WHERE 
          pos.wallet_id = $1
        ORDER BY 
          e.timestamp DESC
        LIMIT $2
      `, [walletId, limit]);
      
      if (feeEvents.rows.length === 0) {
        console.log('No fee events found');
      } else {
        console.log(`Found ${feeEvents.rows.length} fee events`);
        
        // Display fee events in a table format
        console.table(feeEvents.rows.map(event => {
          const position = positionMap[event.position_id];
          
          // Make sure values are properly converted to numbers for formatting
          const tokenAAmount = parseFloat(event.token_a_amount) || 0;
          const tokenBAmount = parseFloat(event.token_b_amount) || 0;
          const feeAmountUsd = parseFloat(event.fee_amount_usd) || 0;
          
          return {
            'Date': new Date(event.timestamp).toLocaleString(),
            'Position': `${position.token_a_symbol}-${position.token_b_symbol}`,
            [`${position.token_a_symbol} Amount`]: tokenAAmount.toFixed(6),
            [`${position.token_b_symbol} Amount`]: tokenBAmount.toFixed(6),
            'USD Value': `$${feeAmountUsd.toFixed(2)}`,
            'Tx Hash': event.transaction_hash.slice(0, 10) + '...'
          };
        }));
        
        // Calculate total fees collected
        const totalFees = feeEvents.rows.reduce((sum, event) => {
          const feeAmount = parseFloat(event.fee_amount_usd) || 0;
          return sum + feeAmount;
        }, 0);
        console.log(`\nTotal fees collected: $${totalFees.toFixed(2)}`);
      }
    }
    
    // Show liquidity events if requested
    if (eventType === 'all' || eventType === 'liquidity') {
      console.log('\n🔄 Liquidity Change Events 🔄');
      console.log('============================');
      
      const liquidityEvents = await query(`
        SELECT 
          e.*
        FROM 
          liquidity_events e
          JOIN lp_positions pos ON e.position_id = pos.id
        WHERE 
          pos.wallet_id = $1
        ORDER BY 
          e.timestamp DESC
        LIMIT $2
      `, [walletId, limit]);
      
      if (liquidityEvents.rows.length === 0) {
        console.log('No liquidity events found');
      } else {
        console.log(`Found ${liquidityEvents.rows.length} liquidity events`);
        
        // Display liquidity events in a table format
        console.table(liquidityEvents.rows.map(event => {
          const position = positionMap[event.position_id];
          
          // Make sure values are properly converted to numbers for formatting
          const tokenAAmount = parseFloat(event.token_a_amount) || 0;
          const tokenBAmount = parseFloat(event.token_b_amount) || 0;
          const totalValueUsd = parseFloat(event.total_value_usd) || 0;
          
          return {
            'Date': new Date(event.timestamp).toLocaleString(),
            'Type': event.event_type.charAt(0).toUpperCase() + event.event_type.slice(1),
            'Position': `${position.token_a_symbol}-${position.token_b_symbol}`,
            [`${position.token_a_symbol} Amount`]: tokenAAmount.toFixed(6),
            [`${position.token_b_symbol} Amount`]: tokenBAmount.toFixed(6),
            'USD Value': `$${totalValueUsd.toFixed(2)}`,
            'Tx Hash': event.transaction_hash.slice(0, 10) + '...'
          };
        }));
      }
    }
    
    // Show swap events if requested
    if (eventType === 'all' || eventType === 'swap') {
      console.log('\n💱 Swap Events 💱');
      console.log('================');
      
      // This query is more complex as swap events have references to token IDs
      const swapEvents = await query(`
        SELECT 
          e.*,
          t_in.symbol as token_in_symbol,
          t_out.symbol as token_out_symbol
        FROM 
          swap_events e
          JOIN pools p ON e.pool_id = p.id
          JOIN lp_positions pos ON pos.pool_id = p.id
          JOIN tokens t_in ON e.token_in_id = t_in.id
          JOIN tokens t_out ON e.token_out_id = t_out.id
        WHERE 
          pos.wallet_id = $1
        GROUP BY 
          e.id, t_in.symbol, t_out.symbol
        ORDER BY 
          e.timestamp DESC
        LIMIT $2
      `, [walletId, limit]);
      
      if (swapEvents.rows.length === 0) {
        console.log('No swap events found');
      } else {
        console.log(`Found ${swapEvents.rows.length} swap events`);
        
        // Display swap events in a table format
        console.table(swapEvents.rows.map(event => {
          // Make sure values are properly converted to numbers for formatting
          const amountIn = parseFloat(event.amount_in) || 0;
          const amountOut = parseFloat(event.amount_out) || 0;
          const feeAmount = parseFloat(event.fee_amount) || 0;
          
          return {
            'Date': new Date(event.timestamp).toLocaleString(),
            'Swap': `${event.token_in_symbol} → ${event.token_out_symbol}`,
            'In': `${amountIn.toFixed(6)} ${event.token_in_symbol}`,
            'Out': `${amountOut.toFixed(6)} ${event.token_out_symbol}`,
            'Fee': event.fee_amount ? `${feeAmount.toFixed(6)}` : 'N/A',
            'Tx Hash': event.transaction_hash.slice(0, 10) + '...'
          };
        }));
      }
    }
    
    // Show summary of all events
    console.log('\n📊 Historical Data Summary 📊');
    console.log('===========================');
    
    // Count all events for this wallet
    const [feeCounts, liquidityCounts, swapCounts] = await Promise.all([
      query(`
        SELECT COUNT(*) as count 
        FROM lp_fee_events e
        JOIN lp_positions pos ON e.position_id = pos.id
        WHERE pos.wallet_id = $1
      `, [walletId]),
      
      query(`
        SELECT COUNT(*) as count 
        FROM liquidity_events e
        JOIN lp_positions pos ON e.position_id = pos.id
        WHERE pos.wallet_id = $1
      `, [walletId]),
      
      query(`
        SELECT COUNT(*) as count 
        FROM swap_events e
        JOIN pools p ON e.pool_id = p.id
        JOIN lp_positions pos ON pos.pool_id = p.id
        WHERE pos.wallet_id = $1
        GROUP BY e.id
      `, [walletId])
    ]);
    
    // Get total values
    const totalFeesResult = await query(`
      SELECT COALESCE(SUM(e.fee_amount_usd), 0) as total
      FROM lp_fee_events e
      JOIN lp_positions pos ON e.position_id = pos.id
      WHERE pos.wallet_id = $1
    `, [walletId]);
    
    const totalFeesUsd = parseFloat(totalFeesResult.rows[0]?.total) || 0;
    
    console.log(`Total Fee Events: ${feeCounts.rows[0]?.count || 0}`);
    console.log(`Total Liquidity Events: ${liquidityCounts.rows[0]?.count || 0}`);
    console.log(`Total Swap Events: ${swapCounts.rows?.length || 0}`);
    console.log(`Total Fees Collected: $${totalFeesUsd.toFixed(2)}`);
    
    // Close database connection
    await pool.end();
    
  } catch (error) {
    console.error('Error retrieving historical data:', error);
    await pool.end();
    process.exit(1);
  }
}

main().catch(console.error);