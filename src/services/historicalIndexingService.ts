/**
 * HistoricalIndexingService
 * 
 * This service fetches and processes historical transactions for a wallet's
 * Whirlpool positions, indexing fee collection and liquidity change events.
 */

import { Connection, PublicKey } from '@solana/web3.js';
import { ReliableConnection } from '../utils/solana.js';
import { 
  getPositionsForWallet, 
  getOrCreateWallet, 
  recordFeeEvent, 
  recordLiquidityEvent,
  recordSwapEvent,
  getOrCreateToken,
  getOrCreatePool,
  LPPosition,
  LPFeeEvent,
  LiquidityEvent,
  SwapEvent
} from '../db/models.js';
import { query } from '../utils/database.js';
import { getTokenPrices } from './priceService.js';
import { calculateHistoricalFees } from './whirlpoolRewardsService.js';
import * as BN from 'bn.js';

// Constants for Helius API
const HELIUS_API_BASE = 'https://api.helius.xyz/v0';
const HELIUS_API_KEY = process.env.HELIUS_API_KEY || '';

// Known Whirlpool program IDs
const WHIRLPOOL_PROGRAM_ID = 'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc';

// Transaction types we're interested in
export enum TransactionType {
  CollectFees = 'collectFees',
  IncreaseLiquidity = 'increaseLiquidity',
  DecreaseLiquidity = 'decreaseLiquidity',
  OpenPosition = 'openPosition',
  ClosePosition = 'closePosition',
  Swap = 'swap'
}

// Response type for Helius API
export interface HeliusParsedTransaction {
  signature: string;
  timestamp: number;
  slot: number;
  fee: number;
  feePayer: string;
  instructions: Array<{
    accounts: string[];
    data: string;
    programId: string;
    innerInstructions?: Array<{
      accounts: string[];
      data: string;
      programId: string;
    }>;
  }>;
  accountData: Array<{
    account: string;
    nativeBalanceChange: number;
    tokenBalanceChanges: Array<{
      userAccount: string;
      tokenAccount: string;
      mint: string;
      rawTokenAmount: {
        tokenAmount: string;
        decimals: number;
      };
    }>;
  }>;
  events?: {
    swap?: {
      tokenInputs: any[];
      tokenOutputs: any[];
      tokenFees: any[];
      nativeFees: any[];
      innerSwaps: Array<{
        programInfo: {
          source: string;
          account: string;
          programName: string;
          instructionName: string;
        };
      }>;
    };
  };
}

/**
 * Fetches historical transactions for a wallet from Helius API
 */
export async function fetchWalletTransactions(
  walletAddress: string,
  limit: number = 100,
  beforeSignature?: string
): Promise<HeliusParsedTransaction[]> {
  try {
    // Use the Helius REST API directly, not the Solana connection
    let url = `${HELIUS_API_BASE}/addresses/${walletAddress}/transactions?api-key=${HELIUS_API_KEY}&limit=${limit}`;
    
    if (beforeSignature) {
      url += `&before=${beforeSignature}`;
    }
    
    // Double check we're using proper REST API for historical indexing
    console.log(`Fetching transactions from Helius REST API: ${url.replace(HELIUS_API_KEY, 'REDACTED')}`);
    
    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });
    
    if (!response.ok) {
      throw new Error(`Helius API error: ${response.status} ${response.statusText}`);
    }
    
    const transactions = await response.json() as HeliusParsedTransaction[];
    return transactions;
  } catch (error) {
    console.error('Error fetching historical transactions:', error);
    return [];
  }
}

/**
 * Parses a transaction to determine if it's a Whirlpool transaction and what type
 */
