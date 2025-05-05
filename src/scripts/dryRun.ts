/**
 * Dry Run Testing Script
 * 
 * This script simulates the LP tracking workflow without writing to the database.
 * It's useful for testing and validating behavior before committing changes.
 * 
 * Features:
 * - Simulates position, fee, and liquidity event detection
 * - Validates API responses and parsing logic
 * - Reports detailed metrics about what would be recorded
 * - Estimates database size growth
 * 
 * Usage: npm run dry-run <WALLET_PUBKEY> [--txn-limit <NUMBER>] [--with-fees] [--verbose]
 */

import { PublicKey } from '@solana/web3.js';
import { ReliableConnection } from '../utils/solana.js';
import { RPC_ENDPOINT } from '../config.js';
import { getWhirlpoolExposures } from '../services/whirlpoolService.js';
import { fetchWalletTransactions, parseWhirlpoolTransaction, TransactionType } from '../services/historicalIndexingService.js';
import { getTokenPrices } from '../services/priceService.js';
import { getUncollectedFees, WhirlpoolReward } from '../services/whirlpoolRewardsService.js';

// Mock DB stats for size estimation
interface DBSizeEstimate {
  tables: {
    [tableName: string]: {
      rowCount: number;
      rowSizeBytes: number;
      totalSizeBytes: number;
    }
  };
  totalSizeBytes: number;
  formattedSize: string;
}

