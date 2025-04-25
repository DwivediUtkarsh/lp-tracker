import { query } from '../utils/database.js';
import { Exposure } from '../types/Exposure.js';
import { PublicKey } from '@solana/web3.js';

// Token model
export interface Token {
  id?: number;
  symbol: string;
  name?: string;
  address: string;
  decimals?: number;
  coingecko_id?: string;
  created_at?: Date;
  updated_at?: Date;
}

// Wallet model
export interface Wallet {
  id?: number;
  address: string;
  label?: string;
  created_at?: Date;
  updated_at?: Date;
}

// LP Position model
export interface LPPosition {
  id?: number;
  wallet_id: number;
  dex: string;
  pool_address: string;
  token_a_id: number;
  token_b_id: number;
  qty_a: number;
  qty_b: number;
  last_updated?: Date;
  created_at?: Date;
}

// Token functions
export async function getOrCreateToken(tokenData: Token): Promise<Token> {
  // Check if token exists
  const existingToken = await query('SELECT * FROM tokens WHERE address = $1', [tokenData.address]);
  
  if (existingToken.rows.length > 0) {
    return existingToken.rows[0];
  }
  
  // Create new token
  const result = await query(
    'INSERT INTO tokens (symbol, name, address, decimals, coingecko_id) VALUES ($1, $2, $3, $4, $5) RETURNING *',
    [tokenData.symbol, tokenData.name || null, tokenData.address, tokenData.decimals || 9, tokenData.coingecko_id || null]
  );
  
  return result.rows[0];
}

// Wallet functions
export async function getOrCreateWallet(walletAddress: string, label?: string): Promise<Wallet> {
  // Check if wallet exists
  const existingWallet = await query('SELECT * FROM wallets WHERE address = $1', [walletAddress]);
  
  if (existingWallet.rows.length > 0) {
    return existingWallet.rows[0];
  }
  
  // Create new wallet
  const result = await query(
    'INSERT INTO wallets (address, label) VALUES ($1, $2) RETURNING *',
    [walletAddress, label || null]
  );
  
  return result.rows[0];
}

// LP Position functions
export async function saveExposureToDatabase(exposure: Exposure, walletAddress: string): Promise<LPPosition> {
  // Get or create wallet
  const wallet = await getOrCreateWallet(walletAddress);
  
  // Get or create tokens
  const tokenA = await getOrCreateToken({
    symbol: exposure.tokenA,
    address: exposure.tokenA, // Note: In a real app, you'd use the actual token address, not the symbol
  });
  
  const tokenB = await getOrCreateToken({
    symbol: exposure.tokenB,
    address: exposure.tokenB, // Note: In a real app, you'd use the actual token address, not the symbol
  });
  
  // Check if position exists
  const existingPosition = await query(
    'SELECT * FROM lp_positions WHERE wallet_id = $1 AND pool_address = $2',
    [wallet.id, exposure.pool]
  );
  
  if (existingPosition.rows.length > 0) {
    // Update existing position
    const result = await query(
      `UPDATE lp_positions 
       SET qty_a = $1, qty_b = $2, last_updated = CURRENT_TIMESTAMP
       WHERE id = $3 RETURNING *`,
      [exposure.qtyA, exposure.qtyB, existingPosition.rows[0].id]
    );
    
    return result.rows[0];
  }
  
  // Create new position
  const result = await query(
    `INSERT INTO lp_positions 
     (wallet_id, dex, pool_address, token_a_id, token_b_id, qty_a, qty_b)
     VALUES ($1, $2, $3, $4, $5, $6, $7) RETURNING *`,
    [wallet.id, exposure.dex, exposure.pool, tokenA.id, tokenB.id, exposure.qtyA, exposure.qtyB]
  );
  
  return result.rows[0];
}

// Get all LP positions for a wallet
export async function getPositionsForWallet(walletAddress: string): Promise<any[]> {
  const result = await query(
    `SELECT lp.*, 
            ta.symbol as token_a_symbol, ta.address as token_a_address,
            tb.symbol as token_b_symbol, tb.address as token_b_address
     FROM lp_positions lp
     JOIN wallets w ON lp.wallet_id = w.id
     JOIN tokens ta ON lp.token_a_id = ta.id
     JOIN tokens tb ON lp.token_b_id = tb.id
     WHERE w.address = $1
     ORDER BY lp.last_updated DESC`,
    [walletAddress]
  );
  
  return result.rows;
} 