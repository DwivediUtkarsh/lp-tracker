/**
 * Script to fetch and display Orca Whirlpool positions for a given wallet
 * 
 * Usage: npm run whirlpools <WALLET_PUBKEY>
 */

import { PublicKey, Connection } from '@solana/web3.js'
import { ReliableConnection } from '../utils/solana.js'
import { RPC_ENDPOINT } from '../config.js'
import { getWhirlpoolExposures } from '../services/whirlpoolService.js'
import { getTokenMetadata } from '../utils/tokenUtils.js'
import { enrichPositionsWithPrices } from '../services/priceService.js'
import { getUncollectedFees } from '../services/whirlpoolRewardsService.js'

// No-op wallet for read-only operations
class ReadOnlyWallet {
  constructor(readonly publicKey: PublicKey) {}
  async signTransaction(tx: any) { return tx; }
  async signAllTransactions(txs: any[]) { return txs; }
}

interface ProcessedPosition {
  pool: string;
  tokenA: string;
  tokenB: string;
  qtyA: number;
  qtyB: number;
}

async function main() {
  // Parse command line arguments
  const [, , walletArg] = process.argv;
  
  if (!walletArg) {
    console.error('Usage: npm run whirlpools <WALLET_PUBKEY>');
    process.exit(1);
  }
  
  try {
    // Set up connection and wallet
    const wallet = new PublicKey(walletArg);
    const walletAddress = wallet.toBase58();
    console.log('🔗 RPC endpoint:', RPC_ENDPOINT);
    console.log('👛 Wallet:', walletAddress, '\n');
    
    // Create connections
    const conn = new ReliableConnection(RPC_ENDPOINT);
    
    console.log('Fetching Orca Whirlpool positions...');
    
    // Fetch whirlpool exposures
    const positions = await getWhirlpoolExposures(conn, wallet);
    
    if (positions.length === 0) {
      console.log('No Orca Whirlpool positions found for this wallet.');
      return;
    }
    
    // Display positions
    console.log(`Found ${positions.length} Orca Whirlpool positions:`);
    
    // Show basic position information
    console.table(
      positions.map(pos => ({
        Pair: pos.pool,
        TokenA: pos.tokenA,
        AmountA: pos.qtyA.toFixed(6),
        TokenB: pos.tokenB,
        AmountB: pos.qtyB.toFixed(6)
      }))
    );
    
    // Fetch uncollected fees/rewards
    console.log('\nFetching uncollected fees and rewards...');
    console.time('rewardsCalculation');
    
    // Create a special wrapper to make conn compatible with SDK
    const rpcWrapper = {
      ...conn,
      getTokenAccountsByOwner: (...args: any[]) => {
        // Add a .send method that just returns the original promise
        const originalPromise = (conn as any).getTokenAccountsByOwner(...args);
        return {
          ...originalPromise,
          send: () => originalPromise
        };
      },
      getMultipleAccounts: (...args: any[]) => {
        // Add a .send method that just returns the original promise
        const originalPromise = (conn as any).getMultipleAccounts(...args);
        return {
          ...originalPromise,
          send: () => originalPromise
        };
      }
    };
    
    const rewards = await getUncollectedFees(rpcWrapper as any, wallet);
    console.timeEnd('rewardsCalculation');
    console.log(`Found fee data for ${rewards.length} positions`);
    
    // Debug: print position IDs
    console.log('\nPosition IDs from whirlpoolExposures:');
    for (const pos of positions) {
      console.log(`- ${pos.positionAddress} (pool: ${pos.pool})`);
    }
    
    // Debug: print reward IDs 
    console.log('\nPosition IDs from fees/rewards:');
    for (const reward of rewards) {
      console.log(`- ${reward.positionAddress} (pool: ${reward.poolAddress})`);
    }
    
    // Debug: print first reward object details if available
    if (rewards.length > 0) {
      console.log('\nFirst reward object:');
      console.log(JSON.stringify(rewards[0], null, 2));
    }
    
    // Debug: display all rewards data
    console.log('\nAll rewards data:');
    for (const reward of rewards) {
      console.log(`Position: ${reward.positionAddress}, Pool: ${reward.poolAddress}`);
      console.log(`   Token A (${reward.tokenASymbol}): ${reward.feeA.toFixed(6)}`);
      console.log(`   Token B (${reward.tokenBSymbol}): ${reward.feeB.toFixed(6)}`);
    }
    
    // Try alternative matching approach
    console.log('\nAttempting to match positions by pool address...');
    const rewardsByPool = new Map();
    for (const reward of rewards) {
      rewardsByPool.set(reward.poolAddress, reward);
    }
    
    for (const pos of positions) {
      const reward = rewardsByPool.get(pos.pool);
      if (reward) {
        console.log(`Match found for position ${pos.positionAddress} via pool ${pos.pool}`);
      }
    }
    
    // Create a map for quick lookup
    const rewardsMap = new Map(
      rewards.map(reward => [reward.positionAddress, reward])
    );
    
    // Try to enrich with price data if available
    try {
      console.log('\nFetching price information...');
      
      // Get unique token addresses to fetch prices for
      const uniqueTokenAddresses = new Set<string>();
      positions.forEach(pos => {
        uniqueTokenAddresses.add(pos.tokenAAddress);
        uniqueTokenAddresses.add(pos.tokenBAddress);
      });
      
      console.log('Fetching prices for tokens:', 
        Array.from(uniqueTokenAddresses).map(addr => addr.slice(0, 8) + '...').join(', '));
      
      // Convert to the format expected by the price service
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
      
      // Enrich with prices
      const enrichedPositions = await enrichPositionsWithPrices(dbFormatPositions);
      
      // Display with value information
      console.log('\n=== Position Values ===');
      console.table(
        enrichedPositions.map(p => ({
          Pair: `${p.token_a_symbol}-${p.token_b_symbol}`,
          [`${p.token_a_symbol}`]: p.qty_a.toFixed(4),
          [`${p.token_a_symbol} Value`]: p.qty_a > 0 ? `$${p.token_a_value?.toFixed(2) || '0.00'}` : '-',
          [`${p.token_b_symbol}`]: p.qty_b.toFixed(4),
          [`${p.token_b_symbol} Value`]: p.qty_b > 0 ? `$${p.token_b_value?.toFixed(2) || '0.00'}` : '-',
          ['Position Value']: `$${p.total_value?.toFixed(2) || '0.00'}`
        }))
      );
      
      // Calculate and display total value across all positions
      const totalValue = enrichedPositions.reduce((sum, pos) => sum + (pos.total_value || 0), 0);
      console.log(`\n💰 Total Portfolio Value: $${totalValue.toFixed(2)}`);
      
      // Display uncollected fees
      console.log('\n=== Uncollected Fees (Rewards) ===');
      const feesData = positions.map(pos => {
        const reward = rewardsMap.get(pos.positionAddress);
        return {
          Pair: pos.pool,
          [`${pos.tokenA} Fees`]: reward ? reward.feeA.toFixed(6) : '-',
          [`${pos.tokenA} Fees Value`]: reward?.feeAUsd ? `$${reward.feeAUsd.toFixed(2)}` : '-',
          [`${pos.tokenB} Fees`]: reward ? reward.feeB.toFixed(6) : '-',
          [`${pos.tokenB} Fees Value`]: reward?.feeBUsd ? `$${reward.feeBUsd.toFixed(2)}` : '-',
          ['Total Fees Value']: reward?.totalUsd ? `$${reward.totalUsd.toFixed(2)}` : '-',
        };
      });
      console.table(feesData);
      
      // Calculate total fees value
      const totalFeesValue = rewards.reduce((sum, reward) => sum + (reward.totalUsd || 0), 0);
      console.log(`\n💸 Total Uncollected Fees: $${totalFeesValue.toFixed(2)}`);
      
      // Grand total with fees
      console.log(`\n💰 Total Value + Fees: $${(totalValue + totalFeesValue).toFixed(2)}`);
      
    } catch (err: unknown) {
      if (err instanceof Error) {
        console.log('Could not fetch price information:', err.message);
      } else {
        console.log('Could not fetch price information:', String(err));
      }
    }
    
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error('Error:', error.message);
    } else {
      console.error('Error:', String(error));
    }
    process.exit(1);
  }
}

main().catch(console.error); 