export function parseWhirlpoolTransaction(tx: HeliusParsedTransaction): {
  type: TransactionType | null;
  positionAddress?: string;
  poolAddress?: string;
  tokenAmounts?: {
    tokenA?: { mint: string, amount: number };
    tokenB?: { mint: string, amount: number };
  };
} {
  // Check if we have a Whirlpool instruction
  const whirlpoolInstructions = tx.instructions.filter(
    instr => instr.programId === WHIRLPOOL_PROGRAM_ID
  );
  
  // Also check inner instructions
  const allInstructions = [...whirlpoolInstructions];
  tx.instructions.forEach(instr => {
    if (instr.innerInstructions) {
      const innerWhirlpoolInstrs = instr.innerInstructions.filter(
        inner => inner.programId === WHIRLPOOL_PROGRAM_ID
      );
      allInstructions.push(...innerWhirlpoolInstrs);
    }
  });
  
  // Get position and pool addresses from account data if available
  let positionAddress: string | undefined;
  let poolAddress: string | undefined;
  
  // First, look for position NFT address in instruction accounts
  // Whirlpool position NFTs are passed as the first account in many instructions
  for (const instr of allInstructions) {
    if (instr.accounts && instr.accounts.length > 0) {
      // This is a simplification - actual determination would involve inspecting
      // the instruction type, but for demo purposes we'll try to use the first account
      positionAddress = instr.accounts[0];
      
      // Pool address is often the second account in many instructions
      if (instr.accounts.length > 1) {
        poolAddress = instr.accounts[1];
      }
      
      // Break after finding the first potential position
      break;
    }
  }
  
  // If no Whirlpool instructions found, check for swaps
  if (allInstructions.length === 0) {
    // Check if this is a Jupiter/Orca swap using the events
    if (tx.events?.swap?.innerSwaps) {
      for (const innerSwap of tx.events.swap.innerSwaps) {
        if (
          innerSwap.programInfo?.source === 'ORCA' && 
          innerSwap.programInfo?.account === WHIRLPOOL_PROGRAM_ID &&
          innerSwap.programInfo?.instructionName === 'whirlpoolSwap'
        ) {
          // Parse token transfers if available in the events
          const sourceWallet = tx.feePayer; // Usually the wallet initiating the swap
          let inputMint, outputMint, inputAmount = 0, outputAmount = 0;
          
          // First look in tokenInputs and tokenOutputs
          if (tx.events.swap.tokenInputs && tx.events.swap.tokenInputs.length > 0) {
            const tokenInput = tx.events.swap.tokenInputs[0];
            inputMint = tokenInput.mint;
            inputAmount = parseFloat(tokenInput.amount) / Math.pow(10, tokenInput.decimals || 9);
          }
          
          if (tx.events.swap.tokenOutputs && tx.events.swap.tokenOutputs.length > 0) {
            const tokenOutput = tx.events.swap.tokenOutputs[0];
            outputMint = tokenOutput.mint;
            outputAmount = parseFloat(tokenOutput.amount) / Math.pow(10, tokenOutput.decimals || 9);
          }
          
          // Then fallback to checking the accountData for token balance changes
          if (!inputMint || !outputMint) {
            for (const account of tx.accountData) {
              for (const tokenChange of account.tokenBalanceChanges || []) {
                const amount = parseFloat(tokenChange.rawTokenAmount.tokenAmount);
                const decimals = tokenChange.rawTokenAmount.decimals;
                const normalizedAmount = amount / Math.pow(10, decimals);
                
                // Negative amounts are tokens going out (inputs)
                if (normalizedAmount < 0 && tokenChange.userAccount === sourceWallet) {
                  inputMint = tokenChange.mint;
                  inputAmount = Math.abs(normalizedAmount);
                }
                // Positive amounts are tokens coming in (outputs)
                else if (normalizedAmount > 0 && tokenChange.userAccount === sourceWallet) {
                  outputMint = tokenChange.mint;
                  outputAmount = normalizedAmount;
                }
              }
            }
          }
          
          return { 
            type: TransactionType.Swap,
            poolAddress: poolAddress, // This might not be accurate in all cases
            tokenAmounts: {
              tokenA: inputMint ? { mint: inputMint, amount: inputAmount } : undefined,
              tokenB: outputMint ? { mint: outputMint, amount: outputAmount } : undefined
            }
          };
        }
      }
    }
    
    return { type: null };
  }
  
  // Enhanced detection logic for common Whirlpool operations
  
  // 1. Get token balance changes
  const tokenChanges = tx.accountData
    .filter(data => data.tokenBalanceChanges && data.tokenBalanceChanges.length > 0)
    .flatMap(data => data.tokenBalanceChanges);
    
  // Improved swap detection by looking for source and destination wallet pairs
  // This helps with Jupiter aggregated swaps
  const parseSourceDestinationTransfers = () => {
    const transfers: Array<{mint: string, amount: number, direction: 'in'|'out', wallet: string}> = [];
    
    // Look for transfers to/from wallets
    for (const account of tx.accountData) {
      for (const tokenChange of account.tokenBalanceChanges || []) {
        const amount = parseFloat(tokenChange.rawTokenAmount.tokenAmount);
        if (amount === 0) continue;
        
        const decimals = tokenChange.rawTokenAmount.decimals;
        const normalizedAmount = amount / Math.pow(10, decimals);
        
        transfers.push({
          mint: tokenChange.mint,
          amount: Math.abs(normalizedAmount),
          direction: normalizedAmount > 0 ? 'in' : 'out',
          wallet: tokenChange.userAccount
        });
      }
    }
    
    return transfers;
  };
  
  // 2. Analyze transaction data to understand what happened
  
  // Check for fee collection - typically has positive token balance changes
  const positiveTokenChanges = tokenChanges.filter(change => {
    const amount = parseInt(change.rawTokenAmount.tokenAmount);
    return amount > 0;
  });
  
  if (positiveTokenChanges.length >= 1) {
    console.log(`Found potential fee collection with ${positiveTokenChanges.length} positive token changes`);
    
    // Extract the position_mint from the accounts if possible
    // Improved detection for unknown position_mint
    if (!positionAddress) {
      // Look for potential position mints in the transaction
      // In Orca transactions, NFT position is referenced in the accounts
      const positionAccount = tx.instructions.find(instr => 
        instr.programId === WHIRLPOOL_PROGRAM_ID && 
        instr.accounts && instr.accounts.length > 0
      )?.accounts[0];
      
      if (positionAccount) {
        console.log(`Detected potential position address: ${positionAccount}`);
        positionAddress = positionAccount;
      }
    }
    
    return { 
      type: TransactionType.CollectFees, 
      positionAddress,
      poolAddress,
      tokenAmounts: {
        tokenA: positiveTokenChanges[0] ? {
          mint: positiveTokenChanges[0].mint,
          amount: parseInt(positiveTokenChanges[0].rawTokenAmount.tokenAmount) / 
                 Math.pow(10, positiveTokenChanges[0].rawTokenAmount.decimals)
        } : undefined,
        tokenB: positiveTokenChanges.length > 1 ? {
          mint: positiveTokenChanges[1].mint,
          amount: parseInt(positiveTokenChanges[1].rawTokenAmount.tokenAmount) / 
                 Math.pow(10, positiveTokenChanges[1].rawTokenAmount.decimals)
        } : undefined
      }
    };
  }
  
  // Check for liquidity changes - typically has both positive and negative token changes
  if (tokenChanges.length >= 2) {
    const hasPositive = tokenChanges.some(change => parseInt(change.rawTokenAmount.tokenAmount) > 0);
    const hasNegative = tokenChanges.some(change => parseInt(change.rawTokenAmount.tokenAmount) < 0);
    
    if (hasPositive && hasNegative) {
      console.log(`Found potential liquidity change with mixed token changes`);
      
      // Simplistically classify as increase/decrease based on the first token change
      const firstChange = parseInt(tokenChanges[0].rawTokenAmount.tokenAmount);
      const type = firstChange > 0 ? TransactionType.DecreaseLiquidity : TransactionType.IncreaseLiquidity;
      
      return { 
        type, 
        positionAddress,
        poolAddress,
        tokenAmounts: {
          tokenA: tokenChanges[0] ? {
            mint: tokenChanges[0].mint,
            amount: Math.abs(parseInt(tokenChanges[0].rawTokenAmount.tokenAmount)) / 
                   Math.pow(10, tokenChanges[0].rawTokenAmount.decimals)
          } : undefined,
          tokenB: tokenChanges.length > 1 ? {
            mint: tokenChanges[1].mint,
            amount: Math.abs(parseInt(tokenChanges[1].rawTokenAmount.tokenAmount)) / 
                   Math.pow(10, tokenChanges[1].rawTokenAmount.decimals)
          } : undefined
        }
      };
    }
  }
  
  // If we got here but have Whirlpool instructions, log for debugging
  if (allInstructions.length > 0) {
    console.log(`Found Whirlpool transaction (${tx.signature.slice(0, 8)}...) but couldn't classify type`);
    console.log(`- Has ${tokenChanges.length} token balance changes`);
    console.log(`- Has ${allInstructions.length} Whirlpool instructions`);
    
    // Return a generic result for logging purposes
    return { 
      type: TransactionType.CollectFees, // Default guess
      positionAddress,
      poolAddress
    };
  }
  
  // Default - can't determine the specific operation
  return { type: null };
}

