// ── src/services/whirlpoolService.ts ───────────────────────────────────────
/**
 * This service handles interactions with Orca Whirlpool liquidity pools.
 * It directly fetches position data for a wallet using the Orca SDK's fetchPositionsForOwner function.
 */
import { PublicKey, Connection } from '@solana/web3.js';
import BN from 'bn.js';
import { Decimal } from 'decimal.js';
import {
  buildWhirlpoolClient,
  WhirlpoolContext,
  ORCA_WHIRLPOOLS_CONFIG,
  PriceMath,
} from '@orca-so/whirlpools-sdk';
import { fetchPositionsForOwner, setWhirlpoolsConfig } from '@orca-so/whirlpools';
import { createSolanaRpc, mainnet, address as kitAddress } from '@solana/kit';

import { ReliableConnection } from '../utils/solana.js';
import { getTokenMetadata } from '../utils/tokenUtils.js';
import { getTokenPrices } from './priceService.js';
import { Exposure } from '../types/Exposure.js';

// Add Orca Whirlpool Program ID
const ORCA_WHIRLPOOL_PROGRAM_ID = new PublicKey('whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc');
const Q64 = new BN(1).ushln(64);

/* ------------------ helper: amounts via Uniswap v3 math ----------------- */
function calcAmounts(posData: any, pool: any): { 
  a: ReturnType<typeof Decimal.prototype.div>; 
  b: ReturnType<typeof Decimal.prototype.div>; 
} {
  try {
    // Get token decimals from pool's token info objects
    const tokenAInfo = pool.getTokenAInfo();
    const tokenBInfo = pool.getTokenBInfo();
    const decimalA = tokenAInfo.decimals;
    const decimalB = tokenBInfo.decimals;
    
    const poolData = pool.getData();

    if (typeof decimalA !== 'number' || typeof decimalB !== 'number') {
      throw new Error(`Invalid decimals: A=${decimalA}, B=${decimalB}`);
    }

    // Convert to BN for precise math
    const liquidity = new BN(posData.liquidity.toString());
    const sqrtPriceCurrent = new BN(poolData.sqrtPrice.toString());
    const tickLower = posData.tickLowerIndex;
    const tickUpper = posData.tickUpperIndex;
    
    // Safety check for invalid ticks
    if (tickLower >= tickUpper) {
      throw new Error('Invalid tick range');
    }

    // Get sqrt prices for position bounds using SDK math
    const sqrtPriceLower = PriceMath.tickIndexToSqrtPriceX64(tickLower);
    const sqrtPriceUpper = PriceMath.tickIndexToSqrtPriceX64(tickUpper);
    
    // Add uncollected fees
    const feeOwedA = new BN(posData.feeOwedA.toString() || '0');
    const feeOwedB = new BN(posData.feeOwedB.toString() || '0');

    let amountA = new BN(0);
    let amountB = new BN(0);

    // Handle edge cases for better numerical stability
    if (liquidity.isZero()) {
      // Position has no liquidity, only use fees
      amountA = feeOwedA;
      amountB = feeOwedB;
    } else if (sqrtPriceCurrent.lte(sqrtPriceLower)) {
      // Case A: Price below range - all liquidity in token A
      amountA = liquidity
      .mul(sqrtPriceUpper.sub(sqrtPriceLower))
      .mul(Q64)                                    // ← multiply by 2^64
      .div(sqrtPriceLower.mul(sqrtPriceUpper));    // ← only one division
    } else if (sqrtPriceCurrent.gte(sqrtPriceUpper)) {
      // Case B: Price above range - all liquidity in token B
      amountB = liquidity.mul(sqrtPriceUpper.sub(sqrtPriceLower))
                .shrn(64);  // Divide by 2^64 for fixed-point
    } else {
      // Case C: Price in range - liquidity split between both tokens
      const numA = sqrtPriceUpper.sub(sqrtPriceCurrent);
      const denomA = sqrtPriceCurrent.mul(sqrtPriceUpper);
      amountA = liquidity
      .mul(numA)
      .mul(Q64)                                    // ← multiply by 2^64
      .div(denomA);                                // ← only one division

      const numB = sqrtPriceCurrent.sub(sqrtPriceLower);
      amountB = liquidity.mul(numB).shrn(64);
    }

    // Add uncollected fees to amounts
    amountA = amountA.add(feeOwedA);
    amountB = amountB.add(feeOwedB);

    // Convert to human-readable decimals
    const decimalFactorA = new Decimal(10).pow(decimalA);
    const decimalFactorB = new Decimal(10).pow(decimalB);

    // Create decimal results with proper scaling
    const resultA = new Decimal(amountA.toString()).div(decimalFactorA);
    const resultB = new Decimal(amountB.toString()).div(decimalFactorB);

    return {
      a: resultA,
      b: resultB
    };
  } catch (error) {
    console.error('Error calculating amounts:', error);
    return {
      a: new Decimal(0),
      b: new Decimal(0)
    };
  }
}

