import express from 'express';
import { SwiftApiService } from './services/swift-api.js';
import { SolanaService } from './services/solana-service.js';
import { EvmService } from './services/evm-service.js';
import type { SwiftOrder } from './types/swift-order.js';
import type { 
  ApiResponse, 
  SwiftOrderAnalysis, 
  OrderInfo, 
  OnchainData, 
  ChainInfo 
} from './types/api-response.js';

// SWIFT chain ID mapping (different from standard chain IDs)
const SWIFT_CHAIN_MAPPING: Record<string, ChainInfo> = {
  '1': { type: 'solana', name: 'Solana' },
  '2': { type: 'evm', chainId: 1, name: 'Ethereum' },
  '4': { type: 'evm', chainId: 56, name: 'BSC' },
  '5': { type: 'evm', chainId: 137, name: 'Polygon' },
  '6': { type: 'evm', chainId: 43114, name: 'Avalanche' },
  '23': { type: 'evm', chainId: 42161, name: 'Arbitrum' },
  '30': { type: 'evm', chainId: 8453, name: 'Base' },
};

class SwiftTracker {
  private apiService: SwiftApiService;
  private solanaService: SolanaService;
  private evmServices: Map<number, EvmService>;

  constructor() {
    this.apiService = new SwiftApiService();
    this.solanaService = new SolanaService();
    this.evmServices = new Map();
  }

