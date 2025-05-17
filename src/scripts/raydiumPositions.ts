/**
 * Script to fetch and display Raydium CLMM positions for a given wallet
 * 
 * Usage: npm run raydium <WALLET_PUBKEY>
 */

import { PublicKey } from '@solana/web3.js';
import dotenv from 'dotenv';
import { Decimal } from 'decimal.js';

import { ReliableConnection } from '../utils/solana.js';
import { getRaydiumPositions } from '../services/raydiumHeliusService.js';
import { getRaydiumUncollectedFees } from '../services/raydiumFeeCalc.js';

// Load environment config
console.log('Loading environment config...');
dotenv.config();

// Parse command line arguments
const walletArg = process.argv[2];
   
if (!walletArg) {
  console.error('Usage: npm run raydium <WALLET_PUBKEY>');
  process.exit(1);
}

// Set up connection and wallet
const wallet = new PublicKey(walletArg);
const walletAddress = wallet.toBase58();
const rpcEndpoint = process.env.RPC_ENDPOINT || 'https://api.mainnet-beta.solana.com';
console.log(`Using Solana RPC endpoint: ${rpcEndpoint}`);
console.log('🔗 RPC endpoint:', rpcEndpoint);
console.log('👛 Wallet:', walletAddress, '\n');

// Create connections
const conn = new ReliableConnection(rpcEndpoint);

