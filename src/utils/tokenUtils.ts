import { PublicKey, Connection } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from './solana.js';
import * as SPLToken from '@solana/spl-token';
import fetch from 'node-fetch';

// Interface for token metadata
interface TokenMetadata {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string | null;
  [key: string]: any; // Allow for additional properties
}

// Interface for token info objects
export interface TokenInfo {
  mint: string;
  address: string;
  address_label?: string;
  balance: number;
  decimals: number;
  symbol: string;
  name: string;
  metadata: TokenMetadata;
  isLPToken?: boolean;
  [key: string]: any; // Allow other properties
}

// Cache for token metadata
const tokenMetadataCache = new Map<string, TokenMetadata>();
// Flag to track if we've loaded the Jupiter token list
let jupiterTokensLoaded = false;
let jupiterTokens: TokenMetadata[] = [];

// Maximum number of tokens to process at once to avoid memory issues
const MAX_TOKENS_PER_BATCH = 50;

/**
 * Pre-load the Jupiter token list to avoid repeated fetches
 */
export async function preloadJupiterTokens(): Promise<void> {
  if (jupiterTokensLoaded) return;
  
  try {
    console.log(`Fetching Jupiter token list...`);
    const response = await fetch('https://token.jup.ag/all');
    console.log(`Jupiter API response received`);
    jupiterTokens = await response.json() as TokenMetadata[];
    console.log(`Loaded ${jupiterTokens.length} tokens from Jupiter API`);
    jupiterTokensLoaded = true;
    
    // Pre-cache some common tokens
    jupiterTokens.forEach(token => {
      tokenMetadataCache.set(token.address, token);
    });
  } catch (error) {
    console.error(`Error preloading Jupiter tokens:`, error);
  }
}

/**
 * Fetches token metadata from various sources
 */
export async function getTokenMetadata(mintAddress: string): Promise<TokenMetadata> {
  console.log(`Fetching metadata for token: ${mintAddress}`);
  
  // Check cache first
  if (tokenMetadataCache.has(mintAddress)) {
    console.log(`Using cached metadata for ${mintAddress}`);
    return tokenMetadataCache.get(mintAddress)!;
  }

  try {
    // If we've already loaded the Jupiter tokens, search in memory
    if (jupiterTokensLoaded) {
      const token = jupiterTokens.find((t) => t.address === mintAddress);
      
      if (token) {
        console.log(`Found metadata for ${mintAddress}: ${token.symbol}`);
        tokenMetadataCache.set(mintAddress, token);
        return token;
      }
    } else {
      // Try to fetch from Solana token list API
      console.log(`Fetching from Jupiter token list API...`);
      const response = await fetch('https://token.jup.ag/all');
      console.log(`Jupiter API response received`);
      jupiterTokens = await response.json() as TokenMetadata[];
      jupiterTokensLoaded = true;
      console.log(`Parsed ${jupiterTokens.length} tokens from Jupiter API`);
      
      const token = jupiterTokens.find((t) => t.address === mintAddress);
      
      if (token) {
        console.log(`Found metadata for ${mintAddress}: ${token.symbol}`);
        tokenMetadataCache.set(mintAddress, token);
        return token;
      }
    }
    
    // If not found, return minimal information
    console.log(`No metadata found for ${mintAddress}, using default`);
    const defaultMetadata: TokenMetadata = {
      address: mintAddress,
      symbol: mintAddress.slice(0, 4),
      name: `Unknown (${mintAddress.slice(0, 8)}...)`,
      decimals: 0,
      logoURI: null
    };
    return defaultMetadata;
  } catch (error) {
    console.error(`Error fetching token metadata for ${mintAddress}:`, error);
    const errorMetadata: TokenMetadata = {
      address: mintAddress,
      symbol: mintAddress.slice(0, 4),
      name: `Error (${mintAddress.slice(0, 8)}...)`,
      decimals: 0,
      logoURI: null
    };
    return errorMetadata;
  }
}

/**
 * Checks if the token might be an LP token based on heuristics
 */
