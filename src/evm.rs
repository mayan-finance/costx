use ethers::prelude::*;
use serde::{Deserialize, Serialize};
use std::{collections::HashMap, str::FromStr, sync::Arc};
use anyhow::Result;
use clap::Args;

/// Configuration for EVM chains
#[derive(Debug, Clone, Args)]
pub struct EVMConfig {
    /// Base RPC URL
    #[arg(long, env = "BASE_RPC_URL", default_value = "https://mainnet.base.org")]
    pub base_rpc_url: String,

    /// Arbitrum RPC URL
    #[arg(long, env = "ARBITRUM_RPC_URL", default_value = "https://arb1.arbitrum.io/rpc")]
    pub arbitrum_rpc_url: String,

    /// Avalanche RPC URL
    #[arg(long, env = "AVAX_RPC_URL", default_value = "https://api.avax.network/ext/bc/C/rpc")]
    pub avalanche_rpc_url: String,

    /// Polygon RPC URL
    #[arg(long, env = "POLYGON_RPC_URL", default_value = "https://polygon-rpc.com")]
    pub polygon_rpc_url: String,

    /// Optimism RPC URL
    #[arg(long, env = "OPTIMISM_RPC_URL", default_value = "https://optimism.drpc.org")]
    pub optimism_rpc_url: String,

    /// Unichain RPC URL
    #[arg(long, env = "UNICHAIN_RPC_URL", default_value = "https://rpc.unichain.io")]
    pub unichain_rpc_url: String,