async function main() {
  try {
    console.log('Fetching Raydium CLMM positions...');
    
    // Use the improved Helius implementation
    const positions = await getRaydiumPositions(walletAddress);
    
    if (positions.length === 0) {
      console.log('No Raydium CLMM positions found for this wallet.');
      return;
    }
    
    // Display positions
    console.log(`Found ${positions.length} Raydium CLMM positions:`);
    
    // Show basic position information
    console.table(
      positions.map(pos => {
        const qtyA_D = new Decimal(pos.qtyA || 0);
        const qtyB_D = new Decimal(pos.qtyB || 0);
        return {
          Pair: pos.pool,
          TokenA: pos.tokenA,
          AmountA: qtyA_D.toFixed(8),
          TokenB: pos.tokenB,
          AmountB: qtyB_D.toFixed(8),
          InRange: pos.inRange ? '✓' : '✗',
          PositionID: pos.positionId?.slice(0, 8) + '...' || 'N/A'
        };
      })
    );
    
    // Display positions with valuation
    console.log('\n=== Position Values ===');
    console.table(
      positions.map(pos => {
        const qtyA_D = new Decimal(pos.qtyA || 0);
        const qtyB_D = new Decimal(pos.qtyB || 0);
        const feesOwed0_D = new Decimal(pos.feesOwed0 || 0);
        const feesOwed1_D = new Decimal(pos.feesOwed1 || 0);

        const totalQtyA = qtyA_D.plus(feesOwed0_D);
        const totalQtyB = qtyB_D.plus(feesOwed1_D);

        const tokenAPrice = pos.tokenAPrice || 0;
        const tokenBPrice = pos.tokenBPrice || 0;

        const tokenAValueNum = totalQtyA.mul(tokenAPrice).toNumber();
        const tokenBValueNum = totalQtyB.mul(tokenBPrice).toNumber();
        const positionTotalValueNum = tokenAValueNum + tokenBValueNum;

        return {
          Pair: pos.pool,
          [pos.tokenA]: totalQtyA.toFixed(8), 
          [`${pos.tokenA} Value`]: tokenAPrice !== 0 ? `$${tokenAValueNum.toFixed(2)}` : 'N/A',
          [pos.tokenB]: totalQtyB.toFixed(8),
          [`${pos.tokenB} Value`]: tokenBPrice !== 0 ? `$${tokenBValueNum.toFixed(2)}` : 'N/A',
          ['Position Value']: `$${positionTotalValueNum.toFixed(2)}` 
        };
      })
    );
    
    // Calculate and display total value across all positions
    const totalPortfolioValueLiquidityOnly = positions.reduce((sum, pos) => {
      // Calculate from individual token values
      const qtyA_D = new Decimal(pos.qtyA || 0);
      const qtyB_D = new Decimal(pos.qtyB || 0);
      const tokenAPrice = pos.tokenAPrice || 0;
      const tokenBPrice = pos.tokenBPrice || 0;
      
      return sum + qtyA_D.mul(tokenAPrice).toNumber() + qtyB_D.mul(tokenBPrice).toNumber();
    }, 0);
    console.log(`\n💰 Total Portfolio Value (Liquidity Only): $${totalPortfolioValueLiquidityOnly.toFixed(2)}`);
    
    // Fetch and display uncollected fees using the new accurate calculator
    console.log('\n=== Calculating Uncollected Fees (Using Uniswap V3 Fee Math) ===');
    console.log('This may take a moment as we fetch on-chain data...');
    
    // Debug: Log info about positions to help with tracing
    console.log('\nPosition IDs we need to match:');
    positions.forEach(pos => {
      console.log(`- ${pos.positionId || 'undefined'} (pool: ${pos.pool})`);
    });
    
    // Pass the already fetched positions to avoid fetching them again
    const fees = await getRaydiumUncollectedFees(conn, wallet, positions);
    
    // Debug: Show the fee results we got back
    if (fees.length > 0) {
      console.log('\nPosition IDs from fee calculation:');
      fees.forEach(fee => {
        console.log(`- ${fee.positionAddress} (pool: ${fee.poolAddress})`);
      });
    }
    
    if (fees.length === 0) {
      console.log('No uncollected fees found or calculation failed.');
    } else {
      console.log(`Found fee data for ${fees.length} positions.`);
      
      // Create a map for quick position lookup
      const feeMap = new Map(fees.map(fee => [fee.positionAddress, fee]));
      
      // Display uncollected fees
      console.log('\n=== Uncollected Fees (Exact Calculation) ===');
      console.table(
        positions.map(pos => {
          // Skip positions without a position address
          if (!pos.positionAddress) {
            return {
              Pair: pos.pool,
              [`${pos.tokenA} Fees`]: '0.00000000',
              [`${pos.tokenA} Fees Value`]: '$0.00',
              [`${pos.tokenB} Fees`]: '0.00000000',
              [`${pos.tokenB} Fees Value`]: '$0.00',
              ['Total Fees Value']: '$0.00'
            };
          }
          
          // Use the position address for matching fees
          const fee = feeMap.get(pos.positionAddress);
          
          if (!fee) {
            return {
              Pair: pos.pool,
              [`${pos.tokenA} Fees`]: '0.00000000',
              [`${pos.tokenA} Fees Value`]: '$0.00',
              [`${pos.tokenB} Fees`]: '0.00000000',
              [`${pos.tokenB} Fees Value`]: '$0.00',
              ['Total Fees Value']: '$0.00'
            };
          }
          
          return {
            Pair: pos.pool,
            [`${pos.tokenA} Fees`]: fee.feeA.toFixed(8),
            [`${pos.tokenA} Fees Value`]: fee.feeAUsd ? `$${fee.feeAUsd.toFixed(2)}` : '$0.00',
            [`${pos.tokenB} Fees`]: fee.feeB.toFixed(8),
            [`${pos.tokenB} Fees Value`]: fee.feeBUsd ? `$${fee.feeBUsd.toFixed(2)}` : '$0.00',
            ['Total Fees Value']: fee.totalUsd ? `$${fee.totalUsd.toFixed(2)}` : '$0.00'
          };
        })
      );
      
      // Calculate total fees value
      const totalUncollectedFeesValue = fees.reduce((sum, fee) => sum + (fee.totalUsd || 0), 0);
      console.log(`\n💸 Total Uncollected Fees: $${totalUncollectedFeesValue.toFixed(2)}`);
      
      // Grand total with fees
      console.log(`\n💰 Grand Total (Portfolio Value + Fees): $${(totalPortfolioValueLiquidityOnly + totalUncollectedFeesValue).toFixed(2)}`);
    }
    
  } catch (error) {
    console.error('Error fetching Raydium positions:', error);
    process.exit(1);
  }
}

main().catch(console.error); 