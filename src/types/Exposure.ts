export interface Exposure {
    dex: 'raydium' | 'orca-classic' | 'orca-whirlpool'
    pool: string
    tokenA: string
    tokenB: string
    qtyA: number
    qtyB: number
  }