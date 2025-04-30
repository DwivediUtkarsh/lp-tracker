# LP Tracker for Solana

A command-line tool to track and manage liquidity positions across different Solana DEXes (Decentralized Exchanges).

## Features

- Track LP positions across multiple Solana DEXes:
  - Raydium
  - Orca (Classic)
  - Orca Whirlpools (concentrated liquidity positions)
- Fetch positions directly from the blockchain
- Store and retrieve positions from a PostgreSQL database
- Get real-time token prices and calculate position values in USD
- Simple command-line interface

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
SOLANA_RPC=https://your-rpc-endpoint.com
DATABASE_URL=postgresql://username:password@localhost:5432/lp_tracker
```

4. Set up the database:
```bash
# Start PostgreSQL (if using Docker)
npm run start:db

# Create tables and initial data
npm run db:setup
```

## Usage

The LP Tracker provides several commands for different functions:

```bash
npm run dev <WALLET_ADDRESS> [action]
```

Available actions:

- `fetch` (default): Fetch positions from the blockchain and save to database
- `db`: View positions stored in the database
- `direct`: Fetch positions directly from the blockchain (without saving)
- `directsave`: Fetch positions directly and save them to the database
- `tokens`: View all tokens in the wallet
- `prices`: Show real-time prices and USD values for LP positions
- `whirlpools`: Display Orca Whirlpool positions

You can also use the dedicated Whirlpools command for more detailed information:

```bash
npm run whirlpools <WALLET_ADDRESS>
```

### Examples

Fetch and save positions:
```bash
npm run dev 5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1
```

View positions from database:
```bash
npm run dev 5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1 db
```

View Orca Whirlpool positions:
```bash
npm run dev 5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1 whirlpools
# or
npm run whirlpools 5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1
```

View token prices and position values:
```bash
npm run dev 5Q544fKrFoe6tsEbD7S8EmxGTJYAKtTVhAW5Q5pge4j1 prices
```

## Testing

Run the test script to verify price service functionality:
```bash
npm run test:prices
```

## Database Schema

The application uses a PostgreSQL database with the following structure:

- `tokens`: Information about tokens (symbol, address, price)
- `wallets`: Wallet addresses being tracked
- `lp_positions`: LP positions linking wallets to token pairs

## Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## License

This project is licensed under the MIT License. 