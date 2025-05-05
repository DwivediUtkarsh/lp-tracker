/**
 * Analytics Controller
 * 
 * This file implements the business logic for the LP-Tracker analytics API.
 * It accesses the database to fetch and process analytics data for fees, 
 * positions, performance, and time-series metrics.
 */

import { Request, Response } from 'express';
import { query } from '../../utils/database.js';

/**
 * Get total fees earned across all positions or for a specific wallet
 */
export async function getTotalFees(req: Request, res: Response) {
  try {
    const { wallet, startDate, endDate, currency = 'usd' } = req.query;
    
    // Base query for total fees
    let sql = `
      SELECT 
        SUM(fee_amount_usd) as total_usd_fees,
        COUNT(DISTINCT position_id) as positions_count,
        COUNT(*) as fee_events_count
      FROM lp_fee_events e
    `;
    
    const params: any[] = [];
    const conditions: string[] = [];
    
    // Add wallet filter if provided
    if (wallet) {
      sql += ` JOIN lp_positions p ON e.position_id = p.id
               JOIN wallets w ON p.wallet_id = w.id`;
      conditions.push('w.address = $1');
      params.push(wallet);
    }
    
    // Add date filters if provided
    if (startDate) {
      conditions.push(`e.timestamp >= $${params.length + 1}`);
      params.push(new Date(startDate as string));
    }
    
    if (endDate) {
      conditions.push(`e.timestamp <= $${params.length + 1}`);
      params.push(new Date(endDate as string));
    }
    
    // Add WHERE clause if we have conditions
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    // Execute query
    const result = await query(sql, params);
    
    // Format response
    const totalFees = result.rows[0];
    
    res.json({
      totalFees: {
        usd: parseFloat(totalFees.total_usd_fees || '0'),
        positionsCount: parseInt(totalFees.positions_count || '0', 10),
        eventCount: parseInt(totalFees.fee_events_count || '0', 10),
      },
      filters: {
        wallet: wallet || 'all',
        startDate: startDate || 'all-time',
        endDate: endDate || 'present',
        currency
      }
    });
  } catch (error) {
    console.error('Error fetching total fees:', error);
    res.status(500).json({ error: 'Failed to fetch fee data' });
  }
}

/**
 * Get fee breakdown by different dimensions: pool, token, time period
 */
export async function getFeesBreakdown(req: Request, res: Response) {
  try {
    const { wallet, groupBy = 'pool', startDate, endDate } = req.query;
    
    let sql = '';
    const params: any[] = [];
    let paramIndex = 1;
    
    // Different SQL based on grouping dimension
    if (groupBy === 'pool') {
      sql = `
        SELECT 
          p.address as pool_address,
          ta.symbol as token_a_symbol,
          tb.symbol as token_b_symbol,
          SUM(e.fee_amount_usd) as total_usd_fees,
          COUNT(*) as fee_events_count
        FROM lp_fee_events e
        JOIN lp_positions pos ON e.position_id = pos.id
        JOIN pools p ON pos.pool_id = p.id
        JOIN tokens ta ON p.token_a_id = ta.id
        JOIN tokens tb ON p.token_b_id = tb.id
      `;
    } else if (groupBy === 'token') {
      sql = `
        SELECT 
          'token_a' as token_type,
          ta.symbol as token_symbol,
          ta.address as token_address,
          SUM(e.token_a_amount * e.token_a_price_usd) as total_usd_fees,
          SUM(e.token_a_amount) as token_amount
        FROM lp_fee_events e
        JOIN lp_positions pos ON e.position_id = pos.id
        JOIN pools p ON pos.pool_id = p.id
        JOIN tokens ta ON p.token_a_id = ta.id
        WHERE e.token_a_amount > 0
        
        UNION ALL
        
        SELECT 
          'token_b' as token_type,
          tb.symbol as token_symbol,
          tb.address as token_address,
          SUM(e.token_b_amount * e.token_b_price_usd) as total_usd_fees,
          SUM(e.token_b_amount) as token_amount
        FROM lp_fee_events e
        JOIN lp_positions pos ON e.position_id = pos.id
        JOIN pools p ON pos.pool_id = p.id
        JOIN tokens tb ON p.token_b_id = tb.id
        WHERE e.token_b_amount > 0
      `;
    } else if (groupBy === 'time') {
      // Group by month
      sql = `
        SELECT 
          DATE_TRUNC('month', e.timestamp) as period,
          SUM(e.fee_amount_usd) as total_usd_fees,
          COUNT(*) as fee_events_count
        FROM lp_fee_events e
      `;
    } else {
      return res.status(400).json({ error: 'Invalid groupBy parameter. Use "pool", "token", or "time"' });
    }
    
    // Common conditions
    const conditions: string[] = [];
    
    // Add wallet filter if provided
    if (wallet) {
      sql += ` JOIN wallets w ON pos.wallet_id = w.id`;
      conditions.push(`w.address = $${paramIndex++}`);
      params.push(wallet);
    }
    
    // Add date filters if provided
    if (startDate) {
      conditions.push(`e.timestamp >= $${paramIndex++}`);
      params.push(new Date(startDate as string));
    }
    
    if (endDate) {
      conditions.push(`e.timestamp <= $${paramIndex++}`);
      params.push(new Date(endDate as string));
    }
    
    // Add WHERE clause if we have conditions
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    // Add GROUP BY and ORDER BY
    if (groupBy === 'pool') {
      sql += ` GROUP BY p.address, ta.symbol, tb.symbol
               ORDER BY total_usd_fees DESC`;
    } else if (groupBy === 'token') {
      sql += ` GROUP BY token_type, token_symbol, token_address
               ORDER BY total_usd_fees DESC`;
    } else if (groupBy === 'time') {
      sql += ` GROUP BY period
               ORDER BY period ASC`;
    }
    
    // Execute query
    const result = await query(sql, params);
    
    res.json({
      breakdown: result.rows,
      dimension: groupBy,
      filters: {
        wallet: wallet || 'all',
        startDate: startDate || 'all-time',
        endDate: endDate || 'present'
      }
    });
  } catch (error) {
    console.error('Error fetching fee breakdown:', error);
    res.status(500).json({ error: 'Failed to fetch fee breakdown data' });
  }
}

