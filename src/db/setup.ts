import { readFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { query, pool } from '../utils/database.js';

// Type definitions
interface Token {
  symbol: string;
  name: string;
  address: string;
  decimals: number;
  coingecko_id: string;
}

interface Pool {
  address: string;
  protocol: string;
  token_a: string;
  token_b: string;
  fee_rate: number;
  tick_spacing: number;
}

// Use a more compatible approach to get directory name
// This uses the fact that we know the file structure
const __dirname = path.resolve(process.cwd(), 'src/db');

async function setupDatabase() {
  try {
    console.log('Setting up database...');
    
    // Read SQL schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    try {
      const schema = readFileSync(schemaPath, 'utf8');
      
      // Execute schema
      await query(schema);
      console.log('Database schema created successfully');
    } catch (schemaError) {
      console.error('Error reading or executing schema file:', schemaError);
      throw schemaError; // Rethrow to be caught by outer try/catch
    }
    
    // Create or update basic tokens
    try {
      await createBasicTokens();
    } catch (tokensError) {
      console.error('Error creating basic tokens:', tokensError);
      // Continue execution despite token errors
    }
    
    // Verify all tables were created properly
    try {
      await verifyTablesExist();
    } catch (verifyError) {
      console.error('Error verifying tables:', verifyError);
      throw verifyError; // Rethrow to be caught by outer try/catch
    }
    
    console.log('Database setup completed successfully');
  } catch (error) {
    console.error('Error setting up database:', error);
    throw error; // Rethrow so the calling code knows setup failed
  } finally {
    // Always attempt to close the connection pool, even if there was an error
    try {
      await pool.end();
      console.log('Database connection pool closed');
    } catch (poolError) {
      console.error('Error closing connection pool:', poolError);
    }
  }
}

async function verifyTablesExist() {
  const tables = [
    'tokens', 
    'wallets', 
    'pools', 
    'lp_positions', 
    'lp_fee_events', 
    'liquidity_events', 
    'swap_events'
  ];
  
  for (const table of tables) {
    const result = await query(`
      SELECT EXISTS (
        SELECT FROM information_schema.tables 
        WHERE table_schema = 'public'
        AND table_name = $1
      );
    `, [table]);
    
    if (!result.rows[0].exists) {
      console.error(`ERROR: Table '${table}' was not created properly!`);
    } else {
      console.log(`Table '${table}' exists ✓`);
    }
  }
}

