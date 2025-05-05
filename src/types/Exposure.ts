export interface Exposure {
  dex: string;
  pool: string;
  positionAddress: string; // Position NFT address
  tokenA: string;
  tokenB: string;
  qtyA: number;
  qtyB: number;
  tokenAAddress: string;
  tokenBAddress: string;
  tokenAPrice?: number;
  tokenBPrice?: number;
  tokenAValue?: number;
  tokenBValue?: number;
  totalValue?: number;
  poolAddress?: string; // The actual pool address (distinct from position)
  feeRate?: number;      // Pool fee rate (e.g., 0.003 for 0.3%)
  tickSpacing?: number;  // Pool tick spacing
}
