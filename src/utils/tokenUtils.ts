import { PublicKey, Connection } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID } from './solana.js';
import * as SPLToken from '@solana/spl-token';
import fetch from 'node-fetch';
import { TokenListProvider, TokenInfo as RegistryTokenInfo } from '@solana/spl-token-registry';
import { Metaplex } from '@metaplex-foundation/js';

/**
 * Unified metadata interface
 */
export interface TokenMetadata {
  address: string;
  symbol: string;
  name: string;
  decimals: number;
  logoURI?: string | null;
  [key: string]: any;
}

/**
 * Token info object returned by getWalletTokens
 */
export interface TokenInfo {
  mint: string;
  address: string;
  address_label?: string;
  balance: number;
  decimals: number;
  symbol: string;
  name: string;
  metadata: TokenMetadata | null;
  isLPToken?: boolean;
  [key: string]: any;
}

// Caches
const tokenMetadataCache = new Map<string, TokenMetadata>();
let jupiterTokensLoaded = false;
let jupiterTokens: TokenMetadata[] = [];
let registryLoaded = false;

const MAX_TOKENS_PER_BATCH = 50;
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';
const HELIUS_ASSET_URL = `https://api.helius.xyz/v0/get-asset?api-key=${HELIUS_API_KEY}`;

// Interface for Helius API response
interface HeliusTokenResponse {
  symbol?: string;
  name?: string;
  decimals?: number;
  image?: string;
  [key: string]: any;
}

/**
 * Pre-load Solana Token Registry
 */
async function preloadTokenRegistry(): Promise<void> {
  if (registryLoaded) return;
  try {
    console.log('Loading token registry...');
    const container = await new TokenListProvider().resolve();
    const list = container.filterByChainId(101).getList();
    for (const info of list) {
      const md: TokenMetadata = {
        address: info.address,
        symbol: info.symbol,
        name: info.name,
        decimals: info.decimals,
        logoURI: info.logoURI || null
      };
      tokenMetadataCache.set(info.address, md);
    }
    registryLoaded = true;
    console.log(`Loaded ${tokenMetadataCache.size} tokens from registry`);
  } catch (err) {
    console.warn('Failed to load token registry:', err);
  }
}

/**
 * Pre-load Jupiter token list
 */
export async function preloadJupiterTokens(): Promise<void> {
  if (jupiterTokensLoaded) return;
  try {
    console.log(`Fetching Jupiter token list...`);
    const res = await fetch('https://token.jup.ag/all');
    console.log(`Jupiter API response received`);
    const data = (await res.json()) as RegistryTokenInfo[];
    jupiterTokens = data.map(t => ({
      address: t.address,
      symbol: t.symbol,
      name: t.name,
      decimals: t.decimals,
      logoURI: t.logoURI || null
    }));
    for (const token of jupiterTokens) {
      if (!tokenMetadataCache.has(token.address)) tokenMetadataCache.set(token.address, token);
    }
    jupiterTokensLoaded = true;
    console.log(`Loaded ${jupiterTokens.length} tokens from Jupiter API`);
  } catch (err) {
    console.error('Failed to load Jupiter tokens:', err);
  }
}

/**
 * Fetch metadata via Helius DAS endpoint
 */
async function fetchHeliusMetadata(mintAddress: string): Promise<TokenMetadata | null> {
  if (!HELIUS_API_KEY) return null;
  try {
    console.log(`Fetching Helius metadata for ${mintAddress}...`);
    const res = await fetch(HELIUS_ASSET_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ assetId: mintAddress, showFungible: true })
    });
    if (!res.ok) return null;
    
    const json = await res.json() as HeliusTokenResponse;
    // Verify essential properties exist
    if (!json || !json.symbol) return null;
    
    const md: TokenMetadata = {
      address: mintAddress,
      symbol: json.symbol,
      name: json.name || mintAddress.slice(0, 4),
      decimals: json.decimals ?? 0,
      logoURI: json.image || null
    };
    console.log(`Found Helius metadata for ${mintAddress}: ${md.symbol}`);
    return md;
  } catch (err) {
    console.warn(`Helius metadata fetch failed for ${mintAddress}:`, err);
    return null;
  }
}

