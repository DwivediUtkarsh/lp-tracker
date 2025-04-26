-- Drop tables if they exist (for clean setup)
DROP TABLE IF EXISTS lp_positions;
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

-- Create LP positions table
CREATE TABLE lp_positions (
  id SERIAL PRIMARY KEY,
  wallet_id INTEGER NOT NULL REFERENCES wallets(id),
  dex VARCHAR(20) NOT NULL,
  pool_address VARCHAR(44) NOT NULL,
  token_a_id INTEGER NOT NULL REFERENCES tokens(id),
  token_b_id INTEGER NOT NULL REFERENCES tokens(id),
  qty_a NUMERIC(30, 15) NOT NULL,
  qty_b NUMERIC(30, 15) NOT NULL,
  last_updated TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT CURRENT_TIMESTAMP,
  UNIQUE(wallet_id, pool_address)
);

-- Create indexes
CREATE INDEX idx_lp_positions_wallet ON lp_positions(wallet_id);
CREATE INDEX idx_lp_positions_tokens ON lp_positions(token_a_id, token_b_id);
CREATE INDEX idx_tokens_address ON tokens(address);
CREATE INDEX idx_wallets_address ON wallets(address); 