import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';
import { pool, query } from '../utils/database.js';

// Get the directory name
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

async function setupDatabase() {
  console.log('Setting up database...');
  
  try {
    // Read the schema file
    const schemaPath = path.join(__dirname, 'schema.sql');
    const schema = fs.readFileSync(schemaPath, 'utf8');
    
    // Execute the schema SQL
    await query(schema);
    console.log('Database schema created successfully');

    // Add some basic token data (examples)
    const tokens = [
      { symbol: 'SOL', name: 'Solana', address: 'So11111111111111111111111111111111111111112', decimals: 9 },
      { symbol: 'USDC', name: 'USD Coin', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', decimals: 6 },
      { symbol: 'BONK', name: 'Bonk', address: 'DezXAZ8z7PnrnRJjz3wXBoRgixCa6xjnB7YaB1pPB263', decimals: 5 },
    ];
    
    for (const token of tokens) {
      await query(
        'INSERT INTO tokens (symbol, name, address, decimals) VALUES ($1, $2, $3, $4) ON CONFLICT (address) DO NOTHING',
        [token.symbol, token.name, token.address, token.decimals]
      );
    }
    
    console.log('Example tokens added');
    
    console.log('Database setup completed successfully');
  } catch (error) {
    console.error('Database setup failed:', error);
    throw error;
  } finally {
    // Close the pool
    await pool.end();
  }
}

// Run the setup if this file is executed directly
if (process.argv[1] === fileURLToPath(import.meta.url)) {
  setupDatabase().catch(console.error);
}

export { setupDatabase }; 