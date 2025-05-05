-- Drop tables if they exist (for clean setup)
DROP TABLE IF EXISTS swap_events;
DROP TABLE IF EXISTS liquidity_events;
DROP TABLE IF EXISTS lp_fee_events;
DROP TABLE IF EXISTS lp_positions;
DROP TABLE IF EXISTS pools;
DROP TABLE IF EXISTS wallets;
DROP TABLE IF EXISTS tokens;

-- Create tokens table
CREATE TABLE tokens (
  id SERIAL PRIMARY KEY,
  symbol VARCHAR(20) NOT NULL,
  name VARCHAR(100),
  address VARCHAR(44) NOT NULL UNIQUE,
  decimals INTEGER NOT NULL DEFAULT 9,
  coingecko_id VARCHAR(50),
  price NUMERIC(30, 15),
  last_price_update TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create wallets table
CREATE TABLE wallets (
  id SERIAL PRIMARY KEY,
  address VARCHAR(44) NOT NULL UNIQUE,
  label VARCHAR(100),
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create pools table
CREATE TABLE pools (
  id SERIAL PRIMARY KEY,
  address VARCHAR(44) NOT NULL UNIQUE,
  protocol VARCHAR(20) NOT NULL, -- 'whirlpool', 'classic', etc.
  token_a_id INTEGER NOT NULL REFERENCES tokens(id),
  token_b_id INTEGER NOT NULL REFERENCES tokens(id),
  fee_rate NUMERIC(10, 6), -- Fee rate as a decimal (e.g., 0.003 for 0.3%)
  tick_spacing INTEGER, -- For Whirlpools
  price_range_min NUMERIC(30, 15), -- For position price range tracking
  price_range_max NUMERIC(30, 15), -- For position price range tracking
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create LP positions table (enhanced from original)
CREATE TABLE lp_positions (
  id SERIAL PRIMARY KEY,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id),
  position_address VARCHAR(44) UNIQUE, -- NFT position address (for Whirlpools)
  pool_id INTEGER NOT NULL REFERENCES pools(id),
  lower_tick_index BIGINT, -- For Whirlpools
  upper_tick_index BIGINT, -- For Whirlpools
  liquidity NUMERIC(38, 0), -- Raw liquidity value
  token_a_qty NUMERIC(30, 15),
  token_b_qty NUMERIC(30, 15),
  total_fees_earned_a NUMERIC(30, 15) DEFAULT 0, -- Accumulated fees token A
  total_fees_earned_b NUMERIC(30, 15) DEFAULT 0, -- Accumulated fees token B
  total_fees_usd NUMERIC(30, 15) DEFAULT 0, -- Accumulated fees in USD
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(wallet_id, position_address)
);

-- Create LP fee events table
CREATE TABLE lp_fee_events (
  id SERIAL PRIMARY KEY,
  position_id INTEGER NOT NULL REFERENCES lp_positions(id),
  transaction_hash VARCHAR(88) NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  token_a_amount NUMERIC(30, 15) NOT NULL DEFAULT 0,
  token_b_amount NUMERIC(30, 15) NOT NULL DEFAULT 0,
  token_a_price_usd NUMERIC(30, 15),
  token_b_price_usd NUMERIC(30, 15),
  fee_amount_usd NUMERIC(30, 15),
  block_number BIGINT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create liquidity events table
CREATE TABLE liquidity_events (
  id SERIAL PRIMARY KEY,
  position_id INTEGER NOT NULL REFERENCES lp_positions(id),
  transaction_hash VARCHAR(88) NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  event_type VARCHAR(20) NOT NULL, -- 'increase', 'decrease', 'create'
  token_a_amount NUMERIC(30, 15) NOT NULL DEFAULT 0,
  token_b_amount NUMERIC(30, 15) NOT NULL DEFAULT 0, 
  token_a_price_usd NUMERIC(30, 15),
  token_b_price_usd NUMERIC(30, 15),
  total_value_usd NUMERIC(30, 15),
  liquidity_delta NUMERIC(38, 0), -- Raw liquidity change
  block_number BIGINT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create swap events table (for indexing swaps in pools we track)
CREATE TABLE swap_events (
  id SERIAL PRIMARY KEY,
  pool_id INTEGER NOT NULL REFERENCES pools(id),
  transaction_hash VARCHAR(88) NOT NULL,
  timestamp TIMESTAMP WITH TIME ZONE NOT NULL,
  token_in_id INTEGER NOT NULL REFERENCES tokens(id),
  token_out_id INTEGER NOT NULL REFERENCES tokens(id),
  amount_in NUMERIC(30, 15) NOT NULL,
  amount_out NUMERIC(30, 15) NOT NULL,
  fee_amount NUMERIC(30, 15),
  price_impact NUMERIC(10, 6), -- e.g. 0.01 for 1% price impact
  block_number BIGINT,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP
);

-- Create indexes
CREATE INDEX idx_lp_positions_wallet ON lp_positions(wallet_id);
CREATE INDEX idx_lp_positions_pool ON lp_positions(pool_id);
CREATE INDEX idx_pools_tokens ON pools(token_a_id, token_b_id);
CREATE INDEX idx_tokens_address ON tokens(address);
CREATE INDEX idx_wallets_address ON wallets(address);
CREATE INDEX idx_lp_fee_events_position ON lp_fee_events(position_id);
CREATE INDEX idx_lp_fee_events_tx ON lp_fee_events(transaction_hash);
CREATE INDEX idx_lp_fee_events_timestamp ON lp_fee_events(timestamp);
CREATE INDEX idx_liquidity_events_position ON liquidity_events(position_id);
CREATE INDEX idx_liquidity_events_tx ON liquidity_events(transaction_hash);
CREATE INDEX idx_liquidity_events_timestamp ON liquidity_events(timestamp);
CREATE INDEX idx_swap_events_pool ON swap_events(pool_id);
CREATE INDEX idx_swap_events_tx ON swap_events(transaction_hash);
CREATE INDEX idx_swap_events_timestamp ON swap_events(timestamp); 