export interface EvmConnectionConfig {
  rpcUrl: string;
  chainId: number;
}

export interface SwiftOrderParams {
  trader: string;
  tokenOut: string;
  minAmountOut: bigint;
  gasDrop: bigint;
  cancelFee: bigint;
  refundFee: bigint;
  deadline: bigint;
  destAddr: string;
  destChainId: number;
  referrerAddr: string;
  referrerBps: number;
  auctionMode: number;
  random: string;
}

export interface SwiftCreateOrderCall {
  functionName: 'createOrderWithToken' | 'createOrderWithEth' | 'createOrderWithSig';
  tokenIn?: string; // undefined for ETH
  amountIn?: bigint; // undefined for ETH (uses msg.value)
  params: SwiftOrderParams;
  submissionFee?: bigint; // for createOrderWithSig
  ethValue?: bigint; // msg.value for ETH transactions
}

export interface SwiftOrderCreatedEvent {
  orderHash: string;
  blockNumber: number;
  transactionHash: string;
  logIndex: number;
}

export interface EvmTransactionParsed {
  hash: string;
  blockNumber: number;
  blockTimestamp: number;
  from: string;
  to: string;
  value: bigint;
  gasUsed: bigint;
  gasPrice: bigint;
  
  // SWIFT-specific data
  swiftCall?: SwiftCreateOrderCall;
  orderCreatedEvent?: SwiftOrderCreatedEvent;
  lockedAmount?: bigint;
  lockedToken?: string;
  lockedTokenSymbol?: string;
}

export interface EvmFulfillTransactionParsed {
  hash: string;
  blockNumber: number;
  blockTimestamp: number;
  from: string; // Solver address
  to: string;
  value: bigint;
  gasUsed: bigint;
  gasPrice: bigint;
  gasCost: bigint;
  gasCostInEth: string;
  tokenTransfers: TokenTransferParsed[];
  swiftEvents: SwiftFulfillEvent[];
  nativeTokenSymbol: string;
  ethTransferAmount: bigint;
  ethTransferRecipient?: string;
}

export interface TokenTransferParsed {
  tokenAddress: string;
  tokenSymbol: string;
  tokenDecimals: number;
  from: string;
  to: string;
  rawAmount: bigint;
  formattedAmount: string;
  logIndex: number;
}

export interface SwiftFulfillEvent {
  eventName: string;
  orderHash: string;
  solver: string;
  amount: bigint;
  logIndex: number;
  contractAddress: string;
}

// New interfaces for unlock/redeem transaction analysis
export interface EvmUnlockTransactionParsed {
  hash: string;
  blockNumber: number;
  blockTimestamp: number;
  from: string; // Who initiated the unlock (usually solver)
  to: string;
  value: bigint;
  gasUsed: bigint;
  gasPrice: bigint;
  gasCost: bigint;
  gasCostInEth: string;
  
  // Unlocked assets
  unlockedTokenTransfers: TokenTransferParsed[];
  unlockedEthAmount: bigint;
  unlockedEthRecipient?: string;
  
  // SWIFT unlock events and orders
  orderUnlockedEvents: OrderUnlockedEvent[];
  unlockedOrderHashes: string[];
  totalUnlockedOrders: number;
  gasCostPerOrder: bigint;
  gasCostPerOrderInEth: string;
  
  // Other SWIFT events
  swiftUnlockEvents: SwiftUnlockEvent[];
  nativeTokenSymbol: string;
  
  // Summary
  totalUnlockedAssets: number;
  unlockInitiator: string; // Address that initiated the unlock
}

export interface OrderUnlockedEvent {
  orderHash: string;
  logIndex: number;
  contractAddress: string;
}

export interface SwiftUnlockEvent {
  eventName: string;
  orderHash: string;
  recipient: string;
  amount: bigint;
  logIndex: number;
  contractAddress: string;
}

export interface ChainConfig {
  chainId: number;
  name: string;
  rpcUrl: string;
  nativeToken: {
    symbol: string;
    decimals: number;
  };
}

// Common EVM chain configurations
export const CHAIN_CONFIGS: Record<number, ChainConfig> = {
  1: {
    chainId: 1,
    name: 'Ethereum',
    rpcUrl: 'https://eth.llamarpc.com',
    nativeToken: { symbol: 'ETH', decimals: 18 }
  },
  137: {
    chainId: 137,
    name: 'Polygon',
    rpcUrl: 'https://rpc-center.mayan.finance/polygon',
    nativeToken: { symbol: 'POL', decimals: 18 }
  },
  42161: {
    chainId: 42161,
    name: 'Arbitrum',
    rpcUrl: 'https://arb1.arbitrum.io/rpc',
    nativeToken: { symbol: 'ETH', decimals: 18 }
  },
  8453: {
    chainId: 8453,
    name: 'Base',
    rpcUrl: 'https://base.llamarpc.com',
    nativeToken: { symbol: 'ETH', decimals: 18 }
  },
  56: {
    chainId: 56,
    name: 'BSC',
    rpcUrl: 'https://bsc.llamarpc.com',
    nativeToken: { symbol: 'BNB', decimals: 18 }
  },
  43114: {
    chainId: 43114,
    name: 'Avalanche',
    rpcUrl: 'https://avalanche.llamarpc.com',
    nativeToken: { symbol: 'AVAX', decimals: 18 }
  }
}; 