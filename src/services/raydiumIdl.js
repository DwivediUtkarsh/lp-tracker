  /**
   * This file provides the Anchor program interface for Raydium CLMM
   */
  import { PublicKey, Connection } from '@solana/web3.js';
  import { Program, AnchorProvider, BN } from '@project-serum/anchor';
  import { IDL } from './raydiumClmmIdl.js';

  // Raydium CLMM Program ID
  export const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');

  /**
   * Get the Raydium CLMM Anchor program
   */
  export function getClmmProgram(connection) {
    // Create a read-only provider
    const provider = new AnchorProvider(
      connection,
      {
        publicKey: PublicKey.default,
        signTransaction: async () => { throw new Error('Unsupported'); },
        signAllTransactions: async () => { throw new Error('Unsupported'); },
      },
      { commitment: 'confirmed' }
    );

    // Create the program
    return new Program(IDL, RAYDIUM_CLMM_PROGRAM_ID, provider);
  } 