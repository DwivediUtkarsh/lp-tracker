import { PublicKey, Connection } from "@solana/web3.js";
import { RPC_ENDPOINT } from "./config.js";
import { ReliableConnection } from "./utils/solana.js";
import {
  getRaydiumExposures,
  preloadRaydiumPools,
} from "./services/raydiumService.js";
import { getWhirlpoolExposures } from "./services/whirlpoolService.js";
import { getDirectLPPositions } from "./services/directLPService.js";
import { saveExposureToDatabase, getPositionsForWallet, getOrCreateToken, getOrCreateWallet } from "./db/models.js";
import { getWalletTokens, preloadJupiterTokens } from "./utils/tokenUtils.js";
import { query } from "./utils/database.js";
import { enrichPositionsWithPrices, updateTokenPricesInDb, getTokenPrices } from "./services/priceService.js";

// Maximum execution time (5 minutes)
const MAX_EXECUTION_TIME = 5 * 60 * 1000;

async function bootstrapStaticPools() {
  console.log("Starting bootstrapStaticPools...");
  try {
    // Pre‑fetch & cache pool registries so that the first wallet query is instant
    console.log("Skipping Raydium pools pre-fetching...");
    // Commented out to focus on Orca Whirlpools
    // await Promise.all([preloadRaydiumPools()]);
    console.log("Completed bootstrapStaticPools");
  } catch (error) {
    console.error("Error in bootstrapStaticPools:", error);
  }
}

