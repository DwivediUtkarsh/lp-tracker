/**
 * This service handles interactions with Raydium Concentrated Liquidity Market Maker (CLMM) positions.
 * It uses the Helius RPC to find NFTs and then parses position data directly.
 */
import { Connection, PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { Decimal } from 'decimal.js';
import axios from 'axios';

import { getTokenMetadata } from '../utils/tokenUtils.js';
import { getTokenPrices } from './priceService.js';
import { Exposure } from '../types/Exposure.js';
import { getClmmProgram } from './raydiumIdl.js';

// Raydium CLMM Program ID
const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');
const HELIUS_API_ENDPOINT = `https://mainnet.helius-rpc.com/?api-key=${process.env.HELIUS_API_KEY || ''}`;

// Type definitions
interface RaydiumPositionInfo {
  nftMint: PublicKey;
  poolId: PublicKey;
  tickLowerIndex: number;
  tickUpperIndex: number;
  liquidity: BN;
  tokenFeesOwed0: BN;
  tokenFeesOwed1: BN;
}

interface RaydiumPoolInfo {
  tokenMint0: PublicKey;
  tokenMint1: PublicKey;
  mintDecimals0: number;
  mintDecimals1: number;
  tickCurrent: number;
  sqrtPriceX64: BN;
}

// Add interface for the position info with a positionAccount field
interface RaydiumHeliusPositionInfo {
  nftMint: PublicKey;
  positionPda: PublicKey;
  poolId: PublicKey;
  tickLowerIndex: number;
  tickUpperIndex: number;
  liquidity: BN;
  tokenFeesOwed0: BN;
  tokenFeesOwed1: BN;
}

// Add a delay function
const delay = (ms: number) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Get all Raydium CLMM positions for a wallet using Helius RPC
 */
export async function getRaydiumPositions(walletAddress: string): Promise<Exposure[]> {
  console.log(`[raydium-clmm] scanning for positions owned by ${walletAddress}`);
  
  try {
    // Strategy #3: Use Helius RPC to get all NFTs for the wallet
    const connection = new Connection(HELIUS_API_ENDPOINT);
    
    // Get all NFT token accounts owned by this wallet
    console.log(`[raydium-clmm] fetching NFTs via Helius DAS API`);
    const response = await axios.post(HELIUS_API_ENDPOINT, {
      jsonrpc: '2.0',
      id: 'helius-test',
      method: 'getAssetsByOwner',
      params: {
        ownerAddress: walletAddress,
        page: 1,
        limit: 1000
      },
    });
    
    if (!response.data?.result?.items) {
      console.log(`[raydium-clmm] no NFTs found for wallet`);
      return [];
    }
    
    // Get all NFTs without filtering by interface
    const nfts = response.data.result.items;
    console.log(`[raydium-clmm] found ${nfts.length} NFTs total`);
    
    // Initialize Anchor coder
    const coder = getClmmProgram(connection).coder;
    
    // Filter for Raydium position NFTs - check each NFT
    const positionInfos: RaydiumHeliusPositionInfo[] = [];
    
    // Process in small batches to avoid rate limiting
    const batchSize = 1;  // Process just 1 NFT at a time
    
    for (let i = 0; i < nfts.length; i += batchSize) {
      const batch = nfts.slice(i, i + batchSize);
      
      // Process each NFT sequentially
      for (const nft of batch) {
        try {
          const mintAddress = nft.id;
          
          // Get the position PDA using the mint
          const [positionPDA] = PublicKey.findProgramAddressSync(
            [Buffer.from('position'), new PublicKey(mintAddress).toBuffer()],
            RAYDIUM_CLMM_PROGRAM_ID
          );
          
          // Fetch the position data
          const positionAccount = await connection.getAccountInfo(positionPDA);
          
          // Add a small delay after each RPC call
          await delay(100);
          
          // If we found a position account, it's a Raydium position NFT
          if (positionAccount && positionAccount.owner.equals(RAYDIUM_CLMM_PROGRAM_ID)) {
            console.log(`[raydium-clmm] found Raydium position NFT: ${mintAddress}`);
            
            // Use Anchor coder to decode the position data
            const position = coder.accounts.decode('PersonalPositionState', positionAccount.data);

            // Log the decoded values
            console.log(`[raydium-helius-debug] Decoded for NFT ${mintAddress}:`);
            console.log(`[raydium-helius-debug]   poolId: ${position.poolId.toString()}`);
            console.log(`[raydium-helius-debug]   tickLowerIndex: ${position.tickLowerIndex}`);
            console.log(`[raydium-helius-debug]   tickUpperIndex: ${position.tickUpperIndex}`);
            console.log(`[raydium-helius-debug]   liquidity: ${position.liquidity.toString()}`);
            console.log(`[raydium-helius-debug]   feeGrowthInside0LastX64: ${position.feeGrowthInside0LastX64.toString()}`);
            console.log(`[raydium-helius-debug]   tokenFeesOwed0: ${position.tokenFeesOwed0.toString()}`);

            positionInfos.push({
              nftMint: new PublicKey(mintAddress),
              positionPda: positionPDA,
              poolId: position.poolId,
              tickLowerIndex: position.tickLowerIndex,
              tickUpperIndex: position.tickUpperIndex,
              liquidity: position.liquidity,
              tokenFeesOwed0: position.tokenFeesOwed0,
              tokenFeesOwed1: position.tokenFeesOwed1
            });
          }
        } catch (err) {
          console.error(`Error processing NFT:`, err);
        }
        
        // Add a delay between NFTs
        if (i + batchSize < nfts.length) {
          await delay(300);
        }
      }
    }
    
    console.log(`[raydium-clmm] found ${positionInfos.length} Raydium positions`);
    
    if (positionInfos.length === 0) {
      return [];
    }
    
    // Fetch pool data for all positions with delays
    const poolIds = [...new Set(positionInfos.map(p => p.poolId.toString()))];
    console.log(`[raydium-clmm] fetching data for ${poolIds.length} unique pools`);
    
    const poolInfoMap = new Map<string, RaydiumPoolInfo>();
    
    // Process pools one at a time with delays
    for (const poolId of poolIds) {
      try {
        const poolAccount = await connection.getAccountInfo(new PublicKey(poolId));
        
        // Add delay after each request
        await delay(100);
        
        if (poolAccount) {
          // Use Anchor coder to decode pool data
          const pool = coder.accounts.decode('PoolState', poolAccount.data);
          
          poolInfoMap.set(poolId, {
            tokenMint0: pool.tokenMint0,
            tokenMint1: pool.tokenMint1,
            mintDecimals0: pool.mintDecimals0,
            mintDecimals1: pool.mintDecimals1,
            tickCurrent: pool.tickCurrent,
            sqrtPriceX64: pool.sqrtPriceX64
          });
        }
      } catch (err) {
        console.error(`Error fetching pool ${poolId}:`, err);
      }
      
      // Add delay between pool requests
      await delay(200);
    }
    
    // NEW: Collect all involved token mints for fetching prices and metadata
    const allTokenMints = new Set<string>();
    positionInfos.forEach(pos => {
      const poolInfo = poolInfoMap.get(pos.poolId.toString());
      if (poolInfo) {
        allTokenMints.add(poolInfo.tokenMint0.toString());
        allTokenMints.add(poolInfo.tokenMint1.toString());
      }
    });

    const tokenPrices = await getTokenPrices([...allTokenMints]);
    const tokenMetadataResults = await Promise.all(
      [...allTokenMints].map(async address => ({
        address,
        metadata: await getTokenMetadata(address)
      }))
    );
    const tokenMetadataMap: Record<string, any> = {};
    tokenMetadataResults.forEach(result => {
      tokenMetadataMap[result.address] = result.metadata;
    });

    const exposures: Exposure[] = [];

    for (const position of positionInfos) {
      const poolInfo = poolInfoMap.get(position.poolId.toString());
      if (!poolInfo) {
        console.warn(`[raydium-helius] Pool info not found for poolId ${position.poolId.toString()} when creating exposure for NFT ${position.nftMint.toString()}`);
        continue; // Skip if no pool info
      }

      // Log poolInfo details
      console.log(`[raydium-helius-debug] Using PoolInfo for pool ${position.poolId.toString()}:`);
      console.log(`[raydium-helius-debug]   tickCurrent: ${poolInfo.tickCurrent}`);
      console.log(`[raydium-helius-debug]   sqrtPriceX64: ${poolInfo.sqrtPriceX64.toString()}`);
      console.log(`[raydium-helius-debug]   mintDecimals0: ${poolInfo.mintDecimals0}`);
      console.log(`[raydium-helius-debug]   mintDecimals1: ${poolInfo.mintDecimals1}`);

      const { amountA, amountB } = calculateAmountsFromLiquidity(
        position.liquidity,
        poolInfo.sqrtPriceX64,
        position.tickLowerIndex,
        position.tickUpperIndex,
        poolInfo.tickCurrent,
        poolInfo.mintDecimals0,
        poolInfo.mintDecimals1
      );

      const feesA = Number(new Decimal(position.tokenFeesOwed0.toString()).div(new Decimal(10).pow(poolInfo.mintDecimals0)));
      const feesB = Number(new Decimal(position.tokenFeesOwed1.toString()).div(new Decimal(10).pow(poolInfo.mintDecimals1)));

      const tokenAAddress = poolInfo.tokenMint0.toString();
      const tokenBAddress = poolInfo.tokenMint1.toString();

      const metaA = tokenMetadataMap[tokenAAddress];
      const metaB = tokenMetadataMap[tokenBAddress];
      const tokenASymbol = metaA?.symbol || tokenAAddress.slice(0, 6);
      const tokenBSymbol = metaB?.symbol || tokenBAddress.slice(0, 6);

      const tokenAPrice = tokenPrices[tokenAAddress] || 0;
      const tokenBPrice = tokenPrices[tokenBAddress] || 0;

      const tokenAValue = amountA * tokenAPrice;
      const tokenBValue = amountB * tokenBPrice;
      const totalValue = tokenAValue + tokenBValue; // Value of current liquidity

      const inRange = poolInfo.tickCurrent >= position.tickLowerIndex && poolInfo.tickCurrent < position.tickUpperIndex;

      const decimalsA = (poolInfo.mintDecimals0 !== undefined && poolInfo.mintDecimals0 >= 0 && poolInfo.mintDecimals0 <= 100) ? poolInfo.mintDecimals0 : 6;
      const decimalsB = (poolInfo.mintDecimals1 !== undefined && poolInfo.mintDecimals1 >= 0 && poolInfo.mintDecimals1 <= 100) ? poolInfo.mintDecimals1 : 6;

      console.log(`[raydium-helius] Position NFT ${position.nftMint?.toString().slice(0, 8) || 'unknown'}...  pool ${tokenASymbol}-${tokenBSymbol}`);
      console.log(`[raydium-helius] Position in-range: ${inRange}   amountA: ${amountA.toFixed(decimalsA)} ${tokenASymbol}   amountB: ${amountB.toFixed(decimalsB)} ${tokenBSymbol}`);

      exposures.push({
        dex: 'raydium-clmm',
        pool: `${tokenASymbol}-${tokenBSymbol}`,
        positionAddress: position.positionPda.toString(),
        tokenA: tokenASymbol,
        tokenB: tokenBSymbol,
        qtyA: amountA, // Just current liquidity, not including fees here for base qty
        qtyB: amountB,
        tokenAAddress,
        tokenBAddress,
        tokenAPrice,
        tokenBPrice,
        tokenAValue,
        tokenBValue,
        totalValue,
        tickLowerIndex: position.tickLowerIndex,
        tickUpperIndex: position.tickUpperIndex,
        tickCurrentIndex: poolInfo.tickCurrent,
        liquidity: position.liquidity.toString(),
        feesOwed0: feesA.toString(), // feesA is already decimal adjusted
        feesOwed1: feesB.toString(), // feesB is already decimal adjusted
        platform: 'Raydium CLMM',
        protocolVersion: 'v2',
        positionId: position.nftMint.toString(), // Using NFT mint as positionId
        nftMint: position.nftMint.toString(),
        poolId: position.poolId.toString(),
        poolName: `${tokenASymbol}-${tokenBSymbol}`,
        poolAddress: position.poolId.toString(),
        inRange
      });
    }

    console.log(`[raydium-helius] Processed ${exposures.length} exposures.`);
    return exposures;

  } catch (error) {
    console.error('[raydium-helius] Error in getRaydiumPositions:', error);
    return [];
  }
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