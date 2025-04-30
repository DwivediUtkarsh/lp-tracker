import { PublicKey } from "@solana/web3.js";
import { getWhirlpoolExposures } from "../services/whirlpoolService.js";
import { ReliableConnection } from "../utils/solana.js";
import dotenv from "dotenv";

// Load environment variables
dotenv.config();

async function testWhirlpoolService() {
  // Use the Helius RPC endpoint from environment variables
  const rpcUrl = process.env.SOLANA_RPC || 
                "https://mainnet.helius-rpc.com/?api-key=8ef0cd1b-026b-44ef-a6db-afed9d9d27e5";
  
  console.log(`Using RPC endpoint: ${rpcUrl}`);
  const connection = new ReliableConnection(rpcUrl);
  
  // Get wallet address from command line arguments or use default
  const walletAddressArg = process.argv[2] || "Ao8worHr46EMrrvYDrstStkmAQkZa5KvSPPWAEDrWGk8";
  const walletAddress = new PublicKey(walletAddressArg);
  
  console.log(`Testing getWhirlpoolExposures for wallet: ${walletAddress.toBase58()}`);
  
  try {
    const exposures = await getWhirlpoolExposures(connection, walletAddress);
    
    if (exposures.length === 0) {
      console.log("No Whirlpool positions found for this wallet");
    } else {
      console.log(`Found ${exposures.length} Whirlpool positions:`);
      exposures.forEach((exposure, i) => {
        console.log(`Position ${i + 1}:`);
        console.log(`  Pool: ${exposure.pool}`);
        console.log(`  Token A: ${exposure.tokenA}, Quantity: ${exposure.qtyA}`);
        console.log(`  Token B: ${exposure.tokenB}, Quantity: ${exposure.qtyB}`);
      });
    }
  } catch (error) {
    console.error("Error testing Whirlpool service:", error);
    if (error instanceof Error) {
      console.error("Error details:", error.message);
    }
  }
}

// Run the test
testWhirlpoolService().then(
  () => console.log("Test completed"),
  (err) => console.error("Test failed:", err)
); 