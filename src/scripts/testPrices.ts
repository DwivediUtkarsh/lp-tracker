/**
 * Test script for the price service functionality
 * This creates a test wallet with simulated LP positions
 * and demonstrates the price enrichment
 */
import { getOrCreateToken, getOrCreateWallet } from '../db/models.js';
import { query } from '../utils/database.js';
import { enrichPositionsWithPrices, updateTokenPricesInDb } from '../services/priceService.js';

// Test wallet address (must be 44 chars or less)
const TEST_WALLET = 'TestWallet12345678901234567890123456789012';

async function setupTestData() {
  console.log('Setting up test data...');
  
  // Create test wallet
  const wallet = await getOrCreateWallet(TEST_WALLET);
  console.log(`Test wallet created with ID: ${wallet.id}`);
  
  // Create test tokens
  const tokenA = await getOrCreateToken({
    symbol: 'SOL',
    address: 'So11111111111111111111111111111111111111112'
  });
  
  const tokenB = await getOrCreateToken({
    symbol: 'USDC',
    address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v'
  });
  
  const tokenC = await getOrCreateToken({
    symbol: 'ORCA',
    address: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE'
  });
  
  console.log('Test tokens created');
  
  // Create test LP positions
  
  // First check if positions already exist
  const existingPosition = await query(
    'SELECT * FROM lp_positions WHERE wallet_id = $1',
    [wallet.id]
  );
  
  if (existingPosition.rows.length === 0) {
    // Create SOL-USDC position
    await query(
      `INSERT INTO lp_positions 
       (wallet_id, dex, pool_address, token_a_id, token_b_id, qty_a, qty_b)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [wallet.id, 'raydium', 'sol-usdc-test-pool-123', tokenA.id, tokenB.id, 1.5, 150]
    );
    
    // Create SOL-ORCA position
    await query(
      `INSERT INTO lp_positions 
       (wallet_id, dex, pool_address, token_a_id, token_b_id, qty_a, qty_b)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [wallet.id, 'orca', 'sol-orca-test-pool-456', tokenA.id, tokenC.id, 0.75, 25]
    );
    
    console.log('Test LP positions created');
  } else {
    console.log('Test LP positions already exist');
  }
}

async function testPriceService() {
  try {
    // Setup test data
    await setupTestData();
    
    // Get positions for test wallet
    const result = await query(
      `SELECT lp.*, 
              ta.symbol as token_a_symbol, ta.address as token_a_address,
              tb.symbol as token_b_symbol, tb.address as token_b_address
       FROM lp_positions lp
       JOIN wallets w ON lp.wallet_id = w.id
       JOIN tokens ta ON lp.token_a_id = ta.id
       JOIN tokens tb ON lp.token_b_id = tb.id
       WHERE w.address = $1`,
      [TEST_WALLET]
    );
    
    const positions = result.rows;
    
    // Convert string values to numbers
    positions.forEach(pos => {
      pos.qty_a = parseFloat(pos.qty_a);
      pos.qty_b = parseFloat(pos.qty_b);
    });
    
    console.log('Retrieved positions:');
    console.table(
      positions.map(p => ({
        DEX: p.dex,
        Pool: `${p.token_a_symbol}-${p.token_b_symbol}`,
        [`${p.token_a_symbol}`]: p.qty_a,
        [`${p.token_b_symbol}`]: p.qty_b
      }))
    );
    
    // Enrich positions with price data
    console.log('\nFetching price data and calculating values...');
    const enrichedPositions = await enrichPositionsWithPrices(positions);
    
    // Display the enriched positions
    console.log('\nEnriched positions with price data:');
    console.table(
      enrichedPositions.map(p => ({
        DEX: p.dex,
        Pool: `${p.token_a_symbol}-${p.token_b_symbol}`,
        [`${p.token_a_symbol}`]: p.qty_a.toFixed(4),
        [`${p.token_a_symbol} Price`]: `$${p.token_a_price.toFixed(2)}`,
        [`${p.token_a_symbol} Value`]: `$${p.token_a_value.toFixed(2)}`,
        [`${p.token_b_symbol}`]: p.qty_b.toFixed(4),
        [`${p.token_b_symbol} Price`]: `$${p.token_b_price.toFixed(2)}`,
        [`${p.token_b_symbol} Value`]: `$${p.token_b_value.toFixed(2)}`,
        ['Total Value']: `$${p.total_value.toFixed(2)}`
      }))
    );
    
    // Calculate total value
    const totalValue = enrichedPositions.reduce((sum, pos) => sum + pos.total_value, 0);
    console.log(`\nTotal LP Value: $${totalValue.toFixed(2)}`);
    
    // Update database
    await updateTokenPricesInDb();
    
  } catch (error) {
    console.error('Error in test script:', error);
  } finally {
    // Close the pool to properly terminate the program
    try {
      const { pool } = await import('../utils/database.js');
      await pool.end();
    } catch (err) {
      console.error('Error closing database pool:', err);
    }
  }
}

// Run the test
testPriceService(); 