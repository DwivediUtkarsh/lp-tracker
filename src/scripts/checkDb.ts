import { pool } from '../utils/database.js';
import 'dotenv/config';

async function query(text: string, params?: any[]) {
  return pool.query(text, params);
}

async function main() {
  console.log('Loading environment config...');
  console.log(`Checking database tables...`);
  
  try {
    // Check all tables in the public schema
    console.log('Listing all tables:');
    const tablesResult = await query(`
      SELECT table_name 
      FROM information_schema.tables 
      WHERE table_schema = 'public'
      ORDER BY table_name;
    `);
    
    for (const row of tablesResult.rows) {
      console.log(`- ${row.table_name}`);
    }
    console.log();
    
    // Check wallets
    console.log('Checking wallets table:');
    const walletsResult = await query('SELECT COUNT(*) FROM wallets');
    console.log(`Found ${walletsResult.rows[0].count} wallets`);
    
    if (parseInt(walletsResult.rows[0].count) > 0) {
      const wallets = await query('SELECT * FROM wallets');
      for (const wallet of wallets.rows) {
        console.log(`  ID: ${wallet.id}, Address: ${wallet.address}, Label: ${wallet.label || 'N/A'}`);
      }
    }
    console.log();
    
    // Check LP positions
    console.log('Checking lp_positions table:');
    const positionsResult = await query('SELECT COUNT(*) FROM lp_positions');
    console.log(`Found ${positionsResult.rows[0].count} LP positions`);
    
    if (parseInt(positionsResult.rows[0].count) > 0) {
      const positions = await query(`
        SELECT 
          p.id, 
          w.address AS wallet_address, 
          p.position_address,
          pool.id AS pool_id,
          t1.symbol AS token_a_symbol,
          t2.symbol AS token_b_symbol,
          p.token_a_qty,
          p.token_b_qty,
          p.is_active
        FROM lp_positions p
        JOIN wallets w ON p.wallet_id = w.id
        JOIN pools pool ON p.pool_id = pool.id
        JOIN tokens t1 ON pool.token_a_id = t1.id
        JOIN tokens t2 ON pool.token_b_id = t2.id
        ORDER BY p.id
      `);
      
      for (const pos of positions.rows) {
        console.log(`  ID: ${pos.id}, Wallet: ${pos.wallet_address.substring(0, 8)}..., Position: ${pos.position_address || 'N/A'}`);
        console.log(`     Pool ID: ${pos.pool_id}, Pair: ${pos.token_a_symbol}/${pos.token_b_symbol}`);
        console.log(`     Token A: ${pos.token_a_qty} ${pos.token_a_symbol}, Token B: ${pos.token_b_qty} ${pos.token_b_symbol}`);
        console.log(`     Active: ${pos.is_active ? 'Yes' : 'No'}`);
        console.log();
      }
    }
    
    // Check events
    console.log('Checking event tables:');
    const feeEventsResult = await query('SELECT COUNT(*) FROM lp_fee_events');
    const liquidityEventsResult = await query('SELECT COUNT(*) FROM liquidity_events');
    const swapEventsResult = await query('SELECT COUNT(*) FROM swap_events');
    
    console.log(`Found ${feeEventsResult.rows[0].count} LP fee events`);
    console.log(`Found ${liquidityEventsResult.rows[0].count} liquidity events`);
    console.log(`Found ${swapEventsResult.rows[0].count} swap events`);
    
    // If events exist, show some samples
    if (parseInt(feeEventsResult.rows[0].count) > 0) {
      console.log('\nRecent fee events:');
      const feeEvents = await query(`
        SELECT 
          e.id, 
          e.position_id,
          e.transaction_hash,
          e.token_a_amount,
          e.token_b_amount,
          e.fee_amount_usd,
          e.timestamp
        FROM lp_fee_events e
        ORDER BY e.timestamp DESC
        LIMIT 5
      `);
      
      for (const event of feeEvents.rows) {
        console.log(`  ID: ${event.id}, Position: ${event.position_id}, Tx: ${event.transaction_hash.substring(0, 10)}...`);
        console.log(`     Amounts: A=${event.token_a_amount}, B=${event.token_b_amount}, USD=$${event.fee_amount_usd}`);
        console.log(`     Time: ${event.timestamp}`);
        console.log();
      }
    }
    
    if (parseInt(liquidityEventsResult.rows[0].count) > 0) {
      console.log('\nRecent liquidity events:');
      const liquidityEvents = await query(`
        SELECT 
          e.id, 
          e.position_id,
          e.transaction_hash,
          e.event_type,
          e.token_a_amount,
          e.token_b_amount,
          e.total_value_usd,
          e.timestamp
        FROM liquidity_events e
        ORDER BY e.timestamp DESC
        LIMIT 5
      `);
      
      for (const event of liquidityEvents.rows) {
        console.log(`  ID: ${event.id}, Position: ${event.position_id}, Type: ${event.event_type}, Tx: ${event.transaction_hash.substring(0, 10)}...`);
        console.log(`     Amounts: A=${event.token_a_amount}, B=${event.token_b_amount}, USD=$${event.total_value_usd}`);
        console.log(`     Time: ${event.timestamp}`);
        console.log();
      }
    }
    
  } catch (error) {
    console.error('Error checking database:', error);
  } finally {
    // Close the pool when done
    await pool.end();
  }
}

main().catch(console.error); 