async function createBasicTokens() {
  console.log('Creating basic token records...');
  
  // Check if tokens table exists before checking for columns
  const tableCheckQuery = `
    SELECT EXISTS (
      SELECT FROM information_schema.tables 
      WHERE table_schema = 'public' 
      AND table_name = 'tokens'
    );
  `;
  
  const tableExists = await query(tableCheckQuery);
  
  // Only check for columns if the table exists
  if (tableExists.rows[0].exists) {
    const checkColumnQuery = `
      SELECT column_name 
      FROM information_schema.columns 
      WHERE table_name = 'tokens' AND column_name = 'price'
    `;
    
    const columnResult = await query(checkColumnQuery);
    
    // If price column doesn't exist, add it
    if (columnResult.rows.length === 0) {
      console.log('Adding price columns to tokens table...');
      await query(`
        ALTER TABLE tokens 
        ADD COLUMN IF NOT EXISTS price NUMERIC(30, 15),
        ADD COLUMN IF NOT EXISTS last_price_update TIMESTAMP WITH TIME ZONE
      `);
    }
  }
  
  // List of common tokens to pre-populate
  const basicTokens: Token[] = [
    { symbol: 'SOL', name: 'Solana', address: 'So11111111111111111111111111111111111111112', decimals: 9, coingecko_id: 'solana' },
    { symbol: 'USDC', name: 'USD Coin', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, coingecko_id: 'usd-coin' },
    { symbol: 'USDT', name: 'Tether', address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6, coingecko_id: 'tether' },
    { symbol: 'RAY', name: 'Raydium', address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', decimals: 6, coingecko_id: 'raydium' },
    { symbol: 'ORCA', name: 'Orca', address: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', decimals: 6, coingecko_id: 'orca' },
    { symbol: 'mSOL', name: 'Marinade staked SOL', address: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', decimals: 9, coingecko_id: 'msol' },
    { symbol: 'BONK', name: 'Bonk', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5, coingecko_id: 'bonk' },
    { symbol: 'JitoSOL', name: 'Jito Staked SOL', address: 'J1toso1uCk3RLmjorhTtrVwY9HJ7X8V9yYac6Y7kGCPn', decimals: 9, coingecko_id: 'jito-staked-sol' }
  ];
  
  for (const token of basicTokens) {
    try {
      // Check if token exists
      const existingToken = await query('SELECT * FROM tokens WHERE address = $1', [token.address]);
      
      if (existingToken.rows.length === 0) {
        // Create new token
        await query(
          'INSERT INTO tokens (symbol, name, address, decimals, coingecko_id) VALUES ($1, $2, $3, $4, $5)',
          [token.symbol, token.name, token.address, token.decimals, token.coingecko_id]
        );
        console.log(`Created token: ${token.symbol}`);
      } else {
        // Update token if needed
        await query(
          'UPDATE tokens SET name = $1, decimals = $2, coingecko_id = $3 WHERE address = $4',
          [token.name, token.decimals, token.coingecko_id, token.address]
        );
        console.log(`Updated token: ${token.symbol}`);
      }
    } catch (error) {
      console.error(`Error creating/updating token ${token.symbol}:`, error);
    }
  }
  
  // Create or update some common Whirlpool pools for testing
  await createBasicPools();
}

async function createBasicPools() {
  console.log('Creating basic pool records...');
  
  // Get token IDs for reference
  const tokenIds: Record<string, number> = {};
  try {
    const tokens = await query('SELECT id, symbol, address FROM tokens');
    for (const token of tokens.rows) {
      tokenIds[token.symbol] = token.id;
    }
  } catch (error) {
    console.error('Error fetching token IDs:', error);
    return; // Exit the function if we can't get token IDs
  }
  
  // List of common pools to pre-populate
  const basicPools: Pool[] = [
    { 
      address: 'HJPjoWUrhoZzkNfRpHuieeFk9WcZWjwy6PBjZ81ngndJ',
      protocol: 'whirlpool',
      token_a: 'SOL',
      token_b: 'USDC',
      fee_rate: 0.0025,
      tick_spacing: 64
    },
    { 
      address: '7qbRF6YsyGuLUVs6Y1q64bdVrfe4ZcUUz1JRdoVNUJnm',
      protocol: 'whirlpool',
      token_a: 'BONK',
      token_b: 'SOL',
      fee_rate: 0.003,
      tick_spacing: 64
    },
    { 
      address: 'AXtdSZ2mpagmtM5aZcbkXDzHf1FPJ63hi5MgCJFKa3PZ',
      protocol: 'whirlpool',
      token_a: 'mSOL',
      token_b: 'SOL',
      fee_rate: 0.0005,
      tick_spacing: 1
    }
  ];
  
  for (const pool of basicPools) {
    try {
      if (!tokenIds[pool.token_a] || !tokenIds[pool.token_b]) {
        console.warn(`Skipping pool ${pool.address}: missing token IDs for ${pool.token_a} or ${pool.token_b}`);
        continue;
      }
      
      // Check if pool exists
      const existingPool = await query('SELECT * FROM pools WHERE address = $1', [pool.address]);
      
      if (existingPool.rows.length === 0) {
        // Create new pool
        await query(
          `INSERT INTO pools 
           (address, protocol, token_a_id, token_b_id, fee_rate, tick_spacing) 
           VALUES ($1, $2, $3, $4, $5, $6)`,
          [
            pool.address, 
            pool.protocol, 
            tokenIds[pool.token_a], 
            tokenIds[pool.token_b], 
            pool.fee_rate, 
            pool.tick_spacing
          ]
        );
        console.log(`Created pool: ${pool.token_a}/${pool.token_b} (${pool.protocol})`);
      } else {
        // Update pool if needed
        await query(
          `UPDATE pools 
           SET protocol = $1, token_a_id = $2, token_b_id = $3, fee_rate = $4, tick_spacing = $5 
           WHERE address = $6`,
          [
            pool.protocol, 
            tokenIds[pool.token_a], 
            tokenIds[pool.token_b], 
            pool.fee_rate, 
            pool.tick_spacing, 
            pool.address
          ]
        );
        console.log(`Updated pool: ${pool.token_a}/${pool.token_b} (${pool.protocol})`);
      }
    } catch (error) {
      console.error(`Error creating/updating pool ${pool.address}:`, error);
    }
  }
}

// Run the setup function if this module is executed directly
// Using a different approach to check if this is the main module
const isMainModule = process.argv[1]?.endsWith('src/db/setup.ts') || 
                    process.argv[1]?.endsWith('src/db/setup.js');

if (isMainModule) {
  setupDatabase()
    .then(() => {
      console.log('Database setup script completed successfully');
      process.exit(0);
    })
    .catch((error) => {
      console.error('Database setup failed:', error);
      process.exit(1);
    });
}

export { setupDatabase }; 