/**
 * Fetches and indexes historical transactions for a wallet
 */
export async function indexHistoricalTransactions(
  conn: ReliableConnection,
  walletAddress: PublicKey,
  options: {
    maxTransactions?: number;
    startingSignature?: string;
    skipPhase3BackFill?: boolean; // Add option to skip back-filling on cold start
  } = {}
): Promise<{
  processedTransactions: number;
  newEvents: {
    feeEvents: number;
    liquidityEvents: number;
    swapEvents: number;
  };
  lastSignature?: string; // Return the most recent signature for live polling
}> {
  const summary = {
    processedTransactions: 0,
    newEvents: {
      feeEvents: 0,
      liquidityEvents: 0,
      swapEvents: 0
    }
  };
  
  console.log(`Starting historical indexing for wallet: ${walletAddress.toBase58()}`);
  
  // Get wallet DB record
  const wallet = await getOrCreateWallet(walletAddress.toBase58());
  
  let lastSignature = options.startingSignature;
  let totalFetched = 0;
  const maxTransactions = options.maxTransactions || 1000;
  let mostRecentSignature: string | undefined;
  
  try {
    // If skipPhase3BackFill is true and lastSignature is undefined, just fetch the most recent batch
    // This is for cold starts where we don't want to process the entire history
    if (options.skipPhase3BackFill && !lastSignature) {
      console.log('Cold start detected. Will only fetch most recent transactions (Phase 3 back-fill skipped)');
      const batch = await fetchWalletTransactions(
        walletAddress.toBase58(),
        100, // Just get the most recent 100 transactions
        undefined // No signature, so get the most recent
      );
      
      if (batch.length > 0) {
        // Store the most recent signature for future polling
        mostRecentSignature = batch[0].signature;
        console.log(`Most recent transaction signature: ${mostRecentSignature.slice(0, 8)}...`);
        console.log(`Use this signature as a starting point for future polling`);
        
        // Return early with the signature but no processing
        return {
          ...summary,
          lastSignature: mostRecentSignature
        };
      }
    }
    
    // Normal flow - Fetch transactions in batches until we reach the limit
    while (totalFetched < maxTransactions) {
      const batch = await fetchWalletTransactions(
        walletAddress.toBase58(),
        Math.min(100, maxTransactions - totalFetched),
        lastSignature
      );
      
      // Keep track of the most recent signature for return value
      if (batch.length > 0 && !mostRecentSignature) {
        mostRecentSignature = batch[0].signature;
      }
      
      if (batch.length === 0) {
        console.log("No more transactions to fetch");
        break; // No more transactions
      }
      
      totalFetched += batch.length;
      lastSignature = batch[batch.length - 1].signature;
      
      console.log(`Fetched ${batch.length} transactions, total: ${totalFetched}`);
      
      // Process the batch
      const batchEvents = await processTransactions(wallet.id!, batch, conn);
      
      // Accumulate event counts
      summary.newEvents.feeEvents += batchEvents.feeEvents;
      summary.newEvents.liquidityEvents += batchEvents.liquidityEvents;
      summary.newEvents.swapEvents += batchEvents.swapEvents;
      
      // Update processed transaction count
      summary.processedTransactions += batch.length;
      
      // Log batch summary
      if (batchEvents.feeEvents > 0 || batchEvents.liquidityEvents > 0 || batchEvents.swapEvents > 0) {
        console.log(`Batch events: ${batchEvents.feeEvents} fees, ${batchEvents.liquidityEvents} liquidity, ${batchEvents.swapEvents} swaps`);
      }
    }
    
    console.log(`Completed historical indexing for wallet: ${walletAddress.toBase58()}`);
    console.log(`Processed ${summary.processedTransactions} transactions`);
    console.log(`Recorded events: ${JSON.stringify(summary.newEvents)}`);
    
    // Return the most recent signature for future polling
    if (mostRecentSignature) {
      console.log(`Most recent transaction signature: ${mostRecentSignature.slice(0, 8)}...`);
    }
    
    return {
      ...summary,
      lastSignature: mostRecentSignature
    };
  } catch (error) {
    console.error('Error in historical indexing:', error);
    return summary;
  }
}

