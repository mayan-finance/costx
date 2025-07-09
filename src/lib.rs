// Costx Library - Blockchain Transaction Analysis Tools
//! 
//! Costx is a library for analyzing blockchain transactions across multiple chains.
//! It supports both EVM-based chains (Ethereum, Polygon, Arbitrum, etc.) and Solana.
//! 
//! # Examples
//! 
//! ## EVM Transaction Analysis
//! 
//! ```no_run
//! use costx::evm::{EVMChainManager, EVMConfig};
//! use clap::Parser;
//! 
//! #[derive(Parser)]
//! struct Config {
//!     #[command(flatten)]
//!     evm: EVMConfig,
//! }
//! 
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     let config = Config::parse();
//!     let manager = EVMChainManager::new(&config.evm);
//!     
//!     let analysis = manager.analyze_transaction("ethereum", "0x...").await?;
//!     println!("Transaction fee: {:?}", analysis.transaction_fee);
//!     
//!     Ok(())
//! }
//! ```
//! 
//! ## Solana Transaction Analysis
//! 
//! ```no_run
//! use costx::solana::{SolanaChainManager, SolanaConfig};
//! use clap::Parser;
//! 
//! #[derive(Parser)]
//! struct Config {
//!     #[command(flatten)]
//!     solana: SolanaConfig,
//! }
//! 
//! #[tokio::main]
//! async fn main() -> Result<(), Box<dyn std::error::Error>> {
//!     let config = Config::parse();
//!     let manager = SolanaChainManager::new(&config.solana);
//!     
//!     let analysis = manager.analyze_transaction("mainnet", "signature...").await?;
//!     println!("Transaction fee: {:?}", analysis.transaction_fee);
//!     
//!     Ok(())
//! }
//! ```

pub mod evm;
pub mod solana;

// Re-export commonly used types for convenience
pub use evm::{
    ChainConfig, EVMChainManager, TransactionAnalysis, ERC20Transfer, EVMConfig
};
pub use solana::{
    SolanaChainConfig, SolanaChainManager, SolanaTransactionAnalysis, 
    SolBalanceChange, TokenBalanceChange, SolanaConfig
};

// Re-export anyhow Result for convenience
pub use anyhow::Result; 