/**
 * On-chain Metaplex fallback
 */
async function fetchOnchainMetadata(connection: Connection, mintAddress: string): Promise<TokenMetadata | null> {
  try {
    console.log(`Fetching on-chain metadata for ${mintAddress}...`);
    const metaplex = Metaplex.make(connection);
    
    // Using the Metaplex API in a more standard way
    const mintKey = new PublicKey(mintAddress);
    const metadata = await metaplex.nfts().findByMint({ mintAddress: mintKey });
    
    if (!metadata || !metadata.name) return null;
    
    console.log(`Found on-chain metadata for ${mintAddress}: ${metadata.symbol || mintAddress.slice(0, 4)}`);
    return { 
      address: mintAddress, 
      symbol: metadata.symbol || mintAddress.slice(0, 4), 
      name: metadata.name, 
      decimals: metadata.mint?.decimals || 0, 
      logoURI: metadata.json?.image || null 
    };
  } catch {
    return null;
  }
}

/**
 * Get token metadata from various sources
 * 
 * This function tries multiple sources to get token metadata:
 * 1. Local cache
 * 2. On-chain metadata
 * 3. Helius API (if available)
 * 
 * @param tokenAddress Token mint address
 * @returns Token metadata object or null if not found
 */
export async function getTokenMetadata(tokenAddress: string): Promise<TokenMetadata | null> {
  if (!tokenAddress) {
    console.log("No token address provided to getTokenMetadata");
    return null;
  }
  
  try {
    // Check if we have it in cache
    const cachedMetadata = tokenMetadataCache.get(tokenAddress);
    if (cachedMetadata) {
      console.log(`Using cached metadata for ${tokenAddress}`);
      return cachedMetadata;
  }

    // Try to get from Helius API first (if API key is available)
    if (process.env.HELIUS_API_KEY) {
      try {
        console.log(`Fetching Helius metadata for ${tokenAddress}...`);
        const heliusMetadata = await fetchHeliusMetadata(tokenAddress);
        if (heliusMetadata) {
          // Cache and return
          tokenMetadataCache.set(tokenAddress, heliusMetadata);
          return heliusMetadata;
        }
      } catch (error: any) {
        console.log(`Helius metadata fetch failed for ${tokenAddress}: ${error.message}`);
      }
    }
    
    // Try to get on-chain metadata
    try {
      console.log(`Fetching on-chain metadata for ${tokenAddress}...`);
      // Create a connection for on-chain metadata
      const connection = new Connection(process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com');
      const onChainMetadata = await fetchOnchainMetadata(connection, tokenAddress);
      if (onChainMetadata) {
        console.log(`Found on-chain metadata for ${tokenAddress}: ${onChainMetadata.symbol}`);
        // Cache and return
        tokenMetadataCache.set(tokenAddress, onChainMetadata);
        return onChainMetadata;
  }
    } catch (error: any) {
      console.log(`On-chain metadata fetch failed for ${tokenAddress}: ${error.message}`);
    }
    
    // If we get here, we couldn't find metadata
    console.log(`No metadata found for ${tokenAddress}, using default`);
    
    // Create a minimal metadata object with just the address
    const minimalMetadata: TokenMetadata = {
      address: tokenAddress,
      symbol: tokenAddress.slice(0, 6),
      name: tokenAddress.slice(0, 6),
      decimals: 9, // Default to 9 decimals (SOL standard)
      logoURI: null,
      tags: []
  };
    
    // Cache this minimal metadata
    tokenMetadataCache.set(tokenAddress, minimalMetadata);
    return minimalMetadata;
    
  } catch (error: any) {
    console.error(`Error in getTokenMetadata for ${tokenAddress}:`, error);
    return null;
  }
}

/**
 * Determines if a token is likely an LP token (heuristic placeholder)
 */
export function isLikelyLPToken(tokenInfo: TokenInfo): boolean {
  console.log(`\nAnalyzing token: ${tokenInfo.symbol} (${tokenInfo.address})`);
  // implement protocol‑specific LP mint lists or regex checks here
  console.log(`❌ NOT LP: LP pattern check disabled`);
  return false;
}

/**
 * Formats raw token amount
 */
export function formatTokenAmount(
  amount: string | number | bigint,
  decimals: number
): number {
  const value = typeof amount === 'bigint' ? amount : BigInt(amount.toString());
  return Number(value) / Math.pow(10, decimals);
}

/**
 * Batch processing of token accounts
 */
async function processTokenBatch(
  connection: Connection,
  accounts: any[],
  startIndex: number,
  batchSize: number
): Promise<TokenInfo[]> {
  console.log(`Processing token batch ${startIndex+1}-${startIndex+batchSize}`);
  
  const batch = accounts.slice(startIndex, startIndex + batchSize);
  return Promise.all(
    batch.map(async (acc, index) => {
      const info = acc.account.data.parsed.info;
      const mint = info.mint;
      const decimals = info.tokenAmount.decimals;
      const balance = formatTokenAmount(info.tokenAmount.amount, decimals);
      
      console.log(`Processing token ${startIndex + index + 1}/${accounts.length}: ${mint}`);

      const metadata = await getTokenMetadata(mint);
      console.log(`Retrieved metadata for ${mint}: ${metadata?.symbol}`);
      
      const tokenInfo: TokenInfo = {
        mint,
        address: mint,
        address_label: acc.pubkey.toString(),
        balance,
        decimals,
        symbol: metadata?.symbol || mint.slice(0, 6),
        name: metadata?.name || mint.slice(0, 6),
        metadata
      };
      
      // Check if it's likely an LP token
      console.log(`Checking if ${metadata?.symbol} is an LP token...`);
      const isLP = isLikelyLPToken(tokenInfo);
      
      return {
        ...tokenInfo,
        isLPToken: isLP
      };
    })
  );
}

/**
 * Retrieve and format all tokens for a wallet
 */
export async function getWalletTokens(
  connection: Connection,
  walletAddress: string
): Promise<TokenInfo[]> {
  console.log(`=== Starting getWalletTokens for ${walletAddress} ===`);
  
  // Preload token registries
  await preloadTokenRegistry();
  await preloadJupiterTokens();

  // Get token accounts
  console.log(`Fetching token accounts from Solana...`);
  const pub = new PublicKey(walletAddress);
  const parsed = await connection.getParsedTokenAccountsByOwner(
    pub, 
    { programId: TOKEN_PROGRAM_ID }
  );
  console.log(`Received ${parsed.value.length} token accounts from Solana`);

  // Get native SOL balance
  console.log(`Fetching native SOL balance...`);
  const solLamports = await connection.getBalance(pub);
  console.log(`SOL balance: ${solLamports / 1e9} SOL`);
  
  // Create SOL token info
  console.log(`Creating SOL token info`);
  const solInfo: TokenInfo = {
    mint: 'So11111111111111111111111111111111111111112',
    address: 'So11111111111111111111111111111111111111112',
    address_label: 'Native SOL',
    balance: solLamports / 1e9,
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

  // Process all token accounts
  const allAccounts = parsed.value;
  console.log(`Processing all ${allAccounts.length} token accounts (including zero balances)`);
  console.log(`Fetching metadata for each token in batches...`);
  
  // Process in batches
  const results: TokenInfo[] = [solInfo];
  for (let i = 0; i < allAccounts.length; i += MAX_TOKENS_PER_BATCH) {
    const batchSize = Math.min(MAX_TOKENS_PER_BATCH, allAccounts.length - i);
    const batch = await processTokenBatch(connection, allAccounts, i, batchSize);
    results.push(...batch);
    
    // Force garbage collection
    global.gc && global.gc();
    
    console.log(`Completed batch ${Math.floor(i/MAX_TOKENS_PER_BATCH) + 1}, processed ${results.length-1}/${allAccounts.length} tokens`);
  }
  
  console.log(`Processed ${results.length-1} SPL tokens`);
  console.log(`=== Completed getWalletTokens with ${results.length} tokens ===`);
  return results;
}