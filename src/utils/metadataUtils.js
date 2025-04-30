/**
 * Utility functions for token metadata and formatting
 */

import { formatTokenAmount as formatAmount } from './tokenUtils.js';

/**
 * Formats token amount based on decimals
 * Re-exported from tokenUtils for convenience
 */
export function formatTokenAmount(amount, decimals) {
  return formatAmount(amount, decimals);
} 