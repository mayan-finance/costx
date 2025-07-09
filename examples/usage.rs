use costx::evm::{EVMChainManager, EVMConfig};
use costx::solana::{SolanaChainManager, SolanaConfig};
use clap::Parser;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Config {
    #[command(flatten)]
    evm: EVMConfig,

    #[command(flatten)]
    solana: SolanaConfig,
}

#[tokio::main]
async fn main() -> Result<(), Box<dyn std::error::Error>> {
    // Load environment variables from .env file if present
    dotenvy::dotenv().ok();
    
    // Parse command line arguments and environment variables
    let config = Config::parse();
    
    // Initialize EVM chain manager
    let evm_manager = EVMChainManager::new(&config.evm);
    
    // Initialize Solana chain manager
    let solana_manager = SolanaChainManager::new(&config.solana);
    
    // Example: Get supported chains
    println!("Supported EVM chains:");
    for chain in evm_manager.get_supported_chains() {
        println!("  - {} (Chain ID: {})", chain.name, chain.chain_id);
    }
    
    println!("\nSupported Solana networks:");
    for network in solana_manager.get_supported_chains() {
        println!("  - {} ({})", network.name, network.network);
    }
    
    // Example: Analyze an EVM transaction (replace with actual transaction hash)
    /*
    let tx_hash = "0x...";
    match evm_manager.analyze_transaction("ethereum", tx_hash).await {
        Ok(analysis) => {
            println!("\nEVM Transaction Analysis:");
            println!("  Hash: {}", analysis.tx_hash);
            println!("  Chain: {}", analysis.chain_name);
            println!("  Status: {}", analysis.transaction_status);
            if let Some(fee) = analysis.transaction_fee {
                println!("  Fee: {} wei", fee);
            }
        }
        Err(e) => eprintln!("Error analyzing EVM transaction: {}", e),
    }
    */
    
    // Example: Analyze a Solana transaction (replace with actual signature)
    /*
    let signature = "...";
    match solana_manager.analyze_transaction("mainnet", signature).await {
        Ok(analysis) => {
            println!("\nSolana Transaction Analysis:");
            println!("  Signature: {}", analysis.signature);
            println!("  Network: {}", analysis.network);
            println!("  Status: {}", analysis.transaction_status);
            if let Some(fee) = analysis.transaction_fee {
                println!("  Fee: {} lamports", fee);
            }
        }
        Err(e) => eprintln!("Error analyzing Solana transaction: {}", e),
    }
    */
    
    Ok(())
} 