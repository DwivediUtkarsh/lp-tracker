import { Connection, PublicKey } from '@solana/web3.js';
import { getWalletTokens, isLikelyLPToken } from '../utils/tokenUtils.js';
import fetch from 'node-fetch';

// Known DEX Program IDs
const DEX_PROGRAM_IDS = {
  RAYDIUM: 'RVKd61ztZW9GUwhRbbLoYVRE5Xf1B2tVscKqwZqXgEr',
  ORCA: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc',
  ORCA_WHIRLPOOL: '9W959DqEETiGZocYWCQPaJ6sBmUzgfxXfqGeTEdp3aQP'
};

// LP token information for known LP tokens
const KNOWN_LP_TOKENS = {
  '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump': {
    dex: 'orca-classic',
    poolName: 'ORCA/USDC',
    tokenA: { symbol: 'ORCA', address: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE' },
    tokenB: { symbol: 'USDC', address: 'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v' },
    // Approximate reserves for share calculation, would be fetched from chain in prod
    reserveA: 150000,
    reserveB: 75000,
    totalLpSupply: 1000000
  },
  '9BBayhfBenWrG4wKi6FaFnEe133cLvA4jRmMMc1WiHr3': {
    dex: 'orca-classic',
    poolName: 'ORCA/SOL',
    tokenA: { symbol: 'ORCA', address: 'orcaEKTdK7LKz57vaAYr9QeNsVEPfiu6QeMU1kektZE' },
    tokenB: { symbol: 'SOL', address: 'So11111111111111111111111111111111111111112' },
    // Approximate reserves for share calculation, would be fetched from chain in prod
    reserveA: 200000,
    reserveB: 5000,
    totalLpSupply: 1000000
  },
  'AZqj1MkJ7u57fLMamkJyX1DfkgddAiV9AUFXzGHUvZ1z': {
    dex: 'raydium',
    poolName: 'RAY/SOL',
    tokenA: { symbol: 'RAY', address: '4k3Dyjzvzp8eMZWUXbBCjEvwSkkk59S5iCNLY3QrkX6R' },
    tokenB: { symbol: 'SOL', address: 'So11111111111111111111111111111111111111112' },
    // Approximate reserves for share calculation, would be fetched from chain in prod
    reserveA: 500000,
    reserveB: 20000,
    totalLpSupply: 1000000
  }
};

// Interface for LP token position
export interface LPPosition {
  dex: string;
  lpMint: string;
  poolName: string;
  userLpAmount: number;
  tokenA: {
    address: string;
    symbol: string;
    amount: number;
  };
  tokenB: {
    address: string;
    symbol: string;
    amount: number;
  };
}

/**
 * Attempt to determine which DEX an LP token belongs to based on naming or metadata
 */
function determineDex(tokenInfo: any): string {
  // First check if it's a known LP token
  if (KNOWN_LP_TOKENS[tokenInfo.mint]) {
    return KNOWN_LP_TOKENS[tokenInfo.mint].dex;
  }

  const { symbol = '', name = '' } = tokenInfo;
  const lowerSymbol = symbol.toLowerCase();
  const lowerName = name.toLowerCase();
  
  if (lowerSymbol.includes('ray') || lowerName.includes('raydium')) {
    return 'raydium';
  } else if (lowerSymbol.includes('orca') || lowerName.includes('orca')) {
    return 'orca';
  } else if (lowerSymbol.includes('whirl') || lowerName.includes('whirlpool')) {
    return 'orca-whirlpool';
  }
  
  // Default to unknown
  return 'unknown-dex';
}

/**
 * Get pool name from LP token symbol/name
 */
function getPoolName(tokenInfo: any): string {
  // First check if it's a known LP token
  if (KNOWN_LP_TOKENS[tokenInfo.mint]) {
    return KNOWN_LP_TOKENS[tokenInfo.mint].poolName;
  }

  const { symbol = '', name = '' } = tokenInfo;
  
  // Try to extract token names from the LP token name
  const cleanName = name.replace(/(LP|Pool|Liquidity\sProvider|Raydium|Orca)/gi, '').trim();
  if (cleanName.includes('/') || cleanName.includes('-')) {
    return cleanName;
  }
  
  // Try symbol if name doesn't work
  const cleanSymbol = symbol.replace(/(LP|Pool|Liquidity\sProvider|Raydium|Orca)/gi, '').trim();
  if (cleanSymbol.includes('/') || cleanSymbol.includes('-')) {
    return cleanSymbol;
  }
  
  // If all else fails
  return `${symbol} Pool`;
}

/**
 * Given an LP token, estimate the underlying tokens and amounts
 */
async function estimateUnderlyingTokens(lpToken: any, connection: Connection): Promise<LPPosition | null> {
  try {
    // Check if it's a known LP token
    const knownLp = KNOWN_LP_TOKENS[lpToken.mint];
    if (knownLp) {
      // Calculate user's share of the pool
      const share = lpToken.balance / knownLp.totalLpSupply;
      
      return {
        dex: knownLp.dex,
        lpMint: lpToken.mint,
        poolName: knownLp.poolName,
        userLpAmount: lpToken.balance,
        tokenA: {
          address: knownLp.tokenA.address,
          symbol: knownLp.tokenA.symbol,
          amount: share * knownLp.reserveA
        },
        tokenB: {
          address: knownLp.tokenB.address,
          symbol: knownLp.tokenB.symbol,
          amount: share * knownLp.reserveB
        }
      };
    }
    
    // For unknown tokens, make our best guess
    const dex = determineDex(lpToken);
    const poolName = getPoolName(lpToken);
    
    // Parse pool name to get token symbols
    let tokenSymbols = [];
    if (poolName.includes('/')) {
      tokenSymbols = poolName.split('/');
    } else if (poolName.includes('-')) {
      tokenSymbols = poolName.split('-');
    } else {
      // If we can't determine the tokens, use placeholder
      tokenSymbols = ['TokenA', 'TokenB'];
    }
    
    // Create basic LP position info
    const lpPosition: LPPosition = {
      dex,
      lpMint: lpToken.mint,
      poolName,
      userLpAmount: lpToken.balance,
      tokenA: {
        address: '', // Would be fetched from pool data
        symbol: tokenSymbols[0]?.trim() || 'Unknown',
        amount: 0 // Would be calculated based on pool reserves
      },
      tokenB: {
        address: '', // Would be fetched from pool data
        symbol: tokenSymbols[1]?.trim() || 'Unknown',
        amount: 0 // Would be calculated based on pool reserves
      }
    };
    
    // For demonstration purposes, estimate token amounts - this is arbitrary
    // In a real implementation, you would calculate based on actual pool reserves
    lpPosition.tokenA.amount = lpToken.balance * 10; // Arbitrary multiplier
    lpPosition.tokenB.amount = lpToken.balance * 5;  // Arbitrary multiplier
    
    return lpPosition;
  } catch (error) {
    console.error(`Error processing LP token ${lpToken.mint}:`, error);
    return null;
  }
}

/**
 * Get all LP token positions for a wallet directly from the blockchain
 */
export async function getDirectLPPositions(connection: Connection, walletAddress: string): Promise<LPPosition[]> {
  try {
    // Get all tokens in the wallet
    const tokens = await getWalletTokens(connection, walletAddress);
    
    // Filter for LP tokens
    const lpTokens = tokens.filter(token => token.isLPToken);
    
    console.log(`Found ${lpTokens.length} potential LP tokens in wallet`);
    if (lpTokens.length > 0) {
      console.log('LP tokens found:');
      lpTokens.forEach(token => {
        console.log(`- ${token.symbol} (${token.mint}): ${token.balance}`);
      });
    }
    
    // Process each LP token to estimate underlying tokens
    const lpPositions = await Promise.all(
      lpTokens.map(async lpToken => {
        return await estimateUnderlyingTokens(lpToken, connection);
      })
    );
    
    // Filter out null results
    return lpPositions.filter(Boolean) as LPPosition[];
  } catch (error) {
    console.error('Error fetching direct LP positions:', error);
    return [];
  }
} 