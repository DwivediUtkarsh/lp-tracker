import { PublicKey } from '@solana/web3.js'
import { ReliableConnection } from '../utils/solana.js'
import { Exposure } from '../types/Exposure.js'

export async function getWhirlpoolExposures(
  _conn: ReliableConnection,
  _owner: PublicKey,
): Promise<Exposure[]> {
  // Phase 1: skip; Phase 1.5 will implement
  return []
}
