export interface ChainInfo {
  type: 'solana' | 'evm';
  chainId?: number;
  name: string;
}

export interface OrderInfo {
  orderId: string;
  status: string;
  service: string;
  sourceChain: {
    id: string;
    info: ChainInfo;
  };
  destChain: {
    id: string;
    info: ChainInfo;
  };
  swapChain: string;
  tokens: {
    from: {
      amount: string;
      symbol: string;
    };
    to: {
      amount: string;
      symbol: string;
    };
    expected: string;
  };
  transactions: {
    sourceTxHash: string;
    redeemTxHash?: string;
    fulfillTxHash?: string;
    allTransactions?: Array<{
      goals: string[];
      txHash: string;
    }>;
  };
  timing: {
    initiatedAt: string;
    completedAt: string;
  };
  contracts: {
    driverAddress: string;
    auctionAddress: string;
    stateAddr: string;
  };
}

export interface OnchainData {
  sourceTransaction?: any;
  fulfillTransaction?: any;
  unlockTransaction?: any;
  additionalCosts?: any;
}

export interface SwiftOrderAnalysis {
  success: boolean;
  orderInfo: OrderInfo;
  onchainData: OnchainData;
  extractionStatus: {
    sourceAnalyzed: boolean;
    fulfillAnalyzed: boolean;
    unlockAnalyzed: boolean;
    additionalCostsAnalyzed: boolean;
  };
  errors?: string[];
}

export interface ApiResponse {
  success: boolean;
  data?: SwiftOrderAnalysis;
  error?: string;
  timestamp: string;
} 