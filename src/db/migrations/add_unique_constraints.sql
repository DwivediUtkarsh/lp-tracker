-- Add unique constraints to prevent duplicate event records
-- This ensures data integrity and handles race conditions during concurrent processing

-- Fee events should be unique per transaction and position
ALTER TABLE lp_fee_events 
ADD CONSTRAINT uniq_fee UNIQUE (transaction_hash, position_id);

-- Liquidity events should be unique per transaction, position, and event type
ALTER TABLE liquidity_events
ADD CONSTRAINT uniq_liq UNIQUE (transaction_hash, position_id, event_type);

-- Swap events should be unique per transaction and pool
ALTER TABLE swap_events
ADD CONSTRAINT uniq_swap UNIQUE (transaction_hash, pool_id);
