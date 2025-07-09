# Costx - Blockchain Transaction Analysis Library

Costx is a Rust library for analyzing blockchain transactions across multiple chains. It supports both EVM-based chains (Ethereum, Polygon, Arbitrum, etc.) and Solana.

## Features

- **EVM Chain Support**: Ethereum, Polygon, Arbitrum, Avalanche, Base, Optimism, Unichain
- **Solana Support**: Mainnet transaction analysis
- **Transaction Analysis**: Gas fees, token transfers, transaction status
- **CLI Integration**: Built-in command-line argument parsing with clap
- **Library and Binary**: Can be used as both a library and standalone application

## Usage as a Library

Add to your `Cargo.toml`:

```toml
[dependencies]
costx = "0.1.0"
clap = { version = "4.0", features = ["derive"] }
tokio = { version = "1.0", features = ["full"] }
```

### EVM Transaction Analysis

```rust
use costx::evm::{EVMChainManager, EVMConfig};
use clap::Parser;

#[derive(Parser)]
struct Config {
    #[command(flatten)]
    evm: EVMConfig,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::parse();
    let manager = EVMChainManager::new(&config.evm);
    
    let analysis = manager.analyze_transaction("ethereum", "0x...").await?;
    println!("Transaction fee: {:?}", analysis.transaction_fee);
    
    Ok(())
}
```

### Solana Transaction Analysis

```rust
use costx::solana::{SolanaChainManager, SolanaConfig};
use clap::Parser;

#[derive(Parser)]
struct Config {
    #[command(flatten)]
    solana: SolanaConfig,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    let config = Config::parse();
    let manager = SolanaChainManager::new(&config.solana);
    
    let analysis = manager.analyze_transaction("mainnet", "signature...").await?;
    println!("Transaction fee: {:?}", analysis.transaction_fee);
    
    Ok(())
}
```

## Usage as CLI Application

The library also comes with a built-in REST API server:

```bash
# Run with default settings
cargo run

# Run with custom port
cargo run -- --port 8080

# Run with custom RPC URLs
cargo run -- --eth-rpc-url https://custom-eth-rpc.com --solana-rpc-url https://custom-solana-rpc.com
```

### Environment Variables

All configuration options can be set via environment variables:

```bash
export PORT=8080
export ETH_RPC_URL="https://custom-eth-rpc.com"
export SOLANA_RPC_URL="https://custom-solana-rpc.com"
# ... and more
```

## API Endpoints

### EVM Endpoints
- `GET /evm/chains` - Get supported EVM chains
- `GET /evm/analyze/{chain}/{tx_hash}` - Analyze transaction
- `POST /evm/transaction` - Analyze transaction (JSON body)

### Solana Endpoints
- `GET /solana/networks` - Get supported Solana networks
- `GET /solana/analyze/{network}/{signature}` - Analyze transaction
- `POST /solana/transaction` - Analyze transaction (JSON body)

## Examples

Run the usage example:

```bash
cargo run --example usage
```

## Configuration Options

### EVM Configuration (`EVMConfig`)
- `--base-rpc-url` / `BASE_RPC_URL`
- `--arbitrum-rpc-url` / `ARBITRUM_RPC_URL`
- `--avax-rpc-url` / `AVAX_RPC_URL`
- `--polygon-rpc-url` / `POLYGON_RPC_URL`
- `--optimism-rpc-url` / `OPTIMISM_RPC_URL`
- `--unichain-rpc-url` / `UNICHAIN_RPC_URL`
- `--eth-rpc-url` / `ETH_RPC_URL`

### Solana Configuration (`SolanaConfig`)
- `--solana-rpc-url` / `SOLANA_RPC_URL`

## License

MIT 