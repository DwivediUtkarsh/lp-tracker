/**
 * Portfolio Controller
 * 
 * This controller provides endpoints for accessing wallet portfolio data
 * including token balances, LP positions, and overall portfolio value.
 * It's based on the same functionality as the portfolio CLI script.
 */

import { Request, Response } from 'express';
import { PublicKey, Connection } from '@solana/web3.js';
import { ReliableConnection } from '../../utils/solana.js';
import { RPC_ENDPOINT } from '../../config.js';
import { getWhirlpoolExposures } from '../../services/whirlpoolService.js';
import { getTokenMetadata, getWalletTokens as fetchWalletTokens } from '../../utils/tokenUtils.js';
import { enrichPositionsWithPrices, getTokenPrices } from '../../services/priceService.js';

// Define a type for wallet token
interface WalletToken {
  mint: string;
  balance: number;
  symbol?: string;
  decimals: number;
  isLPToken: boolean;
}

// Define a type for token data
interface TokenData {
  symbol: string;
  amount: number;
  price: number;
  value: number;
  isLPToken: boolean;
  address: string;
  decimals: number;
}

// Define a type for enriched position
interface EnrichedPosition {
  id: number;
  dex: string;
  pool_address: string;
  token_a_symbol: string;
  token_b_symbol: string;
  qty_a: number;
  qty_b: number;
  token_a_address: string;
  token_b_address: string;
  position_address?: string;
  token_a_price?: number;
  token_b_price?: number;
  token_a_value?: number;
  token_b_value?: number;
  total_value?: number;
}

/**
 * Get complete portfolio data including tokens, positions and summary
 */
export async function getWalletPortfolio(req: Request, res: Response) {
  try {
    const { wallet } = req.query;
    
    if (!wallet) {
      return res.status(400).json({ error: 'Missing required parameter: wallet' });
    }
    
    let walletAddress: string;
    
    try {
      // Validate the wallet address
      const pubkey = new PublicKey(wallet as string);
      walletAddress = pubkey.toBase58();
    } catch (err) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    // Create connections
    const conn = new ReliableConnection(RPC_ENDPOINT);
    const connection = new Connection(RPC_ENDPOINT);
    
    // Get wallet tokens
    const tokens = await fetchWalletTokens(connection, walletAddress) as WalletToken[];
    const nonZeroTokens = tokens.filter((t: WalletToken) => t.balance > 0);
    
    // Get token prices
    const tokenAddresses = nonZeroTokens.map((t: WalletToken) => t.mint);
    const prices = await getTokenPrices(tokenAddresses);
    
    // Process token data
    const tokenData = nonZeroTokens.map((t: WalletToken) => {
      const price = typeof prices[t.mint] === 'number' ? prices[t.mint] : 0;
      const value = price * t.balance;
      
      return {
        symbol: t.symbol || 'Unknown',
        amount: t.balance,
        price: price,
        value: value,
        isLPToken: t.isLPToken,
        address: t.mint,
        decimals: t.decimals
      };
    });
    
    // Calculate total token value
    const totalTokenValue = tokenData.reduce((sum: number, t: TokenData) => sum + t.value, 0);
    
    // Get whirlpool positions
    const positions = await getWhirlpoolExposures(conn, new PublicKey(walletAddress));
    
    // Format positions for enrichment
    const dbFormatPositions = positions.map((pos, index) => ({
      id: index,
      dex: pos.dex,
      pool_address: pos.pool,
      token_a_symbol: pos.tokenA,
      token_b_symbol: pos.tokenB,
      qty_a: pos.qtyA,
      qty_b: pos.qtyB,
      token_a_address: pos.tokenAAddress,
      token_b_address: pos.tokenBAddress,
      position_address: pos.positionAddress
    }));
    
    // Enrich positions with prices
    const enrichedPositions = await enrichPositionsWithPrices(dbFormatPositions) as EnrichedPosition[];
    
    // Calculate total position value
    const totalPositionValue = enrichedPositions.reduce((sum: number, pos: EnrichedPosition) => sum + (pos.total_value || 0), 0);
    
    // Build the response
    const portfolio = {
      wallet: walletAddress,
      tokens: {
        items: tokenData.sort((a: TokenData, b: TokenData) => b.value - a.value),
        totalValue: totalTokenValue
      },
      positions: {
        items: enrichedPositions.map(p => ({
          id: p.id,
          dex: p.dex,
          pair: `${p.token_a_symbol}-${p.token_b_symbol}`,
          poolAddress: p.pool_address,
          positionAddress: p.position_address,
          tokenA: {
            symbol: p.token_a_symbol,
            address: p.token_a_address,
            amount: p.qty_a,
            price: p.token_a_price || 0,
            value: p.token_a_value || 0
          },
          tokenB: {
            symbol: p.token_b_symbol,
            address: p.token_b_address,
            amount: p.qty_b,
            price: p.token_b_price || 0,
            value: p.token_b_value || 0
          },
          totalValue: p.total_value || 0
        })),
        totalValue: totalPositionValue
      },
      summary: {
        tokenCount: nonZeroTokens.length,
        positionCount: positions.length,
        tokenValue: totalTokenValue,
        positionValue: totalPositionValue,
        totalValue: totalTokenValue + totalPositionValue,
        distribution: {
          tokens: totalTokenValue / (totalTokenValue + totalPositionValue) * 100,
          positions: totalPositionValue / (totalTokenValue + totalPositionValue) * 100
        }
      },
      timestamp: new Date().toISOString()
    };
    
    res.json(portfolio);
  } catch (error) {
    console.error('Error fetching wallet portfolio:', error);
    res.status(500).json({ error: 'Failed to fetch wallet portfolio', details: String(error) });
  }
}

