// src/types/Position.ts
export interface Exposure {
    dex: 'raydium' | 'orca'
    pool: string
    tokenA: string
    tokenB: string
    qtyA: number
    qtyB: number
  }
  