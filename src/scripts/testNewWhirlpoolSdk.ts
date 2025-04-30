// import { fetchPositionsForOwner, setWhirlpoolsConfig } from '@orca-so/whirlpools';
// import { createSolanaRpc, mainnet, address } from '@solana/kit';
// import dotenv from "dotenv";

// // Load environment variables
// dotenv.config();

// async function testWhirlpoolPositions() {
//   try {
//     // Configure for mainnet
//     await setWhirlpoolsConfig('solanaMainnet');
    
//     // Get RPC URL from environment variables or use default
//     const rpcUrl = process.env.SOLANA_RPC || 
//                    "https://mainnet.helius-rpc.com/?api-key=8ef0cd1b-026b-44ef-a6db-afed9d9d27e5";
    
//     console.log(`Using RPC endpoint: ${rpcUrl}`);
//     const mainnetRpc = createSolanaRpc(mainnet(rpcUrl));
    
//     // Set the wallet address
//     const owner = address("Ao8worHr46EMrrvYDrstStkmAQkZa5KvSPPWAEDrWGk8");
//     console.log(`Fetching Whirlpool positions for wallet: ${owner.toString()}`);
    
//     // Fetch positions for the owner
//     const positions = await fetchPositionsForOwner(mainnetRpc, owner);
    
//     // Display results
//     console.log(`Found ${positions.length} Whirlpool positions`);
    
//     if (positions.length === 0) {
//       console.log("No positions found for this wallet");
//     } else {
//       positions.forEach((position, i) => {
//         console.log(`Position ${i + 1}:`);
//         console.log(`  Position address: ${position.address.toString()}`);
//         console.log(`  Whirlpool address: ${position.data.whirlpool.toString()}`);
//         console.log(`  Liquidity: ${position.data.liquidity.toString()}`);
//         console.log(`  Fee owed A: ${position.data.feeOwedA.toString()}`);
//         console.log(`  Fee owed B: ${position.data.feeOwedB.toString()}`);
//       });
//     }
    
//     return positions;
//   } catch (error) {
//     console.error("Error fetching Whirlpool positions:", error);
//     if (error instanceof Error) {
//       console.error("Error details:", error.message);
//     }
//     return [];
//   }
// }

// // Run the test
// testWhirlpoolPositions().then(
//   () => console.log("Test completed"),
//   (err) => console.error("Test failed:", err)
// ); 