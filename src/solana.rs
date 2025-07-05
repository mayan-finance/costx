use anyhow::Result;
use serde::{Deserialize, Serialize};
use solana_client::rpc_client::RpcClient;
use solana_sdk::pubkey::Pubkey;
use solana_transaction_status::{EncodedConfirmedTransactionWithStatusMeta, UiTransactionEncoding};
use std::{collections::HashMap, str::FromStr};

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SolanaChainConfig {
    pub name: String,
    pub rpc_url: String,
    pub explorer_url: String,
    pub network: String,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SolanaTransactionAnalysis {
    pub signature: String,
    pub network: String,
    pub slot: Option<u64>,
    pub transaction_fee: Option<u64>,
    pub sol_balance_changes: Vec<SolBalanceChange>,
    pub token_balance_changes: Vec<TokenBalanceChange>,
    pub transaction_status: String,
    pub block_time: Option<i64>,
    pub compute_units_consumed: Option<u64>,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct SolBalanceChange {
    pub address: String,
    pub pre_balance: u64,
    pub post_balance: u64,
    pub balance_change: i64,
}

#[derive(Debug, Serialize, Deserialize)]
pub struct TokenBalanceChange {
    pub address: String,
    pub mint: String,
    pub token_account: String,
    pub pre_balance: Option<u64>,
    pub post_balance: Option<u64>,
    pub balance_change: Option<i64>,
}

pub struct SolanaChainManager {
    chains: HashMap<String, SolanaChainConfig>,
    clients: HashMap<String, RpcClient>,
}

impl SolanaChainManager {
    pub fn new_with_config(config: &crate::Config) -> Self {
        let mut chains = HashMap::new();
        
        // Mainnet configuration
        chains.insert(
            "mainnet".to_string(),
            SolanaChainConfig {
                name: "Solana Mainnet".to_string(),
                rpc_url: config.solana_mainnet_rpc_url.clone(),
                explorer_url: "https://explorer.solana.com".to_string(),
                network: "mainnet-beta".to_string(),
            },
        );
        
        let mut clients = HashMap::new();
        for (key, config) in &chains {
            let client = RpcClient::new(config.rpc_url.clone());
            clients.insert(key.clone(), client);
        }
        
        SolanaChainManager { chains, clients }
    }

    pub fn get_supported_chains(&self) -> Vec<&SolanaChainConfig> {
        self.chains.values().collect()
    }

    pub async fn analyze_transaction(
        &self,
        network: &str,
        signature: &str,
    ) -> Result<SolanaTransactionAnalysis> {
        let client = self
            .clients
            .get(network)
            .ok_or_else(|| anyhow::anyhow!("Network not supported: {}", network))?;

        let chain_config = self
            .chains
            .get(network)
            .ok_or_else(|| anyhow::anyhow!("Network config not found: {}", network))?;

        // Parse signature
        let signature_pubkey = signature
            .parse()
            .map_err(|e| anyhow::anyhow!("Invalid signature: {}", e))?;

        // Get transaction details
        let transaction = client.get_transaction_with_config(
            &signature_pubkey,
            solana_client::rpc_config::RpcTransactionConfig {
                encoding: Some(UiTransactionEncoding::JsonParsed),
                commitment: Some(solana_sdk::commitment_config::CommitmentConfig::confirmed()),
                max_supported_transaction_version: Some(0),
            },
        )?;

        self.analyze_transaction_details(signature, &chain_config.network, transaction)
            .await
    }

    async fn analyze_transaction_details(
        &self,
        signature: &str,
        network: &str,
        transaction: EncodedConfirmedTransactionWithStatusMeta,
    ) -> Result<SolanaTransactionAnalysis> {
        let meta = transaction
            .transaction
            .meta
            .clone()
            .ok_or_else(|| anyhow::anyhow!("Transaction meta not found"))?;

        // Extract transaction status
        let transaction_status = if meta.err.is_none() {
            "Success".to_string()
        } else {
            "Failed".to_string()
        };

        // Extract transaction fee
        let transaction_fee = meta.fee;

        // Extract SOL balance changes
        let sol_balance_changes = self.extract_sol_balance_changes(&transaction)?;

        // Extract token balance changes
        let token_balance_changes = self.extract_token_balance_changes(&transaction)?;

        // Extract compute units consumed
        let compute_units_consumed = meta.compute_units_consumed.unwrap();

        Ok(SolanaTransactionAnalysis {
            signature: signature.to_string(),
            network: network.to_string(),
            slot: Some(transaction.slot),
            transaction_fee: Some(transaction_fee),
            sol_balance_changes,
            token_balance_changes,
            transaction_status,
            block_time: transaction.block_time,
            compute_units_consumed: Some(compute_units_consumed),
        })
    }

    fn extract_sol_balance_changes(
        &self,
        transaction: &EncodedConfirmedTransactionWithStatusMeta,
    ) -> Result<Vec<SolBalanceChange>> {
        let mut balance_changes = Vec::new();

        if let Some(meta) = &transaction.transaction.meta {
            let pre_balances = &meta.pre_balances;
            let post_balances = &meta.post_balances;

            // Get account keys from the transaction
            if let Some(accounts) = self.get_account_keys(transaction) {
                for (i, account) in accounts.iter().enumerate() {
                    if i < pre_balances.len() && i < post_balances.len() {
                        let pre_balance = pre_balances[i];
                        let post_balance = post_balances[i];
                        let balance_change = post_balance as i64 - pre_balance as i64;

                        // Only include accounts with balance changes
                        if balance_change != 0 {
                            balance_changes.push(SolBalanceChange {
                                address: account.to_string(),
                                pre_balance,
                                post_balance,
                                balance_change,
                            });
                        }
                    }
                }
            }
        }

        Ok(balance_changes)
    }

    fn extract_token_balance_changes(
        &self,
        transaction: &EncodedConfirmedTransactionWithStatusMeta,
    ) -> Result<Vec<TokenBalanceChange>> {
        let mut token_changes = Vec::new();

        if let Some(meta) = &transaction.transaction.meta {
            let pre_token_balances = &meta.pre_token_balances;
            let post_token_balances = &meta.post_token_balances;

            // Create a map of account -> pre balance
            let mut pre_balances_map = HashMap::new();
            for balance in pre_token_balances.clone().unwrap() {
                let key = (balance.account_index, balance.mint.clone());
                pre_balances_map.insert(key, balance.clone());
            }

            // Process post balances and calculate changes
            for post_balance in post_token_balances.clone().unwrap() {
                let key = (post_balance.account_index, post_balance.mint.clone());
                if let Some(accounts) = self.get_account_keys(transaction) {
                    if let Some(account) = accounts.get(post_balance.account_index as usize) {
                        let pre_balance = pre_balances_map.get(&key);

                        let pre_amount =
                            pre_balance.and_then(|b| b.ui_token_amount.amount.parse::<u64>().ok());

                        let post_amount = post_balance.ui_token_amount.amount.parse::<u64>().ok();

                        let balance_change = match (pre_amount, post_amount) {
                            (Some(pre), Some(post)) => Some(post as i64 - pre as i64),
                            _ => None,
                        };

                        // Only include accounts with balance changes or new token accounts
                        if balance_change.is_some() && balance_change != Some(0) {
                            token_changes.push(TokenBalanceChange {
                                address: account.to_string(),
                                mint: post_balance.mint.clone(),
                                token_account: account.to_string(),
                                pre_balance: pre_amount,
                                post_balance: post_amount,
                                balance_change,
                            });
                        }
                    }
                }
            }
        }

        Ok(token_changes)
    }

    fn get_account_keys(
        &self,
        transaction: &EncodedConfirmedTransactionWithStatusMeta,
    ) -> Option<Vec<Pubkey>> {
        match &transaction.transaction.transaction {
            solana_transaction_status::EncodedTransaction::Json(ui_transaction) => {
                match &ui_transaction.message {
                    solana_transaction_status::UiMessage::Parsed(parsed_message) => {
                        return Some(
                            parsed_message
                                .account_keys
                                .iter()
                                .filter_map(|key| Pubkey::from_str(&key.pubkey).ok())
                                .collect(),
                        );
                    }
                    solana_transaction_status::UiMessage::Raw(raw_message) => {
                        return Some(
                            raw_message
                                .account_keys
                                .iter()
                                .filter_map(|key| Pubkey::from_str(key).ok())
                                .collect(),
                        );
                    }
                }
            }
            _ => return None,
        }
    }
}
