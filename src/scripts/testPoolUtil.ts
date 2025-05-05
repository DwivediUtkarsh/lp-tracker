// Test script to understand how the Orca SDK's PoolUtil works

import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { 
  buildWhirlpoolClient, 
  PDAUtil, 
  PoolUtil, 
  TickArrayUtil, 
  ORCA_WHIRLPOOL_PROGRAM_ID 
} from '@orca-so/whirlpools-sdk';
import { loadEnv } from '../utils/env.js';
import { ReliableConnection } from '../utils/solana.js';

// Sample position and pool addresses
const SAMPLE_POSITION = 'CTnbL7vTsDab2R4wWteYb6FmaAG18maWsFBfBL629XoL';

async function main() {
  // Load env and set up connections
  loadEnv();
  console.log('Using Solana RPC endpoint:', process.env.RPC_ENDPOINT);
  
  const rpcEndpoint = process.env.RPC_ENDPOINT as string;
  const connection = new ReliableConnection(rpcEndpoint);
  
  // Create the whirlpool client
  const whirlpoolClient = buildWhirlpoolClient(connection);
  
  try {
    // Get position
    console.log(`Fetching position data for ${SAMPLE_POSITION}...`);
    const positionPubkey = new PublicKey(SAMPLE_POSITION);
    const position = await whirlpoolClient.getPosition(positionPubkey);
    const positionData = position.getData();
    
    // Get the pool
    console.log(`Fetching pool data...`);
    const poolPubkey = positionData.whirlpool;
    const pool = await whirlpoolClient.getPool(poolPubkey);
    const poolData = pool.getData();
    
    // Get the tick data
    console.log('Fetching tick arrays...');
    const fetcher = whirlpoolClient.getFetcher();
    
    // Calculate the tick arrays
    const lowerTickArrayPubkey = PDAUtil.getTickArrayFromTickIndex(
      positionData.tickLowerIndex,
      poolData.tickSpacing,
      poolPubkey,
      ORCA_WHIRLPOOL_PROGRAM_ID
    ).publicKey;
    
    const upperTickArrayPubkey = PDAUtil.getTickArrayFromTickIndex(
      positionData.tickUpperIndex,
      poolData.tickSpacing,
      poolPubkey,
      ORCA_WHIRLPOOL_PROGRAM_ID
    ).publicKey;
    
    console.log(`Lower tick array: ${lowerTickArrayPubkey.toBase58()}`);
    console.log(`Upper tick array: ${upperTickArrayPubkey.toBase58()}`);
    
    const [lowerRaw, upperRaw] = await fetcher.getTickArrays([
      lowerTickArrayPubkey,
      upperTickArrayPubkey
    ]);
    
    // Check available functions on TickArrayUtil
    console.log('Available methods on TickArrayUtil:', Object.getOwnPropertyNames(TickArrayUtil));
    
    // Check available functions on PoolUtil
    console.log('Available methods on PoolUtil:', Object.getOwnPropertyNames(PoolUtil));
    
    // Try to deserialize the tick arrays
    try {
      // Find the right method to deserialize tick arrays
      if ('deserialize' in TickArrayUtil) {
        console.log('Using TickArrayUtil.deserialize');
        // @ts-ignore - Method may not exist in this SDK version
        const lowerTA = TickArrayUtil.deserialize(lowerRaw.data);
        // @ts-ignore
        const upperTA = TickArrayUtil.deserialize(upperRaw.data);
        console.log('Successfully deserialized tick arrays');
      } else if ('fromTickArrayData' in TickArrayUtil) {
        console.log('Using TickArrayUtil.fromTickArrayData');
        // @ts-ignore
        const lowerTA = TickArrayUtil.fromTickArrayData(lowerRaw.data, lowerTickArrayPubkey);
        // @ts-ignore
        const upperTA = TickArrayUtil.fromTickArrayData(upperRaw.data, upperTickArrayPubkey);
        console.log('Successfully created tick arrays from data');
      } else {
        console.log('No deserialize method found on TickArrayUtil');
      }
    } catch (err) {
      console.error('Error deserializing tick arrays:', err);
    }
    
    // Try to use PoolUtil
    try {
      if ('getPositionFeesAndRewards' in PoolUtil) {
        console.log('PoolUtil.getPositionFeesAndRewards is available');
      } else {
        console.log('PoolUtil.getPositionFeesAndRewards not found');
        
        // Check what other methods are available
        for (const method of Object.getOwnPropertyNames(PoolUtil)) {
          if (typeof PoolUtil[method] === 'function') {
            console.log(`- ${method}`);
          }
        }
      }
    } catch (err) {
      console.error('Error using PoolUtil:', err);
    }
    
  } catch (error) {
    console.error('Error:', error);
  }
}

main().catch(console.error);
