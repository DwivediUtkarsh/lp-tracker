/**
 * This service handles the calculation of uncollected fees and rewards for Raydium CLMM positions.
 * Uses Anchor-based deserialization.
 */
import { PublicKey } from '@solana/web3.js';
import BN from 'bn.js';
import { Decimal } from 'decimal.js';

import { ReliableConnection } from '../utils/solana.js';
import { getTokenMetadata } from '../utils/tokenUtils.js';
import { getTokenPrices } from './priceService.js';
import { getClmmProgram } from './raydiumIdl.js';

// Raydium CLMM Program ID
const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');

/**
 * Get uncollected fees for all Raydium CLMM positions for a wallet
 */
export async function getRaydiumUncollectedFees(
  conn: ReliableConnection,
  owner: PublicKey
): Promise<any[]> {
  console.log("[raydium-clmm-rewards] calculating uncollected fees for", owner.toBase58());
  
  try {
    const program = getClmmProgram(conn.getConnection());
    const rewards = [];
    
    // Get all NFTs owned by the wallet (filtered for likely position NFTs)
    const nftAccounts = await conn.getConnection().getParsedTokenAccountsByOwner(
      owner,
      { programId: new PublicKey('TokenkegQfeZyiNwAJbNbGKPFXCWuBvf9Ss623VQ5DA') }
    );
    
    const positionNFTMints = nftAccounts.value
      .filter(account => {
        const data = account.account.data.parsed.info;
        return Number(data.tokenAmount.amount) === 1 && Number(data.tokenAmount.decimals) === 0;
      })
      .map(account => new PublicKey(account.account.data.parsed.info.mint));
    
    // Process each potential position NFT
    for (const mint of positionNFTMints) {
      try {
        // Derive position address from NFT mint (PDA)
        const [positionPda] = PublicKey.findProgramAddressSync(
          [Buffer.from('position'), mint.toBuffer()],
          RAYDIUM_CLMM_PROGRAM_ID
        );
        
        // Try to load the position account
        let position;
        try {
          position = await program.account.personalPositionState.fetch(positionPda);
        } catch (e: any) {
          // Not a valid Raydium position
          continue;
        }
        
        const { 
          poolId, tokenFeesOwed0, tokenFeesOwed1, 
          tickLowerIndex, tickUpperIndex 
        } = position as {
          poolId: PublicKey;
          tokenFeesOwed0: BN;
          tokenFeesOwed1: BN;
          tickLowerIndex: number;
          tickUpperIndex: number;
        };
        
        // Fetch the associated pool
        const pool = await program.account.poolState.fetch(poolId);
        const { 
          tokenMint0, tokenMint1, 
          mintDecimals0, mintDecimals1 
        } = pool as {
          tokenMint0: PublicKey;
          tokenMint1: PublicKey;
          mintDecimals0: number;
          mintDecimals1: number;
        };
        
        // Format token fees with proper decimals
        const decimals0 = Math.pow(10, mintDecimals0);
        const decimals1 = Math.pow(10, mintDecimals1);
        
        const feeAmount0 = new Decimal(tokenFeesOwed0.toString()).div(decimals0);
        const feeAmount1 = new Decimal(tokenFeesOwed1.toString()).div(decimals1);
        
        // Get token metadata for nice symbols
        const meta0 = await getTokenMetadata(tokenMint0.toString());
        const meta1 = await getTokenMetadata(tokenMint1.toString());
        
        // Fetch current token prices for USD conversions
        const symbols = [tokenMint0.toString(), tokenMint1.toString()];
        const priceMap = await getTokenPrices(symbols);
        const price0 = priceMap[tokenMint0.toString()] || 0;
        const price1 = priceMap[tokenMint1.toString()] || 0;
        
        // Calculate USD values
        const feeAUsd = feeAmount0.toNumber() * price0;
        const feeBUsd = feeAmount1.toNumber() * price1;
        const totalUsd = feeAUsd + feeBUsd;
        
        rewards.push({
          positionAddress: positionPda.toString(),
          poolId: poolId.toString(),
          tokenA: meta0?.symbol || tokenMint0.toString().slice(0, 6),
          tokenB: meta1?.symbol || tokenMint1.toString().slice(0, 6),
          feeA: feeAmount0.toNumber(),
          feeB: feeAmount1.toNumber(),
          feeAUsd: feeAUsd,
          feeBUsd: feeBUsd,
          totalUsd: totalUsd,
          pool: `${meta0?.symbol || tokenMint0.toString().slice(0, 6)}-${meta1?.symbol || tokenMint1.toString().slice(0, 6)}`
        });
      } catch (error: any) {
        console.error(`[raydium-clmm-rewards] error processing fees for position ${mint.toString().slice(0, 8)}...`, error);
      }
    }
    
    return rewards;
  } catch (error: any) {
    console.error('[raydium-clmm-rewards] error calculating rewards:', error);
    return [];
  }
} 