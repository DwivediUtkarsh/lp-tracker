import { Connection } from '@solana/web3.js'

console.log('👋  Hello LP-Tracker')
const conn = new Connection('https://api.mainnet-beta.solana.com', 'confirmed')
conn.getEpochInfo().then(info => {
  console.log('Current Solana epoch:', info.epoch)
})
