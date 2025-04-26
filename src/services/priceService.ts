import axios from 'axios';
import { Token } from '../db/models.js';
import { query } from '../utils/database.js';

// Define a map of token symbols to CoinGecko IDs
const COINGECKO_IDS: Record<string, string> = {
  'SOL': 'solana',
  'USDC': 'usd-coin',
  'USDT': 'tether',
  'ORCA': 'orca',
  'RAY': 'raydium',
  'mSOL': 'msol',
  'BTC': 'bitcoin',
  'ETH': 'ethereum',
  'BONK': 'bonk',
  'JUP': 'jupiter',
  'JTO': 'jito-governance',
  // Add more mappings as needed
};

// Token price cache to reduce API calls
const priceCache: Record<string, { price: number; timestamp: number }> = {};
const CACHE_TTL = 5 * 60 * 1000; // 5 minutes
const API_DELAY = 1500; // Add delay between API calls to avoid rate limiting (1.5 seconds)

// Track last API call time to prevent rate limiting
let lastApiCallTime = 0;

/**
 * Sleep for the specified number of milliseconds
 */
const sleep = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Ensures proper rate limiting for API calls
 */
async function respectRateLimit() {
  const now = Date.now();
  const timeSinceLastCall = now - lastApiCallTime;
  
  if (timeSinceLastCall < API_DELAY && lastApiCallTime !== 0) {
    const delayNeeded = API_DELAY - timeSinceLastCall;
    await sleep(delayNeeded);
  }
  
  lastApiCallTime = Date.now();
}

/**
 * Get current token price from CoinGecko
 * @param tokenSymbol Token symbol
 * @returns Token price in USD
 */
export async function getTokenPrice(tokenSymbol: string): Promise<number> {
  const tokenId = COINGECKO_IDS[tokenSymbol.toUpperCase()];
  
  if (!tokenId) {
    console.warn(`No CoinGecko ID mapping for token ${tokenSymbol}`);
    return 0;
  }
  
  // Check cache first
  const now = Date.now();
  if (priceCache[tokenId] && now - priceCache[tokenId].timestamp < CACHE_TTL) {
    return priceCache[tokenId].price;
  }
  
  try {
    // Respect rate limits
    await respectRateLimit();
    
    const response = await axios.get(
      `https://api.coingecko.com/api/v3/simple/price?ids=${tokenId}&vs_currencies=usd`,
      { 
        timeout: 5000,
        headers: {
          'Accept': 'application/json',
          'User-Agent': 'LP-Tracker/1.0'
        }
      }
    );
    
    const price = response.data[tokenId]?.usd || 0;
    
    // Update cache
    priceCache[tokenId] = { price, timestamp: now };
    
    return price;
  } catch (error) {
    console.error(`Error fetching price for ${tokenSymbol}:`, error);
    
    // If we have a cached price, use it even if expired
    if (priceCache[tokenId]) {
      console.log(`Using expired cached price for ${tokenSymbol}`);
      return priceCache[tokenId].price;
    }
    
    return 0;
  }
}

/**
 * Get current token prices for multiple tokens
 * @param tokenSymbols Array of token symbols
 * @returns Object mapping token symbols to prices
 */
