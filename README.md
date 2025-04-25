# LP Tracker

Track your Solana liquidity provider (LP) positions across different DEXes.

## Database Setup

This project uses PostgreSQL for storing LP position data. Follow these steps to set up and use the database:

### Prerequisites

- Docker and Docker Compose installed
- Node.js and npm installed

### Setup Steps

1. Create a `.env` file in the root directory with the following content:
   ```
   # Solana RPC endpoint
   SOLANA_RPC=https://api.mainnet-beta.solana.com
   
   # Database connection string
   DATABASE_URL=postgresql://lpuser:lppass@localhost:5433/lptracker
   ```

2. Start the PostgreSQL database container:
   ```bash
   npm run start:db
   ```

3. Initialize the database schema:
   ```bash
   npm run db:setup
   ```

### Usage

1. Fetch and save LP positions for a wallet:
   ```bash
   npm run dev <WALLET_ADDRESS>
   ```

2. View saved positions from the database:
   ```bash
   npm run dev <WALLET_ADDRESS> db
   ```

3. Stop the database container:
   ```bash
   npm run stop:db
   ```

## Database Schema

The database includes the following tables:

- **tokens**: Stores token information (symbol, address, decimals)
- **wallets**: Stores wallet addresses
- **lp_positions**: Stores LP position data for each wallet

## Development

To add new DEX support or modify existing functionality, check the services directory for implementation details. 