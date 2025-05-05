/**
 * Analytics Routes
 * 
 * This file defines the routes for the LP-Tracker analytics API.
 * It provides endpoints for accessing fee data, position performance,
 * and time-series analytics.
 */

import express, { RequestHandler } from 'express';
import { 
  getTotalFees,
  getFeesBreakdown,
  getPositionsPerformance,
  getPnLByPool,
  getTimeSeries
} from '../controllers/analyticsController.js';

const router = express.Router();

/**
 * Fee Analytics Endpoints
 */

// Get total fees earned across all positions
router.get('/fees/total', getTotalFees as RequestHandler);

// Get fee breakdown by pool, token, or time period
router.get('/fees/breakdown', getFeesBreakdown as RequestHandler);

/**
 * Position Performance Endpoints
 */

// Get performance metrics for all positions
router.get('/positions', getPositionsPerformance as RequestHandler);

/**
 * PnL (Profit and Loss) Endpoints
 */

// Get PnL metrics per pool
router.get('/pnl/by-pool', getPnLByPool as RequestHandler);

/**
 * Time Series Data Endpoints
 */

// Get time series data for various metrics
router.get('/timeseries', getTimeSeries as RequestHandler);

export { router as analyticsRoutes };
