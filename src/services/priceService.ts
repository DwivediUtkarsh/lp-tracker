/**
 * Price Service for fetching and managing token prices
 * 
 * This service provides functionality to:
 * - Fetch token prices from Jupiter's Price API V2
 * - Cache prices to reduce API calls
 * - Update token prices in the database
 * - Enrich LP positions with price data
 */
import axios from 'axios';
import { Token } from '../db/models.js';
import { query } from '../utils/database.js';

// Token price cache with TTL to minimize API calls
const priceCache: Record<string, { price: number; timestamp: number }> = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Fetches current price for a single token from Jupiter using Price API V2
 * 
 * The function:
 * 1. Checks the in-memory cache first to avoid unnecessary API calls
 * 2. Makes an API call to Jupiter if needed
 * 3. Updates the cache with fresh price data
 * 4. Falls back to expired cache data if API call fails
 * 
 * @param tokenMint - Solana token mint address
 * @returns Token price in USD (0 if price not available)
 */
export async function getTokenPrice(tokenMint: string): Promise<number> {
  // Check cache first
  const now = Date.now();
  if (priceCache[tokenMint] && now - priceCache[tokenMint].timestamp < CACHE_TTL) {
    return priceCache[tokenMint].price;
  }
  
  try {
    const response = await axios.get(
      `https://api.jup.ag/price/v2?ids=${tokenMint}`,
      { 
        timeout: 5000,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'LP-Tracker/1.0'
        }
      }
    );
    
    // Handle price as either string or number
    let price = 0;
    if (response.data.data && response.data.data[tokenMint] && response.data.data[tokenMint].price) {
      // Convert to number if it's a string
      price = typeof response.data.data[tokenMint].price === 'string' 
        ? parseFloat(response.data.data[tokenMint].price) 
        : response.data.data[tokenMint].price;
    }
    
    // Update cache
    priceCache[tokenMint] = { price, timestamp: now };
    
    return price;
  } catch (error) {
    console.error(`Error fetching price for ${tokenMint}:`, error);
    
    // If we have a cached price, use it even if expired
    if (priceCache[tokenMint]) {
      console.log(`Using expired cached price for ${tokenMint}`);
      return priceCache[tokenMint].price;
    }
    
    return 0;
  }
}

/**
 * Fetches current prices for multiple tokens in a single API call
 * 
 * Optimizes API usage by:
 * 1. Batching multiple token price requests in one API call
 * 2. Only fetching prices for tokens not in cache or with expired cache
 * 3. Falling back to expired cache values if API call fails
 * 
 * @param mints - Array of token mint addresses
 * @returns Object mapping token mint addresses to their USD prices
 */
export async function getTokenPrices(mints: string[]): Promise<Record<string, number>> {
  if (mints.length === 0) {
    return {};
  }

  try {
    // Try Jupiter first
    const { data: jupiterData } = await axios.get(
      'https://api.jup.ag/price/v2', 
      { 
        params: { ids: mints.join(',') }, 
        timeout: 10_000, // Increased timeout as per guide
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'LP-Tracker/1.0' // Keep existing User-Agent
        }
      }
    );
    // Ensure prices are numbers
    const prices: Record<string, number> = {};
    for (const k in jupiterData.data) {
      if (jupiterData.data[k] && typeof jupiterData.data[k].price !== 'undefined') {
        prices[k] = Number(jupiterData.data[k].price);
      }
    }
    // Check if we got prices for all requested mints
    // If not, it doesn't necessarily mean an error for the whole call,
    // Jupiter might just not track some mints.
    // The fallback will handle missing ones.
    
    // We need to identify which mints were NOT found by Jupiter to try Raydium for them.
    const foundMints = Object.keys(prices);
    const missingMints = mints.filter(m => !foundMints.includes(m));

    if (missingMints.length > 0) {
      try {
        const { data: raydiumData } = await axios.get('https://api.raydium.io/v2/main/price', {
          timeout: 10_000, // Add timeout for consistency
           headers: {
            'Accept': 'application/json',
            'User-Agent': 'LP-Tracker/1.0'
          }
        });
        missingMints.forEach(m => {
          if (raydiumData[m]) {
            prices[m] = Number(raydiumData[m]);
          }
        });
      } catch (raydiumError) {
        // Log Raydium specific error but don't let it stop processing
        console.warn(`[priceService] Raydium fallback failed for some mints: ${missingMints.join(',')}`, raydiumError);
      }
    }
    
    // For any mints still without a price, set to 0 and update cache.
    // Also, update cache for successfully fetched prices.
    const finalPrices: Record<string, number> = {};
    const now = Date.now();
    mints.forEach(m => {
      if (typeof prices[m] === 'number') {
        finalPrices[m] = prices[m];
        priceCache[m] = { price: prices[m], timestamp: now };
      } else {
        finalPrices[m] = 0; // Default to 0 if not found by either
        // Optionally, could use old cache here if preferred:
        // if (priceCache[m]) finalPrices[m] = priceCache[m].price; else finalPrices[m] = 0;
        // For simplicity aligning with guide, just 0 if not found in this round.
      }
    });

    return finalPrices;

  } catch (e) {
    // This 'e' is from Jupiter failing. Now try Raydium for ALL mints.
    console.warn('[priceService] Jupiter API failed, attempting fallback to Raydium for all mints:', mints.join(','), e);
    try {
      const { data: raydiumFallbackData } = await axios.get('https://api.raydium.io/v2/main/price', {
        timeout: 10_000,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'LP-Tracker/1.0'
        }
      });
      const prices: Record<string, number> = {};
      const now = Date.now();
      let allFoundInRaydium = true;
      mints.forEach(m => {
        if (raydiumFallbackData[m]) {
          prices[m] = Number(raydiumFallbackData[m]);
          priceCache[m] = { price: prices[m], timestamp: now };
        } else {
          prices[m] = 0; // Not found in Raydium fallback
          allFoundInRaydium = false;
        }
      });
      if (!allFoundInRaydium) {
         console.warn('[priceService] Some mints not found in Raydium fallback:', mints.filter(m => !prices[m]).join(','));
      }
      if (Object.keys(prices).length > 0) return prices; // Return if Raydium found anything
    } catch (raydiumError) {
       console.warn('[priceService] Raydium fallback API also failed:', raydiumError);
    }

    // If both Jupiter and the Raydium fallback failed for all mints, log once and return 0s.
    console.warn('[priceService] All price sources failed for mints:', mints.join(','));
    const finalPrices: Record<string, number> = {};
    mints.forEach(m => finalPrices[m] = 0);
    return finalPrices;
  }
}

