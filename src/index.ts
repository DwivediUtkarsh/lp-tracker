import { PublicKey, Connection } from '@solana/web3.js'
import { RPC_ENDPOINT } from './config.js'
import { ReliableConnection } from './utils/solana.js'
import { getRaydiumExposures } from './services/raydiumService.js'
import { getOrcaExposures }    from './services/orcaService.js'
import { getWhirlpoolExposures } from './services/whirlpoolService.js'
import { getDirectLPPositions } from './services/directLPService.js'
import { saveExposureToDatabase, getPositionsForWallet, getOrCreateToken, getOrCreateWallet } from './db/models.js'
import { getWalletTokens } from './utils/tokenUtils.js'
import { query } from './utils/database.js';
import { enrichPositionsWithPrices, updateTokenPricesInDb } from './services/priceService.js';

async function main() {
  const [, , walletArg, action = 'fetch'] = process.argv
  if (!walletArg) {
    console.error('Usage: npm run dev <WALLET_PUBKEY> [action]')
    console.error('Actions: fetch, db, direct, directsave, tokens, prices')
    process.exit(1)
  }

  const wallet = new PublicKey(walletArg)
  const walletAddress = wallet.toBase58()
  console.log('🔗 RPC endpoints:', RPC_ENDPOINT)
  console.log('👛 Wallet:', walletAddress, '\n')

  // Direct connection for new functionality
  const connection = new Connection(RPC_ENDPOINT, 'confirmed')

  // Real-time price updates and valuation
  if (action === 'prices') {
    console.log('Fetching real-time prices and LP position values...')
    
    // Get saved positions from database
    const savedPositions = await getPositionsForWallet(walletAddress)
    
    if (!savedPositions.length) {
      console.log('No LP positions found in database for this wallet. Run "fetch" action first.')
      return
    }
    
    // Convert string values to numbers (PostgreSQL returns numeric as strings)
    savedPositions.forEach(pos => {
      pos.qty_a = parseFloat(pos.qty_a);
      pos.qty_b = parseFloat(pos.qty_b);
    });
    
    // Enrich positions with real-time price data
    const enrichedPositions = await enrichPositionsWithPrices(savedPositions)
    
    // Format for display
    console.table(
      enrichedPositions.map(p => ({
        DEX: p.dex,
        Pool: `${p.token_a_symbol}-${p.token_b_symbol}`,
        [`${p.token_a_symbol}`]: p.qty_a.toFixed(4),
        [`${p.token_a_symbol} Price`]: `$${p.token_a_price.toFixed(2)}`,
        [`${p.token_a_symbol} Value`]: `$${p.token_a_value.toFixed(2)}`,
        [`${p.token_b_symbol}`]: p.qty_b.toFixed(4),
        [`${p.token_b_symbol} Price`]: `$${p.token_b_price.toFixed(2)}`,
        [`${p.token_b_symbol} Value`]: `$${p.token_b_value.toFixed(2)}`,
        ['Total Value']: `$${p.total_value.toFixed(2)}`
      }))
    )
    
    // Calculate and display total value across all positions
    const totalValue = enrichedPositions.reduce((sum, pos) => sum + pos.total_value, 0)
    console.log(`\nTotal LP Value: $${totalValue.toFixed(2)}`)
    
    // Update prices in database for future reference
    await updateTokenPricesInDb()
    
    return
  }

  // View all tokens in wallet
  if (action === 'tokens') {
    console.log('Fetching all tokens in wallet...')
    const tokens = await getWalletTokens(connection, walletAddress)
    
    console.table(
      tokens.map(token => ({
        Symbol: token.symbol,
        Name: token.name,
        Balance: token.balance,
        'Is LP': token.isLPToken ? '✓' : ''
      }))
    )
    return
  }

  // Direct LP token fetching with database save
  if (action === 'directsave') {
    console.log('Fetching LP positions directly from blockchain and saving to database...')
    const positions = await getDirectLPPositions(connection, walletAddress)
    
    if (!positions.length) {
      console.log('No LP positions detected using direct fetching.')
      return
    }
    
    console.table(
      positions.map(pos => ({
        DEX: pos.dex,
        Pool: pos.poolName,
        'LP Amount': pos.userLpAmount,
        [`${pos.tokenA.symbol}`]: pos.tokenA.amount,
        [`${pos.tokenB.symbol}`]: pos.tokenB.amount
      }))
    )
    
    // Save direct LP positions to database
    console.log('\nSaving direct LP positions to database...')
    const wallet = await getOrCreateWallet(walletAddress)
    
    for (const pos of positions) {
      try {
        // Get or create tokens
        const tokenA = await getOrCreateToken({
          symbol: pos.tokenA.symbol,
          address: pos.tokenA.address || pos.tokenA.symbol // Fallback to symbol if no address
        })
        
        const tokenB = await getOrCreateToken({
          symbol: pos.tokenB.symbol,
          address: pos.tokenB.address || pos.tokenB.symbol // Fallback to symbol if no address
        })
        
        // Check if position exists
        const existingPosition = await query(
          'SELECT * FROM lp_positions WHERE wallet_id = $1 AND pool_address = $2',
          [wallet.id, pos.lpMint]
        )
        
        if (existingPosition.rows.length > 0) {
          // Update existing position
          await query(
            `UPDATE lp_positions 
             SET qty_a = $1, qty_b = $2, last_updated = CURRENT_TIMESTAMP
             WHERE id = $3`,
            [pos.tokenA.amount, pos.tokenB.amount, existingPosition.rows[0].id]
          )
          console.log(`Updated LP position for ${pos.poolName}`)
        } else {
          // Create new position
          await query(
            `INSERT INTO lp_positions 
             (wallet_id, dex, pool_address, token_a_id, token_b_id, qty_a, qty_b)
             VALUES ($1, $2, $3, $4, $5, $6, $7)`,
            [wallet.id, pos.dex, pos.lpMint, tokenA.id, tokenB.id, pos.tokenA.amount, pos.tokenB.amount]
          )
          console.log(`Added new LP position for ${pos.poolName}`)
        }
      } catch (error) {
        console.error(`Error saving position ${pos.poolName}:`, error)
      }
    }
    console.log('Direct LP positions saved to database successfully')
    return
  }

  // Direct LP token fetching (no pools.json)
  if (action === 'direct') {
    console.log('Fetching LP positions directly from blockchain...')
    const positions = await getDirectLPPositions(connection, walletAddress)
    
    if (!positions.length) {
      console.log('No LP positions detected using direct fetching.')
      return
    }
    
    console.table(
      positions.map(pos => ({
        DEX: pos.dex,
        Pool: pos.poolName,
        'LP Amount': pos.userLpAmount,
        [`${pos.tokenA.symbol}`]: pos.tokenA.amount,
        [`${pos.tokenB.symbol}`]: pos.tokenB.amount
      }))
    )
    return
  }

  // Check if we just want to view existing positions from the database
  if (action === 'db') {
    const savedPositions = await getPositionsForWallet(walletAddress)
    
    if (!savedPositions.length) {
      console.log('No LP positions found in database for this wallet.')
      return
    }
    
    console.log('LP positions from database:')
    console.table(
      savedPositions.map((p) => {
        // Create a consistent object with fixed column order
        return {
          DEX: p.dex,
          Pool: p.pool_address,
          // Use the token symbols to determine which qty is which
          SOL: p.token_a_symbol === 'SOL' ? p.qty_a : 
               p.token_b_symbol === 'SOL' ? p.qty_b : null,
          USDC: p.token_a_symbol === 'USDC' ? p.qty_a : 
                p.token_b_symbol === 'USDC' ? p.qty_b : null,
          ORCA: p.token_a_symbol === 'ORCA' ? p.qty_a : 
                p.token_b_symbol === 'ORCA' ? p.qty_b : null,
          RAY: p.token_a_symbol === 'RAY' ? p.qty_a : 
               p.token_b_symbol === 'RAY' ? p.qty_b : null,
          Last_Updated: p.last_updated
        }
      }),
    )
    return
  }

  const conn = new ReliableConnection(RPC_ENDPOINT)

  // Fetch positions from the blockchain using the original method
  const [raydium, orca, whirl] = await Promise.all([
    getRaydiumExposures(conn, wallet),
    getOrcaExposures(conn, wallet),
    getWhirlpoolExposures(conn, wallet),
  ])

  const rows = [...raydium, ...orca, ...whirl]
  if (!rows.length) {
    console.log('No LP positions detected.')
    return
  }

  console.table(
    rows.map((r) => ({
      DEX: r.dex,
      Pool: r.pool,
      [`${r.tokenA} qty`]: r.qtyA.toFixed(6),
      [`${r.tokenB} qty`]: r.qtyB.toFixed(6),
    })),
  )

  // Save positions to database
  console.log('\nSaving positions to database...')
  for (const exposure of rows) {
    try {
      await saveExposureToDatabase(exposure, walletAddress)
    } catch (error) {
      console.error(`Error saving position ${exposure.pool}:`, error)
    }
  }
  console.log('Positions saved to database successfully')
}

main().catch(console.error)