async function main(): Promise<void> {
  // Set a global timeout to prevent infinite execution
  const timeoutId = setTimeout(() => {
    console.error("Execution timed out after", MAX_EXECUTION_TIME / 1000, "seconds");
    process.exit(1);
  }, MAX_EXECUTION_TIME);
  
  console.log("=== LP-TRACKER STARTING ===");
  console.log("Bootstrapping static pools...");
  try {
    await bootstrapStaticPools();
  } catch (error) {
    console.error("Error in bootstrapStaticPools:", error);
  }

  const [, , walletArg, action = "fetch"] = process.argv;
  if (!walletArg) {
    console.error("Usage: npm run dev <WALLET_PUBKEY> [action]");
    clearTimeout(timeoutId);
    process.exit(1);
  }

  console.log(`Processing action: ${action} for wallet: ${walletArg}`);
  
  let wallet;
  try {
    wallet = new PublicKey(walletArg);
  } catch (error) {
    console.error("Invalid wallet public key:", error);
    clearTimeout(timeoutId);
    process.exit(1);
  }
  
  const walletAddress = wallet.toBase58();
  console.log("🔗 RPC endpoint:", RPC_ENDPOINT);
  console.log("👛 Wallet:", walletAddress, "\n");

  // Shared connection objects
  console.log("Establishing Solana connections...");
  let connection, conn;
  try {
    connection = new Connection(RPC_ENDPOINT, "confirmed");
    conn = new ReliableConnection(RPC_ENDPOINT);
    console.log("Solana connections established");
  } catch (error) {
    console.error("Failed to establish Solana connections:", error);
    clearTimeout(timeoutId);
    process.exit(1);
  }

  // Preload Jupiter tokens to optimize metadata fetching for all commands
  try {
    await preloadJupiterTokens();
  } catch (error) {
    console.warn("Warning: Failed to preload Jupiter tokens. Continuing without preloaded data.");
  }

  /* ---------------------------------------------------------------------
     ACTION SWITCH
  --------------------------------------------------------------------- */
  console.log(`Executing action: ${action}`);
  
  try {
    switch (action) {
      case "whirlpools": {
        console.log("Fetching Whirlpool exposures...");
        try {
          const whirl = await getWhirlpoolExposures(conn, wallet);
          console.log("Whirlpool exposures fetched successfully");
          console.table(
            whirl.map((p) => ({
              DEX: p.dex,
              Pool: p.pool,
              [p.tokenA]: p.qtyA.toFixed(6),
              [p.tokenB]: p.qtyB.toFixed(6),
            }))
          );
        } catch (error) {
          console.error("Error fetching Whirlpool exposures:", error);
        }
        break;
      }

      case "tokens": {
        console.log("Fetching wallet tokens...");
        try {
          const tokens = await getWalletTokens(connection, walletAddress);
          console.log("Wallet tokens fetched successfully");
          
          // Filter out zero-value tokens
          const nonZeroTokens = tokens.filter(t => t.balance > 0);
          console.log(`Found ${nonZeroTokens.length} non-zero tokens in wallet`);
          
          // Get addresses for price lookup
          const tokenAddresses = nonZeroTokens.map(t => t.mint);
          
          // Fetch token prices
          console.log("Fetching token prices...");
          const prices = await getTokenPrices(tokenAddresses);
          
          // Create display data with value calculations
          const tokenData = nonZeroTokens.map(t => {
            // Ensure price is a valid number
            const price = typeof prices[t.mint] === 'number' ? prices[t.mint] : 0;
            const value = price * t.balance;
            
            return {
              Symbol: t.symbol || 'Unknown',
              Amount: t.balance.toFixed(6),
              Price: price > 0 ? `$${price.toFixed(4)}` : 'N/A',
              Value: value > 0 ? `$${value.toFixed(2)}` : 'N/A',
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
          const totalTokenValue = nonZeroTokens.reduce((sum, t) => {
            const price = typeof prices[t.mint] === 'number' ? prices[t.mint] : 0;
            return sum + (price * t.balance);
          }, 0);
          
          console.log(`\nTotal Token Value: $${totalTokenValue.toFixed(2)}`);
          
          // Show original token data (limited to 10 per page)
          console.log(`\nDetailed Token Info (limited to 10 per page):`);
          for (let i = 0; i < tokens.length; i += 10) {
            const chunk = tokens.slice(i, i + 10);
            console.log(`\n--- Tokens ${i+1} to ${Math.min(i+10, tokens.length)} ---`);
            console.table(chunk);
          }
          
          const lpTokens = tokens.filter(t => t.isLPToken);
          if (lpTokens.length > 0) {
            console.log(`\n--- Found ${lpTokens.length} Liquidity Pool tokens ---`);
            console.table(lpTokens);
          }
        } catch (error) {
          console.error("Error fetching wallet tokens:", error);
        }
        break;
      }

      case "direct": {
        console.log("Fetching direct LP positions...");
        try {
          const positions = await getDirectLPPositions(connection, walletAddress);
          console.log("Direct LP positions fetched successfully");
          console.table(positions);
        } catch (error) {
          console.error("Error fetching direct LP positions:", error);
        }
        break;
      }

      case "directsave": {
        console.log("Fetching direct LP positions for DB save...");
        try {
          const positions = await getDirectLPPositions(connection, walletAddress);
          // (db‑save logic unchanged)
          // ...
          console.log("Direct LP positions saved to DB");
        } catch (error) {
          console.error("Error saving direct LP positions:", error);
        }
        break;
      }

      case "prices": {
        console.log("Enriching positions with prices...");
        try {
          const saved = await getPositionsForWallet(walletAddress);
          if (!saved.length) {
            console.log("No LP positions in DB – run fetch first");
            break;
          }
          console.log(`Found ${saved.length} positions, enriching with prices...`);
          const enriched = await enrichPositionsWithPrices(saved);
          console.log("Positions enriched with prices");
          console.table(enriched);
          const total = enriched.reduce((s, p) => s + p.total_value, 0);
          console.log(`\nTotal: $${total.toFixed(2)}`);
          console.log("Updating token prices in DB...");
          await updateTokenPricesInDb();
          console.log("Token prices updated in DB");
        } catch (error) {
          console.error("Error processing prices:", error);
        }
        break;
      }

      case "db": {
        console.log("Fetching positions from DB...");
        try {
          const rows = await getPositionsForWallet(walletAddress);
          console.log(`Found ${rows.length} positions in DB`);
          console.table(rows);
        } catch (error) {
          console.error("Error fetching positions from DB:", error);
        }
        break;
      }

      // default → full fetch + DB save
      default: {
        console.log("Performing full fetch (Orca Whirlpools only)...");
        try {
          console.log("Fetching Whirlpool exposures...");
          const whirl = await getWhirlpoolExposures(conn, wallet);
          console.log("Exposures fetched successfully");

          const rows = [...whirl];
          if (!rows.length) {
            console.log("No LP positions detected.");
            break;
          }
          console.log(`Found ${rows.length} LP positions`);
          console.table(
            rows.map((r) => ({
              DEX: r.dex,
              Pool: r.pool,
              [r.tokenA]: r.qtyA.toFixed(6),
              [r.tokenB]: r.qtyB.toFixed(6),
            }))
          );

          console.log("Saving exposures to database...");
          let savedCount = 0;
          for (const exposure of rows) {
            await saveExposureToDatabase(exposure, walletAddress);
            savedCount++;
            console.log(`Saved ${savedCount}/${rows.length} exposures`);
          }
          console.log("✔️  All exposures saved to DB");
        } catch (error) {
          console.error("Error in full fetch process:", error);
        }
        break;
      }
    }
  } catch (error) {
    console.error("Unhandled error in main execution:", error);
  } finally {
    // Clear the timeout
    clearTimeout(timeoutId);
  }
}

// Handle unhandled rejections
process.on('unhandledRejection', (reason, promise) => {
  console.error('Unhandled Rejection at:', promise, 'reason:', reason);
});

console.log("Starting main...");
main().catch(error => {
  console.error("Uncaught error in main:", error);
  process.exit(1);
});
