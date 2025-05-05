/**
 * Start API Server Script
 * 
 * This script initializes and starts the LP-Tracker Analytics API server.
 * It can be run directly via npm scripts.
 * 
 * Usage: npm run start:api
 */

import { startServer } from '../api/server.js';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

console.log('Starting LP-Tracker Analytics API Server...');
const server = startServer();

// Handle graceful shutdown
process.on('SIGINT', () => {
  console.log('Shutting down API server...');
  server.close(() => {
    console.log('API server closed');
    process.exit(0);
  });
});
