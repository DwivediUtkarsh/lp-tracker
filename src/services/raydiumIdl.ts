/**
 * This file provides the Anchor program interface for Raydium CLMM
 * with proper account decoding
 */
import { PublicKey, Connection } from '@solana/web3.js';
import { Program, AnchorProvider, Idl, BorshAccountsCoder } from '@project-serum/anchor';
import idlJson from './idl/raydium-clmm_v4.json' assert { type: 'json' };

// Raydium CLMM Program ID
export const RAYDIUM_CLMM_PROGRAM_ID = new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK');

// Set up the Anchor account coder for safe decoding
export const coder = new BorshAccountsCoder(idlJson as Idl);

/**
 * Get the Raydium CLMM Anchor program
 */
export function getClmmProgram(connection: Connection) {
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
  return new Program(idlJson as Idl, RAYDIUM_CLMM_PROGRAM_ID, provider);
}

/**
 * Safely decode a position account using the official IDL
 */
export function safeDecodePosition(accountData: Buffer) {
  try {
    return coder.decode('PersonalPositionState', accountData);
  } catch (e) {
    console.error('Error decoding position:', e);
    throw e;
  }
}

/**
 * Safely decode a pool account using the official IDL
 */
export function safeDecodePool(accountData: Buffer) {
  try {
    return coder.decode('PoolState', accountData);
  } catch (e) {
    console.error('Error decoding pool:', e);
    throw e;
  }
} 