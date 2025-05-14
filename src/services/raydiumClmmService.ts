/**
 * This service handles interactions with Raydium Concentrated Liquidity Market Maker (CLMM) positions.
 * It uses direct on-chain scanning of program accounts rather than SDK dependencies.
 */
import { Connection, PublicKey, GetProgramAccountsFilter } from '@solana/web3.js';
import { TOKEN_PROGRAM_ID, ASSOCIATED_TOKEN_PROGRAM_ID } from '@solana/spl-token';
import BN from 'bn.js';
import { Decimal } from 'decimal.js';
import axios from 'axios';
import bs58 from 'bs58';

import { ReliableConnection } from '../utils/solana.js';
import { getTokenMetadata } from '../utils/tokenUtils.js';
import { getTokenPrices } from './priceService.js';
import { Exposure } from '../types/Exposure.js';
import { getClmmProgram } from './raydiumIdl.js';

// Raydium CLMM Program ID
const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');
const HELIUS_API_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY || ''}`;

// Type definitions
interface RaydiumPositionInfo {
  bump: number;
  nftMint: PublicKey;
  poolId: PublicKey;
  tickLowerIndex: number;
  tickUpperIndex: number;
  liquidity: BN;
  feeGrowthInside0LastX64: BN;
  feeGrowthInside1LastX64: BN;
  tokenFeesOwed0: BN;
  tokenFeesOwed1: BN;
  // Other fields omitted
}

interface RaydiumPoolInfo {
  bump: number;
  tokenMint0: PublicKey;
  tokenMint1: PublicKey;
  mintDecimals0: number;
  mintDecimals1: number;
  tickCurrent: number;
  sqrtPriceX64: BN;
  // Other fields omitted
}

interface TokenBalance {
  mint: string;
  owner: string;
  tokenAccount: string;
  amount: string;
  decimals: number;
  program: string;
}

/**
 * Main function to fetch Raydium CLMM positions for a wallet
 */
export async function getRaydiumClmmExposures(
  conn: ReliableConnection,
  owner: PublicKey
): Promise<Exposure[]> {
  console.log("[raydium-clmm] scanning for positions owned by", owner.toBase58());
  
  try {
    // Strategy #1: Direct on-chain scan for positions by discriminator
    const positionAccounts = await scanForPositionsByOwner(conn.getConnection(), owner);
    console.log(`[raydium-clmm] found ${positionAccounts.length} position accounts via direct PDA scan`);
    
    if (positionAccounts.length === 0) {
      // Fallback to NFT strategy if no positions found
      const nftMints = await getClmmNftMints(owner);
      console.log(`[raydium-clmm] fallback: found ${nftMints.length} potential CLMM NFTs`);
      
      if (nftMints.length === 0) {
        return [];
      }
      
      // Process NFT positions
      const connection = conn.getConnection();
      const positionsData = await loadPositionsData(connection, owner, nftMints);
      console.log(`[raydium-clmm] loaded data for ${positionsData.length} verified positions from NFTs`);
      
      if (positionsData.length === 0) {
        return [];
      }
      
      return await processPositionData(conn, positionsData);
    }
    
    // Process position accounts found through direct scanning
    const positions = await parsePositionAccounts(conn.getConnection(), positionAccounts);
    console.log(`[raydium-clmm] loaded data for ${positions.length} verified positions from on-chain scan`);
    
    if (positions.length === 0) {
      return [];
    }
    
    return await processPositionData(conn, positions);
    
  } catch (error) {
    console.error('[raydium-clmm] error fetching positions:', error);
    return [];
  }
}

/**
 * Scan on-chain for position accounts owned by the wallet
 * Implementation of Strategy #1 from the reference
 */
async function scanForPositionsByOwner(
  connection: Connection, 
  owner: PublicKey
): Promise<Array<{ pubkey: PublicKey; account: any }>> {
  try {
    console.log(`[raydium-clmm] scanning Raydium CLMM PersonalPosition accounts`);
    
    // 8-byte Anchor discriminator for "personal_position"
    const DISC = bs58.encode(Buffer.from("6dfcdac9b377b1ef", "hex"));
    
    // Get position accounts with discriminator filter
    const raw = await connection.getProgramAccounts(
      RAYDIUM_CLMM_PROGRAM_ID,
      {
        commitment: 'confirmed',
        withContext: false,
        filters: [
          { memcmp: { offset: 0, bytes: DISC } }   // Only PersonalPositionState accounts
        ],
        dataSlice: { offset: 0, length: 0 }        // 0-byte payload, tiny response
      }
    );
    
    console.log(`[raydium-clmm] scan returned ${raw.length} position accounts total`);
    
    if (raw.length === 0) {
      return [];
    }
    
    // Get full account data for position accounts
    const positionKeysToFetch = raw.map(item => item.pubkey);
    const accountInfos = await connection.getMultipleAccountsInfo(positionKeysToFetch);
    
    console.log(`[raydium-clmm] fetched ${accountInfos.length} position accounts`);
    
    // Initialize Anchor coder
    const coder = getClmmProgram(connection).coder;
    
    // Filter for positions belonging to this wallet
    const positions = [];
    for (let i = 0; i < positionKeysToFetch.length; i++) {
      const accountInfo = accountInfos[i];
      if (!accountInfo) continue;
      
      try {
        const pubkey = positionKeysToFetch[i];
        const accountData = accountInfo.data;
        
        // Use Anchor coder to decode position
        const position = coder.accounts.decode('PersonalPositionState', accountData);
        
        // Derive wallet's associated token account for this NFT
        const [expectedAta] = PublicKey.findProgramAddressSync(
          [owner.toBuffer(), TOKEN_PROGRAM_ID.toBuffer(), position.nftMint.toBuffer()],
          ASSOCIATED_TOKEN_PROGRAM_ID
        );
        
        // Check if owner has the NFT for this position
        const tokenAccountInfo = await connection.getAccountInfo(expectedAta);
        if (tokenAccountInfo && tokenAccountInfo.owner.equals(TOKEN_PROGRAM_ID)) {
          positions.push({
            pubkey: pubkey,
            account: accountInfos[i]
          });
        }
      } catch (e) {
        console.log(`[raydium-clmm] error checking position ${positionKeysToFetch[i].toString().slice(0, 8)}...`, e);
      }
    }
    
    console.log(`[raydium-clmm] ✅ ${positions.length} positions belong to wallet ${owner.toString().slice(0, 8)}...`);
    return positions;
  } catch (error) {
    console.error('[raydium-clmm] error scanning for positions:', error);
    return [];
  }
}

/**
 * Parse multiple position accounts into our PositionData format
 */
async function parsePositionAccounts(
  connection: Connection,
  accounts: { pubkey: PublicKey; account: any }[]
): Promise<PositionData[]> {
  // Initialize Anchor coder
  const coder = getClmmProgram(connection).coder;
  
  // Process each position account
  const positions = await Promise.all(
    accounts.map(async ({ pubkey, account }) => {
      try {
        console.log(`[raydium-clmm] processing position ${pubkey.toString().slice(0, 8)}...`);
        
        // Use Anchor coder to decode position data
        const position = coder.accounts.decode('PersonalPositionState', account.data);
        
        // Get pool data
        console.log(`[raydium-clmm] fetching pool data for ${position.poolId.toString().slice(0, 8)}...`);
        const poolAccount = await connection.getAccountInfo(position.poolId);
        
        if (!poolAccount) {
          console.log(`[raydium-clmm] no pool found for position ${pubkey.toString().slice(0, 8)}..., pool ID: ${position.poolId.toString()}`);
          return null;
        }
        
        // Use Anchor coder to decode pool data
        const pool = coder.accounts.decode('PoolState', poolAccount.data);
        
        console.log(`[raydium-clmm] found valid position at ${pubkey.toString().slice(0, 8)}...`);
        console.log(`[raydium-clmm] pool: ${position.poolId.toString().slice(0, 8)}...`);
        console.log(`[raydium-clmm] tokens: ${pool.tokenMint0.toString().slice(0, 8)}.../${pool.tokenMint1.toString().slice(0, 8)}...`);
        console.log(`[raydium-clmm] position ticks: lower=${position.tickLowerIndex}, upper=${position.tickUpperIndex}, current=${pool.tickCurrent}`);
        console.log(`[raydium-clmm] liquidity: ${position.liquidity.toString()}`);
        
        // Calculate token amounts based on position liquidity
        const { amountA, amountB } = calculateAmountsFromLiquidity(
          position.liquidity,
          pool.sqrtPriceX64,
          position.tickLowerIndex,
          position.tickUpperIndex,
          pool.tickCurrent,
          pool.mintDecimals0,
          pool.mintDecimals1
        );
        
        // Check if position is in range
        const inRange = pool.tickCurrent >= position.tickLowerIndex && 
                      pool.tickCurrent < position.tickUpperIndex;
        
        // Return position data
        return {
          nftMint: position.nftMint,
          positionPda: pubkey,
          poolId: position.poolId,
          mintA: pool.tokenMint0,
          mintB: pool.tokenMint1,
          liquidity: position.liquidity,
          tickLower: position.tickLowerIndex,
          tickUpper: position.tickUpperIndex,
          tickCurrent: pool.tickCurrent,
          inRange,
          amountA: Number(amountA),
          amountB: Number(amountB),
          feesA: Number(new Decimal(position.tokenFeesOwed0.toString()).div(new Decimal(10).pow(pool.mintDecimals0))),
          feesB: Number(new Decimal(position.tokenFeesOwed1.toString()).div(new Decimal(10).pow(pool.mintDecimals1))),
          decimalsA: pool.mintDecimals0,
          decimalsB: pool.mintDecimals1
        };
      } catch (error) {
        console.error(`[raydium-clmm] error processing position ${pubkey.toString()}:`, error);
        return null;
      }
    })
  );
  
  // Filter out null positions
  return positions.filter(Boolean) as PositionData[];
}

/**
 * Get NFT mints that belong to CLMM collection using Helius API
 */
async function getClmmNftMints(owner: PublicKey): Promise<PublicKey[]> {
  try {
    // First try the token account method which is more reliable
    const tokenAccountMints = await getClmmNftMintsFromTokenAccounts(owner);
    if (tokenAccountMints.length > 0) {
      console.log(`[raydium-clmm] found ${tokenAccountMints.length} NFTs via token accounts`);
      return tokenAccountMints;
    }
    
    // Try direct Raydium NFT detection
    const directRaydiumMints = await getRaydiumNftMints(owner);
    if (directRaydiumMints.length > 0) {
      console.log(`[raydium-clmm] found ${directRaydiumMints.length} Raydium NFTs via direct check`);
      return directRaydiumMints;
    }
    
    // Fall back to Helius if other methods return nothing
    const response = await axios.post(HELIUS_API_ENDPOINT, {
      jsonrpc: "2.0",
      id: "raydium-clmm-scanner",
      method: "getAssetsByOwner",
      params: {
        ownerAddress: owner.toBase58(),
        page: 1, 
        limit: 1000
      }
    }, {
      headers: {
        'Content-Type': 'application/json'
      }
    });
    
    if (!response.data || !response.data.result || !response.data.result.items) {
      console.log('[raydium-clmm] No NFTs found or invalid response from Helius');
      return [];
    }
    
    // Filter for NFTs belonging to CLMM collection
    // Note: We process all NFTs without filtering
    const nftMints = response.data.result.items.map((item: any) => new PublicKey(item.id));
    
    console.log(`[raydium-clmm] found ${nftMints.length} NFTs via Helius`);
    return nftMints;
  } catch (error) {
    console.error('[raydium-clmm] error fetching NFTs from Helius:', error);
    // Fallback to querying token accounts if Helius fails
    return await getClmmNftMintsFromTokenAccounts(owner);
  }
}

// Add delay function
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

// Update the loadPositionsData function to use smaller batches with delays
async function loadPositionsData(
  connection: Connection,
  owner: PublicKey,
  nftMints: PublicKey[]
): Promise<PositionData[]> {
  // Initialize Anchor coder
  const coder = getClmmProgram(connection).coder;
  
  // Process each mint to find valid positions - in very small batches with delays
  const positions: PositionData[] = [];
  const batchSize = 1; // Process just 1 NFT at a time to avoid rate limits
  
  console.log(`[raydium-clmm] processing ${nftMints.length} NFTs in batches of ${batchSize}`);
  
  for (let i = 0; i < nftMints.length; i += batchSize) {
    const batch = nftMints.slice(i, i + batchSize);
    
    // Process batch sequentially instead of in parallel
    for (const mint of batch) {
      try {
        // Derive PDA for the position account
        const [positionPda] = PublicKey.findProgramAddressSync(
          [Buffer.from("position"), mint.toBuffer()],
          RAYDIUM_CLMM_PROGRAM_ID
        );
        
        console.log(`[raydium-clmm] checking position for NFT ${mint.toString().slice(0, 8)}... at PDA ${positionPda.toString().slice(0, 8)}...`);
        
        // Get position account data
        const positionAccount = await connection.getAccountInfo(positionPda);
        
        // Add a small delay after each RPC call
        await delay(100);
        
        if (!positionAccount || !positionAccount.owner.equals(RAYDIUM_CLMM_PROGRAM_ID)) {
          continue;
        }
        
        // Use Anchor coder to decode position data
        const position = coder.accounts.decode('PersonalPositionState', positionAccount.data);
        
        // Verify NFT mint (safety check)
        if (!position.nftMint.equals(mint)) {
          console.log(`[raydium-clmm] NFT mint mismatch for ${mint.toString().slice(0, 8)}...`);
          continue;
        }
        
        // Get pool data
        const poolAccount = await connection.getAccountInfo(position.poolId);
        
        // Add a small delay after each RPC call
        await delay(100);
        
        if (!poolAccount) {
          console.log(`[raydium-clmm] no pool found for position ${positionPda.toString().slice(0, 8)}..., pool ID: ${position.poolId.toString()}`);
          continue;
        }
        
        // Use Anchor coder to decode pool data
        const pool = coder.accounts.decode('PoolState', poolAccount.data);
        
        console.log(`[raydium-clmm] found valid position for NFT ${mint.toString().slice(0, 8)}...`);
        console.log(`[raydium-clmm] pool: ${position.poolId.toString().slice(0, 8)}...`);
        console.log(`[raydium-clmm] tokens: ${pool.tokenMint0.toString().slice(0, 8)}.../${pool.tokenMint1.toString().slice(0, 8)}...`);
        console.log(`[raydium-clmm] position ticks: lower=${position.tickLowerIndex}, upper=${position.tickUpperIndex}, current=${pool.tickCurrent}`);
        console.log(`[raydium-clmm] liquidity: ${position.liquidity.toString()}`);
        
        // Calculate token amounts based on position liquidity
        const { amountA, amountB } = calculateAmountsFromLiquidity(
          position.liquidity,
          pool.sqrtPriceX64,
          position.tickLowerIndex,
          position.tickUpperIndex,
          pool.tickCurrent,
          pool.mintDecimals0,
          pool.mintDecimals1
        );
        
        // Check if position is in range
        const inRange = pool.tickCurrent >= position.tickLowerIndex && 
                      pool.tickCurrent < position.tickUpperIndex;
        
        // Create position data object
        positions.push({
          nftMint: mint,
          positionPda,
          poolId: position.poolId,
          mintA: pool.tokenMint0,
          mintB: pool.tokenMint1,
          liquidity: position.liquidity,
          tickLower: position.tickLowerIndex,
          tickUpper: position.tickUpperIndex,
          tickCurrent: pool.tickCurrent,
          inRange,
          amountA: Number(amountA),
          amountB: Number(amountB),
          feesA: Number(new Decimal(position.tokenFeesOwed0.toString()).div(new Decimal(10).pow(pool.mintDecimals0))),
          feesB: Number(new Decimal(position.tokenFeesOwed1.toString()).div(new Decimal(10).pow(pool.mintDecimals1))),
          decimalsA: pool.mintDecimals0,
          decimalsB: pool.mintDecimals1
        });
      } catch (error) {
        console.error(`[raydium-clmm] error processing position for NFT ${mint.toString().slice(0, 8)}:`, error);
      }
      
      // Add a delay between NFTs to avoid rate limiting
      if (i + batchSize < nftMints.length) {
        await delay(300);
      }
    }
  }
  
  console.log(`[raydium-clmm] found ${positions.length} valid positions`);
  return positions;
}

/**
 * Specifically look for Raydium CLMM position NFTs 
 * Using known creators and metadata patterns
 */
async function getRaydiumNftMints(owner: PublicKey): Promise<PublicKey[]> {
  try {
    console.log('[raydium-clmm] attempting direct Raydium NFT lookup');
    
    const connection = new Connection(process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com');
    
    // Get all NFT token accounts
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_PROGRAM_ID
    });
    
    // Filter for NFT accounts (amount = 1, decimals = 0)
    const nftAccounts = tokenAccounts.value.filter(account => {
      const data = account.account.data.parsed.info;
      return Number(data.tokenAmount.amount) === 1 && 
             Number(data.tokenAmount.decimals) === 0;
    });
    
    console.log(`[raydium-clmm] checking ${nftAccounts.length} NFT accounts for valid Raydium position NFTs`);
    
    // Extract mints
    const mintAddresses = nftAccounts.map(account => 
      new PublicKey(account.account.data.parsed.info.mint)
    );
    
    // For each mint, try to derive position PDA and check if it exists
    const positionCheckResults = await Promise.all(
      mintAddresses.map(async (mint) => {
        try {
          // Derive PDA for the position
          const [positionPda] = PublicKey.findProgramAddressSync(
            [Buffer.from("position"), mint.toBuffer()],
            RAYDIUM_CLMM_PROGRAM_ID
          );
          
          // Check if this position exists
          const accountInfo = await connection.getAccountInfo(positionPda);
          
          if (accountInfo && accountInfo.owner.equals(RAYDIUM_CLMM_PROGRAM_ID)) {
            console.log(`[raydium-clmm] found valid Raydium position for NFT ${mint.toString().slice(0, 8)}...`);
            return mint;
          }
          
          return null;
        } catch (e) {
          return null;
        }
      })
    );
    
    // Filter out nulls (failed checks)
    const validMints = positionCheckResults.filter(Boolean) as PublicKey[];
    console.log(`[raydium-clmm] found ${validMints.length} valid Raydium position NFTs`);
    
    return validMints;
  } catch (error) {
    console.error('[raydium-clmm] error in direct Raydium NFT lookup:', error);
    return [];
  }
}

/**
 * Fallback method to get NFTs from token accounts
 */
async function getClmmNftMintsFromTokenAccounts(owner: PublicKey): Promise<PublicKey[]> {
  try {
    const connection = new Connection(process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com');
    const tokenAccounts = await connection.getParsedTokenAccountsByOwner(owner, {
      programId: TOKEN_PROGRAM_ID
    });
    
    // Filter for NFTs (amount = 1, decimals = 0)
    const nftAccounts = tokenAccounts.value.filter(account => {
      const data = account.account.data.parsed.info;
      return Number(data.tokenAmount.amount) === 1 && 
             Number(data.tokenAmount.decimals) === 0;
    });
    
    console.log(`[raydium-clmm] found ${nftAccounts.length} NFTs via token accounts fallback`);
    
    // Extract mint addresses
    return nftAccounts.map(account => 
      new PublicKey(account.account.data.parsed.info.mint)
    );
  } catch (error) {
    console.error('[raydium-clmm] error fetching NFTs from token accounts:', error);
    return [];
  }
}

/**
 * Common function to process position data into exposures
 */
async function processPositionData(
  conn: ReliableConnection,
  positionsData: PositionData[]
): Promise<Exposure[]> {
  // Collect token addresses for batch price fetch
  const tokenAddresses = new Set<string>();
  positionsData.forEach(pos => {
    tokenAddresses.add(pos.mintA.toString());
    tokenAddresses.add(pos.mintB.toString());
  });
  
  // Get token prices and symbols
  const tokenPrices = await getTokenPrices(Array.from(tokenAddresses));
  const tokenMetadataPromises = Array.from(tokenAddresses).map(async address => {
    return {
      address,
      metadata: await getTokenMetadata(address)
    };
  });
  const tokenMetadataResults = await Promise.all(tokenMetadataPromises);
  
  // Create a map for quick metadata lookup
  const tokenMetadataMap: Record<string, any> = {};
  tokenMetadataResults.forEach(result => {
    tokenMetadataMap[result.address] = result.metadata;
  });
  
  // Convert to Exposure objects
  const exposures: Exposure[] = positionsData.map(posData => {
    const tokenAAddress = posData.mintA.toString();
    const tokenBAddress = posData.mintB.toString();
    
    // Get token metadata/symbols
    const metaA = tokenMetadataMap[tokenAAddress];
    const metaB = tokenMetadataMap[tokenBAddress];
    const tokenASymbol = metaA?.symbol || tokenAAddress.slice(0, 6);
    const tokenBSymbol = metaB?.symbol || tokenBAddress.slice(0, 6);
    
    // Get token prices
    const tokenAPrice = tokenPrices[tokenAAddress] || 0;
    const tokenBPrice = tokenPrices[tokenBAddress] || 0;
    
    // Calculate token values
    const tokenAValue = posData.amountA * tokenAPrice;
    const tokenBValue = posData.amountB * tokenBPrice;
    const totalValue = tokenAValue + tokenBValue;
    
    console.log(`[raydium-clmm] Position NFT ${posData.nftMint?.toString().slice(0, 8) || 'unknown'}...  pool ${tokenASymbol}-${tokenBSymbol}`);
    console.log(`[raydium-clmm] Position in-range: ${posData.inRange}   amountA: ${posData.amountA.toFixed(4)} ${tokenASymbol}   amountB: ${posData.amountB.toFixed(4)} ${tokenBSymbol}`);
    
    return {
      dex: 'raydium-clmm',
      pool: `${tokenASymbol}-${tokenBSymbol}`,
      positionAddress: posData.positionPda.toString(),
      tokenA: tokenASymbol,
      tokenB: tokenBSymbol,
      qtyA: posData.amountA,
      qtyB: posData.amountB,
      tokenAAddress,
      tokenBAddress,
      tokenAPrice,
      tokenBPrice,
      tokenAValue,
      tokenBValue,
      totalValue,
      tickLowerIndex: posData.tickLower,
      tickUpperIndex: posData.tickUpper,
      tickCurrentIndex: posData.tickCurrent,
      liquidity: posData.liquidity.toString(),
      feesOwed0: posData.feesA.toString(),
      feesOwed1: posData.feesB.toString(),
      // Additional fields
      platform: 'Raydium CLMM',
      protocolVersion: 'v2',
      positionId: posData.positionPda.toString(),
      nftMint: posData.nftMint?.toString() || '',
      poolId: posData.poolId.toString(),
      poolName: `${tokenASymbol}-${tokenBSymbol}`,
      poolAddress: posData.poolId.toString(),
      inRange: posData.inRange
    };
  });
  
  console.log(`[raydium-clmm] found ${exposures.length} valid Raydium CLMM positions`);
  return exposures;
}

/**
 * Calculate token amounts from liquidity, implementing the core formulas
 * Based on Uniswap v3 mathematics
 */
function calculateAmountsFromLiquidity(
  liquidity: BN,
  sqrtPriceX64: BN,
  tickLower: number,
  tickUpper: number,
  tickCurrent: number,
  decimal0: number,
  decimal1: number
): { amountA: number; amountB: number } {
  try {
    // Convert to Decimal.js for safer math
    const liquidityDec = new Decimal(liquidity.toString());
    const sqrtPriceCurrentX64 = new Decimal(sqrtPriceX64.toString());
    const decimalA = new Decimal(10).pow(decimal0);
    const decimalB = new Decimal(10).pow(decimal1);
    
    // Calculate sqrt prices at ticks
    const sqrtPriceLowerX64 = getSqrtPriceX64(tickLower);
    const sqrtPriceUpperX64 = getSqrtPriceX64(tickUpper);
    
    let amountA = new Decimal(0);
    let amountB = new Decimal(0);
    
    const Q64 = new Decimal(2).pow(64);
    
    // Use Uniswap v3 formulas to calculate token amounts based on where current price is
    if (tickCurrent < tickLower) {
      // All liquidity in token A
      amountA = liquidityDec
        .mul(sqrtPriceUpperX64.minus(sqrtPriceLowerX64))
        .mul(Q64)
        .div(sqrtPriceUpperX64.mul(sqrtPriceLowerX64))
        .div(decimalA);
    } else if (tickCurrent >= tickUpper) {
      // All liquidity in token B
      amountB = liquidityDec
        .mul(sqrtPriceUpperX64.minus(sqrtPriceLowerX64))
        .div(Q64)
        .div(decimalB);
    } else {
      // Liquidity in both tokens
      amountA = liquidityDec
        .mul(sqrtPriceUpperX64.minus(sqrtPriceCurrentX64))
        .mul(Q64)
        .div(sqrtPriceUpperX64.mul(sqrtPriceCurrentX64))
        .div(decimalA);
        
      amountB = liquidityDec
        .mul(sqrtPriceCurrentX64.minus(sqrtPriceLowerX64))
        .div(Q64)
        .div(decimalB);
    }
    
    return {
      amountA: amountA.toNumber(),
      amountB: amountB.toNumber()
    };
  } catch (error) {
    console.error('[raydium-clmm] error calculating amounts:', error);
    return {
      amountA: 0,
      amountB: 0
    };
  }
}

/**
 * Calculate sqrt price from tick index
 * Uses the formula: sqrt(1.0001^tick) * 2^64
 */
function getSqrtPriceX64(tick: number): Decimal {
  return new Decimal(1.0001).pow(tick).sqrt().mul(new Decimal(2).pow(64));
}

/**
 * PositionData interface for internal use
 */
interface PositionData {
  nftMint?: PublicKey;
  positionPda: PublicKey;
  poolId: PublicKey;
  mintA: PublicKey;
  mintB: PublicKey;
  liquidity: BN;
  tickLower: number;
  tickUpper: number;
  tickCurrent: number;
  inRange: boolean;
  amountA: number;
  amountB: number;
  feesA: number;
  feesB: number;
  decimalsA: number;
  decimalsB: number;
} 