/**
 * Get wallet token balances with values
 */
export async function getWalletTokens(req: Request, res: Response) {
  try {
    const { wallet, includeZero } = req.query;
    
    if (!wallet) {
      return res.status(400).json({ error: 'Missing required parameter: wallet' });
    }
    
    let walletAddress: string;
    
    try {
      // Validate the wallet address
      const pubkey = new PublicKey(wallet as string);
      walletAddress = pubkey.toBase58();
    } catch (err) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    // Create connection
    const connection = new Connection(RPC_ENDPOINT);
    
    // Get wallet tokens
    const tokens = await fetchWalletTokens(connection, walletAddress) as WalletToken[];
    
    // Filter zero balances if requested
    const filteredTokens = includeZero === 'true' 
      ? tokens 
      : tokens.filter((t: WalletToken) => t.balance > 0);
    
    // Get token prices
    const tokenAddresses = filteredTokens.map((t: WalletToken) => t.mint);
    const prices = await getTokenPrices(tokenAddresses);
    
    // Process token data
    const tokenData = filteredTokens.map((t: WalletToken) => {
      const price = typeof prices[t.mint] === 'number' ? prices[t.mint] : 0;
      const value = price * t.balance;
      
      return {
        symbol: t.symbol || 'Unknown',
        amount: t.balance,
        price: price,
        value: value,
        isLPToken: t.isLPToken,
        address: t.mint,
        decimals: t.decimals
      };
    });
    
    // Calculate total token value
    const totalTokenValue = tokenData.reduce((sum: number, t: TokenData) => sum + t.value, 0);
    
    res.json({
      wallet: walletAddress,
      tokens: tokenData.sort((a: TokenData, b: TokenData) => b.value - a.value),
      totalValue: totalTokenValue,
      count: tokenData.length
    });
  } catch (error) {
    console.error('Error fetching wallet tokens:', error);
    res.status(500).json({ error: 'Failed to fetch wallet tokens', details: String(error) });
  }
}

/**
 * Get wallet LP positions with values
 */