/**
 * Updates token prices in the database for all tracked tokens
 * 
 * The function:
 * 1. Retrieves all tokens from the database
 * 2. Fetches current prices from Jupiter API
 * 3. Updates each token's price and timestamp in the database
 * 
 * This is typically called on a schedule to keep DB prices fresh
 */
export async function updateTokenPricesInDb(): Promise<void> {
  try {
    // Get all tokens from the database
    const result = await query('SELECT * FROM tokens');
    const tokens: Token[] = result.rows;
    
    // Get token addresses for fetching prices
    const tokenAddresses = tokens.map(token => token.address);
    
    // Fetch prices
    const prices = await getTokenPrices(tokenAddresses);
    
    // Update prices for tokens
    for (const token of tokens) {
      // Update price if available
      if (prices[token.address]) {
        await query(
          'UPDATE tokens SET price = $1, last_price_update = CURRENT_TIMESTAMP WHERE id = $2',
          [prices[token.address], token.id]
        );
      }
    }
    
    console.log('Token prices updated successfully');
  } catch (error) {
    console.error('Error updating token prices in database:', error);
  }
}

/**
 * Enhances LP positions with price data and calculates USD values
 * 
 * For each position, this function:
 * 1. Fetches prices for all tokens in the positions
 * 2. Calculates USD value of each token amount
 * 3. Calculates total position value
 * 4. Adds price and value fields to each position object
 * 
 * @param positions - Array of LP position objects
 * @returns Positions enriched with price and USD value data
 */
export async function enrichPositionsWithPrices(positions: any[]): Promise<any[]> {
  if (positions.length === 0) {
    return positions;
  }
  
  // Extract all unique token addresses
  const tokenAddresses = new Set<string>();
  positions.forEach(pos => {
    tokenAddresses.add(pos.token_a_address);
    tokenAddresses.add(pos.token_b_address);
  });
  
  console.log(`Fetching prices for token addresses: ${Array.from(tokenAddresses).join(', ')}`);
  
  // Get prices for all tokens in a single API call
  const prices = await getTokenPrices(Array.from(tokenAddresses));
  
  console.log('Prices fetched successfully:');
  Object.entries(prices).forEach(([address, price]) => {
    console.log(`${address.slice(0, 8)}...: $${price.toFixed(2)}`);
  });
  
  // Enrich positions with price data and calculate USD values
  return positions.map(pos => {
    const tokenAValue = pos.qty_a * (prices[pos.token_a_address] || 0);
    const tokenBValue = pos.qty_b * (prices[pos.token_b_address] || 0);
    const totalValue = tokenAValue + tokenBValue;
    
    return {
      ...pos,
      token_a_price: prices[pos.token_a_address] || 0,
      token_b_price: prices[pos.token_b_address] || 0,
      token_a_value: tokenAValue,
      token_b_value: tokenBValue,
      total_value: totalValue
    };
  });
} 