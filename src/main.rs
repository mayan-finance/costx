mod evm;
mod solana;

use axum::{
    extract::{Path, State},
    http::StatusCode,
    response::Json,
    routing::{get, post},
    Router,
};
use clap::Parser;
use evm::{ChainConfig, EVMChainManager, TransactionAnalysis};
use solana::{SolanaChainConfig, SolanaChainManager, SolanaTransactionAnalysis};
use serde::Deserialize;
use std::sync::Arc;
use tower_http::cors::CorsLayer;

#[derive(Parser, Debug)]
#[command(author, version, about, long_about = None)]
struct Config {
    /// Server port
    #[arg(short, long, env = "PORT", default_value = "3000")]
    port: u16,

    /// Base RPC URL
    #[arg(long, env = "BASE_RPC_URL", default_value = "https://mainnet.base.org")]
    base_rpc_url: String,

    /// Arbitrum RPC URL
    #[arg(long, env = "ARBITRUM_RPC_URL", default_value = "https://arb1.arbitrum.io/rpc")]
    arbitrum_rpc_url: String,

    /// Avalanche RPC URL
    #[arg(long, env = "AVAX_RPC_URL", default_value = "https://api.avax.network/ext/bc/C/rpc")]
    avalanche_rpc_url: String,

    /// Polygon RPC URL
    #[arg(long, env = "POLYGON_RPC_URL", default_value = "https://polygon-rpc.com")]
    polygon_rpc_url: String,

    /// Optimism RPC URL
    #[arg(long, env = "OPTIMISM_RPC_URL", default_value = "https://optimism.drpc.org")]
    optimism_rpc_url: String,

    /// Unichain RPC URL
    #[arg(long, env = "UNICHAIN_RPC_URL", default_value = "https://rpc.unichain.io")]
    unichain_rpc_url: String,

    /// Ethereum RPC URL
    #[arg(long, env = "ETH_RPC_URL", default_value = "https://eth.llamarpc.com")]
    eth_rpc_url: String,

    /// Solana Mainnet RPC URL
    #[arg(long, env = "SOLANA_RPC_URL", default_value = "https://api.mainnet-beta.solana.com")]
    solana_mainnet_rpc_url: String,
}

#[derive(Deserialize)]
struct TransactionRequest {
    chain: String,
    tx_hash: String,
}

#[derive(Deserialize)]
struct SolanaTransactionRequest {
    network: String,
    signature: String,
}

// Application state
#[derive(Clone)]
struct AppState {
    evm_manager: Arc<EVMChainManager>,
    solana_manager: Arc<SolanaChainManager>,
}

#[tokio::main]
async fn main() {
    // Load environment variables from .env file if present
    dotenvy::dotenv().ok();
    
    // Parse command line arguments and environment variables
    let config = Config::parse();
    
    // Initialize EVM chain manager with configuration
    let evm_manager = Arc::new(EVMChainManager::new_with_config(&config));
    // Initialize Solana chain manager with configuration
    let solana_manager = Arc::new(SolanaChainManager::new_with_config(&config));
    let app_state = AppState { evm_manager, solana_manager };

    // Build our application with routes
    let app = Router::new()
        .route("/evm/chains", get(get_supported_chains))
        .route("/evm/analyze/:chain/:tx_hash", get(analyze_transaction))
        .route("/evm/transaction", post(analyze_transaction_post))
        .route("/solana/networks", get(get_supported_solana_networks))
        .route("/solana/analyze/:network/:signature", get(analyze_solana_transaction))
        .route("/solana/transaction", post(analyze_solana_transaction_post))
        .layer(CorsLayer::permissive())
        .with_state(app_state);

    // Run our app with hyper
    let bind_address = format!("0.0.0.0:{}", config.port);
    let listener = tokio::net::TcpListener::bind(&bind_address).await.unwrap();
    println!("🚀 Server starting on http://{}", bind_address);

    axum::serve(listener, app).await.unwrap();
}

// Get supported chains
async fn get_supported_chains(State(state): State<AppState>) -> Json<Vec<ChainConfig>> {
    let chains = state.evm_manager.get_supported_chains();
    Json(chains.into_iter().cloned().collect())
}

// Analyze transaction by URL parameters
async fn analyze_transaction(
    Path((chain, tx_hash)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Result<Json<TransactionAnalysis>, StatusCode> {
    match state
        .evm_manager
        .analyze_transaction(&chain, &tx_hash)
        .await
    {
        Ok(analysis) => Ok(Json(analysis)),
        Err(e) => {
            eprintln!("Error analyzing transaction: {}", e);
            Err(StatusCode::BAD_REQUEST)
        }
    }
}

// Analyze transaction by POST request
async fn analyze_transaction_post(
    State(state): State<AppState>,
    Json(payload): Json<TransactionRequest>,
) -> Result<Json<TransactionAnalysis>, StatusCode> {
    match state
        .evm_manager
        .analyze_transaction(&payload.chain, &payload.tx_hash)
        .await
    {
        Ok(analysis) => Ok(Json(analysis)),
        Err(e) => {
            eprintln!("Error analyzing transaction: {}", e);
            Err(StatusCode::BAD_REQUEST)
        }
    }
}

// Get supported Solana networks
async fn get_supported_solana_networks(State(state): State<AppState>) -> Json<Vec<SolanaChainConfig>> {
    let networks = state.solana_manager.get_supported_chains();
    Json(networks.into_iter().cloned().collect())
}

// Analyze Solana transaction by URL parameters
async fn analyze_solana_transaction(
    Path((network, signature)): Path<(String, String)>,
    State(state): State<AppState>,
) -> Result<Json<SolanaTransactionAnalysis>, StatusCode> {
    match state
        .solana_manager
        .analyze_transaction(&network, &signature)
        .await
    {
        Ok(analysis) => Ok(Json(analysis)),
        Err(e) => {
            eprintln!("Error analyzing Solana transaction: {}", e);
            Err(StatusCode::BAD_REQUEST)
        }
    }
}

// Analyze Solana transaction by POST request
async fn analyze_solana_transaction_post(
    State(state): State<AppState>,
    Json(payload): Json<SolanaTransactionRequest>,
) -> Result<Json<SolanaTransactionAnalysis>, StatusCode> {
    match state
        .solana_manager
        .analyze_transaction(&payload.network, &payload.signature)
        .await
    {
        Ok(analysis) => Ok(Json(analysis)),
        Err(e) => {
            eprintln!("Error analyzing Solana transaction: {}", e);
            Err(StatusCode::BAD_REQUEST)
        }
    }
}
