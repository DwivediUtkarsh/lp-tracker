// src/orca/whirlpoolTracker.ts
/**
 * WhirlpoolTracker using latest @orca-so/whirlpools-sdk (v0.13.x)
 * ---------------------------------------------------------------
 * Discovers Whirlpool Position PDAs via memcmp filter,
 * then uses SDK client.getPositions() & client.getPool() to compute exposures.
 */

import { PublicKey, Connection, Transaction, VersionedTransaction } from '@solana/web3.js'
import Decimal from 'decimal.js'
import { WhirlpoolContext, buildWhirlpoolClient, ORCA_WHIRLPOOLS_CONFIG } from '@orca-so/whirlpools-sdk'
import { ReliableConnection } from '../utils/solana.js'
import { Exposure } from '../types/Exposure.js'

// Q64 constant for fixed-point conversion
const Q64 = new Decimal(2).pow(64)
const q64ToDecimal = (q64: bigint) => new Decimal(q64.toString()).div(Q64)

/** Given PositionData and current sqrtPrice, compute underlying token amounts */
function liquidityToAmounts(posData: any, sqrtP: Decimal) {
  const { liquidity, tickLower, tickUpper } = posData
  const L = new Decimal(liquidity.toString())
  const lower = q64ToDecimal(tickLower.sqrtPrice)
  const upper = q64ToDecimal(tickUpper.sqrtPrice)

  let a = new Decimal(0)
  let b = new Decimal(0)

  // In-range: hold both assets
  if (sqrtP.gte(lower) && sqrtP.lte(upper)) {
    a = L.mul(upper.minus(sqrtP)).div(sqrtP.mul(upper))
    b = L.mul(sqrtP.minus(lower))
  } else if (sqrtP.lt(lower)) {
    // Entirely tokenA
    a = L.mul(upper.minus(lower)).div(lower.mul(upper))
  } else {
    // Entirely tokenB
    b = L.mul(upper.minus(lower))
  }
  return { a, b }
}

/**
 * Fetch Orca Whirlpool exposures for a wallet
 */
export async function getWhirlpoolExposure(
  conn: ReliableConnection,
  owner: PublicKey,
): Promise<Exposure[]> {
  // 1) Unwrap raw Connection
  // @ts-ignore accessing private
  const rawConn: Connection = conn.conn

  // 2) Orca Whirlpool program ID
  const whirlpoolProgramId = new PublicKey(
    'whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc'
  )

  // 3) Compute memcmp offset for positionAuthority
  const authOffset = 8 + 32 + 1 + 32 + 1 + 8 + 8 + 16

  // 4) Get all Position PDAs owned by wallet
  const programAccounts = await rawConn.getProgramAccounts(
    whirlpoolProgramId,
    {
      filters: [
        { memcmp: { offset: authOffset, bytes: owner.toBase58() } },
      ],
      dataSlice: { offset: 0, length: 0 }
    }
  )
  const positionAddresses = programAccounts.map((info) => info.pubkey)
  if (positionAddresses.length === 0) return []

  // 5) Create a minimal Wallet adapter satisfying the SDK
  const walletAdapter = {
    publicKey: owner,
    signTransaction: async <T extends Transaction | VersionedTransaction>(tx: T): Promise<T> => tx,
    signAllTransactions: async <T extends Transaction | VersionedTransaction>(txs: T[]): Promise<T[]> => txs,
  }

  // 6) Build SDK client
  const ctx = WhirlpoolContext.from(rawConn, walletAdapter, ORCA_WHIRLPOOLS_CONFIG)
  const client = buildWhirlpoolClient(ctx)

  // 7) Fetch all Position objects
  const posMap = await client.getPositions(positionAddresses)

  const exposures: Exposure[] = []

  // 8) Compute exposures per position
  for (const position of Object.values(posMap)) {
    if (!position) continue
    const posData = position.getData()
    const poolAddr = posData.whirlpool
    const pool = await client.getPool(poolAddr)
    if (!pool) continue

    const poolData = pool.getData()
    const sqrtP = q64ToDecimal(poolData.sqrtPrice)
    const { a, b } = liquidityToAmounts(posData, sqrtP)

    exposures.push({
      dex: 'orca-whirlpool',
      pool: `${poolData.tokenMintA.toBase58().slice(0,4)}/${poolData.tokenMintB.toBase58().slice(0,4)}`,
      tokenA: poolData.tokenMintA.toBase58(),
      tokenB: poolData.tokenMintB.toBase58(),
      qtyA: a.toNumber(),
      qtyB: b.toNumber(),
    })
  }

  return exposures
}