# LP Tracker for Solana

A powerful tool for tracking and managing liquidity positions across different Solana DEXes (Decentralized Exchanges).

## Overview

LP Tracker is a comprehensive solution for Solana liquidity providers that offers monitoring, analytics, and management capabilities. It supports multiple DEXes including Raydium, Orca Classic, and Orca Whirlpools (concentrated liquidity positions).

## Core Features

- **Cross-DEX Position Tracking**: Fetch and monitor LP positions across multiple Solana DEXes
- **Real-time Analytics**: Calculate current position values, rewards, and fees
- **Historical Indexing**: Track position history and performance over time
- **Portfolio Management**: View aggregated portfolio metrics
- **Database Integration**: Store and retrieve position data with PostgreSQL
- **Advanced Fee Calculation**: Precision computation for Whirlpool concentrated liquidity fees

## Key Components

### Services

- **WhirlpoolService**: Fetches Orca Whirlpool positions and calculates exposures
- **WhirlpoolRewardsService**: Calculates uncollected fees for Orca Whirlpool positions with precision
- **PriceService**: Retrieves token prices from various sources for real-time valuation
- **HistoricalIndexingService**: Tracks position performance over time
- **RaydiumService**: Manages Raydium LP positions retrieval and calculation
- **OrcaService**: Handles Orca Classic LP positions

### Database Layer

- **DB Setup**: Creates schema and tables for storing wallet data, tokens, positions, and historical metrics
- **Position Storage**: Persists position data for later retrieval and analysis
- **SQL Queries**: Optimized queries for position retrieval and analysis

### Scripts

- **Portfolio**: Generates comprehensive view of all positions with real-time values
- **WhirlpoolPositions**: Detailed breakdowns of Whirlpool concentrated liquidity positions
- **IndexHistory**: Records historical position data for long-term tracking
- **SyncPositions**: Synchronizes on-chain position data with the database
- **PollTransactions**: Monitors for relevant transactions to detect position changes

## Installation

1. Clone the repository:
```bash
git clone https://github.com/yourusername/lp-tracker.git
cd lp-tracker
```

2. Install dependencies:
```bash
npm install
```

3. Set up environment variables:
Create a `.env` file in the root directory with the following variables:
```
# Required Solana RPC endpoint - should support websocket for best performance
SOLANA_RPC=https://your-rpc-endpoint.com

# Optional Helius API key for improved fee calculations
HELIUS_API_KEY=your-helius-api-key

# Required PostgreSQL database connection
DATABASE_URL=postgresql://username:password@localhost:5432/lp_tracker

# Optional Moralis API key for enhanced price feeds
MORALIS_API_KEY=your-moralis-api-key
```

4. Start the PostgreSQL database (if using Docker):
```bash
npm run start:db
```

5. Set up database schema and tables:
```bash
npm run db:setup
```

## Usage

### Commands

- **Detailed Whirlpool Positions**: 
  ```bash
  npm run whirlpools <WALLET_ADDRESS>
  ```

- **Full Portfolio View with Analytics**: 
  ```bash
  npm run portfolio <WALLET_ADDRESS>
  ```

- **Sync Positions with Database**: 
  ```bash
  npm run sync:positions <WALLET_ADDRESS>
  ```

- **Live Transaction Polling**:
  ```bash
  npm run poll:transactions <WALLET_ADDRESS>
  ```
  This command continuously monitors new transactions for the specified wallet, automatically recording fee collections and position changes in real-time.


- **Check Database Status**: 
  ```bash
  npm run check:db
  ```

### Troubleshooting

- If RPC errors occur, check your SOLANA_RPC endpoint or try an alternative endpoint
- For database issues, run `npm run check:db` to verify the database structure
- For pricing problems, ensure you have a correct MORALIS_API_KEY or try alternative price sources

## Database Schema

The application uses a PostgreSQL database with the following key tables:

- `tokens`: Information about tokens (symbol, address, price)
- `wallets`: Wallet addresses being tracked
- `lp_positions`: LP positions linking wallets to token pairs
- `position_history`: Historical position data for tracking performance

## Advanced Features

- **Reliable RPC Connections**: The application includes retry mechanisms and connection pooling to handle RPC failures
- **Precise Fee Calculation**: Advanced mathematics for computing fees in concentrated liquidity positions
- **Multi-DEX Support**: Unified interface for working with different DEX protocols
- **Historical Tracking**: Records position changes over time for performance analysis

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License.
