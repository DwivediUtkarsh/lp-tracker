import { PublicKey } from "@solana/web3.js";
import { getWhirlpoolExposures } from "../services/whirlpoolService.js";
import { ReliableConnection } from "../utils/solana.js";

async function testWhirlpoolService() {
  // Set up a connection to the Solana network
  const rpcUrl = process.env.RPC_URL || "https://api.mainnet-beta.solana.com";
  const connection = new ReliableConnection(rpcUrl);
  
  // Example wallet that might have Orca Whirlpool positions
  // Replace with a known wallet address that has Whirlpool positions for better testing
  const walletAddress = new PublicKey("FG4Y3yX4AAchp1HvNZ7LfzFTewF2f6nBsJMwpVCQZ6P4");
  
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
  }
}

// Run the test
testWhirlpoolService().then(
  () => console.log("Test completed"),
  (err) => console.error("Test failed:", err)
); 