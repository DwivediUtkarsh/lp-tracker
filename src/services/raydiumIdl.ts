import clmmIdl from '../idl/raydium_clmm.json' assert { type: 'json' };
import { Program, AnchorProvider, Idl } from '@coral-xyz/anchor';
import { Connection, PublicKey } from '@solana/web3.js';

export function getClmmProgram(connection: Connection) {
  const dummyWallet = {
    publicKey: PublicKey.default,
    signTransaction: async (tx: any) => tx,
    signAllTransactions: async (txs: any[]) => txs,
  } as any;

  const provider = new AnchorProvider(connection, dummyWallet,
    AnchorProvider.defaultOptions());
  return new Program(clmmIdl as Idl,
                     new PublicKey('CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK'),
                     provider);
} 