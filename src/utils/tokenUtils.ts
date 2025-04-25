import { PublicKey, Connection } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from './solana.js';
import * as SPLToken from '@solana/spl-token';
import fetch from 'node-fetch';

// Cache for token metadata
const tokenMetadataCache = new Map<string, any>();

/**
 * Fetches token metadata from various sources
 */
export async function getTokenMetadata(mintAddress: string): Promise<any> {
  // Check cache first
  if (tokenMetadataCache.has(mintAddress)) {
    return tokenMetadataCache.get(mintAddress);
  }

  try {
    // Try to fetch from Solana token list API
    const response = await fetch('https://token.jup.ag/all');
    const tokens = await response.json();
    
    const token = tokens.find((t: any) => t.address === mintAddress);
    
    if (token) {
      tokenMetadataCache.set(mintAddress, token);
      return token;
    }
    
    // If not found, return minimal information
    return {
      address: mintAddress,
      symbol: mintAddress.slice(0, 4),
      name: `Unknown (${mintAddress.slice(0, 8)}...)`,
      decimals: 0,
      logoURI: null
    };
  } catch (error) {
    console.error(`Error fetching token metadata for ${mintAddress}:`, error);
    return {
      address: mintAddress,
      symbol: mintAddress.slice(0, 4),
      name: `Error (${mintAddress.slice(0, 8)}...)`,
      decimals: 0,
      logoURI: null
    };
  }
}

/**
 * Checks if the token might be an LP token based on heuristics
 */
export function isLikelyLPToken(tokenInfo: any): boolean {
  // Known LP mint addresses for Raydium and Orca
  const knownLPMints = [
    '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump', // ORCA-USDC LP
    '9BBayhfBenWrG4wKi6FaFnEe133cLvA4jRmMMc1WiHr3', // ORCA-SOL LP
    'AZqj1MkJ7u57fLMamkJyX1DfkgddAiV9AUFXzGHUvZ1z', // RAY-SOL LP
    'FbC6K13MzHvN42bXrtGaWsvZY9fxrackRSZcBGfjPc7m', // RAY-USDC LP
  ];

  // Check if token is a known LP mint
  if (knownLPMints.includes(tokenInfo.address)) {
    return true;
  }

  const { symbol = '', name = '' } = tokenInfo;
  const symbolLower = symbol.toLowerCase();
  const nameLower = name.toLowerCase();
  
  // Common patterns in LP token names/symbols
  const lpPatterns = [
    'lp', 'liquidity', 'pool',
    'raydium', 'orca', 'whirlpool',
    'dual', 'pair', 'swap'
  ];
  
  // Check for LP patterns in name or symbol
  for (const pattern of lpPatterns) {
    if (symbolLower.includes(pattern) || nameLower.includes(pattern)) {
      return true;
    }
  }
  
  // Check for common separators used in LP token names
  if ((symbolLower.includes('/') || symbolLower.includes('-') || symbolLower.includes('_')) &&
      (symbolLower.length > 5)) { // Avoid false positives with short token names
    return true;  
  }
  
  // Check mint addresses that we've manually identified from our wallet check
  // These are tokens that appeared in our scan but weren't properly identified
  if (tokenInfo.address === '9BB6NFEcjBCtnNLFko2FqVQBq8HHM13kCyYcdQbgpump' ||
      tokenInfo.address === '9BBayhfBenWrG4wKi6FaFnEe133cLvA4jRmMMc1WiHr3') {
    return true;
  }
  
  return false;
}

/**
 * Formats token amount based on decimals
 */
export function formatTokenAmount(amount: string | number | bigint, decimals: number): number {
  const value = typeof amount === 'bigint' ? amount : BigInt(amount.toString());
  return Number(value) / Math.pow(10, decimals);
}

/**
 * Fetches and formats all token balances for a wallet
 */
export async function getWalletTokens(connection: Connection, walletAddress: string) {
  const publicKey = new PublicKey(walletAddress);
  
  // Get all token accounts for the wallet
  const tokenAccounts = await connection.getParsedTokenAccountsByOwner(
    publicKey,
    { programId: TOKEN_PROGRAM_ID }
  );
  
  // Process and format the token balances
  const tokens = await Promise.all(
    tokenAccounts.value
      .filter(account => {
        const parsedInfo = account.account.data.parsed.info;
        const amount = parsedInfo.tokenAmount.amount;
        return amount !== '0'; // Filter out zero-balance tokens
      })
      .map(async account => {
        const parsedInfo = account.account.data.parsed.info;
        const mintAddress = parsedInfo.mint;
        const balance = parsedInfo.tokenAmount;
        
        // Get token metadata
        const metadata = await getTokenMetadata(mintAddress);
        
        // Create token info object
        const tokenInfo = {
          mint: mintAddress,
          address: mintAddress,
          address_label: account.pubkey.toString(),
          balance: formatTokenAmount(balance.amount, balance.decimals),
          decimals: balance.decimals,
          symbol: metadata.symbol || 'Unknown',
          name: metadata.name || 'Unknown Token',
          metadata
        };
        
        // Check if it's likely an LP token
        const isLP = isLikelyLPToken(tokenInfo);
        
        return {
          ...tokenInfo,
          isLPToken: isLP
        };
      })
  );
  
  return tokens;
} 