/**
 * Get performance metrics for all positions
 */
export async function getPositionsPerformance(req: Request, res: Response) {
  try {
    const { wallet, minUsdValue = 0 } = req.query;
    
    // Build query with possible wallet filter
    let sql = `
      WITH position_fees AS (
        SELECT 
          position_id,
          SUM(fee_amount_usd) as total_fees_usd,
          COUNT(*) as fee_events_count,
          MIN(timestamp) as first_fee_date,
          MAX(timestamp) as last_fee_date
        FROM lp_fee_events
        GROUP BY position_id
      )
      SELECT 
        p.id as position_id,
        p.position_address,
        p.lower_tick_index,
        p.upper_tick_index,
        p.token_a_qty,
        p.token_b_qty,
        p.created_at,
        p.is_active,
        pool.address as pool_address,
        ta.symbol as token_a_symbol,
        ta.address as token_a_address,
        ta.price as token_a_price,
        tb.symbol as token_b_symbol,
        tb.address as token_b_address,
        tb.price as token_b_price,
        w.address as wallet_address,
        pf.total_fees_usd,
        pf.fee_events_count,
        pf.first_fee_date,
        pf.last_fee_date,
        (p.token_a_qty * ta.price + p.token_b_qty * tb.price) as current_value_usd,
        CASE WHEN pf.last_fee_date - pf.first_fee_date > INTERVAL '0' 
          THEN pf.total_fees_usd / EXTRACT(EPOCH FROM (pf.last_fee_date - pf.first_fee_date)) * 86400 * 365 / (p.token_a_qty * ta.price + p.token_b_qty * tb.price) * 100
          ELSE 0 
        END as est_apy_pct
      FROM lp_positions p
      JOIN pools pool ON p.pool_id = pool.id
      JOIN tokens ta ON pool.token_a_id = ta.id
      JOIN tokens tb ON pool.token_b_id = tb.id
      JOIN wallets w ON p.wallet_id = w.id
      LEFT JOIN position_fees pf ON p.id = pf.position_id
      WHERE (p.token_a_qty * ta.price + p.token_b_qty * tb.price) >= $1
    `;
    
    const params: any[] = [minUsdValue];
    
    // Add wallet filter if provided
    if (wallet) {
      sql += ` AND w.address = $2`;
      params.push(wallet);
    }
    
    // Add order by current value
    sql += ` ORDER BY current_value_usd DESC`;
    
    // Execute query
    const result = await query(sql, params);
    
    // Format response
    const positions = result.rows.map(row => ({
      id: row.position_id,
      address: row.position_address,
      pool: {
        address: row.pool_address,
        pair: `${row.token_a_symbol}-${row.token_b_symbol}`
      },
      tokens: {
        a: {
          symbol: row.token_a_symbol,
          address: row.token_a_address,
          quantity: parseFloat(row.token_a_qty),
          price: parseFloat(row.token_a_price),
          value: parseFloat(row.token_a_qty) * parseFloat(row.token_a_price)
        },
        b: {
          symbol: row.token_b_symbol,
          address: row.token_b_address,
          quantity: parseFloat(row.token_b_qty),
          price: parseFloat(row.token_b_price),
          value: parseFloat(row.token_b_qty) * parseFloat(row.token_b_price)
        }
      },
      performance: {
        currentValueUsd: parseFloat(row.current_value_usd || '0'),
        totalFeesUsd: parseFloat(row.total_fees_usd || '0'),
        feeEvents: parseInt(row.fee_events_count || '0', 10),
        estimatedApyPct: parseFloat(row.est_apy_pct || '0'),
        firstFeeDate: row.first_fee_date,
        lastFeeDate: row.last_fee_date,
        active: row.is_active
      },
      walletAddress: row.wallet_address,
      created: row.created_at
    }));
    
    res.json({
      positions,
      filters: {
        wallet: wallet || 'all',
        minUsdValue: parseFloat(minUsdValue as string)
      }
    });
  } catch (error) {
    console.error('Error fetching position performance:', error);
    res.status(500).json({ error: 'Failed to fetch position performance data' });
  }
}