export function isLikelyLPToken(tokenInfo: TokenInfo): boolean {
  console.log(`\nAnalyzing token: ${tokenInfo.symbol} (${tokenInfo.address})`);
  
  // LP pattern checking removed as requested
  
  console.log(`❌ NOT LP: LP pattern check disabled`);
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
 * Process a batch of token accounts
 */
async function processTokenBatch(
  accounts: any[], 
  startIndex: number, 
  batchSize: number
): Promise<TokenInfo[]> {
  console.log(`Processing token batch ${startIndex+1}-${startIndex+batchSize}`);
  
  const batchTokens = await Promise.all(
    accounts.slice(startIndex, startIndex + batchSize).map(async (account, index) => {
      const parsedInfo = account.account.data.parsed.info;
      const mintAddress = parsedInfo.mint;
      const balance = parsedInfo.tokenAmount;
      
      console.log(`Processing token ${startIndex + index + 1}/${accounts.length}: ${mintAddress}`);
      
      // Get token metadata
      let metadata;
      try {
        metadata = await getTokenMetadata(mintAddress);
        console.log(`Retrieved metadata for ${mintAddress}: ${metadata.symbol}`);
      } catch (error) {
        console.error(`Error getting metadata for ${mintAddress}:`, error);
        metadata = {
          address: mintAddress,
          symbol: 'ERROR',
          name: 'Error fetching metadata',
          decimals: balance.decimals
        };
      }
      
      // Create token info object
      const tokenInfo: TokenInfo = {
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
      console.log(`Checking if ${metadata.symbol} is an LP token...`);
      const isLP = isLikelyLPToken(tokenInfo);
      
      return {
        ...tokenInfo,
        isLPToken: isLP
      };
    })
  );
  
  return batchTokens;
}

/**
 * Fetches and formats all token balances for a wallet
 * Now processes tokens in batches to handle large wallets
 */
export async function getWalletTokens(connection: Connection, walletAddress: string): Promise<TokenInfo[]> {
  console.log(`=== Starting getWalletTokens for ${walletAddress} ===`);
  const publicKey = new PublicKey(walletAddress);
  
  // Preload Jupiter tokens to optimize metadata fetching
  await preloadJupiterTokens();
  
  // Get all token accounts for the wallet
  console.log(`Fetching token accounts from Solana...`);
  let tokenAccounts;
  try {
    tokenAccounts = await connection.getParsedTokenAccountsByOwner(
      publicKey,
      { programId: TOKEN_PROGRAM_ID }
    );
    console.log(`Received ${tokenAccounts.value.length} token accounts from Solana`);
  } catch (error) {
    console.error(`Error fetching token accounts:`, error);
    throw error;
  }
  
  // Get native SOL balance
  console.log(`Fetching native SOL balance...`);
  let solBalance;
  try {
    solBalance = await connection.getBalance(publicKey);
    console.log(`SOL balance: ${solBalance / 1_000_000_000} SOL`);
  } catch (error) {
    console.error(`Error fetching SOL balance:`, error);
    throw error;
  }
  
  // Process and format the token balances
  console.log(`Processing ${tokenAccounts.value.length} token accounts...`);
  // Use all accounts instead of filtering out zero-balance tokens
  const allAccounts = tokenAccounts.value;
  console.log(`Processing all ${allAccounts.length} token accounts (including zero balances)`);
  
  console.log(`Fetching metadata for each token in batches...`);
  
  // Process tokens in batches to avoid memory issues
  const splTokens: TokenInfo[] = [];
  for (let i = 0; i < allAccounts.length; i += MAX_TOKENS_PER_BATCH) {
    const batchSize = Math.min(MAX_TOKENS_PER_BATCH, allAccounts.length - i);
    const batchTokens = await processTokenBatch(allAccounts, i, batchSize);
    splTokens.push(...batchTokens);
    
    // Force garbage collection by clearing references
    global.gc && global.gc();
    
    console.log(`Completed batch ${i/MAX_TOKENS_PER_BATCH + 1}, processed ${splTokens.length}/${allAccounts.length} tokens`);
  }
  
  console.log(`Processed ${splTokens.length} SPL tokens`);
  
  // Create native SOL token info
  console.log(`Creating SOL token info`);
  const solTokenInfo: TokenInfo = {
    mint: 'So11111111111111111111111111111111111111112', // Native SOL mint address
    address: 'So11111111111111111111111111111111111111112',
    address_label: 'Native SOL',
    balance: solBalance / 1_000_000_000, // Convert lamports to SOL (9 decimals)
    decimals: 9,
    symbol: 'SOL',
    name: 'Solana',
    metadata: {
      address: 'So11111111111111111111111111111111111111112',
      symbol: 'SOL',
      name: 'Solana',
      decimals: 9,
      logoURI: null
    },
    isLPToken: false
  };
  
  // Combine SOL with other tokens
  const result = [solTokenInfo, ...splTokens];
  console.log(`=== Completed getWalletTokens with ${result.length} tokens ===`);
  return result;
}