  /**
   * Extract onchain data for cost and profit calculations
   */
  async investigateOrder(orderId: string): Promise<SwiftOrderAnalysis> {
    const errors: string[] = [];
    let extractionStatus = {
      sourceAnalyzed: false,
      fulfillAnalyzed: false,
      unlockAnalyzed: false,
      additionalCostsAnalyzed: false
    };
    let onchainData: OnchainData = {};

    try {
      // Normalize and validate order ID
      const normalizedOrderId = SwiftApiService.normalizeOrderId(orderId);
      
      if (!SwiftApiService.isValidOrderId(normalizedOrderId)) {
        throw new Error(`Invalid order ID format: ${normalizedOrderId}`);
      }

      // Fetch order data from API
      const order = await this.apiService.getOrder(normalizedOrderId);
      
      // Convert order to structured format
      const orderInfo = this.buildOrderInfo(order);
      
      // Extract onchain data
      try {
        const extractionResult = await this.extractOnchainData(order);
        onchainData = extractionResult.onchainData;
        extractionStatus = extractionResult.extractionStatus;
        errors.push(...extractionResult.errors);
      } catch (error) {
        errors.push(`Onchain data extraction failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      
      return {
        success: true,
        orderInfo,
        onchainData,
        extractionStatus,
        errors: errors.length > 0 ? errors : undefined
      };
      
    } catch (error) {
      throw new Error(`Investigation failed: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  /**
   * Extract onchain data needed for cost and profit calculations
   */
  private async extractOnchainData(order: SwiftOrder): Promise<{
    onchainData: OnchainData;
    extractionStatus: typeof extractionStatus;
    errors: string[];
  }> {
    const errors: string[] = [];
    const onchainData: OnchainData = {};
    const extractionStatus = {
      sourceAnalyzed: false,
      fulfillAnalyzed: false,
      unlockAnalyzed: false,
      additionalCostsAnalyzed: false
    };

    try {
      // Determine source chain type
      const sourceChainInfo = SWIFT_CHAIN_MAPPING[order.sourceChain];
      
      if (!sourceChainInfo) {
        throw new Error(`Unsupported source chain: ${order.sourceChain}`);
      }

      // Extract source transaction data
      try {
        if (sourceChainInfo.type === 'solana') {
          onchainData.sourceTransaction = await this.extractSolanaData(order);
        } else {
          onchainData.sourceTransaction = await this.extractEvmData(order, sourceChainInfo.chainId!);
        }
        extractionStatus.sourceAnalyzed = true;
      } catch (error) {
        errors.push(`Source transaction analysis failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      
      // Analyze fulfill transaction
      try {
        const hasFulfillTx = order.fulfillTxHash || (order.txs && order.txs.some(tx => tx.goals.includes('FULFILL')));
        if (hasFulfillTx) {
          onchainData.fulfillTransaction = await this.extractFulfillData(order);
          extractionStatus.fulfillAnalyzed = true;
        }
      } catch (error) {
        errors.push(`Fulfill transaction analysis failed: ${error instanceof Error ? error.message : String(error)}`);
      }
      
      // Analyze unlock/redeem transaction for EVM source chains
      if (sourceChainInfo.type === 'evm') {
        try {
          onchainData.unlockTransaction = await this.extractUnlockData(order, sourceChainInfo.chainId!);
          extractionStatus.unlockAnalyzed = true;
        } catch (error) {
          errors.push(`Unlock transaction analysis failed: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
      return { onchainData, extractionStatus, errors };
      
    } catch (error) {
      errors.push(`Onchain data extraction failed: ${error instanceof Error ? error.message : String(error)}`);
      return { onchainData, extractionStatus, errors };
    }
  }

  /**
   * Extract data from Solana source transaction
   */
  private async extractSolanaData(order: SwiftOrder): Promise<any> {
    return await this.solanaService.parseSwiftSourceTransaction(order.sourceTxHash);
  }

  /**
   * Extract data from EVM source transaction
   */
  private async extractEvmData(order: SwiftOrder, evmChainId: number): Promise<any> {
    // Get or create EVM service for this chain
    if (!this.evmServices.has(evmChainId)) {
      this.evmServices.set(evmChainId, new EvmService(evmChainId));
    }
    
    const evmService = this.evmServices.get(evmChainId)!;
    return await evmService.parseSwiftSourceTransaction(order.sourceTxHash, order);
  }

  /**
   * Extract data from fulfill transaction
   */
  private async extractFulfillData(order: SwiftOrder): Promise<any> {
    // Look for FULFILL transaction in txs array first
    let fulfillTxHash = null;
    
    if (order.txs && order.txs.length > 0) {
      const fulfillTx = order.txs.find(tx => tx.goals.includes('FULFILL'));
      if (fulfillTx) {
        fulfillTxHash = fulfillTx.txHash;
      }
    }
    
    // Fall back to fulfillTxHash if no FULFILL found in txs array
    if (!fulfillTxHash) {
      fulfillTxHash = order.fulfillTxHash;
    }

    if (!fulfillTxHash) {
      throw new Error('No fulfill transaction hash available');
    }

    // Determine destination chain type
    const destChainInfo = SWIFT_CHAIN_MAPPING[order.destChain];
    
    if (!destChainInfo) {
      throw new Error(`Unsupported destination chain: ${order.destChain}`);
    }

    if (destChainInfo.type === 'evm') {
      // Get or create EVM service for destination chain
      if (!this.evmServices.has(destChainInfo.chainId!)) {
        this.evmServices.set(destChainInfo.chainId!, new EvmService(destChainInfo.chainId!));
      }
      
      const evmService = this.evmServices.get(destChainInfo.chainId!)!;
      return await evmService.parseSwiftFulfillTransaction(fulfillTxHash, order);
      
    } else {
      // Solana fulfill transaction parsing
      const fulfillData = await this.solanaService.parseSwiftFulfillTransaction(fulfillTxHash, order);
      
      // Also analyze additional transaction costs for Solana destinations
      try {
        const additionalCosts = await this.solanaService.parseMultipleTransactionCosts(order);
        return {
          fulfillData,
          additionalCosts
        };
      } catch (error) {
        return fulfillData;
      }
    }
  }

  /**
   * Extract data from unlock/redeem transaction (EVM source chains only)
   */
  private async extractUnlockData(order: SwiftOrder, evmChainId: number): Promise<any> {
    // Look for UNLOCK transaction in txs array first
    let unlockTxHash = null;
    
    if (order.txs && order.txs.length > 0) {
      const unlockTx = order.txs.find(tx => tx.goals.includes('UNLOCK'));
      if (unlockTx) {
        unlockTxHash = unlockTx.txHash;
      }
    }
    
    // Fall back to redeemTxHash if no UNLOCK found in txs array
    if (!unlockTxHash) {
      unlockTxHash = order.redeemTxHash;
    }

    if (!unlockTxHash) {
      throw new Error('No unlock/redeem transaction hash available');
    }

    // Get or create EVM service for source chain
    if (!this.evmServices.has(evmChainId)) {
      this.evmServices.set(evmChainId, new EvmService(evmChainId));
    }
    
    const evmService = this.evmServices.get(evmChainId)!;
    return await evmService.parseSwiftUnlockTransaction(unlockTxHash, order);
  }

  /**
   * Convert SwiftOrder to structured OrderInfo
   */
  private buildOrderInfo(order: SwiftOrder): OrderInfo {
    const sourceChainInfo = SWIFT_CHAIN_MAPPING[order.sourceChain];
    const destChainInfo = SWIFT_CHAIN_MAPPING[order.destChain];
    
    return {
      orderId: order.orderId,
      status: order.status,
      service: order.service,
      sourceChain: {
        id: order.sourceChain,
        info: sourceChainInfo || { type: 'evm', name: 'Unknown' }
      },
      destChain: {
        id: order.destChain,
        info: destChainInfo || { type: 'evm', name: 'Unknown' }
      },
      swapChain: order.swapChain,
      tokens: {
        from: {
          amount: order.fromAmount,
          symbol: order.fromTokenSymbol
        },
        to: {
          amount: order.toAmount,
          symbol: order.toTokenSymbol
        },
        expected: order.estimateMarketToAmount
      },
      transactions: {
        sourceTxHash: order.sourceTxHash,
        redeemTxHash: order.redeemTxHash || undefined,
        fulfillTxHash: order.fulfillTxHash || undefined,
        allTransactions: order.txs
      },
      timing: {
        initiatedAt: order.initiatedAt,
        completedAt: order.completedAt
      },
      contracts: {
        driverAddress: order.driverAddress,
        auctionAddress: order.auctionAddress,
        stateAddr: order.stateAddr
      }
    };
  }
}

// Create Express app
const app = express();
app.use(express.json());

// BigInt serialization helper
function serializeBigInt(obj: any): any {
  if (obj === null || obj === undefined) {
    return obj;
  }
  
  if (typeof obj === 'bigint') {
    return obj.toString();
  }
  
  if (Array.isArray(obj)) {
    return obj.map(serializeBigInt);
  }
  
  if (typeof obj === 'object') {
    const serialized: any = {};
    for (const [key, value] of Object.entries(obj)) {
      serialized[key] = serializeBigInt(value);
    }
    return serialized;
  }
  
  return obj;
}

// Add BigInt serialization support
app.set('json replacer', (key: string, value: any) => {
  if (typeof value === 'bigint') {
    return value.toString();
  }
  return value;
});

// Create tracker instance
const tracker = new SwiftTracker();

// Health check endpoint
app.get('/health', (req, res) => {
  res.json({ 
    status: 'healthy', 
    timestamp: new Date().toISOString(),
    service: 'swift-tracker'
  });
});

// Main API endpoint
app.post('/analyze/:orderId', async (req, res) => {
  const { orderId } = req.params;
  
  if (!orderId) {
    const response: ApiResponse = {
      success: false,
      error: 'Order ID is required',
      timestamp: new Date().toISOString()
    };
    return res.status(400).json(response);
  }

  try {
    const analysis = await tracker.investigateOrder(orderId);
    
    const response: ApiResponse = {
      success: true,
      data: serializeBigInt(analysis),
      timestamp: new Date().toISOString()
    };
    
    res.json(response);
    
  } catch (error) {
    const response: ApiResponse = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
    
    res.status(500).json(response);
  }
});

// GET endpoint for convenience
app.get('/analyze/:orderId', async (req, res) => {
  const { orderId } = req.params;
  
  if (!orderId) {
    const response: ApiResponse = {
      success: false,
      error: 'Order ID is required',
      timestamp: new Date().toISOString()
    };
    return res.status(400).json(response);
  }

  try {
    const analysis = await tracker.investigateOrder(orderId);
    
    const response: ApiResponse = {
      success: true,
      data: serializeBigInt(analysis),
      timestamp: new Date().toISOString()
    };
    
    res.json(response);
    
  } catch (error) {
    const response: ApiResponse = {
      success: false,
      error: error instanceof Error ? error.message : String(error),
      timestamp: new Date().toISOString()
    };
    
    res.status(500).json(response);
  }
});

// Start server
const PORT = process.env.PORT || 3000;

app.listen(PORT, () => {
  console.log(`🚀 SWIFT Tracker API Server running on port ${PORT}`);
  console.log(`📡 Health check: http://localhost:${PORT}/health`);
  console.log(`🔍 API endpoint: http://localhost:${PORT}/analyze/{orderId}`);
  console.log('━'.repeat(60));
});

export { app, tracker };