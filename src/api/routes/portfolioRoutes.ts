/**
 * Portfolio Routes
 * 
 * This file defines the routes for the LP-Tracker portfolio API.
 * It provides endpoints for accessing wallet token balances,
 * LP positions, and aggregate portfolio data.
 */

import express, { RequestHandler } from 'express';
import { 
  getWalletPortfolio,
  getWalletTokens,
  getWalletPositions,
  getPortfolioSummary
} from '../controllers/portfolioController.js';

const router = express.Router();

/**
 * Complete Portfolio Endpoint
 */

// Get complete portfolio data (tokens + positions + summary)
router.get('/complete', getWalletPortfolio as RequestHandler);

/**
 * Portfolio Component Endpoints
 */

// Get wallet token balances with values
router.get('/tokens', getWalletTokens as RequestHandler);

// Get wallet LP positions with values
router.get('/positions', getWalletPositions as RequestHandler);

// Get portfolio summary with total values
router.get('/summary', getPortfolioSummary as RequestHandler);

export { router as portfolioRoutes };
