export interface Exposure {
  dex: string;
  pool: string;
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
}
