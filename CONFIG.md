# Configuration Guide

## Swift Tracker Configuration

Swift Tracker supports configuration through command line arguments and environment variables.

### Command Line Arguments

```bash
# Start server on port 8080
./costx --port 8080

# Configure custom RPC URLs
./costx --base-rpc-url https://base-mainnet.infura.io/v3/YOUR_API_KEY \
                --arbitrum-rpc-url https://arbitrum-mainnet.infura.io/v3/YOUR_API_KEY \
                --avalanche-rpc-url https://avalanche-mainnet.infura.io/v3/YOUR_API_KEY \
                --solana-mainnet-rpc-url https://mainnet.helius-rpc.com/?api-key=YOUR_API_KEY \
                --solana-devnet-rpc-url https://devnet.helius-rpc.com/?api-key=YOUR_API_KEY
```

### Environment Variables

Create a `.env` file in the project root:

```bash
# Server Configuration
PORT=3000

# EVM Chain RPC URLs
BASE_RPC_URL=https://mainnet.base.org
ARBITRUM_RPC_URL=https://arb1.arbitrum.io/rpc
AVALANCHE_RPC_URL=https://api.avax.network/ext/bc/C/rpc

# Solana Network RPC URLs
SOLANA_MAINNET_RPC_URL=https://api.mainnet-beta.solana.com
SOLANA_DEVNET_RPC_URL=https://api.devnet.solana.com
```

### Default Values

| Configuration | Default Value | Description |
|---------------|---------------|-------------|
| `PORT` | `3000` | Server port |
| `BASE_RPC_URL` | `https://mainnet.base.org` | Base network RPC endpoint |
| `ARBITRUM_RPC_URL` | `https://arb1.arbitrum.io/rpc` | Arbitrum network RPC endpoint |
| `AVALANCHE_RPC_URL` | `https://api.avax.network/ext/bc/C/rpc` | Avalanche network RPC endpoint |
| `SOLANA_MAINNET_RPC_URL` | `https://api.mainnet-beta.solana.com` | Solana mainnet RPC endpoint |
| `SOLANA_DEVNET_RPC_URL` | `https://api.devnet.solana.com` | Solana devnet RPC endpoint |

### Usage Examples

1. **Development with default settings:**
   ```bash
   cargo run
   ```

2. **Production with custom port:**
   ```bash
   PORT=8080 cargo run
   ```

3. **With custom RPC endpoints:**
   ```bash
   cargo run -- --port 8080 --base-rpc-url https://your-base-rpc.com
   ```

4. **Help:**
   ```bash
   cargo run -- --help
   ```

### Priority Order

Configuration values are resolved in the following order (highest to lowest priority):
1. Command line arguments
2. Environment variables
3. Default values 