    /// Ethereum RPC URL
    #[arg(long, env = "ETH_RPC_URL", default_value = "https://eth.llamarpc.com")]
    pub eth_rpc_url: String,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ChainConfig {
    pub name: String,
    pub chain_id: u64,
    pub rpc_url: String,
    pub explorer_url: String,
    pub native_token: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TransactionAnalysis {
    pub tx_hash: String,
    pub chain_name: String,
    pub gas_used: Option<U256>,
    pub gas_price: Option<U256>,
    pub gas_limit: U256,
    pub transaction_fee: Option<U256>,
    pub erc20_transfers: Vec<ERC20Transfer>,
    pub transaction_status: String,
    pub block_number: Option<U64>,
    pub from_address: String,
    pub to_address: Option<String>,
    pub value: U256,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct ERC20Transfer {
    pub token_address: String,
    pub from_address: String,
    pub to_address: String,
    pub amount: U256,
}

pub struct EVMChainManager {
    chains: HashMap<String, ChainConfig>,
    providers: HashMap<String, Provider<Http>>,
}

impl EVMChainManager {
    /// Create a new EVMChainManager with the provided configuration
    pub fn new(config: &EVMConfig) -> Self {
        let mut chains = HashMap::new();
        
        // Base chain configuration
        chains.insert("base".to_string(), ChainConfig {
            name: "Base".to_string(),
            chain_id: 8453,
            rpc_url: config.base_rpc_url.clone(),
            explorer_url: "https://basescan.org".to_string(),
            native_token: "ETH".to_string(),
        });
        
        // Arbitrum chain configuration
        chains.insert("arbitrum".to_string(), ChainConfig {
            name: "Arbitrum One".to_string(),
            chain_id: 42161,
            rpc_url: config.arbitrum_rpc_url.clone(),
            explorer_url: "https://arbiscan.io".to_string(),
            native_token: "ETH".to_string(),
        });
        
        // Avalanche chain configuration
        chains.insert("avalanche".to_string(), ChainConfig {
            name: "Avalanche C-Chain".to_string(),
            chain_id: 43114,
            rpc_url: config.avalanche_rpc_url.clone(),
            explorer_url: "https://snowtrace.io".to_string(),
            native_token: "AVAX".to_string(),
        });
        
        // Polygon chain configuration
        chains.insert("polygon".to_string(), ChainConfig {
            name: "Polygon Mainnet".to_string(),
            chain_id: 137,
            rpc_url: config.polygon_rpc_url.clone(),
            explorer_url: "https://polygonscan.com".to_string(),
            native_token: "MATIC".to_string(),
        });
        
        // Optimism chain configuration
        chains.insert("optimism".to_string(), ChainConfig {
            name: "Optimism Mainnet".to_string(),
            chain_id: 10,
            rpc_url: config.optimism_rpc_url.clone(),
            explorer_url: "https://optimistic.etherscan.io".to_string(),
            native_token: "ETH".to_string(),
        });

        // Unichain chain configuration
        chains.insert("unichain".to_string(), ChainConfig {
            name: "Unichain Mainnet".to_string(),
            chain_id: 167,
            rpc_url: config.unichain_rpc_url.clone(),
            explorer_url: "https://unichainscan.io".to_string(),
            native_token: "UNI".to_string(),
        });

        // Ethereum chain configuration
        chains.insert("ethereum".to_string(), ChainConfig {
            name: "Ethereum Mainnet".to_string(),
            chain_id: 1,
            rpc_url: config.eth_rpc_url.clone(),
            explorer_url: "https://etherscan.io".to_string(),
            native_token: "ETH".to_string(),
        });

        let mut providers = HashMap::new();
        for (key, config) in &chains {
            if let Ok(provider) = Provider::<Http>::try_from(config.rpc_url.as_str()) {
                providers.insert(key.clone(), provider);
            }
        }

        EVMChainManager { chains, providers }
    }
    
    pub fn get_supported_chains(&self) -> Vec<&ChainConfig> {
        self.chains.values().collect()
    }
    
    pub async fn analyze_transaction(&self, chain_name: &str, tx_hash: &str) -> Result<TransactionAnalysis> {
        let provider = Arc::new(self.providers.get(chain_name)
            .ok_or_else(|| anyhow::anyhow!("Chain not supported: {}", chain_name))?.clone());
        
        let chain_config = self.chains.get(chain_name)
            .ok_or_else(|| anyhow::anyhow!("Chain config not found: {}", chain_name))?;
        
        // Parse transaction hash
        let tx_hash_bytes: H256 = tx_hash.parse()?;
        
        // Get transaction details
        let tx = provider.get_transaction(tx_hash_bytes).await?
            .ok_or_else(|| anyhow::anyhow!("Transaction not found: {}", tx_hash))?;
        
        // Get transaction receipt for gas usage and status
        let receipt = provider.get_transaction_receipt(tx_hash_bytes).await?;

        let (gas_used, transaction_status, block_number) = if let Some(receipt) = &receipt {
            (
                receipt.gas_used,
                if receipt.status == Some(U64::from(1)) { "Success" } else { "Failed" }.to_string(),
                receipt.block_number,
            )
        } else {
            (None, "Pending".to_string(), None)
        };

        // Calculate transaction fee
        let transaction_fee = if let (Some(gas_used), Some(gas_price)) = (gas_used, tx.gas_price) {
            Some(gas_used * gas_price)
        } else {
            None
        };

        // Analyze ERC20 transfers from transaction logs
        let erc20_transfers = if let Some(receipt) = &receipt {
            self.extract_erc20_transfers(receipt, &tx.from).await?
        } else {
            Vec::new()
        };
        
        Ok(TransactionAnalysis {
            tx_hash: tx_hash.to_string(),
            chain_name: chain_config.name.clone(),
            gas_used,
            gas_price: tx.gas_price,
            gas_limit: tx.gas,
            transaction_fee,
            erc20_transfers,
            transaction_status,
            block_number,
            from_address: format!("{:?}", tx.from),
            to_address: tx.to.map(|addr| format!("{:?}", addr)),
            value: tx.value,
        })
    }
    
    async fn extract_erc20_transfers(&self, receipt: &TransactionReceipt, tx_sender: &H160) -> Result<Vec<ERC20Transfer>> {
        let mut transfers = Vec::new();
        
        // ERC20 Transfer event signature: Transfer(address,address,uint256)
        let transfer_event_signature = H256::from_str("0xddf252ad1be2c89b69c2b068fc378daa952ba7f163c4a11628f55a4df523b3ef")?;
        
        // Format transaction sender address for comparison
        let tx_sender_formatted = format!("{:?}", tx_sender);
        
        for log in &receipt.logs {
            // Check if this is a Transfer event
            if log.topics.len() >= 3 && log.topics[0] == transfer_event_signature {
                let token_address = format!("{:?}", log.address);
                let from_address = format!("{:?}", H160::from(log.topics[1]));
                let to_address = format!("{:?}", H160::from(log.topics[2]));
                
                // Only include transfers where the transaction sender is the from_address
                if from_address == tx_sender_formatted {
                    // Parse amount from data field
                    let amount = if log.data.len() >= 32 {
                        U256::from_big_endian(&log.data[..32])
                    } else {
                        U256::zero()
                    };

                    transfers.push(ERC20Transfer {
                        token_address,
                        from_address,
                        to_address,
                        amount,
                    });
                }
            }
        }
        
        Ok(transfers)
    }
}
