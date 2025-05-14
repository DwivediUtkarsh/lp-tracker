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
  tokenAPrice: number;
  tokenBPrice: number;
  tokenAValue: number;
  tokenBValue: number;
  totalValue: number;
  tickLowerIndex?: number;
  tickUpperIndex?: number;
  tickCurrentIndex?: number;
  liquidity?: string;
  feesOwed0?: string;
  feesOwed1?: string;
  inRange?: boolean;
  platform?: string;
  protocolVersion?: string;
  positionId?: string;
  nftMint?: string;
  poolId?: string;
  poolName?: string;
  poolAddress?: string;
  feeRate?: number;      // Pool fee rate (e.g., 0.003 for 0.3%)
  tickSpacing?: number;  // Pool tick spacing
}
