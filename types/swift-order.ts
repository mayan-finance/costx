export interface SwiftTransaction {
  txHash: string;
  goals: string[];
  scannerUrl: string;
}

export interface SwiftStep {
  title: string;
  status: string;
  type: string;
}

export interface SwiftOrder {
  id: string;
  trader: string;
  traderLedger: string | null;
  sourceTxHash: string;
  orderId: string;
  sourceTxBlockNo: number;
  status: string;
  
  // Sequences
  transferSequence: string | null;
  swapSequence: string | null;
  redeemSequence: string | null;
  refundSequence: string | null;
  fulfillSequence: string | null;
  
  // Timing
  deadline: string;
  savedAt: string;
  initiatedAt: string;
  completedAt: string;
  attestedAt: string | null;
  statusUpdatedAt: string;
  syncRequestedAt: string | null;
  
  // Chain and token info
  sourceChain: string;
  swapChain: string;
  destChain: string;
  destAddress: string;
  
  // From token
  fromTokenAddress: string;
  fromTokenChain: string;
  fromTokenSymbol: string;
  fromAmount: string;
  fromAmount64: string;
  fromTokenPrice: number;
  fromTokenLogoUri: string;
  fromTokenScannerUrl: string;
  
  // To token
  toTokenAddress: string;
  toTokenChain: string;
  toTokenSymbol: string;
  toAmount: string;
  estimateMarketToAmount: string;
  toTokenPrice: number;
  toTokenLogoUri: string;
  toTokenScannerUrl: string;
  
  // State and auction
  stateAddr: string;
  stateNonce: string | null;
  auctionAddress: string;
  auctionMode: number;
  stateOpen: boolean | null;
  auctionStateAddr: string;
  auctionStateNonce: string | null;
  
  // Fees and amounts
  bridgeFee: string;
  swapRelayerFee: string | null;
  redeemRelayerFee: string;
  refundRelayerFee: string;
  submissionRelayerFee: string;
  redeemTxFee: string | null;
  refundTxFee: string | null;
  clientRelayerFeeSuccess: string | null;
  clientRelayerFeeRefund: string;
  
  // Protocol fees
  mayanBps: number;
  referrerBps: number;
  referrerAddress: string;
  
  // Min amounts and slippage
  minAmountOut: string;
  minAmountOut64: string;
  
  // Gas and native tokens
  gasDrop: string;
  gasDrop64: string;
  fromChainNativeTokenPrice: number;
  toChainNativeTokenPrice: number;
  
  // Transaction hashes
  redeemTxHash: string | null;
  refundTxHash: string | null;
  fulfillTxHash: string | null;
  createTxHash: string;
  unlockTxHash: string | null;
  
  // Refund info
  refundAmount: string;
  refundTokenLogoUri: string;
  refundTokenScannerUrl: string;
  refundTokenSymbol: string;
  refundChain: string;
  refundTokenAddress: string;
  
  // Other fields
  insufficientFees: boolean;
  retries: number;
  driverAddress: string;
  relayerAddress: string | null;
  batchFulfilled: boolean;
  service: string;
  orderHash: string;
  randomKey: string;
  
  // Arrays
  txs?: SwiftTransaction[];
  steps: SwiftStep[];
  
  // Status
  clientStatus: string;
  
  // Additional fields that might be null
  [key: string]: any;
}

export interface CostAnalysis {
  totalFees: number;
  bridgeFee: number;
  relayerFees: {
    redeem: number;
    refund: number;
    submission: number;
    total: number;
  };
  protocolFees: {
    mayan: number;
    referrer: number;
    total: number;
  };
  estimatedGasCosts: {
    source: number;
    destination: number;
    total: number;
  };
}

export interface ProfitAnalysis {
  expectedOutput: number;
  actualOutput: number;
  slippage: number;
  netProfit: number;
  profitPercentage: number;
} 