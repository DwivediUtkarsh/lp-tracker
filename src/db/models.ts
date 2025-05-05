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
  price?: number;
  last_price_update?: Date;
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

// Pool model
export interface Pool {
  id?: number;
  address: string;
  protocol: string; // 'whirlpool', 'classic', etc.
  token_a_id: number;
  token_b_id: number;
  fee_rate?: number; // Fee rate as a decimal (e.g., 0.003 for 0.3%)
  tick_spacing?: number; // For Whirlpools
  price_range_min?: number; // For position price range tracking
  price_range_max?: number; // For position price range tracking
  created_at?: Date;
  updated_at?: Date;
  // References for convenience
  token_a?: Token;
  token_b?: Token;
}

// LP Position model (enhanced)
export interface LPPosition {
  id?: number;
  wallet_id: number;
  position_address?: string; // NFT position address (for Whirlpools)
  pool_id: number;
  lower_tick_index?: number; // For Whirlpools
  upper_tick_index?: number; // For Whirlpools
  liquidity?: number; // Raw liquidity value
  token_a_qty: number;
  token_b_qty: number;
  total_fees_earned_a?: number; // Accumulated fees token A
  total_fees_earned_b?: number; // Accumulated fees token B
  total_fees_usd?: number; // Accumulated fees in USD
  is_active?: boolean;
  created_at?: Date;
  updated_at?: Date;
  // References for convenience
  wallet?: Wallet;
  pool?: Pool;
}

// LP Fee Event model
export interface LPFeeEvent {
  id?: number;
  position_id: number;
  transaction_hash: string;
  timestamp: Date;
  token_a_amount: number;
  token_b_amount: number;
  token_a_price_usd?: number;
  token_b_price_usd?: number;
  fee_amount_usd?: number;
  block_number?: number;
  created_at?: Date;
  // References for convenience
  position?: LPPosition;
}

// Liquidity Event model
export interface LiquidityEvent {
  id?: number;
  position_id: number;
  transaction_hash: string;
  timestamp: Date;
  event_type: 'increase' | 'decrease' | 'create';
  token_a_amount: number;
  token_b_amount: number;
  token_a_price_usd?: number;
  token_b_price_usd?: number;
  total_value_usd?: number;
  liquidity_delta?: number; // Raw liquidity change
  block_number?: number;
  created_at?: Date;
  // References for convenience
  position?: LPPosition;
}

// Swap Event model
export interface SwapEvent {
  id?: number;
  pool_id: number;
  transaction_hash: string;
  timestamp: Date;
  token_in_id: number;
  token_out_id: number;
  amount_in: number;
  amount_out: number;
  fee_amount?: number;
  price_impact?: number; // e.g. 0.01 for 1% price impact
  block_number?: number;
  created_at?: Date;
  // References for convenience
  pool?: Pool;
  token_in?: Token;
  token_out?: Token;
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

// Pool functions
export async function getOrCreatePool(poolData: Pool): Promise<Pool> {
  // Check if pool exists
  const existingPool = await query('SELECT * FROM pools WHERE address = $1', [poolData.address]);
  
  if (existingPool.rows.length > 0) {
    return existingPool.rows[0];
  }
  
  // Create new pool
  const result = await query(
    `INSERT INTO pools 
     (address, protocol, token_a_id, token_b_id, fee_rate, tick_spacing, price_range_min, price_range_max) 
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
    [
      poolData.address, 
      poolData.protocol, 
      poolData.token_a_id, 
      poolData.token_b_id, 
      poolData.fee_rate || null, 
      poolData.tick_spacing || null,
      poolData.price_range_min || null,
      poolData.price_range_max || null
    ]
  );
  
  return result.rows[0];
}

// LP Position functions
export async function getOrCreatePosition(positionData: LPPosition): Promise<LPPosition> {
  // Check if position exists by position_address if provided
  if (positionData.position_address) {
    const existingPosition = await query(
      'SELECT * FROM lp_positions WHERE position_address = $1',
      [positionData.position_address]
    );
    
    if (existingPosition.rows.length > 0) {
      return existingPosition.rows[0];
    }
  } else {
    // Check by wallet and pool as fallback
    const existingPosition = await query(
      'SELECT * FROM lp_positions WHERE wallet_id = $1 AND pool_id = $2',
      [positionData.wallet_id, positionData.pool_id]
    );
    
    if (existingPosition.rows.length > 0) {
      return existingPosition.rows[0];
    }
  }
  
  // Create new position
  const result = await query(
    `INSERT INTO lp_positions 
     (wallet_id, position_address, pool_id, lower_tick_index, upper_tick_index, 
      liquidity, token_a_qty, token_b_qty, is_active)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      positionData.wallet_id,
      positionData.position_address || null,
      positionData.pool_id,
      positionData.lower_tick_index || null,
      positionData.upper_tick_index || null,
      positionData.liquidity || null,
      positionData.token_a_qty,
      positionData.token_b_qty,
      positionData.is_active !== undefined ? positionData.is_active : true
    ]
  );
  