// Convert bytes to human-readable format
function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 Bytes';
  
  const k = 1024;
  const sizes = ['Bytes', 'KB', 'MB', 'GB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  
  return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

// Estimate DB size based on transaction and position counts
function estimateDatabaseSize(positions: number, transactions: number, feeEvents: number, liquidityEvents: number, swapEvents: number): DBSizeEstimate {
  // These are rough estimates based on typical Postgres row sizes
  const walletRowSize = 250; // 1 row per wallet
  const tokenRowSize = 800;  // ~10 tokens (addresses, metadata, etc)
  const poolRowSize = 400;   // ~5 pools with fee rate, etc
  const positionRowSize = 500;
  const feeEventRowSize = 600;
  const liquidityEventRowSize = 700;
  const swapEventRowSize = 550;
  
  // Estimate how many tokens based on positions (usually 2 per position but with overlap)
  const estimatedTokens = Math.min(Math.ceil(positions * 1.3), 20);
  
  // Estimate pools (usually 1 pool per 1-2 positions)
  const estimatedPools = Math.ceil(positions * 0.7);
  
  // Calculate sizes
  const walletTableSize = walletRowSize;
  const tokenTableSize = estimatedTokens * tokenRowSize;
  const poolTableSize = estimatedPools * poolRowSize;
  const positionTableSize = positions * positionRowSize;
  const feeEventTableSize = feeEvents * feeEventRowSize;
  const liquidityEventTableSize = liquidityEvents * liquidityEventRowSize;
  const swapEventTableSize = swapEvents * swapEventRowSize;
  
  const totalSize = walletTableSize + tokenTableSize + poolTableSize + 
                   positionTableSize + feeEventTableSize + 
                   liquidityEventTableSize + swapEventTableSize;
  
  return {
    tables: {
      wallets: { rowCount: 1, rowSizeBytes: walletRowSize, totalSizeBytes: walletTableSize },
      tokens: { rowCount: estimatedTokens, rowSizeBytes: tokenRowSize, totalSizeBytes: tokenTableSize },
      pools: { rowCount: estimatedPools, rowSizeBytes: poolRowSize, totalSizeBytes: poolTableSize },
      positions: { rowCount: positions, rowSizeBytes: positionRowSize, totalSizeBytes: positionTableSize },
      fee_events: { rowCount: feeEvents, rowSizeBytes: feeEventRowSize, totalSizeBytes: feeEventTableSize },
      liquidity_events: { rowCount: liquidityEvents, rowSizeBytes: liquidityEventRowSize, totalSizeBytes: liquidityEventTableSize },
      swap_events: { rowCount: swapEvents, rowSizeBytes: swapEventRowSize, totalSizeBytes: swapEventTableSize }
    },
    totalSizeBytes: totalSize,
    formattedSize: formatBytes(totalSize)
  };
}

async function main() {
  console.log('🧪 LP-Tracker Dry Run Testing Tool 🧪\n');
  
  // Parse command line arguments
  const args = process.argv.slice(2);
  const walletArg = args[0];
  
  if (!walletArg || walletArg.startsWith('--')) {
    console.error('Usage: npm run dry-run <WALLET_PUBKEY> [--txn-limit <NUMBER>] [--with-fees] [--verbose]');
    process.exit(1);
  }
  
  // Parse flags
  const verbose = args.includes('--verbose');
  const withFees = args.includes('--with-fees');
  
  // Always show detailed fee events for this run
  const showDetailedFeeEvents = true; // Override for this run
  
  const txnLimitIndex = args.indexOf('--txn-limit');
  const txnLimit = txnLimitIndex >= 0 && args.length > txnLimitIndex + 1 
    ? parseInt(args[txnLimitIndex + 1], 10) 
    : 25; // Default to 25 transactions for a dry run
  
  try {
    const startTime = Date.now();
    
    // Set up connection and wallet
    const wallet = new PublicKey(walletArg);
    const walletAddress = wallet.toBase58();
    
    console.log('Dry Run Configuration:');
    console.log('🔗 RPC endpoint:', RPC_ENDPOINT);
    console.log('👛 Wallet:', walletAddress);
    console.log(`📜 Transaction limit: ${txnLimit}`);
    console.log(`🔍 Verbose mode: ${verbose ? 'Enabled' : 'Disabled'}`);
    console.log(`💰 Fee calculation: ${withFees ? 'Enabled' : 'Disabled'}\n`);
    
    const conn = new ReliableConnection(RPC_ENDPOINT);
    
    // SIMULATION PHASE 1: Position Discovery
    console.log('Phase 1: Simulating Position Discovery...');
    
    console.log('Fetching current Whirlpool positions...');
    const startPositionTime = Date.now();
    const positions = await getWhirlpoolExposures(conn, wallet);
    const positionTime = Date.now() - startPositionTime;
    
    console.log(`Found ${positions.length} Whirlpool positions in ${positionTime}ms`);
    
    if (verbose && positions.length > 0) {
      console.log('\nPosition Details:');
      positions.forEach((pos, index) => {
        console.log(`  [${index + 1}] ${pos.tokenA}-${pos.tokenB} Pool`);
        console.log(`      Address: ${pos.positionAddress.slice(0, 10)}...`);
        console.log(`      Amounts: ${pos.qtyA.toFixed(6)} ${pos.tokenA}, ${pos.qtyB.toFixed(6)} ${pos.tokenB}`);
      });
    }
    
    // SIMULATION PHASE 2: Transaction Discovery & Parsing
    console.log('\nPhase 2: Simulating Transaction Processing...');
    
    const startTxTime = Date.now();
    console.log(`Fetching ${txnLimit} most recent transactions...`);
    const transactions = await fetchWalletTransactions(walletAddress, txnLimit);
    const txnTime = Date.now() - startTxTime;
    
    console.log(`Fetched ${transactions.length} transactions in ${txnTime}ms`);
    
    // Analyze transactions
    const startParseTime = Date.now();
    console.log('Analyzing transactions to detect events...');
    
    // Collect token mints for price lookups
    const tokenAddresses = new Set<string>();
    positions.forEach(pos => {
      tokenAddresses.add(pos.tokenAAddress);
      tokenAddresses.add(pos.tokenBAddress);
    });
    
    // Initialize event counters
    const eventCounts = {
      feeEvents: 0,
      liquidityEvents: 0,
      swapEvents: 0,
      openPositionEvents: 0,
      closePositionEvents: 0,
      unknownEvents: 0
    };
    
    // Track cumulative token amounts
    const feeAmounts: {[token: string]: number} = {};
    const liquidityAmounts: {[token: string]: number} = {};
    
    // Track events for detailed output
    const events: {
      feeEvents?: Array<{
        txSignature: string;
        timestamp: Date;
        positionAddress: string;
        poolAddress: string;
        tokenAmounts: any;
        matchedPosition: any;
      }>;
      liquidityEvents?: any[];
      swapEvents?: any[];
    } = {};
    
    // Process each transaction
    for (const tx of transactions) {
      const parsedTx = parseWhirlpoolTransaction(tx);
      
      if (!parsedTx.type) {
        eventCounts.unknownEvents++;
        continue;
      }
      
      // Map transaction to position(s)
      let matchedPositions: typeof positions = [];
      
      // Simple matching logic
      if (parsedTx.positionAddress) {
        matchedPositions = positions.filter(p => p.positionAddress === parsedTx.positionAddress);
      } else if (parsedTx.poolAddress) {
        matchedPositions = positions.filter(p => p.poolAddress === parsedTx.poolAddress);
      }
      
      // If we have token mints from the tx, add them to our price lookup list
      if (parsedTx.tokenAmounts?.tokenA?.mint) {
        tokenAddresses.add(parsedTx.tokenAmounts.tokenA.mint);
      }
      
      if (parsedTx.tokenAmounts?.tokenB?.mint) {
        tokenAddresses.add(parsedTx.tokenAmounts.tokenB.mint);
      }
      
      // Count by type and collect token amounts
      if (parsedTx.type === TransactionType.CollectFees) {
        eventCounts.feeEvents++;
        
        // Accumulate fee amounts by token
        if (parsedTx.tokenAmounts?.tokenA) {
          const tokenMint = parsedTx.tokenAmounts.tokenA.mint;
          feeAmounts[tokenMint] = (feeAmounts[tokenMint] || 0) + parsedTx.tokenAmounts.tokenA.amount;
        }
        
        if (parsedTx.tokenAmounts?.tokenB) {
          const tokenMint = parsedTx.tokenAmounts.tokenB.mint;
          feeAmounts[tokenMint] = (feeAmounts[tokenMint] || 0) + parsedTx.tokenAmounts.tokenB.amount;
        }

        // Store detailed fee event info for later display
        if (showDetailedFeeEvents) {
          // Create a detailed fee event record
          const feeEvent = {
            txSignature: tx.signature,
            timestamp: new Date(tx.timestamp * 1000),
            positionAddress: parsedTx.positionAddress || 'Unknown',
            poolAddress: parsedTx.poolAddress || 'Unknown',
            tokenAmounts: parsedTx.tokenAmounts,
            matchedPosition: matchedPositions.length > 0 ? matchedPositions[0] : null
          };
          
          // Store this in a collection we'll display in detail later
          if (!events.feeEvents) events.feeEvents = [];
          events.feeEvents.push(feeEvent);
        }
      } 
      else if (parsedTx.type === TransactionType.IncreaseLiquidity || parsedTx.type === TransactionType.DecreaseLiquidity) {
        eventCounts.liquidityEvents++;
        
        // Accumulate liquidity amounts by token
        if (parsedTx.tokenAmounts?.tokenA) {
          const tokenMint = parsedTx.tokenAmounts.tokenA.mint;
          liquidityAmounts[tokenMint] = (liquidityAmounts[tokenMint] || 0) + parsedTx.tokenAmounts.tokenA.amount;
        }
        
        if (parsedTx.tokenAmounts?.tokenB) {
          const tokenMint = parsedTx.tokenAmounts.tokenB.mint;
          liquidityAmounts[tokenMint] = (liquidityAmounts[tokenMint] || 0) + parsedTx.tokenAmounts.tokenB.amount;
        }
      } 
      else if (parsedTx.type === TransactionType.Swap) {
        eventCounts.swapEvents++;
      }
      else if (parsedTx.type === TransactionType.OpenPosition) {
        eventCounts.openPositionEvents++;
      }
      else if (parsedTx.type === TransactionType.ClosePosition) {
        eventCounts.closePositionEvents++;
      }
      
      if (verbose) {
        console.log(`\nTransaction ${tx.signature.slice(0, 10)}... (${new Date(tx.timestamp * 1000).toLocaleString()})`);
        console.log(`  Type: ${parsedTx.type}`);
        console.log(`  Matched Positions: ${matchedPositions.length > 0 ? matchedPositions.map(p => p.positionAddress.slice(0, 8)).join(', ') : 'None'}`);
        
        if (parsedTx.tokenAmounts) {
          if (parsedTx.tokenAmounts.tokenA) {
            console.log(`  Token A: ${parsedTx.tokenAmounts.tokenA.amount.toFixed(6)} units`);
          }
          if (parsedTx.tokenAmounts.tokenB) {
            console.log(`  Token B: ${parsedTx.tokenAmounts.tokenB.amount.toFixed(6)} units`);
          }
        }
      }
    }
    
    const parseTime = Date.now() - startParseTime;
    console.log(`Parsed ${transactions.length} transactions in ${parseTime}ms`);
    
    // PHASE 4: Price Calculation
    console.log('\nPhase 4: Simulating Price Enrichment...');
    
    const startPriceTime = Date.now();
    const tokenPrices = await getTokenPrices(Array.from(tokenAddresses));
    const priceTime = Date.now() - startPriceTime;
    
    console.log(`Fetched prices for ${Object.keys(tokenPrices).length} tokens in ${priceTime}ms`);
    
    // Calculate fee values in USD
    let totalFeeValueUsd = 0;
    Object.entries(feeAmounts).forEach(([tokenMint, amount]) => {
      const price = tokenPrices[tokenMint] || 0;
      const valueUsd = amount * price;
      totalFeeValueUsd += valueUsd;
      
      if (verbose && amount > 0) {
        console.log(`  Fee: ${amount.toFixed(6)} ${tokenMint.slice(0, 8)}... ≈ $${valueUsd.toFixed(2)}`);
      }
    });
    
    // Display detailed fee event information
    if (showDetailedFeeEvents && events.feeEvents && events.feeEvents.length > 0) {
      console.log('\n===== DETAILED FEE EVENTS =====');
      events.feeEvents.forEach((event, index) => {
        console.log(`\nFee Event #${index + 1}:`);
        console.log(`  Transaction: ${event.txSignature.slice(0, 10)}...`);
        console.log(`  Timestamp: ${event.timestamp.toLocaleString()}`);
        console.log(`  Position: ${event.positionAddress.slice(0, 10)}...`);
        console.log(`  Pool: ${event.poolAddress.slice(0, 10)}...`);
        
        // Display token information with symbols if available
        if (event.tokenAmounts) {
          if (event.tokenAmounts.tokenA) {
            const tokenPrice = tokenPrices[event.tokenAmounts.tokenA.mint] || 0;
            const usdValue = event.tokenAmounts.tokenA.amount * tokenPrice;
            // Try to get symbol from matched position
            let symbolA = 'Unknown';
            if (event.matchedPosition && event.matchedPosition.tokenA) {
              symbolA = event.matchedPosition.tokenA;
            }
            console.log(`  Token A: ${event.tokenAmounts.tokenA.amount.toFixed(6)} ${symbolA} (≈$${usdValue.toFixed(2)})`);
          }
          
          if (event.tokenAmounts.tokenB) {
            const tokenPrice = tokenPrices[event.tokenAmounts.tokenB.mint] || 0;
            const usdValue = event.tokenAmounts.tokenB.amount * tokenPrice;
            // Try to get symbol from matched position
            let symbolB = 'Unknown';
            if (event.matchedPosition && event.matchedPosition.tokenB) {
              symbolB = event.matchedPosition.tokenB;
            }
            console.log(`  Token B: ${event.tokenAmounts.tokenB.amount.toFixed(6)} ${symbolB} (≈$${usdValue.toFixed(2)})`);
          }
        }
      });
    }
    
    // PHASE 3: Fee Calculation (if requested)
    let uncollectedFees: WhirlpoolReward[] = [];
    if (withFees) {
      console.log('\nPhase 3: Simulating Fee Calculation...');
      
      const startFeeTime = Date.now();
      uncollectedFees = await getUncollectedFees(conn, wallet);
      const feeTime = Date.now() - startFeeTime;
      
      console.log(`Calculated fees for ${uncollectedFees.length} positions in ${feeTime}ms`);
      
      if (verbose && uncollectedFees.length > 0) {
        console.log('\nUncollected Fee Details:');
        uncollectedFees.forEach((fee, index) => {
          console.log(`  [${index + 1}] ${fee.tokenASymbol}-${fee.tokenBSymbol} Position`);
          console.log(`      Address: ${fee.positionAddress.slice(0, 10)}...`);
          console.log(`      Fees: ${fee.feeA.toFixed(6)} ${fee.tokenASymbol}, ${fee.feeB.toFixed(6)} ${fee.tokenBSymbol}`);
          console.log(`      USD Value: $${fee.totalUsd?.toFixed(2) || '0.00'}`);
        });
      }
    }
    
    // PHASE 5: Database Size Estimation
    console.log('\nPhase 5: Estimating Database Footprint...');
    
    const sizeEstimate = estimateDatabaseSize(
      positions.length,
      transactions.length,
      eventCounts.feeEvents,
      eventCounts.liquidityEvents,
      eventCounts.swapEvents
    );
    
    // RESULTS
    const totalTime = Date.now() - startTime;
    console.log('\n===== DRY RUN SUMMARY =====');
    
    console.log('\nMetrics:');
    console.log(`⏱️ Total execution time: ${totalTime}ms`);
    console.log(`🏊‍♂️ Positions found: ${positions.length}`);
    console.log(`📝 Transactions analyzed: ${transactions.length}`);
    console.log(`💰 Fee events detected: ${eventCounts.feeEvents}`);
    console.log(`⚖️ Liquidity events detected: ${eventCounts.liquidityEvents}`);
    console.log(`🔄 Swap events detected: ${eventCounts.swapEvents}`);
    
    if (uncollectedFees.length > 0) {
      const totalUncollectedUsd = uncollectedFees.reduce((sum, fee) => sum + (fee.totalUsd || 0), 0);
      console.log(`💵 Uncollected fees: $${totalUncollectedUsd.toFixed(2)}`);
    }
    
    if (totalFeeValueUsd > 0) {
      console.log(`💹 Historical fees: $${totalFeeValueUsd.toFixed(2)}`);
    }
    
    console.log('\nDatabase Size Estimation:');
    console.log(`📦 Total estimated size: ${sizeEstimate.formattedSize}`);
    
    console.log('\nTable Estimates:');
    Object.entries(sizeEstimate.tables).forEach(([table, stats]) => {
      console.log(`  ${table}: ${stats.rowCount} rows, ${formatBytes(stats.totalSizeBytes)}`);
    });
    
    console.log('\n🎯 Dry run completed successfully. No database changes were made.');
    console.log('To perform an actual sync, use the following commands:');
    console.log(`  - npm run sync-positions ${walletAddress}  # Sync positions only`);
    console.log(`  - npm run resync ${walletAddress}          # Full data resync`);
    console.log(`  - npm run index-fees ${walletAddress}      # Index fee events only`);
    
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
