/**
 * API Server for LP-Tracker Analytics
 * 
 * This file sets up an Express server that provides REST endpoints
 * for accessing LP analytics data such as fee earnings, position performance,
 * and time-series data.
 */

import express from 'express';
import cors from 'cors';
import { analyticsRoutes } from './routes/analyticsRoutes.js';
import { portfolioRoutes } from './routes/portfolioRoutes.js';

// Create Express app
const app = express();
const PORT = process.env.API_PORT || 3000;

// Middleware
app.use(cors());
app.use(express.json());

// Add request logging middleware
app.use((req, res, next) => {
  console.log(`[${new Date().toISOString()}] ${req.method} ${req.url}`);
  next();
});

// API Routes
app.use('/api/v1/analytics', analyticsRoutes);
app.use('/api/v1/portfolio', portfolioRoutes);

// Default route
app.get('/', (req, res) => {
  res.json({
    name: 'LP-Tracker Analytics API',
    version: '1.0.0',
    endpoints: [
      '/api/v1/analytics/fees',
      '/api/v1/analytics/positions',
      '/api/v1/analytics/pnl',
      '/api/v1/analytics/timeseries',
      '/api/v1/portfolio/complete',
      '/api/v1/portfolio/tokens',
      '/api/v1/portfolio/positions',
      '/api/v1/portfolio/summary'
    ]
  });
});

// Error handling middleware
app.use((err: any, req: express.Request, res: express.Response, next: express.NextFunction) => {
  console.error('API Error:', err);
  res.status(err.status || 500).json({
    error: {
      message: err.message || 'Internal Server Error',
      status: err.status || 500
    }
  });
});

// Start server
export function startServer() {
  return app.listen(PORT, () => {
    console.log(`LP-Tracker API server running on port ${PORT}`);
  });
}

// If this file is run directly, start the server
if (process.argv[1] === new URL(import.meta.url).pathname) {
  startServer();
}

export default app;