/**
 * Process a batch of transactions
 */
async function processTransactions(
  walletId: number,
  transactions: HeliusParsedTransaction[],
  conn: ReliableConnection
): Promise<{
  feeEvents: number;
  liquidityEvents: number;
  swapEvents: number;
}> {
  const eventCounts = {
    feeEvents: 0,
    liquidityEvents: 0,
    swapEvents: 0
  };
  
  // Get current positions for the wallet to match with transactions
  // The getPositionsForWallet function expects a wallet address, not ID
  // So we need to find the wallet address first
  const walletResult = await query('SELECT address FROM wallets WHERE id = $1', [walletId]);
  
  if (walletResult.rows.length === 0) {
    console.log(`No wallet found with ID ${walletId}`);
    return eventCounts;
  }
  
  const walletAddress = walletResult.rows[0].address;
  console.log(`Found wallet address ${walletAddress} for ID ${walletId}, fetching positions...`);
  
  // Now get positions using the wallet address
  const positions = await getPositionsForWallet(walletAddress);
  
  if (positions.length === 0) {
    console.log("No positions found in database for this wallet. Make sure to sync positions first.");
    return eventCounts;
  }
  
  console.log(`Found ${positions.length} positions for wallet ID ${walletId}`);
  
  // Create a map of position addresses to position objects for easier lookup
  const positionMap: {[address: string]: any} = {};
  positions.forEach(pos => {
    if (pos.position_address) {
      positionMap[pos.position_address] = pos;
    }
  });
  
  // Create a map of pool addresses to positions
  const poolPositionMap: {[address: string]: any[]} = {};
  positions.forEach(pos => {
    if (pos.pool_address) {
      if (!poolPositionMap[pos.pool_address]) {
        poolPositionMap[pos.pool_address] = [];
      }
      poolPositionMap[pos.pool_address].push(pos);
    }
  });
  
  // Process each transaction
  for (const tx of transactions) {
    const parsedTx = parseWhirlpoolTransaction(tx);
    
    // Previously had token address collection here, now we collect addresses per position
    
    if (!parsedTx.type) continue; // Not a Whirlpool transaction we care about
    
    // Match with position(s) and record appropriate event(s)
    
    // Find matching position(s)
    let matchedPositions: any[] = [];
    
    // First try by position address if available
    if (parsedTx.positionAddress && positionMap[parsedTx.positionAddress]) {
      matchedPositions = [positionMap[parsedTx.positionAddress]];
      console.log(`Matched position by address: ${parsedTx.positionAddress.slice(0, 8)}...`);
    } 
    // Then try by pool address if available
    else if (parsedTx.poolAddress && poolPositionMap[parsedTx.poolAddress]) {
      matchedPositions = poolPositionMap[parsedTx.poolAddress];
      console.log(`Matched ${matchedPositions.length} positions by pool address: ${parsedTx.poolAddress.slice(0, 8)}...`);
    }
    // Try to match by token addresses if the transaction has token information
    else if (parsedTx.tokenAmounts && (parsedTx.tokenAmounts.tokenA?.mint || parsedTx.tokenAmounts.tokenB?.mint)) {
      console.log(`No direct match found, attempting to match by token addresses...`);
      
      const tokenAMint = parsedTx.tokenAmounts.tokenA?.mint;
      const tokenBMint = parsedTx.tokenAmounts.tokenB?.mint;
      
      // Filter positions that contain one or both tokens
      const possibleMatches = positions.filter(pos => {
        const hasTokenA = tokenAMint && (pos.token_a_address === tokenAMint || pos.token_b_address === tokenAMint);
        const hasTokenB = tokenBMint && (pos.token_a_address === tokenBMint || pos.token_b_address === tokenBMint);
        return hasTokenA || hasTokenB;
      });
      
      if (possibleMatches.length > 0) {
        // If we found multiple matches, prefer positions that match both tokens
        const exactMatches = possibleMatches.filter(pos => {
          const hasTokenA = tokenAMint && (pos.token_a_address === tokenAMint || pos.token_b_address === tokenAMint);
          const hasTokenB = tokenBMint && (pos.token_a_address === tokenBMint || pos.token_b_address === tokenBMint);
          return hasTokenA && hasTokenB;
        });
        
        if (exactMatches.length > 0) {
          console.log(`Found ${exactMatches.length} position(s) matching both tokens`);
          matchedPositions = exactMatches;
        } else {
          console.log(`Found ${possibleMatches.length} position(s) matching at least one token`);
          matchedPositions = possibleMatches;
        }
      }
    }
    // If still no match, use first position as last resort but log a clear warning
    else if (positions.length > 0) {
      console.warn(`⚠️ WARNING: No position match found for tx ${tx.signature.slice(0, 8)}... - using first position as fallback`);
      console.warn(`  This may lead to inaccurate data attribution!`);
      console.warn(`  Consider manual verification for this transaction.`);
      matchedPositions = [positions[0]];
    }
    
    if (matchedPositions.length === 0) {
      console.log(`No matching positions found for transaction ${tx.signature.slice(0, 8)}...`);
      continue;
    }
    
    // Record events for matched positions
    for (const position of matchedPositions) {
      if (parsedTx.type === TransactionType.CollectFees && parsedTx.tokenAmounts) {
        try {
          // Get token prices for USD value calculation
          const tokenAddresses = [
            position.token_a_address,
            position.token_b_address
          ].filter(Boolean);
          
          const tokenAAmount = parsedTx.tokenAmounts.tokenA?.amount || 0;
          const tokenBAmount = parsedTx.tokenAmounts.tokenB?.amount || 0;
          
          // Use the accurate fee calculation from whirlpoolRewardsService
          const feeData = await calculateHistoricalFees(
            {
              position_address: position.position_address,
              token_a_address: position.token_a_address,
              token_b_address: position.token_b_address
            },
            tokenAAmount,
            tokenBAmount
          );
          
          console.log(`  Token prices: ${position.token_a_symbol}=$${(feeData.feeAUsd / tokenAAmount).toFixed(4)}, ${position.token_b_symbol}=$${(feeData.feeBUsd / tokenBAmount).toFixed(4)}`);
          console.log(`  Fee USD value: $${feeData.totalUsd.toFixed(2)}`);
          
          await recordFeeEvent({
            position_id: position.id,
            transaction_hash: tx.signature,
            timestamp: new Date(tx.timestamp * 1000),
            token_a_amount: tokenAAmount,
            token_b_amount: tokenBAmount,
            token_a_price_usd: tokenAAmount > 0 ? feeData.feeAUsd / tokenAAmount : 0,
            token_b_price_usd: tokenBAmount > 0 ? feeData.feeBUsd / tokenBAmount : 0,
            fee_amount_usd: feeData.totalUsd,
            block_number: tx.slot
          });
          
          console.log(`Recorded fee collection event for position ${position.position_address?.slice(0, 8)}... (ID: ${position.id})`);
          console.log(`  Tokens: ${tokenAAmount} ${position.token_a_symbol}, ${tokenBAmount} ${position.token_b_symbol}`);
          eventCounts.feeEvents++;
        } catch (error) {
          console.error(`Error recording fee event: ${error}`);
        }
      } else if (
        (parsedTx.type === TransactionType.IncreaseLiquidity || 
        parsedTx.type === TransactionType.DecreaseLiquidity) && 
        parsedTx.tokenAmounts
      ) {
        try {
          // Get token prices for USD value calculation
          const tokenAddresses = [
            position.token_a_address,
            position.token_b_address
          ].filter(Boolean);
          
          const tokenPrices = await getTokenPrices(tokenAddresses);
          const tokenAPrice = tokenPrices[position.token_a_address] || 0;
          const tokenBPrice = tokenPrices[position.token_b_address] || 0;
          
          // Calculate USD value of the fee
          const feeAmountUsd = (parsedTx.tokenAmounts.tokenA?.amount || 0) * tokenAPrice + 
                              (parsedTx.tokenAmounts.tokenB?.amount || 0) * tokenBPrice;
          
          console.log(`  Token prices: ${position.token_a_symbol}=$${tokenAPrice.toFixed(4)}, ${position.token_b_symbol}=$${tokenBPrice.toFixed(4)}`);
          console.log(`  Fee USD value: $${feeAmountUsd.toFixed(2)}`);
          
          await recordLiquidityEvent({
            position_id: position.id,
            transaction_hash: tx.signature,
            timestamp: new Date(tx.timestamp * 1000),
            event_type: parsedTx.type === TransactionType.IncreaseLiquidity ? 'increase' : 'decrease',
            token_a_amount: parsedTx.tokenAmounts.tokenA?.amount || 0,
            token_b_amount: parsedTx.tokenAmounts.tokenB?.amount || 0,
            token_a_price_usd: tokenAPrice,
            token_b_price_usd: tokenBPrice,
            total_value_usd: feeAmountUsd,
            block_number: tx.slot
          });
          
          console.log(`Recorded liquidity ${parsedTx.type === TransactionType.IncreaseLiquidity ? 'increase' : 'decrease'} event for position ${position.position_address?.slice(0, 8)}... (ID: ${position.id})`);
          console.log(`  Tokens: ${parsedTx.tokenAmounts.tokenA?.amount || 0} ${position.token_a_symbol}, ${parsedTx.tokenAmounts.tokenB?.amount || 0} ${position.token_b_symbol}`);
          eventCounts.liquidityEvents++;
        } catch (error) {
          console.error(`Error recording liquidity event: ${error}`);
        }
      } else if (parsedTx.type === TransactionType.Swap && position.pool_id) {
        // We only record one swap event per pool
        if (eventCounts.swapEvents > 0) continue;
        
        try {
          // Get token prices including any tokens in the swap (not just position tokens)
          const tokenAddresses = [
            position.token_a_address,
            position.token_b_address
          ];
          
          // Add the swap token addresses if they're available
          if (parsedTx.tokenAmounts?.tokenA?.mint) {
            tokenAddresses.push(parsedTx.tokenAmounts.tokenA.mint);
          }
          
          if (parsedTx.tokenAmounts?.tokenB?.mint) {
            tokenAddresses.push(parsedTx.tokenAmounts.tokenB.mint);
          }
          
          // Get token prices for any tokens involved
          const tokenPrices = await getTokenPrices(tokenAddresses.filter(Boolean));
          
          // Determine token in and out based on parsed data
          let tokenInId = position.token_a_id;
          let tokenOutId = position.token_b_id;
          let amountIn = 0;
          let amountOut = 0;
          
          // If we have parsed token amounts, use them
          if (parsedTx.tokenAmounts) {
            // First, determine which tokens are being used in the swap
            const tokenInMint = parsedTx.tokenAmounts.tokenA?.mint;
            const tokenOutMint = parsedTx.tokenAmounts.tokenB?.mint;
            
            // Get the amounts
            amountIn = parsedTx.tokenAmounts.tokenA?.amount || 0;
            amountOut = parsedTx.tokenAmounts.tokenB?.amount || 0;
            
            // Log the parsed amounts
            console.log(`  Swap parsed amounts: In=${amountIn}, Out=${amountOut}`);
            
            // Lookup the token IDs if available
            if (tokenInMint && tokenOutMint) {
              // We need to query the database to get the token IDs by their addresses
              const tokensResult = await query(
                'SELECT id, address FROM tokens WHERE address IN ($1, $2)',
                [tokenInMint, tokenOutMint]
              );
              
              // Map addresses to IDs
              const tokenIdMap = new Map();
              tokensResult.rows.forEach(row => {
                tokenIdMap.set(row.address, row.id);
              });
              
              // Update token IDs if found
              if (tokenIdMap.has(tokenInMint)) {
                tokenInId = tokenIdMap.get(tokenInMint);
              }
              
              if (tokenIdMap.has(tokenOutMint)) {
                tokenOutId = tokenIdMap.get(tokenOutMint);
              }
            }
          }
          
          // Record the swap event with the correct token directions and amounts
          await recordSwapEvent({
            pool_id: position.pool_id,
            transaction_hash: tx.signature,
            timestamp: new Date(tx.timestamp * 1000),
            token_in_id: tokenInId,
            token_out_id: tokenOutId,
            amount_in: amountIn,
            amount_out: amountOut,
            block_number: tx.slot
          });
          
          console.log(`Recorded swap event for pool ${position.pool_address?.slice(0, 8)}...`);
          console.log(`  Tokens: ${amountIn} in (ID: ${tokenInId}), ${amountOut} out (ID: ${tokenOutId})`);
          eventCounts.swapEvents++;
        } catch (error) {
          console.error(`Error recording swap event: ${error}`);
        }
      }
    }
  }
  
  return eventCounts;
} 