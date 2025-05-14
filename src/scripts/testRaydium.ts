import { PublicKey } from '@solana/web3.js';
import * as raydium from '@raydium-io/raydium-sdk-v2';
import 'dotenv/config';

import { ReliableConnection } from '../utils/solana.js';
import { getRaydiumClmmExposures } from '../services/raydiumClmmService.js';
import { RPC_ENDPOINT } from '../config.js';

(async () => {
  try {
    const args = process.argv.slice(2);
    if (args.length < 1) {
      console.log('Usage: tsx src/scripts/testRaydium.ts <WALLET_PUBKEY>');
      process.exit(1);
    }

    const walletAddress = args[0];
    const owner = new PublicKey(walletAddress);
    
    console.log('Testing Raydium CLMM position detection...');
    console.log('Wallet:', walletAddress);
    console.log('RPC Endpoint:', RPC_ENDPOINT);

    // Method 1: Use our updated service
    console.log('\n=== Using our updated service ===');
    const conn = new ReliableConnection(RPC_ENDPOINT);
    const positions = await getRaydiumClmmExposures(conn, owner);
    
    console.log(`Found ${positions.length} positions with our service`);
    if (positions.length > 0) {
      console.table(
        positions.map(pos => ({
          Pool: pos.pool,
          TokenA: pos.tokenA,
          AmountA: pos.qtyA.toFixed(6),
          TokenB: pos.tokenB,
          AmountB: pos.qtyB.toFixed(6),
          Value: `$${pos.totalValue.toFixed(2)}`
        }))
      );
    }

    // Skip the Raydium SDK direct test - requires more configuration
  } catch (error) {
    console.error('Error:', error);
    process.exit(1);
  }
})(); 