export async function getWhirlpoolExposures(
  conn: ReliableConnection,
  owner: PublicKey
): Promise<Exposure[]> {
  console.log("[whirlpool] scanning for positions owned by", owner.toBase58());

  try {
    // #S1: Configure SDK and fetch positions
    await setWhirlpoolsConfig('solanaMainnet');
    const rpcEndpoint = conn.endpoint;
    const rpc = createSolanaRpc(mainnet(rpcEndpoint));
    const connection = new Connection(rpcEndpoint);
    const ownerAddress = kitAddress(owner.toBase58());

    // Initialize WhirlpoolClient
    const walletAdapter = {
      publicKey: owner,
      signTransaction: async (tx: any) => tx,
      signAllTransactions: async (txs: any[]) => txs,
    };
    const ctx = WhirlpoolContext.from(
      connection,
      walletAdapter,
      ORCA_WHIRLPOOL_PROGRAM_ID
    );
    const client = buildWhirlpoolClient(ctx);

    // Fetch positions using the proper RPC client
    const positions = await fetchPositionsForOwner(rpc, ownerAddress);
    console.log(`[whirlpool] found ${positions.length} positions`);
    
    if (positions.length === 0) {
      return [];
    }

    const exposures: Exposure[] = [];
    const poolCache = new Map();
    const tokenAddresses = new Set<string>();

    // Process each position - First pass to collect token addresses
    for (const pos of positions) {
      try {
        if (!('data' in pos) || !('whirlpool' in pos.data)) {
          continue;
        }

        // Get pool data (with caching)
        const poolAddr = pos.data.whirlpool.toString();
        let pool = poolCache.get(poolAddr);
        if (!pool) {
          pool = await client.getPool(pos.data.whirlpool);
          if (!pool) {
            continue;
          }
          poolCache.set(poolAddr, pool);
        }

        const tokenAInfo = pool.getTokenAInfo();
        const tokenBInfo = pool.getTokenBInfo();
        const tokenAAddress = tokenAInfo.mint.toBase58();
        const tokenBAddress = tokenBInfo.mint.toBase58();
        
        // Collect token addresses for price fetching
        tokenAddresses.add(tokenAAddress);
        tokenAddresses.add(tokenBAddress);
      } catch (error) {
        console.error(
          `[whirlpool] error identifying tokens for position ${pos.address.toString()}:`,
          error
        );
      }
    }

    // Fetch prices for all tokens in a single API call
    console.log(`[whirlpool] fetching prices for ${tokenAddresses.size} tokens`);
    const tokenPrices = await getTokenPrices(Array.from(tokenAddresses));
    console.log(`[whirlpool] prices fetched successfully`);

    // Display fetched prices for debugging
    Object.entries(tokenPrices).forEach(([address, price]) => {
      console.log(`Token ${address.slice(0, 8)}... price: $${price.toFixed(4)}`);
    });

    // Process each position with price data
    for (const pos of positions) {
      try {
        if (!('data' in pos) || !('whirlpool' in pos.data)) {
          console.log(`Skipping malformed position: ${pos.address.toString()}`);
          continue;
        }

        console.log(`✓ Processing Whirlpool position ${pos.address.toString()}`);

        // Get pool data (with caching)
        const poolAddr = pos.data.whirlpool.toString();
        let pool = poolCache.get(poolAddr);
        if (!pool) {
          pool = await client.getPool(pos.data.whirlpool);
          if (!pool) {
            console.warn('Pool not found:', poolAddr);
            continue;
          }
          poolCache.set(poolAddr, pool);
        }

        const tokenAInfo = pool.getTokenAInfo();
        const tokenBInfo = pool.getTokenBInfo();
        const tokenAAddress = tokenAInfo.mint.toBase58();
        const tokenBAddress = tokenBInfo.mint.toBase58();
        
        // Get token metadata
        const [metaA, metaB] = await Promise.all([
          getTokenMetadata(connection, tokenAAddress),
          getTokenMetadata(connection, tokenBAddress),
        ]);

        // Get symbols and decimals (with fallbacks)
        const symA = metaA?.symbol ?? tokenAAddress.slice(0, 4);
        const symB = metaB?.symbol ?? tokenBAddress.slice(0, 4);

        // Calculate amounts using pool's token info
        const { a: amountA, b: amountB } = calcAmounts(
          pos.data,
          pool
        );

        // For consistency with SonarWatch, we order tokens by address
        // But preserve the original token amounts to match pool's token order
        const shouldSwapOrder = tokenAAddress > tokenBAddress;
        const [token1, token2] = shouldSwapOrder ? [symB, symA] : [symA, symB];
        const [amount1, amount2] = shouldSwapOrder ? [amountB, amountA] : [amountA, amountB];
        const [addr1, addr2] = shouldSwapOrder ? [tokenBAddress, tokenAAddress] : [tokenAAddress, tokenBAddress];

        // Get token prices and calculate values
        const token1Price = tokenPrices[addr1] || 0;
        const token2Price = tokenPrices[addr2] || 0;
        const token1Value = amount1.toNumber() * token1Price;
        const token2Value = amount2.toNumber() * token2Price;
        const totalValue = token1Value + token2Value;

        // Create exposure object with proper token ordering, amounts, and values
        exposures.push({
          dex: "orca-whirlpool",
          pool: `${token1}-${token2}`,
          positionAddress: pos.address.toString(),
          tokenA: token1,
          tokenB: token2,
          qtyA: amount1.toNumber(),
          qtyB: amount2.toNumber(),
          tokenAAddress: addr1,
          tokenBAddress: addr2,
          tokenAPrice: token1Price,
          tokenBPrice: token2Price,
          tokenAValue: token1Value,
          tokenBValue: token2Value,
          totalValue: totalValue,
          poolAddress: poolAddr
        });

        console.log(`  ✅ Added position ${pos.address.toString()}: ${token1}-${token2} (A=${amount1.toFixed(6)}, B=${amount2.toFixed(6)})`);
        console.log(`     Value: $${token1Value.toFixed(2)} + $${token2Value.toFixed(2)} = $${totalValue.toFixed(2)}`);
      } catch (error) {
        console.error(
          `[whirlpool] error processing position ${pos.address.toString()}:`,
          error
        );
      }
    }

    return exposures;
  } catch (error) {
    console.error("[whirlpool] error fetching positions:", error);
    return [];
  }
}
