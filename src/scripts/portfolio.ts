/**
 * Complete Portfolio Dashboard
 * 
 * Shows a complete portfolio overview with:
 * - Token balances and values
 * - Whirlpool positions and values
 * - Raydium CLMM positions and values
 * - Total portfolio value
 * 
 * Usage: npm run portfolio <WALLET_PUBKEY>
 */

import { PublicKey, Connection } from '@solana/web3.js';
import { ReliableConnection } from '../utils/solana.js';
import { RPC_ENDPOINT } from '../config.js';
import { getWhirlpoolExposures } from '../services/whirlpoolService.js';
import { getRaydiumClmmExposures } from '../services/raydiumClmmService.js';
import { getTokenMetadata, getWalletTokens } from '../utils/tokenUtils.js';
import { enrichPositionsWithPrices, getTokenPrices } from '../services/priceService.js';
import { getUncollectedFees } from '../services/whirlpoolRewardsService.js';
import { getRaydiumUncollectedFees } from '../services/raydiumClmmRewardsService.js';

async function main() {
  // Parse command line arguments
  const [, , walletArg] = process.argv;
  
  if (!walletArg) {
    console.error('Usage: npm run portfolio <WALLET_PUBKEY>');
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
    const connection = new Connection(RPC_ENDPOINT);
    
    console.log('📊 FETCHING COMPLETE PORTFOLIO 📊');
    console.log('===============================\n');
    
    let totalPortfolioValue = 0;
    let whirlpoolRewards: any[] = [];
    let raydiumRewards: any[] = [];
    
    // PART 1: Fetch wallet tokens
    console.log('PART 1: TOKENS');
    console.log('--------------');
    
    const tokens = await getWalletTokens(connection, walletAddress);
    console.log("Wallet tokens fetched successfully");
    
    // Filter out zero-value tokens
    const nonZeroTokens = tokens.filter(t => t.balance > 0);
    console.log(`Found ${nonZeroTokens.length} non-zero tokens in wallet`);
    
    // Get addresses for price lookup
    const tokenAddresses = nonZeroTokens.map(t => t.mint);
    
    // Fetch token prices - use whirlpool prices if available
    console.log("Fetching token prices...");
    let prices: Record<string, number> = {}; 
    let totalTokenValue = 0;

    // Attempt to get prices multiple ways to improve success rate
    try {
      // Define important known tokens to prioritize fetching
      const knownTokenPrices: Record<string, number> = {
        'So11111111111111111111111111111111111111112': 150.0, // SOL approximate price
        'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 1.0,  // USDC is pegged to $1
        'Es9vMFrzaCERmJfrF4H2FYD4KCoNkY11McCe8BenwNYB': 1.0,  // USDT is pegged to $1
      };
      
      // Step 1: First fetch prices for important tokens (SOL, USDC, USDT)
      const priorityTokens = tokenAddresses.filter(addr => 
        Object.keys(knownTokenPrices).includes(addr)
      );
      
      if (priorityTokens.length > 0) {
        console.log("Fetching prices for priority tokens first...");
        const priorityPrices = await getTokenPrices(priorityTokens);
        prices = {...prices, ...priorityPrices};
        
        // Apply fallbacks for any priority tokens that failed
        priorityTokens.forEach(addr => {
          if (!prices[addr] && knownTokenPrices[addr]) {
            console.log(`Using fallback price for ${addr.slice(0, 8)}...`);
            prices[addr] = knownTokenPrices[addr];
          }
        });
        
        // Give the API a short break
        console.log("Waiting before fetching remaining tokens...");
        await new Promise(r => setTimeout(r, 1500));
      }

      // Step 2: Fetch remaining tokens in small batches
      const remainingTokens = tokenAddresses.filter(addr => 
        !priorityTokens.includes(addr)
      );
      
      if (remainingTokens.length > 0) {
        console.log(`Fetching remaining ${remainingTokens.length} tokens in batches...`);
        
        // Create batches of tokens to fetch (maximum 3 per batch to avoid rate limits)
        const BATCH_SIZE = 3;
        for (let i = 0; i < remainingTokens.length; i += BATCH_SIZE) {
          const batch = remainingTokens.slice(i, i + BATCH_SIZE);
          console.log(`Fetching batch ${Math.floor(i/BATCH_SIZE) + 1}/${Math.ceil(remainingTokens.length/BATCH_SIZE)}...`);
          
          try {
            const batchPrices = await getTokenPrices(batch);
            prices = {...prices, ...batchPrices};
            
            // Give the API a break between batches
            if (i + BATCH_SIZE < remainingTokens.length) {
              console.log("Waiting between batches...");
              await new Promise(r => setTimeout(r, 2000));
            }
          } catch (error) {
            console.error(`Error fetching batch ${Math.floor(i/BATCH_SIZE) + 1}:`, error);
          }
        }
      }

      console.log("Token prices fetched successfully!");
      
      // Show the prices we got
      console.log("Fetched token prices:");
      let pricesFound = 0;
      Object.entries(prices).forEach(([mint, price]) => {
        if (price > 0) {
          const token = nonZeroTokens.find(t => t.mint === mint);
          const symbol = token?.symbol || mint.slice(0, 8);
          console.log(`${symbol}: $${price.toFixed(4)}`);
          pricesFound++;
        }
      });
      console.log(`Successfully fetched prices for ${pricesFound}/${tokenAddresses.length} tokens`);
    } catch (error) {
      console.error("Error fetching token prices, using fallback values:", error);
    }
    
    // Create display data with value calculations
    const tokenData = nonZeroTokens.map(t => {
      // Ensure price is a valid number
      const price = typeof prices[t.mint] === 'number' ? prices[t.mint] : 0;
      const value = price * t.balance;
      
      // For tokens with no price but non-zero balance, mark them as unknown
      return {
        Symbol: t.symbol || 'Unknown',
        Amount: t.balance.toFixed(6),
        Price: price > 0 ? `$${price.toFixed(4)}` : 'Unknown',
        Value: value > 0 ? `$${value.toFixed(2)}` : (t.balance > 0 ? 'Unknown' : '$0.00'),
        'Is LP': t.isLPToken ? 'Yes' : 'No',
        Address: t.mint.slice(0, 8) + '...'
      };
    });
    
    // Sort by value (descending)
    tokenData.sort((a, b) => {
      const valueA = parseFloat((a.Value || '$0').replace('$', ''));
      const valueB = parseFloat((b.Value || '$0').replace('$', ''));
      return valueB - valueA;
    });
    
    // Print tokens with prices and values
    console.log(`\n--- Tokens with Values ---`);
    console.table(tokenData);
    
    // Calculate total token value
    totalTokenValue = nonZeroTokens.reduce((sum, t) => {
      const price = typeof prices[t.mint] === 'number' ? prices[t.mint] : 0;
      return sum + (price * t.balance);
    }, 0);
    
    console.log(`\n💰 Total Token Value: $${totalTokenValue.toFixed(2)}`);
    totalPortfolioValue += totalTokenValue;
    
    // PART 2: Fetch whirlpool positions
    console.log('\n\nPART 2: WHIRLPOOL POSITIONS');
    console.log('---------------------------');
    
    // Fetch whirlpool exposures
    const whirlpoolPositions = await getWhirlpoolExposures(conn, wallet);
    
    if (whirlpoolPositions.length === 0) {
      console.log('No Orca Whirlpool positions found for this wallet.');
    } else {
      // Display positions
      console.log(`Found ${whirlpoolPositions.length} Orca Whirlpool positions:`);
      
      // Show basic position information
      console.table(
        whirlpoolPositions.map(pos => ({
          Pair: pos.pool,
          TokenA: pos.tokenA,
          AmountA: pos.qtyA.toFixed(6),
          TokenB: pos.tokenB,
          AmountB: pos.qtyB.toFixed(6)
        }))
      );
      
      // Fetch uncollected fees/rewards
      console.log('\nFetching uncollected fees and rewards...');
      whirlpoolRewards = await getUncollectedFees(conn, wallet);
      console.log(`Found fee data for ${whirlpoolRewards.length} positions`);
      
      // Create a map for quick lookup
      const rewardsMap = new Map(
        whirlpoolRewards.map(reward => [reward.positionAddress, reward])
      );
      
      // Get unique token addresses to fetch prices for
      const uniqueTokenAddresses = new Set<string>();
      whirlpoolPositions.forEach(pos => {
        uniqueTokenAddresses.add(pos.tokenAAddress);
        uniqueTokenAddresses.add(pos.tokenBAddress);
      });
      
      console.log('\nFetching price information for positions...');
      console.log('Fetching prices for tokens:', 
        Array.from(uniqueTokenAddresses).map(addr => addr.slice(0, 8) + '...').join(', '));
      
      // Convert to the format expected by the price service
      const dbFormatPositions = whirlpoolPositions.map((pos, index) => ({
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
      const totalWhirlpoolValue = enrichedPositions.reduce((sum, pos) => sum + (pos.total_value || 0), 0);
      console.log(`\n💰 Total Whirlpool Value: $${totalWhirlpoolValue.toFixed(2)}`);
      totalPortfolioValue += totalWhirlpoolValue;
      
      // Display uncollected fees
      console.log('\n=== Uncollected Fees (Rewards) ===');
      const feesData = whirlpoolPositions.map(pos => {
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
      const totalFeesValue = whirlpoolRewards.reduce((sum: number, reward) => sum + (reward.totalUsd || 0), 0);
      console.log(`\n💸 Total Uncollected Fees: $${totalFeesValue.toFixed(2)}`);
      
      // Add fees to portfolio total
      totalPortfolioValue += totalFeesValue;
    }
    
    // PART 3: Fetch Raydium CLMM positions
    console.log('\n\nPART 3: RAYDIUM CLMM POSITIONS');
    console.log('-----------------------------');
    
    // Fetch Raydium CLMM exposures
    const raydiumPositions = await getRaydiumClmmExposures(conn, wallet);
    
    if (raydiumPositions.length === 0) {
      console.log('No Raydium CLMM positions found for this wallet.');
    } else {
      // Display positions
      console.log(`Found ${raydiumPositions.length} Raydium CLMM positions:`);
      
      // Show basic position information
      console.table(
        raydiumPositions.map(pos => ({
          Pair: pos.pool,
          TokenA: pos.tokenA,
          AmountA: pos.qtyA.toFixed(6),
          TokenB: pos.tokenB,
          AmountB: pos.qtyB.toFixed(6)
        }))
      );
      
      // Fetch uncollected fees/rewards
      console.log('\nFetching uncollected fees and rewards...');
      raydiumRewards = await getRaydiumUncollectedFees(conn, wallet);
      console.log(`Found fee data for ${raydiumRewards.length} positions`);
      
      // Create a map for quick lookup
      const rewardsMap = new Map(
        raydiumRewards.map(reward => [reward.positionAddress, reward])
      );
      
      // Get unique token addresses to fetch prices for
      const uniqueTokenAddresses = new Set<string>();
      raydiumPositions.forEach(pos => {
        uniqueTokenAddresses.add(pos.tokenAAddress);
        uniqueTokenAddresses.add(pos.tokenBAddress);
      });
      
      console.log('\nFetching price information for positions...');
      console.log('Fetching prices for tokens:', 
        Array.from(uniqueTokenAddresses).map(addr => addr.slice(0, 8) + '...').join(', '));
      
      // Convert to the format expected by the price service
      const dbFormatPositions = raydiumPositions.map((pos, index) => ({
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
      const totalRaydiumValue = enrichedPositions.reduce((sum, pos) => sum + (pos.total_value || 0), 0);
      console.log(`\n💰 Total Raydium CLMM Value: $${totalRaydiumValue.toFixed(2)}`);
      totalPortfolioValue += totalRaydiumValue;
      
      // Display uncollected fees
      console.log('\n=== Uncollected Fees (Rewards) ===');
      const feesData = raydiumPositions.map(pos => {
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
      const totalRaydiumFeesValue = raydiumRewards.reduce((sum: number, reward) => sum + (reward.totalUsd || 0), 0);
      console.log(`\n💸 Total Uncollected Fees: $${totalRaydiumFeesValue.toFixed(2)}`);
      
      // Add fees to portfolio total
      totalPortfolioValue += totalRaydiumFeesValue;
    }
    
    // PART 4: Portfolio Summary
    console.log('\n\n📈 PORTFOLIO SUMMARY 📈');
    console.log('=======================');
    console.log(`Token Value:     $${totalTokenValue.toFixed(2)}`);
    
    // Calculate whirlpool value and fees separately
    const whirlpoolPositionValue = whirlpoolPositions.length > 0 ? 
      whirlpoolPositions.reduce((sum, pos) => sum + (pos.totalValue || 0), 0) : 0;
    const whirlpoolFeesValue = whirlpoolRewards.length > 0 ? 
      whirlpoolRewards.reduce((sum: number, reward) => sum + (reward.totalUsd || 0), 0) : 0;
    
    // Calculate Raydium CLMM value and fees separately
    const raydiumPositionValue = raydiumPositions.length > 0 ?
      raydiumPositions.reduce((sum, pos) => sum + (pos.totalValue || 0), 0) : 0;
    const raydiumFeesValue = raydiumRewards.length > 0 ?
      raydiumRewards.reduce((sum: number, reward) => sum + (reward.totalUsd || 0), 0) : 0;
    
    console.log(`Whirlpool Value: $${whirlpoolPositionValue.toFixed(2)}`);
    console.log(`Raydium CLMM Value: $${raydiumPositionValue.toFixed(2)}`);
    console.log(`Uncollected Fees: $${(whirlpoolFeesValue + raydiumFeesValue).toFixed(2)}`);
    console.log('------------------------------');
    console.log(`TOTAL VALUE:     $${totalPortfolioValue.toFixed(2)}`);
    
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