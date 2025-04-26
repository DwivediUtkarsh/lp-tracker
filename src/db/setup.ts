import { readFileSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { query, pool } from '../utils/database.js';

// Get the directory name from the current module's URL
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function setupDatabase() {
  try {
    console.log('Setting up database...');
    
    // Read SQL schema
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = readFileSync(schemaPath, 'utf8');
    
    // Execute schema
    await query(schema);
    console.log('Database schema created successfully');
    
    // Create or update basic tokens
    await createBasicTokens();
    
    console.log('Database setup completed successfully');
    
    // Close the connection pool
    await pool.end();
  } catch (error) {
    console.error('Error setting up database:', error);
    process.exit(1);
  }
}

async function createBasicTokens() {
  console.log('Creating basic token records...');
  
  // Check for existing columns
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
  
  // List of common tokens to pre-populate
  const basicTokens = [
    { symbol: 'SOL', name: 'Solana', address: 'So11111111111111111111111111111111111111112', decimals: 9, coingecko_id: 'solana' },
    { symbol: 'USDC', name: 'USD Coin', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6, coingecko_id: 'usd-coin' },
    { symbol: 'USDT', name: 'Tether', address: 'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB', decimals: 6, coingecko_id: 'tether' },
    { symbol: 'RAY', name: 'Raydium', address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R', decimals: 6, coingecko_id: 'raydium' },
    { symbol: 'ORCA', name: 'Orca', address: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE', decimals: 6, coingecko_id: 'orca' },
    { symbol: 'mSOL', name: 'Marinade staked SOL', address: 'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', decimals: 9, coingecko_id: 'msol' }
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
}

// Run the setup function if this module is executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  setupDatabase();
}

export { setupDatabase }; 