/**
 * Get PnL (Profit and Loss) metrics per pool
 */
export async function getPnLByPool(req: Request, res: Response) {
  try {
    const { wallet } = req.query;
    
    // Complex query to calculate PnL by combining fees and liquidity events
    let sql = `
      WITH pool_fees AS (
        SELECT 
          pos.pool_id,
          SUM(e.fee_amount_usd) as total_fees_usd
        FROM lp_fee_events e
        JOIN lp_positions pos ON e.position_id = pos.id
        ${wallet ? 'JOIN wallets w ON pos.wallet_id = w.id' : ''}
        ${wallet ? 'WHERE w.address = $1' : ''}
        GROUP BY pos.pool_id
      ),
      pool_liquidity AS (
        SELECT 
          pos.pool_id,
          -- Sum increases (positive) and decreases (negative) separately
          SUM(CASE WHEN e.event_type = 'increase' THEN e.total_value_usd ELSE 0 END) as total_added_usd,
          SUM(CASE WHEN e.event_type = 'decrease' THEN e.total_value_usd ELSE 0 END) as total_removed_usd
        FROM liquidity_events e
        JOIN lp_positions pos ON e.position_id = pos.id
        ${wallet ? 'JOIN wallets w ON pos.wallet_id = w.id' : ''}
        ${wallet ? 'WHERE w.address = $1' : ''}
        GROUP BY pos.pool_id
      ),
      current_value AS (
        SELECT 
          pos.pool_id,
          SUM(pos.token_a_qty * ta.price + pos.token_b_qty * tb.price) as current_value_usd
        FROM lp_positions pos
        JOIN pools p ON pos.pool_id = p.id
        JOIN tokens ta ON p.token_a_id = ta.id
        JOIN tokens tb ON p.token_b_id = tb.id
        ${wallet ? 'JOIN wallets w ON pos.wallet_id = w.id' : ''}
        ${wallet ? 'WHERE w.address = $1' : ''}
        GROUP BY pos.pool_id
      )
      SELECT 
        p.id as pool_id,
        p.address as pool_address,
        ta.symbol as token_a_symbol,
        tb.symbol as token_b_symbol,
        pf.total_fees_usd,
        pl.total_added_usd,
        pl.total_removed_usd,
        cv.current_value_usd,
        
        -- PnL calculation: (current_value + removed - added + fees)
        (COALESCE(cv.current_value_usd, 0) + COALESCE(pl.total_removed_usd, 0) - 
         COALESCE(pl.total_added_usd, 0) + COALESCE(pf.total_fees_usd, 0)) as estimated_pnl,
         
        -- ROI calculation: PnL / total_added * 100
        CASE WHEN COALESCE(pl.total_added_usd, 0) > 0 
          THEN (COALESCE(cv.current_value_usd, 0) + COALESCE(pl.total_removed_usd, 0) - 
                COALESCE(pl.total_added_usd, 0) + COALESCE(pf.total_fees_usd, 0)) / 
               COALESCE(pl.total_added_usd, 1) * 100
          ELSE 0 
        END as roi_pct
      FROM pools p
      JOIN tokens ta ON p.token_a_id = ta.id
      JOIN tokens tb ON p.token_b_id = tb.id
      LEFT JOIN pool_fees pf ON p.id = pf.pool_id
      LEFT JOIN pool_liquidity pl ON p.id = pl.pool_id
      LEFT JOIN current_value cv ON p.id = cv.pool_id
      WHERE 
        COALESCE(pf.total_fees_usd, 0) > 0 OR 
        COALESCE(pl.total_added_usd, 0) > 0 OR 
        COALESCE(cv.current_value_usd, 0) > 0
      ORDER BY estimated_pnl DESC
    `;
    
    const params = wallet ? [wallet] : [];
    const result = await query(sql, params);
    
    // Format response
    const poolsPnL = result.rows.map(row => ({
      poolId: row.pool_id,
      address: row.pool_address,
      pair: `${row.token_a_symbol}-${row.token_b_symbol}`,
      metrics: {
        totalFeesEarned: parseFloat(row.total_fees_usd || '0'),
        totalValueAdded: parseFloat(row.total_added_usd || '0'),
        totalValueRemoved: parseFloat(row.total_removed_usd || '0'),
        currentValue: parseFloat(row.current_value_usd || '0'),
        estimatedPnL: parseFloat(row.estimated_pnl || '0'),
        roiPercent: parseFloat(row.roi_pct || '0')
      }
    }));
    
    res.json({
      pools: poolsPnL,
      filters: {
        wallet: wallet || 'all'
      }
    });
  } catch (error) {
    console.error('Error fetching PnL by pool:', error);
    res.status(500).json({ error: 'Failed to fetch PnL data' });
  }
}

