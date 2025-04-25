import { Pool } from 'pg';
import { DATABASE_URL } from '../config.js';

// Create a connection pool for PostgreSQL
const pool = new Pool({
  connectionString: DATABASE_URL,
});

// Test the connection
pool.on('connect', () => {
  console.log('Connected to PostgreSQL database');
});

pool.on('error', (err) => {
  console.error('PostgreSQL connection error:', err);
  process.exit(-1);
});

/**
 * Execute a query on the database
 * @param text SQL query
 * @param params Query parameters
 * @returns Query result
 */
export async function query(text: string, params?: any[]) {
  try {
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    console.debug('Executed query', { text, duration, rows: res.rowCount });
    return res;
  } catch (error) {
    console.error('Database query error:', error);
    throw error;
  }
}

// Export pool for advanced usage
export { pool }; 