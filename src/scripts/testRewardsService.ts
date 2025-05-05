/**
 * Script to test the whirlpool rewards service
 * 
 * Usage: npm run test:rewards <WALLET_PUBKEY>
 */

import { PublicKey } from '@solana/web3.js';
import { ReliableConnection } from '../utils/solana.js';
import { RPC_ENDPOINT } from '../config.js';
import { getUncollectedFees } from '../services/whirlpoolRewardsService.js';

async function main() {
  // Parse command line arguments
  const [, , walletArg] = process.argv;
  
  if (!walletArg) {
    console.error('Usage: npm run test:rewards <WALLET_PUBKEY>');
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
    
    console.log('Directly testing whirlpoolRewardsService...');
    console.time('rewardsCalculation');
    const rewards = await getUncollectedFees(conn, wallet);
    console.timeEnd('rewardsCalculation');
    
    console.log(`Found ${rewards.length} positions with fee data`);
    
    if (rewards.length > 0) {
      console.log('\nDetailed rewards data:');
      rewards.forEach((reward, i) => {
        console.log(`\n--- Position ${i+1} ---`);
        console.log(`Position: ${reward.positionAddress}`);
        console.log(`Pool: ${reward.poolAddress}`);
        console.log(`Tokens: ${reward.tokenASymbol}/${reward.tokenBSymbol}`);
        console.log(`${reward.tokenASymbol} Fees: ${reward.feeA}`);
        console.log(`${reward.tokenBSymbol} Fees: ${reward.feeB}`);
        if (reward.feeAUsd !== undefined) console.log(`${reward.tokenASymbol} Fees USD: $${reward.feeAUsd.toFixed(2)}`);
        if (reward.feeBUsd !== undefined) console.log(`${reward.tokenBSymbol} Fees USD: $${reward.feeBUsd.toFixed(2)}`);
        if (reward.totalUsd !== undefined) console.log(`Total Fees USD: $${reward.totalUsd.toFixed(2)}`);
        if (reward.apr !== undefined) console.log(`Estimated APR: ${reward.apr.toFixed(2)}%`);
      });
      
      // Calculate total fees
      const totalFees = rewards.reduce((sum, reward) => sum + (reward.totalUsd || 0), 0);
      console.log(`\n💸 Total Uncollected Fees: $${totalFees.toFixed(2)}`);
    } else {
      console.log('No fee data found for this wallet.');
    }
  } catch (error: unknown) {
    if (error instanceof Error) {
      console.error('Error:', error.message);
      console.error(error.stack);
    } else {
      console.error('Error:', String(error));
    }
    process.exit(1);
  }
}

main().catch(console.error);
