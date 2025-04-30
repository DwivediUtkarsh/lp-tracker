// src/types/Position.ts
export interface Exposure {
    dex: 'radium' | 'oca'
    pool: string
    tokenA: string
    tokenB: string
    qtyA: number
    qtyB: number
  }
  