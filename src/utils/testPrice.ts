/**
 * Test script for the Price Service
 * 
 * This file provides a simple utility to test the functionality of the price service
 * by fetching real-time prices from Jupiter's API. It tests both single token price
 * fetching and batch price fetching for multiple tokens.
 */
import { getTokenPrice, getTokenPrices } from '../services/priceService';

/**
 * Tests the price service functionality by:
 * 1. Fetching the price for a single token (SOL)
 * 2. Fetching prices for multiple tokens in a batch (SOL, USDC, mSOL)
 * 
 * This function can be used to:
 * - Verify the Jupiter API connection is working
 * - Check that both single and batch price fetching work correctly
 * - Debug price service issues
 */
async function testPriceService() {
  console.log('Testing Price Service with Jupiter V2 API');
  
  // Test getting price for a single token (SOL)
  const solMint = 'So11111111111111111111111111111111111111112';
  try {
    console.log(`Getting price for SOL (${solMint})...`);
    const solPrice = await getTokenPrice(solMint);
    console.log(`SOL Price: $${solPrice}`);
  } catch (error) {
    console.error('Error getting SOL price:', error);
  }
  
  // Test getting prices for multiple tokens
  const tokens = [
    'So11111111111111111111111111111111111111112', // SOL
    'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v', // USDC
    'mSoLzYCxHdYgdzU16g5QSh3i5K3z3KZK7ytfqcJm7So', // mSOL
  ];
  
  try {
    console.log('\nGetting prices for multiple tokens...');
    const prices = await getTokenPrices(tokens);
    
    console.log('Token Prices:');
    for (const [mint, price] of Object.entries(prices)) {
      console.log(`${mint}: $${price}`);
    }
  } catch (error) {
    console.error('Error getting multiple token prices:', error);
  }
}

// Execute the test function
testPriceService().catch(console.error); 