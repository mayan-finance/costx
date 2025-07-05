export interface SolanaTokenTransfer {
  programId: string;
  source: string;
  destination: string;
  authority: string;
  amount: string;
  tokenMint?: string;
  tokenSymbol?: string;
}

export interface SwiftLockInstruction {
  instructionIndex: number;
  programId: string;
  type: 'TOKEN_TRANSFER' | 'SWIFT_LOCK' | 'UNKNOWN';
  data: SolanaTokenTransfer | any;
}

export interface SolanaTransactionParsed {
  signature: string;
  slot: number;
  blockTime: number;
  fee: number;
  instructions: SwiftLockInstruction[];
  lockInstruction?: SwiftLockInstruction;
  lockedAmount?: string;
  lockedToken?: string;
  balanceChanges: SolanaBalanceChange[];
  detectedLocks: SolanaAssetLock[];
  totalLockedAssets: number;
}

export interface SolanaFulfillTransactionParsed {
  signature: string;
  slot: number;
  blockTime: number;
  fee: number;
  feeInSol: string;
  solTransfers: SolTransferParsed[];
  splTokenTransfers: SplTokenTransferParsed[];
  solver?: string; // The account that initiated the transaction
  totalTransfers: number;
}

export interface SolTransferParsed {
  from: string;
  to: string;
  amount: number;
  amountInSol: string;
  instructionIndex: number;
}

export interface SplTokenTransferParsed {
  tokenMint: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  from: string;
  to: string;
  rawAmount: string;
  formattedAmount?: string;
  instructionIndex: number;
  authority?: string;
}

export interface SolanaConnectionConfig {
  endpoint: string;
  commitment?: 'processed' | 'confirmed' | 'finalized';
}

// New interfaces for multi-transaction cost analysis
export interface SolanaTransactionCost {
  signature: string;
  transactionType: string; // CLOSE, SETTLE, REGISTER_ORDER, etc.
  slot: number;
  blockTime: number;
  fee: number;
  feeInSol: string;
  from?: string; // Transaction signer/payer
  success: boolean;
  // SOL balance changes for the signer
  solBalanceChange: number; // in lamports (positive = income, negative = additional cost)
  solBalanceChangeInSol: string;
  netCost: number; // fee - solBalanceChange (actual cost after considering rent returns)
  netCostInSol: string;
}

export interface SolanaMultiTransactionCostAnalysis {
  transactions: SolanaTransactionCost[];
  totalCosts: {
    totalFeeLamports: number;
    totalFeeInSol: string;
    totalSolBalanceChange: number; // Total SOL balance changes
    totalSolBalanceChangeInSol: string;
    netTotalCost: number; // Total fees minus total balance changes
    netTotalCostInSol: string;
    transactionCount: number;
  };
  costsByType: Record<string, {
    count: number;
    totalFeeLamports: number;
    totalFeeInSol: string;
    totalSolBalanceChange: number;
    totalSolBalanceChangeInSol: string;
    netTotalCost: number;
    netTotalCostInSol: string;
  }>;
}

// New interfaces for balance change detection
export interface SolanaBalanceChange {
  accountIndex: number;
  accountAddress: string;
  owner?: string;
  changeType: 'SOL' | 'SPL_TOKEN';
  
  // For SOL changes
  solBalanceChange?: number; // in lamports
  solBalanceChangeInSol?: string;
  
  // For SPL token changes
  tokenMint?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  tokenBalanceChange?: string; // raw amount
  tokenBalanceChangeFormatted?: string;
}

export interface SolanaAssetLock {
  lockType: 'SOL' | 'SPL_TOKEN';
  amount: string;
  formattedAmount: string;
  tokenMint?: string;
  tokenSymbol?: string;
  tokenDecimals?: number;
  fromAccount: string;
  authority?: string;
} 