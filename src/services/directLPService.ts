import { Connection, PublicKey } from '@solana/web3.js';
import { getWalletTokens, isLikelyLPToken } from '../utils/tokenUtils.js';
import fetch from 'node-fetch';

// Known DEX Program IDs
const DEX_PROGRAM_IDS = {
  RAYDIUM: 'RVKd61ztZW9GUwhRbbLoYVRE5Xf1B2tVscKqwZqXgEr',
  ORCA_WHIRLPOOL: 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc'
};

// Define an interface for token info objects
interface TokenInfo {
  mint: string;
  symbol?: string;
  name?: string;
  address?: string;
  balance?: number;
  [key: string]: any; // Allow other properties
}

// Define the structure of LP token data
interface LPTokenData {
  dex: string;
  poolName: string;
  tokenA: { symbol: string; address: string };
  tokenB: { symbol: string; address: string };
  reserveA: number;
  reserveB: number;
  totalLpSupply: number;
}

// Type for known LP tokens map
type KnownLPTokens = {
  [mintAddress: string]: LPTokenData;
};

// LP token information for known LP tokens
const KNOWN_LP_TOKENS: KnownLPTokens = {
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
function determineDex(tokenInfo: TokenInfo): string {
  // First check if it's a known LP token
  const mintAddress = tokenInfo.mint as string;
  if (KNOWN_LP_TOKENS[mintAddress]) {
    return KNOWN_LP_TOKENS[mintAddress].dex;
  }

  const { symbol = '', name = '' } = tokenInfo;
  const lowerSymbol = symbol.toLowerCase();
  const lowerName = name.toLowerCase();
  
  if (lowerSymbol.includes('ray') || lowerName.includes('raydium')) {
    return 'raydium';
  } else if (lowerSymbol.includes('whirl') || lowerName.includes('whirlpool')) {
    return 'orca-whirlpool';
  }
  
  // Default to unknown
  return 'unknown-dex';
}

export async function getDirectLPPositions(
  connection: Connection,
  walletAddress: string
): Promise<LPPosition[]> {
  const tokens = await getWalletTokens(connection, walletAddress);
  return tokens
    .filter((t) => t.isLPToken)
    .map((t) => ({
      dex: "unknown",
      lpMint: t.address,
      poolName: t.symbol,
      userLpAmount: t.balance,
      tokenA: { 
        address: "", 
        symbol: "A", 
        amount: 0 
      },
      tokenB: { 
        address: "", 
        symbol: "B", 
        amount: 0 
      },
    }));
}