/**
 * Get time series data for various metrics
 */
export async function getTimeSeries(req: Request, res: Response) {
  try {
    const { 
      metric = 'fees', 
      wallet, 
      interval = 'day', 
      startDate, 
      endDate, 
      poolAddress 
    } = req.query;
    
    // Validate interval
    if (!['hour', 'day', 'week', 'month'].includes(interval as string)) {
      return res.status(400).json({ error: 'Invalid interval. Use hour, day, week, or month' });
    }
    
    // Base query structure depends on the requested metric
    let sql = '';
    const params: any[] = [];
    let paramIndex = 1;
    
    // Interval formatting based on requested granularity
    const intervalTrunc = interval === 'hour' ? 'hour' :
                          interval === 'day' ? 'day' :
                          interval === 'week' ? 'week' : 'month';
    
    if (metric === 'fees') {
      sql = `
        SELECT 
          DATE_TRUNC('${intervalTrunc}', e.timestamp) as period,
          SUM(e.fee_amount_usd) as value
        FROM lp_fee_events e
        JOIN lp_positions pos ON e.position_id = pos.id
      `;
    } else if (metric === 'liquidity') {
      sql = `
        SELECT 
          DATE_TRUNC('${intervalTrunc}', e.timestamp) as period,
          SUM(CASE WHEN e.event_type = 'increase' THEN e.total_value_usd ELSE -e.total_value_usd END) as value
        FROM liquidity_events e
        JOIN lp_positions pos ON e.position_id = pos.id
      `;
    } else {
      return res.status(400).json({ error: 'Invalid metric. Use fees or liquidity' });
    }
    
    // Common conditions
    const conditions: string[] = [];
    
    // Add wallet filter if provided
    if (wallet) {
      sql += ` JOIN wallets w ON pos.wallet_id = w.id`;
      conditions.push(`w.address = $${paramIndex++}`);
      params.push(wallet);
    }
    
    // Add pool filter if provided
    if (poolAddress) {
      sql += ` JOIN pools p ON pos.pool_id = p.id`;
      conditions.push(`p.address = $${paramIndex++}`);
      params.push(poolAddress);
    }
    
    // Add date filters if provided
    if (startDate) {
      conditions.push(`e.timestamp >= $${paramIndex++}`);
      params.push(new Date(startDate as string));
    }
    
    if (endDate) {
      conditions.push(`e.timestamp <= $${paramIndex++}`);
      params.push(new Date(endDate as string));
    }
    
    // Add WHERE clause if we have conditions
    if (conditions.length > 0) {
      sql += ` WHERE ${conditions.join(' AND ')}`;
    }
    
    // Finalize with GROUP BY and ORDER BY
    sql += ` GROUP BY period ORDER BY period ASC`;
    
    // Execute query
    const result = await query(sql, params);
    
    // Format the time series data
    const series = result.rows.map(row => ({
      period: row.period,
      value: parseFloat(row.value || '0')
    }));
    
    res.json({
      metric,
      interval,
      series,
      filters: {
        wallet: wallet || 'all',
        poolAddress: poolAddress || 'all',
        startDate: startDate || 'all-time',
        endDate: endDate || 'present'
      }
    });
  } catch (error) {
    console.error('Error fetching time series data:', error);
    res.status(500).json({ error: 'Failed to fetch time series data' });
  }
}
