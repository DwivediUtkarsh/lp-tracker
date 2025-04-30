/*
 * DEPRECATED: Classic Orca LP tokens are no longer active.
 * This service is kept for reference purposes but is not used in the application.
 * Please use the Orca Whirlpool services instead.
 */

import { PublicKey } from "@solana/web3.js";
import { ReliableConnection } from "../utils/solana.js";
import { Exposure } from "../types/Exposure.js";

// Stub function that does nothing
export async function preloadOrcaPools(force = false): Promise<void> {
  console.warn("Classic Orca LP tokens are no longer active. This function does nothing.");
  return;
}

// Stub function that returns an empty array
export async function getOrcaExposures(
  conn: ReliableConnection,
  owner: PublicKey
): Promise<Exposure[]> {
  console.warn("Classic Orca LP tokens are no longer active. Returning empty array.");
  return [];
}
