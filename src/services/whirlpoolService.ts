// ── src/services/whirlpoolService.ts ───────────────────────────────────────
/**
 * This service handles interactions with Orca Whirlpool liquidity pools.
 * It directly fetches position data for a wallet using the Orca SDK's fetchPositionsForOwner function.
 */
import { PublicKey, Connection } from "@solana/web3.js";
import { ReliableConnection } from "../utils/solana.js";
import { Exposure } from "../types/Exposure.js";
import { fetchPositionsForOwner, setWhirlpoolsConfig } from '@orca-so/whirlpools';
import { createSolanaRpc, mainnet, address } from '@solana/kit';
import { getTokenMetadata } from "../utils/tokenUtils.js";
import { Decimal } from 'decimal.js';
import BN from 'bn.js';
import {
  WhirlpoolContext,
  buildWhirlpoolClient,
  ORCA_WHIRLPOOL_PROGRAM_ID,
  PriceMath,
} from "@orca-so/whirlpools-sdk";

// Constants for price and liquidity calculations
const Q64 = new BN(1).shln(64);
const protocolFeeRate = new Decimal(0.01); // 1%

function sqrtPriceX64ToPrice(sqrtPriceX64: BN, decimalsA: number, decimalsB: number): Decimal {
  const price = new Decimal(sqrtPriceX64.toString())
    .div(new Decimal(2).pow(64))
    .pow(2);
  
  return price.mul(new Decimal(10).pow(decimalsA - decimalsB));
}

function getTokenAmounts(
  posData: any,
  poolData: any,
  decimalA: number,
  decimalB: number
): { amountA: number; amountB: number } {
  try {
    const liquidity = new BN(posData.liquidity.toString());
    const currentTick = poolData.tickCurrentIndex;
    const lowerTick = posData.tickLowerIndex;
    const upperTick = posData.tickUpperIndex;
    
    // Get sqrt prices
    const currentSqrtPrice = poolData.sqrtPrice;
    const lowerSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(lowerTick);
    const upperSqrtPrice = PriceMath.tickIndexToSqrtPriceX64(upperTick);
    
    let amountA = new BN(0);
    let amountB = new BN(0);

    if (currentTick < lowerTick) {
      // Below range - all token A
      const priceDiff = upperSqrtPrice.sub(lowerSqrtPrice);
      amountA = liquidity.mul(priceDiff).div(lowerSqrtPrice);
    } else if (currentTick < upperTick) {
      // Within range - both tokens
      const upperDiff = upperSqrtPrice.sub(currentSqrtPrice);
      amountA = liquidity.mul(upperDiff).div(currentSqrtPrice);
      amountB = liquidity.mul(currentSqrtPrice.sub(lowerSqrtPrice)).div(Q64);
    } else {
      // Above range - all token B
      amountB = liquidity.mul(upperSqrtPrice.sub(lowerSqrtPrice)).div(Q64);
    }

    // Convert to proper decimal scaling and add fees
    const rawAmountA = new Decimal(amountA.toString()).div(new Decimal(10).pow(decimalA));
    const rawAmountB = new Decimal(amountB.toString()).div(new Decimal(10).pow(decimalB));
    
    // Add fees
    const feeA = new Decimal(posData.feeOwedA.toString()).div(new Decimal(10).pow(decimalA));
    const feeB = new Decimal(posData.feeOwedB.toString()).div(new Decimal(10).pow(decimalB));

    return {
      amountA: rawAmountA.plus(feeA).toNumber(),
      amountB: rawAmountB.plus(feeB).toNumber(),
    };
  } catch (error) {
    console.error("Error calculating token amounts:", error);
    return { amountA: 0, amountB: 0 };
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
    const ownerAddress = address(owner.toBase58());

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

    // Process each position
    for (const pos of positions) {
      try {
        if (!('data' in pos) || !('whirlpool' in pos.data)) {
          console.log(`Skipping position bundle: ${pos.address.toString()}`);
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

        const poolData = pool.getData();
        
        // Get token metadata
        const [metaA, metaB] = await Promise.all([
          getTokenMetadata(poolData.tokenMintA.toBase58()),
          getTokenMetadata(poolData.tokenMintB.toBase58()),
        ]);

        // Get symbols and decimals
        const symA = metaA?.symbol ?? poolData.tokenMintA.toBase58().slice(0, 4);
        const symB = metaB?.symbol ?? poolData.tokenMintB.toBase58().slice(0, 4);
        const decA = metaA?.decimals ?? 6;
        const decB = metaB?.decimals ?? 6;

        // Calculate amounts using updated function
        const { amountA, amountB } = getTokenAmounts(
          pos.data,
          poolData,
          decA,
          decB
        );

        // Create exposure object with position details
        exposures.push({
          dex: "orca-whirlpool",
          pool: `${symB}-${symA}`, // Swap order to match SonarWatch
          tokenA: symB,
          tokenB: symA,
          qtyA: amountB, // Swap amounts to match token order
          qtyB: amountA,
        });

        console.log(`  ✅ Added position ${poolAddr}: ${symB}-${symA} (A=${amountB.toFixed(6)}, B=${amountA.toFixed(6)})`);
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