export async function getTokenPrices(tokenSymbols: string[]): Promise<Record<string, number>> {
  const prices: Record<string, number> = {};
  
  // Filter out symbols that have valid CoinGecko IDs
  const validSymbols = tokenSymbols.filter(symbol => COINGECKO_IDS[symbol.toUpperCase()]);
  
  if (validSymbols.length === 0) {
    return prices;
  }
  
  // Check which tokens need price updates
  const now = Date.now();
  const symbolsToFetch = validSymbols.filter(symbol => {
    const tokenId = COINGECKO_IDS[symbol.toUpperCase()];
    return !priceCache[tokenId] || now - priceCache[tokenId].timestamp >= CACHE_TTL;
  });
  
  if (symbolsToFetch.length > 0) {
    // Create a list of CoinGecko IDs
    const ids = symbolsToFetch
      .map(symbol => COINGECKO_IDS[symbol.toUpperCase()])
      .filter(Boolean)
      .join(',');
    
    try {
      // Respect rate limits
      await respectRateLimit();
      
      const response = await axios.get(
        `https://api.coingecko.com/api/v3/simple/price?ids=${ids}&vs_currencies=usd`,
        { 
          timeout: 5000,
          headers: {
            'Accept': 'application/json',
            'User-Agent': 'LP-Tracker/1.0'
          }
        }
      );
      
      // Update cache and prices object
      symbolsToFetch.forEach(symbol => {
        const tokenId = COINGECKO_IDS[symbol.toUpperCase()];
        if (response.data[tokenId]?.usd !== undefined) {
          const price = response.data[tokenId].usd;
          priceCache[tokenId] = { price, timestamp: now };
          prices[symbol] = price;
        } else {
          console.warn(`No price data for ${symbol} (ID: ${tokenId})`);
        }
      });
    } catch (error) {
      console.error('Error fetching multiple token prices:', error);
      
      // Use expired cached prices if available
      symbolsToFetch.forEach(symbol => {
        const tokenId = COINGECKO_IDS[symbol.toUpperCase()];
        if (priceCache[tokenId]) {
          prices[symbol] = priceCache[tokenId].price;
          console.log(`Using expired cached price for ${symbol}`);
        }
      });
    }
  }
  
  // Add cached prices
  validSymbols.forEach(symbol => {
    const tokenId = COINGECKO_IDS[symbol.toUpperCase()];
    if (priceCache[tokenId] && !prices[symbol]) {
      prices[symbol] = priceCache[tokenId].price;
    }
  });
  
  return prices;
}

/**
 * Update token prices in the database
 */
export async function updateTokenPricesInDb(): Promise<void> {
  try {
    // Get all tokens from the database
    const result = await query('SELECT * FROM tokens');
    const tokens: Token[] = result.rows;
    
    // Get token symbols that have CoinGecko mappings
    const tokenSymbols = tokens
      .map(token => token.symbol)
      .filter(symbol => COINGECKO_IDS[symbol.toUpperCase()]);
    
    // Fetch prices
    const prices = await getTokenPrices(tokenSymbols);
    
    // Update prices and coingecko_ids for tokens
    for (const token of tokens) {
      const symbol = token.symbol.toUpperCase();
      
      // Update coingecko_id if not already set
      if (COINGECKO_IDS[symbol] && !token.coingecko_id) {
        await query(
          'UPDATE tokens SET coingecko_id = $1 WHERE id = $2',
          [COINGECKO_IDS[symbol], token.id]
        );
      }
      
      // Update price if available
      if (prices[token.symbol]) {
        await query(
          'UPDATE tokens SET price = $1, last_price_update = CURRENT_TIMESTAMP WHERE id = $2',
          [prices[token.symbol], token.id]
        );
      }
    }
    
    console.log('Token prices updated successfully');
  } catch (error) {
    console.error('Error updating token prices in database:', error);
  }
}

/**
 * Calculate token values in USD for LP positions
 * @param positions Array of LP positions
 * @returns Positions with USD values
 */
export async function enrichPositionsWithPrices(positions: any[]): Promise<any[]> {
  if (positions.length === 0) {
    return positions;
  }
  
  // Extract all token symbols
  const tokenSymbols = new Set<string>();
  positions.forEach(pos => {
    tokenSymbols.add(pos.token_a_symbol);
    tokenSymbols.add(pos.token_b_symbol);
  });
  
  console.log(`Fetching prices for tokens: ${Array.from(tokenSymbols).join(', ')}`);
  
  // Get prices for all tokens
  const prices = await getTokenPrices(Array.from(tokenSymbols));
  
  console.log('Prices fetched successfully:');
  Object.entries(prices).forEach(([symbol, price]) => {
    console.log(`${symbol}: $${price.toFixed(2)}`);
  });
  
  // Enrich positions with price data
  return positions.map(pos => {
    const tokenAValue = pos.qty_a * (prices[pos.token_a_symbol] || 0);
    const tokenBValue = pos.qty_b * (prices[pos.token_b_symbol] || 0);
    const totalValue = tokenAValue + tokenBValue;
    
    return {
      ...pos,
      token_a_price: prices[pos.token_a_symbol] || 0,
      token_b_price: prices[pos.token_b_symbol] || 0,
      token_a_value: tokenAValue,
      token_b_value: tokenBValue,
      total_value: totalValue
    };
  });
} 