export async function getWalletPositions(req: Request, res: Response) {
  try {
    const { wallet, dex } = req.query;
    
    if (!wallet) {
      return res.status(400).json({ error: 'Missing required parameter: wallet' });
    }
    
    let walletAddress: string;
    
    try {
      // Validate the wallet address
      const pubkey = new PublicKey(wallet as string);
      walletAddress = pubkey.toBase58();
    } catch (err) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    // Create connection
    const conn = new ReliableConnection(RPC_ENDPOINT);
    
    // Get whirlpool positions
    const positions = await getWhirlpoolExposures(conn, new PublicKey(walletAddress));
    
    // Filter by dex if requested
    const filteredPositions = dex 
      ? positions.filter(p => p.dex.toLowerCase() === (dex as string).toLowerCase())
      : positions;
    
    // Format positions for enrichment
    const dbFormatPositions = filteredPositions.map((pos, index) => ({
      id: index,
      dex: pos.dex,
      pool_address: pos.pool,
      token_a_symbol: pos.tokenA,
      token_b_symbol: pos.tokenB,
      qty_a: pos.qtyA,
      qty_b: pos.qtyB,
      token_a_address: pos.tokenAAddress,
      token_b_address: pos.tokenBAddress,
      position_address: pos.positionAddress
    }));
    
    // Enrich positions with prices
    const enrichedPositions = await enrichPositionsWithPrices(dbFormatPositions) as EnrichedPosition[];
    
    // Calculate total position value
    const totalPositionValue = enrichedPositions.reduce((sum: number, pos: EnrichedPosition) => sum + (pos.total_value || 0), 0);
    
    res.json({
      wallet: walletAddress,
      positions: enrichedPositions.map(p => ({
        id: p.id,
        dex: p.dex,
        pair: `${p.token_a_symbol}-${p.token_b_symbol}`,
        poolAddress: p.pool_address,
        positionAddress: p.position_address,
        tokenA: {
          symbol: p.token_a_symbol,
          address: p.token_a_address,
          amount: p.qty_a,
          price: p.token_a_price || 0,
          value: p.token_a_value || 0
        },
        tokenB: {
          symbol: p.token_b_symbol,
          address: p.token_b_address,
          amount: p.qty_b,
          price: p.token_b_price || 0,
          value: p.token_b_value || 0
        },
        totalValue: p.total_value || 0
      })),
      totalValue: totalPositionValue,
      count: enrichedPositions.length
    });
  } catch (error) {
    console.error('Error fetching wallet positions:', error);
    res.status(500).json({ error: 'Failed to fetch wallet positions', details: String(error) });
  }
}

/**
 * Get portfolio summary with total values
 */
export async function getPortfolioSummary(req: Request, res: Response) {
  try {
    const { wallet } = req.query;
    
    if (!wallet) {
      return res.status(400).json({ error: 'Missing required parameter: wallet' });
    }
    
    let walletAddress: string;
    
    try {
      // Validate the wallet address
      const pubkey = new PublicKey(wallet as string);
      walletAddress = pubkey.toBase58();
    } catch (err) {
      return res.status(400).json({ error: 'Invalid wallet address' });
    }
    
    // Create connections
    const conn = new ReliableConnection(RPC_ENDPOINT);
    const connection = new Connection(RPC_ENDPOINT);
    
    // Get wallet tokens
    const tokens = await fetchWalletTokens(connection, walletAddress) as WalletToken[];
    const nonZeroTokens = tokens.filter((t: WalletToken) => t.balance > 0);
    
    // Get token prices
    const tokenAddresses = nonZeroTokens.map((t: WalletToken) => t.mint);
    const prices = await getTokenPrices(tokenAddresses);
    
    // Calculate total token value
    const totalTokenValue = nonZeroTokens.reduce((sum: number, t: WalletToken) => {
      const price = typeof prices[t.mint] === 'number' ? prices[t.mint] : 0;
      return sum + (price * t.balance);
    }, 0);
    
    // Get whirlpool positions
    const positions = await getWhirlpoolExposures(conn, new PublicKey(walletAddress));
    
    // Format positions for enrichment
    const dbFormatPositions = positions.map((pos, index) => ({
      id: index,
      dex: pos.dex,
      pool_address: pos.pool,
      token_a_symbol: pos.tokenA,
      token_b_symbol: pos.tokenB,
      qty_a: pos.qtyA,
      qty_b: pos.qtyB,
      token_a_address: pos.tokenAAddress,
      token_b_address: pos.tokenBAddress
    }));
    
    // Enrich positions with prices
    const enrichedPositions = await enrichPositionsWithPrices(dbFormatPositions) as EnrichedPosition[];
    
    // Calculate total position value
    const totalPositionValue = enrichedPositions.reduce((sum: number, pos: EnrichedPosition) => sum + (pos.total_value || 0), 0);
    
    // Build the response
    const summary = {
      wallet: walletAddress,
      tokenCount: nonZeroTokens.length,
      positionCount: positions.length,
      tokenValue: totalTokenValue,
      positionValue: totalPositionValue,
      totalValue: totalTokenValue + totalPositionValue,
      distribution: {
        tokens: totalTokenValue / (totalTokenValue + totalPositionValue) * 100,
        positions: totalPositionValue / (totalTokenValue + totalPositionValue) * 100
      },
      timestamp: new Date().toISOString()
    };
    
    res.json(summary);
  } catch (error) {
    console.error('Error fetching portfolio summary:', error);
    res.status(500).json({ error: 'Failed to fetch portfolio summary', details: String(error) });
  }
}