  return result.rows[0];
}

// Update position liquidity and token amounts
export async function updatePositionLiquidity(
  positionId: number, 
  liquidity: number,
  tokenAQty: number, 
  tokenBQty: number
): Promise<LPPosition> {
  const result = await query(
    `UPDATE lp_positions 
     SET liquidity = $1, token_a_qty = $2, token_b_qty = $3, updated_at = CURRENT_TIMESTAMP
     WHERE id = $4 RETURNING *`,
    [liquidity, tokenAQty, tokenBQty, positionId]
  );
  
  return result.rows[0];
}

// Update position fee totals
export async function updatePositionFees(
  positionId: number, 
  feesTokenA: number, 
  feesTokenB: number,
  feesUsd: number
): Promise<LPPosition> {
  const result = await query(
    `UPDATE lp_positions 
     SET total_fees_earned_a = total_fees_earned_a + $1, 
         total_fees_earned_b = total_fees_earned_b + $2,
         total_fees_usd = total_fees_usd + $3,
         updated_at = CURRENT_TIMESTAMP
     WHERE id = $4 RETURNING *`,
    [feesTokenA, feesTokenB, feesUsd, positionId]
  );
  
  return result.rows[0];
}

// Record LP fee event
export async function recordFeeEvent(feeEvent: LPFeeEvent): Promise<LPFeeEvent | null> {
  // Check if the transaction has already been recorded for this position
  // IMPROVED: Using both transaction_hash AND position_id for deduplication
  // This allows a single harvest tx to create fee events for multiple positions
  const existingEvent = await query(
    'SELECT id FROM lp_fee_events WHERE transaction_hash = $1 AND position_id = $2 LIMIT 1',
    [feeEvent.transaction_hash, feeEvent.position_id]
  );
  
  if (existingEvent.rowCount && existingEvent.rowCount > 0) {
    console.log(`Fee event already exists for position ${feeEvent.position_id} and transaction ${feeEvent.transaction_hash.slice(0, 8)}...`);
    return null;
  }
  
  const result = await query(
    `INSERT INTO lp_fee_events 
     (position_id, transaction_hash, timestamp, token_a_amount, token_b_amount, 
      token_a_price_usd, token_b_price_usd, fee_amount_usd, block_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
    [
      feeEvent.position_id,
      feeEvent.transaction_hash,
      feeEvent.timestamp,
      feeEvent.token_a_amount,
      feeEvent.token_b_amount,
      feeEvent.token_a_price_usd || null,
      feeEvent.token_b_price_usd || null,
      feeEvent.fee_amount_usd || null,
      feeEvent.block_number || null
    ]
  );
  
  return result.rows[0];
}

// Record liquidity event
export async function recordLiquidityEvent(liquidityEvent: LiquidityEvent): Promise<LiquidityEvent> {
  const result = await query(
    `INSERT INTO liquidity_events 
     (position_id, transaction_hash, timestamp, event_type, token_a_amount, token_b_amount, 
      token_a_price_usd, token_b_price_usd, total_value_usd, liquidity_delta, block_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11) RETURNING *`,
    [
      liquidityEvent.position_id,
      liquidityEvent.transaction_hash,
      liquidityEvent.timestamp,
      liquidityEvent.event_type,
      liquidityEvent.token_a_amount,
      liquidityEvent.token_b_amount,
      liquidityEvent.token_a_price_usd || null,
      liquidityEvent.token_b_price_usd || null,
      liquidityEvent.total_value_usd || null,
      liquidityEvent.liquidity_delta || null,
      liquidityEvent.block_number || null
    ]
  );
  
  return result.rows[0];
}

// Record swap event
export async function recordSwapEvent(swapEvent: SwapEvent): Promise<SwapEvent> {
  const result = await query(
    `INSERT INTO swap_events 
     (pool_id, transaction_hash, timestamp, token_in_id, token_out_id, 
      amount_in, amount_out, fee_amount, price_impact, block_number)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING *`,
    [
      swapEvent.pool_id,
      swapEvent.transaction_hash,
      swapEvent.timestamp,
      swapEvent.token_in_id,
      swapEvent.token_out_id,
      swapEvent.amount_in,
      swapEvent.amount_out,
      swapEvent.fee_amount || null,
      swapEvent.price_impact || null,
      swapEvent.block_number || null
    ]
  );
  
  return result.rows[0];
}

// Legacy function to maintain backward compatibility
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
  
  // Get or create pool
  const pool = await getOrCreatePool({
    address: exposure.pool,
    protocol: exposure.dex,
    token_a_id: tokenA.id!,
    token_b_id: tokenB.id!
  });
  
  // Check if position exists
  const existingPosition = await query(
    'SELECT * FROM lp_positions WHERE wallet_id = $1 AND pool_id = $2',
    [wallet.id, pool.id]
  );
  
  if (existingPosition.rows.length > 0) {
    // Update existing position
    const result = await query(
      `UPDATE lp_positions 
       SET token_a_qty = $1, token_b_qty = $2, updated_at = CURRENT_TIMESTAMP
       WHERE id = $3 RETURNING *`,
      [exposure.qtyA, exposure.qtyB, existingPosition.rows[0].id]
    );
    
    return result.rows[0];
  }
  
  // Create new position
  const result = await query(
    `INSERT INTO lp_positions 
     (wallet_id, pool_id, token_a_qty, token_b_qty)
     VALUES ($1, $2, $3, $4) RETURNING *`,
    [wallet.id, pool.id, exposure.qtyA, exposure.qtyB]
  );
  
  return result.rows[0];
}

// Get all LP positions for a wallet
export async function getPositionsForWallet(walletAddress: string): Promise<any[]> {
  const result = await query(
    `SELECT lp.*, 
            p.address as pool_address, p.protocol,
            ta.symbol as token_a_symbol, ta.address as token_a_address,
            tb.symbol as token_b_symbol, tb.address as token_b_address
     FROM lp_positions lp
     JOIN wallets w ON lp.wallet_id = w.id
     JOIN pools p ON lp.pool_id = p.id
     JOIN tokens ta ON p.token_a_id = ta.id
     JOIN tokens tb ON p.token_b_id = tb.id
     WHERE w.address = $1
     ORDER BY lp.updated_at DESC`,
    [walletAddress]
  );
  
  return result.rows;
}

// Get fee events for a position
export async function getFeeEventsForPosition(positionId: number): Promise<LPFeeEvent[]> {
  const result = await query(
    `SELECT * FROM lp_fee_events 
     WHERE position_id = $1 
     ORDER BY timestamp DESC`,
    [positionId]
  );
  
  return result.rows;
}

// Get liquidity events for a position
export async function getLiquidityEventsForPosition(positionId: number): Promise<LiquidityEvent[]> {
  const result = await query(
    `SELECT * FROM liquidity_events 
     WHERE position_id = $1 
     ORDER BY timestamp DESC`,
    [positionId]
  );
  
  return result.rows;
}

// Get total fees earned across all positions for a wallet
export async function getTotalFeesForWallet(walletAddress: string): Promise<any> {
  const result = await query(
    `SELECT 
       SUM(lp.total_fees_earned_a) as total_fees_a,
       SUM(lp.total_fees_earned_b) as total_fees_b,
       SUM(lp.total_fees_usd) as total_fees_usd
     FROM lp_positions lp
     JOIN wallets w ON lp.wallet_id = w.id
     WHERE w.address = $1`,
    [walletAddress]
  );
  
  return result.rows[0];
} 