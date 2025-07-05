import { ethers } from 'ethers';
import type { 
  EvmConnectionConfig,
  EvmTransactionParsed,
  SwiftCreateOrderCall,
  SwiftOrderCreatedEvent,
  ChainConfig,
  EvmFulfillTransactionParsed,
  TokenTransferParsed,
  SwiftFulfillEvent,
  EvmUnlockTransactionParsed,
  SwiftUnlockEvent,
  OrderUnlockedEvent
} from '../types/evm-transaction.js';
import { CHAIN_CONFIGS } from '../types/evm-transaction.js';
import type { SwiftOrder } from '../types/swift-order.js';

// SWIFT Contract ABI - focusing on the functions we need to parse
const SWIFT_CONTRACT_ABI = [
  "function createOrderWithToken(address tokenIn, uint256 amountIn, tuple(bytes32 trader, bytes32 tokenOut, uint64 minAmountOut, uint64 gasDrop, uint64 cancelFee, uint64 refundFee, uint64 deadline, bytes32 destAddr, uint16 destChainId, bytes32 referrerAddr, uint8 referrerBps, uint8 auctionMode, bytes32 random) params) returns (bytes32 orderHash)",
  "function createOrderWithEth(tuple(bytes32 trader, bytes32 tokenOut, uint64 minAmountOut, uint64 gasDrop, uint64 cancelFee, uint64 refundFee, uint64 deadline, bytes32 destAddr, uint16 destChainId, bytes32 referrerAddr, uint8 referrerBps, uint8 auctionMode, bytes32 random) params) payable returns (bytes32 orderHash)",
  "function createOrderWithSig(address tokenIn, uint256 amountIn, tuple(bytes32 trader, bytes32 tokenOut, uint64 minAmountOut, uint64 gasDrop, uint64 cancelFee, uint64 refundFee, uint64 deadline, bytes32 destAddr, uint16 destChainId, bytes32 referrerAddr, uint8 referrerBps, uint8 auctionMode, bytes32 random) params, uint256 submissionFee, bytes signedOrderHash, tuple(uint256 value, uint256 deadline, uint8 v, bytes32 r, bytes32 s) permitParams) returns (bytes32 orderHash)",
  "event OrderCreated(bytes32 key)"
];

export class EvmService {
  private provider: ethers.JsonRpcProvider;
  private swiftContract: ethers.Contract;
  private chainConfig: ChainConfig;

  constructor(chainId: number, customRpcUrl?: string) {
    this.chainConfig = CHAIN_CONFIGS[chainId];
    
    if (!this.chainConfig) {
      throw new Error(`Unsupported chain ID: ${chainId}`);
    }

    const rpcUrl = customRpcUrl || this.chainConfig.rpcUrl;
    this.provider = new ethers.JsonRpcProvider(rpcUrl);
    
    // SWIFT contract address is the same on all EVM chains
    const SWIFT_CONTRACT_ADDRESS = '0xc38e4e6a15593f908255214653d3d947ca1c2338';
    this.swiftContract = new ethers.Contract(SWIFT_CONTRACT_ADDRESS, SWIFT_CONTRACT_ABI, this.provider);
  }

  /**
   * Parse a SWIFT source transaction from EVM chain
   */
  async parseSwiftSourceTransaction(txHash: string, orderData?: SwiftOrder): Promise<EvmTransactionParsed> {
    try {
      console.log(`🔍 Fetching EVM transaction: ${txHash} on ${this.chainConfig.name}`);
      
      // Fetch transaction and receipt in parallel
      const [tx, receipt] = await Promise.all([
        this.provider.getTransaction(txHash),
        this.provider.getTransactionReceipt(txHash)
      ]);

      if (!tx || !receipt) {
        throw new Error(`Transaction not found: ${txHash}`);
      }

      console.log(`✅ Transaction found in block: ${tx.blockNumber}`);
      
      // Get block timestamp
      const block = await this.provider.getBlock(tx.blockNumber!);
      
             // Parse SWIFT contract interaction
       const swiftCall = this.parseSwiftCall(tx, receipt);
       const orderCreatedEvent = this.parseOrderCreatedEvent(receipt);
      
             // Extract locked amount and token
       let lockedAmount: bigint | undefined;
       let lockedToken: string | undefined;
       let lockedTokenSymbol: string | undefined;
       
       if (swiftCall) {
         if (swiftCall.functionName === 'createOrderWithEth') {
           // Use the detected ETH value, or fallback to transaction value
           lockedAmount = swiftCall.ethValue || tx.value;
           lockedToken = 'ETH';
           lockedTokenSymbol = this.chainConfig.nativeToken.symbol;
           
           // If still no amount detected but we have order data, use API data as fallback
           if ((!lockedAmount || lockedAmount === 0n) && orderData) {
             try {
               const apiAmountStr = orderData.fromAmount.toString();
               lockedAmount = ethers.parseEther(apiAmountStr);
               console.log(`📊 Using API data as fallback: ${apiAmountStr} ${this.chainConfig.nativeToken.symbol}`);
             } catch (error) {
               console.warn('Failed to parse API amount as ETH:', error);
             }
           }
           
           // If still no amount detected, log a warning
           if (!lockedAmount || lockedAmount === 0n) {
             console.warn('⚠️  ETH transaction detected but amount could not be determined from onchain data or API fallback.');
           }
         } else if (swiftCall.amountIn) {
           lockedAmount = swiftCall.amountIn;
           lockedToken = swiftCall.tokenIn;
           // Try to get token symbol (could be improved with token metadata lookup)
           lockedTokenSymbol = await this.getTokenSymbol(swiftCall.tokenIn!);
         }
       }

      return {
        hash: tx.hash,
        blockNumber: tx.blockNumber!,
        blockTimestamp: block!.timestamp,
        from: tx.from,
        to: tx.to!,
        value: tx.value,
        gasUsed: receipt.gasUsed,
        gasPrice: tx.gasPrice!,
        swiftCall,
        orderCreatedEvent,
        lockedAmount,
        lockedToken,
        lockedTokenSymbol
      };

    } catch (error) {
      console.error(`❌ Failed to parse EVM transaction ${txHash}:`, error);
      throw error;
    }
  }

  /**
   * Parse SWIFT contract function call from transaction (handles both direct and internal calls)
   */
  private parseSwiftCall(tx: ethers.TransactionResponse, receipt?: ethers.TransactionReceipt): SwiftCreateOrderCall | undefined {
    try {
      // First, try direct call to SWIFT contract
      if (tx.to?.toLowerCase() === this.swiftContract.target.toString().toLowerCase()) {
        return this.parseDirectSwiftCall(tx);
      }

      // If not a direct call, look for internal calls through logs
      if (receipt) {
        return this.parseInternalSwiftCall(tx, receipt);
      }

    } catch (error) {
      console.warn('Failed to parse SWIFT call:', error);
    }

    return undefined;
  }

  /**
   * Parse direct SWIFT contract call
   */
  private parseDirectSwiftCall(tx: ethers.TransactionResponse): SwiftCreateOrderCall | undefined {
    try {
      const iface = new ethers.Interface(SWIFT_CONTRACT_ABI);
      const decoded = iface.parseTransaction({
        data: tx.data,
        value: tx.value
      });

      if (!decoded) return undefined;

      const functionName = decoded.name as 'createOrderWithToken' | 'createOrderWithEth' | 'createOrderWithSig';
      
      if (!['createOrderWithToken', 'createOrderWithEth', 'createOrderWithSig'].includes(functionName)) {
        return undefined;
      }

      // Parse based on function type
      if (functionName === 'createOrderWithEth') {
        return {
          functionName,
          params: this.parseOrderParams(decoded.args[0]),
          ethValue: tx.value
        };
      } else if (functionName === 'createOrderWithToken') {
        return {
          functionName,
          tokenIn: decoded.args[0],
          amountIn: decoded.args[1],
          params: this.parseOrderParams(decoded.args[2])
        };
      } else if (functionName === 'createOrderWithSig') {
        return {
          functionName,
          tokenIn: decoded.args[0],
          amountIn: decoded.args[1],
          params: this.parseOrderParams(decoded.args[2]),
          submissionFee: decoded.args[3]
        };
      }
    } catch (error) {
      console.warn('Failed to parse direct SWIFT call:', error);
    }

    return undefined;
  }

     /**
    * Parse internal SWIFT contract call by analyzing logs and traces
    */
   private parseInternalSwiftCall(tx: ethers.TransactionResponse, receipt: ethers.TransactionReceipt): SwiftCreateOrderCall | undefined {
     try {
       // Look for ERC20 Transfer events TO the SWIFT contract (indicating token lock)
       const erc20Interface = new ethers.Interface([
         "event Transfer(address indexed from, address indexed to, uint256 value)"
       ]);

       const swiftContractAddress = this.swiftContract.target.toString().toLowerCase();
       
       // Common WETH addresses by chain
       const wethAddresses: Record<number, string> = {
         1: '0xc02aaa39b223fe8d0a0e5c4f27ead9083c756cc2',     // Ethereum
         42161: '0x82af49447d8a07e3bd95bd0d56f35241523fbab1',  // Arbitrum
         8453: '0x4200000000000000000000000000000000000006',   // Base
         137: '0x0d500b1d8e8ef31e21c99d1db9a6444d3adf1270',   // Polygon (WMATIC)
         43114: '0xb31f66aa3c1e785363f0875a1b74e27b85fd66c7',  // Avalanche (WAVAX)
         56: '0xbb4cdb9cbd36b01bd1cbaebf2de08d9173bc095c'     // BSC (WBNB)
       };
       
       let detectedEthAmount: bigint | undefined;
       
       for (const log of receipt.logs) {
         try {
           const parsed = erc20Interface.parseLog({
             topics: log.topics,
             data: log.data
           });
           
           if (parsed && parsed.name === 'Transfer') {
             const from = parsed.args[0].toLowerCase();
             const to = parsed.args[1].toLowerCase();
             const value = parsed.args[2];
             
             // Check if this is a transfer TO the SWIFT contract (from anyone)
             if (to === swiftContractAddress) {
               const tokenAddress = log.address.toLowerCase();
               
               // Check if this is WETH/native token wrapper transfer
               const chainWethAddress = wethAddresses[this.chainConfig.chainId]?.toLowerCase();
               if (chainWethAddress && tokenAddress === chainWethAddress) {
                 // This is a WETH (or equivalent) transfer to SWIFT - treat as ETH
                 detectedEthAmount = value;
                 console.log(`🔍 Detected WETH transfer to SWIFT: ${ethers.formatEther(value)} ${this.chainConfig.nativeToken.symbol}`);
                 return {
                   functionName: 'createOrderWithEth',
                   params: {} as any,
                   ethValue: value
                 };
               } else {
                 // Regular ERC20 token transfer
                 return {
                   functionName: 'createOrderWithToken',
                   tokenIn: log.address, // The token contract address
                   amountIn: value,
                   params: {} as any // We'll extract this from OrderCreated event if needed
                 };
               }
             }
           }
         } catch (e) {
           // Skip logs that aren't Transfer events
           continue;
         }
       }

       // Check if there's an OrderCreated event (indicating SWIFT was called)
       const hasOrderCreatedEvent = this.parseOrderCreatedEvent(receipt) !== undefined;
       
       // If no token transfer found but OrderCreated event exists, check if ETH was sent
       if (hasOrderCreatedEvent && tx.value > 0n) {
         return {
           functionName: 'createOrderWithEth',
           params: {} as any,
           ethValue: tx.value
         };
       }

       // Fallback: if no token transfer and no transaction value, but OrderCreated exists,
       // this is likely a complex ETH transaction through a router
       if (hasOrderCreatedEvent) {
         console.warn('⚠️  OrderCreated event found but no token transfers or ETH value detected. This might be a complex internal ETH transaction.');
         
         // For complex router transactions, we'll return a createOrderWithEth but with 0 value
         // The calling function should handle this case and try to get the amount from API data
         return {
           functionName: 'createOrderWithEth',
           params: {} as any,
           ethValue: tx.value || 0n // Will be refined in the calling function if needed
         };
       }

     } catch (error) {
       console.warn('Failed to parse internal SWIFT call:', error);
     }

     return undefined;
   }

  /**
   * Parse OrderCreated event from transaction receipt
   */
  private parseOrderCreatedEvent(receipt: ethers.TransactionReceipt): SwiftOrderCreatedEvent | undefined {
    try {
      const iface = new ethers.Interface(SWIFT_CONTRACT_ABI);
      
      for (const log of receipt.logs) {
        try {
          const parsed = iface.parseLog({
            topics: log.topics,
            data: log.data
          });
          
          if (parsed && parsed.name === 'OrderCreated') {
            return {
              orderHash: parsed.args[0],
              blockNumber: receipt.blockNumber,
              transactionHash: receipt.hash,
              logIndex: log.index
            };
          }
        } catch (e) {
          // Skip logs that aren't from our contract
          continue;
        }
      }
    } catch (error) {
      console.warn('Failed to parse OrderCreated event:', error);
    }

    return undefined;
  }

  /**
   * Parse order parameters from function arguments
   */
  private parseOrderParams(params: any): any {
    return {
      trader: params[0],
      tokenOut: params[1],
      minAmountOut: params[2],
      gasDrop: params[3],
      cancelFee: params[4],
      refundFee: params[5],
      deadline: params[6],
      destAddr: params[7],
      destChainId: params[8],
      referrerAddr: params[9],
      referrerBps: params[10],
      auctionMode: params[11],
      random: params[12]
    };
  }

  /**
   * Get human-readable transaction summary
   */
  static getTransactionSummary(parsed: EvmTransactionParsed, chainConfig: ChainConfig): string {
    const lockInfo = parsed.swiftCall;
    const eventInfo = parsed.orderCreatedEvent;

    return `
🔗 EVM SOURCE TRANSACTION ANALYSIS (${chainConfig.name})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 Transaction Details:
   • Hash: ${parsed.hash}
   • Block: ${parsed.blockNumber}
   • Timestamp: ${new Date(parsed.blockTimestamp * 1000).toISOString()}
   • From: ${parsed.from}
   • Gas Used: ${parsed.gasUsed.toLocaleString()}

 🔒 LOCK OPERATION:
 ${lockInfo ? `   • Function: ${lockInfo.functionName}
    • Token: ${parsed.lockedTokenSymbol || parsed.lockedToken || 'Unknown'}
    • Raw Amount: ${parsed.lockedAmount?.toString() || 'Unknown'}
    ${lockInfo.functionName === 'createOrderWithEth' ? `• ETH Value: ${ethers.formatEther(lockInfo.ethValue || 0n)}` : ''}
    ${lockInfo.tokenIn ? `• Token Address: ${lockInfo.tokenIn}` : ''}` : '   • No SWIFT lock operation found'}

📅 ORDER CREATED EVENT:
${eventInfo ? `   • Order Hash: ${eventInfo.orderHash}
   • Log Index: ${eventInfo.logIndex}` : '   • No OrderCreated event found'}

💰 EXTRACTED DATA:
   • Locked Amount: ${parsed.lockedAmount || 'Not found'}
   • Locked Token: ${parsed.lockedTokenSymbol || parsed.lockedToken || 'Not found'}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  }

  /**
   * Get token symbol from contract (basic implementation)
   */
  private async getTokenSymbol(tokenAddress: string): Promise<string | undefined> {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, [
        "function symbol() view returns (string)"
      ], this.provider);
      
      return await tokenContract.symbol();
    } catch (error) {
      console.warn(`Failed to get token symbol for ${tokenAddress}:`, error);
      return undefined;
    }
  }

  /**
   * Get chain configuration
   */
  getChainConfig(): ChainConfig {
    return this.chainConfig;
  }

  /**
   * Parse a SWIFT fulfill transaction from EVM chain
   */
  async parseSwiftFulfillTransaction(txHash: string, orderData?: SwiftOrder): Promise<EvmFulfillTransactionParsed> {
    try {
      console.log(`🔍 Fetching EVM fulfill transaction: ${txHash} on ${this.chainConfig.name}`);
      
      // Fetch transaction and receipt in parallel
      const [tx, receipt] = await Promise.all([
        this.provider.getTransaction(txHash),
        this.provider.getTransactionReceipt(txHash)
      ]);

      if (!tx || !receipt) {
        throw new Error(`Transaction not found: ${txHash}`);
      }

      console.log(`✅ Fulfill transaction found in block: ${tx.blockNumber}`);
      
      // Get block timestamp
      const block = await this.provider.getBlock(tx.blockNumber!);
      
      // Calculate gas costs
      const gasUsed = receipt.gasUsed;
      const gasPrice = tx.gasPrice || 0n;
      const gasCost = gasUsed * gasPrice;
      
      // Parse token transfers (solver sending tokens to recipient)
      const tokenTransfers = await this.parseTokenTransfers(receipt, tx.from);
      
      // Parse any SWIFT-related events (like OrderFulfilled)
      const swiftEvents = this.parseSwiftFulfillEvents(receipt);
      
      // Check for ETH transfers from solver
      let ethTransferAmount: bigint = 0n;
      let ethTransferRecipient: string | undefined;
      
      if (tx.value > 0n) {
        // Direct ETH transfer to the 'to' address
        ethTransferAmount = tx.value;
        ethTransferRecipient = tx.to!;
        console.log(`🔍 Detected direct ETH transfer: ${ethers.formatEther(tx.value)} ${this.chainConfig.nativeToken.symbol} to ${tx.to}`);
      }

      return {
        hash: tx.hash,
        blockNumber: tx.blockNumber!,
        blockTimestamp: block!.timestamp,
        from: tx.from, // This is the solver
        to: tx.to!,
        value: tx.value,
        gasUsed,
        gasPrice,
        gasCost,
        gasCostInEth: ethers.formatEther(gasCost),
        tokenTransfers,
        swiftEvents,
        nativeTokenSymbol: this.chainConfig.nativeToken.symbol,
        ethTransferAmount,
        ethTransferRecipient
      };

    } catch (error) {
      console.error(`❌ Failed to parse EVM fulfill transaction ${txHash}:`, error);
      throw error;
    }
  }

  /**
   * Parse token transfers from transaction receipt
   */
  private async parseTokenTransfers(receipt: ethers.TransactionReceipt, solverAddress: string): Promise<TokenTransferParsed[]> {
    const transfers: TokenTransferParsed[] = [];
    
    const erc20Interface = new ethers.Interface([
      "event Transfer(address indexed from, address indexed to, uint256 value)"
    ]);

    const solverAddressLower = solverAddress.toLowerCase();
    const swiftContractAddress = this.swiftContract.target.toString().toLowerCase();
    
    for (const log of receipt.logs) {
      try {
        const parsed = erc20Interface.parseLog({
          topics: log.topics,
          data: log.data
        });
        
        if (parsed && parsed.name === 'Transfer') {
          const from = parsed.args[0].toLowerCase();
          const to = parsed.args[1].toLowerCase();
          const value = parsed.args[2];
          
          // We're interested in transfers FROM the solver OR from SWIFT contract (if solver funded it)
          // This catches both direct transfers and transfers through SWIFT contract
          const isFromSolver = from === solverAddressLower;
          const isFromSwift = from === swiftContractAddress;
          
          if (isFromSolver || isFromSwift) {
            // Try to get token symbol and decimals
            const tokenSymbol = await this.getTokenSymbol(log.address);
            const tokenDecimals = await this.getTokenDecimals(log.address);
            
            const transfer: TokenTransferParsed = {
              tokenAddress: log.address,
              tokenSymbol: tokenSymbol || 'Unknown',
              tokenDecimals: tokenDecimals || 18,
              from,
              to,
              rawAmount: value,
              formattedAmount: ethers.formatUnits(value, tokenDecimals || 18),
              logIndex: log.index
            };
            
            transfers.push(transfer);
            
            if (isFromSwift) {
              console.log(`🔍 Detected token transfer through SWIFT contract: ${transfer.formattedAmount} ${transfer.tokenSymbol}`);
            }
          }
        }
      } catch (e) {
        // Skip logs that aren't Transfer events
        continue;
      }
    }
    
    return transfers;
  }

  /**
   * Parse SWIFT fulfill events from transaction receipt
   */
  private parseSwiftFulfillEvents(receipt: ethers.TransactionReceipt): SwiftFulfillEvent[] {
    const events: SwiftFulfillEvent[] = [];
    
    // Common SWIFT fulfill event signatures (you may need to add more based on actual contract)
    const fulfillEvents = [
      "event OrderFulfilled(bytes32 indexed orderHash, address indexed solver, uint256 amount)",
      "event SwiftFulfill(bytes32 indexed orderHash, address indexed fulfiller, uint256 amount)"
    ];
    
    for (const eventSig of fulfillEvents) {
      try {
        const iface = new ethers.Interface([eventSig]);
        
        for (const log of receipt.logs) {
          try {
            const parsed = iface.parseLog({
              topics: log.topics,
              data: log.data
            });
            
            if (parsed) {
              events.push({
                eventName: parsed.name,
                orderHash: parsed.args[0],
                solver: parsed.args[1],
                amount: parsed.args[2],
                logIndex: log.index,
                contractAddress: log.address
              });
            }
          } catch (e) {
            // Skip logs that don't match this event signature
            continue;
          }
        }
      } catch (e) {
        // Skip invalid event signatures
        continue;
      }
    }
    
    return events;
  }

  /**
   * Get token decimals from contract
   */
  private async getTokenDecimals(tokenAddress: string): Promise<number | undefined> {
    try {
      const tokenContract = new ethers.Contract(tokenAddress, [
        "function decimals() view returns (uint8)"
      ], this.provider);
      
      return await tokenContract.decimals();
    } catch (error) {
      console.warn(`Failed to get token decimals for ${tokenAddress}:`, error);
      return undefined;
    }
  }

  /**
   * Get human-readable fulfill transaction summary
   */
  static getFulfillTransactionSummary(parsed: EvmFulfillTransactionParsed, chainConfig: ChainConfig): string {
    const { tokenTransfers, gasCost, gasCostInEth, nativeTokenSymbol, ethTransferAmount, ethTransferRecipient } = parsed;

    let transfersInfo = '';
    
    // Show ETH transfers first
    if (ethTransferAmount > 0n) {
      transfersInfo += `   • Sent: ${ethers.formatEther(ethTransferAmount)} ${nativeTokenSymbol} to ${ethTransferRecipient}\n`;
    }
    
    // Then show token transfers
    if (tokenTransfers.length > 0) {
      transfersInfo += tokenTransfers.map(transfer => 
        `   • Sent: ${transfer.formattedAmount} ${transfer.tokenSymbol} to ${transfer.to}`
      ).join('\n');
    }
    
    if (transfersInfo === '') {
      transfersInfo = '   • No transfers from solver detected';
    }

    let eventsInfo = '';
    if (parsed.swiftEvents.length > 0) {
      eventsInfo = parsed.swiftEvents.map(event => 
        `   • ${event.eventName}: ${event.orderHash.slice(0, 10)}...`
      ).join('\n');
    } else {
      eventsInfo = '   • No SWIFT fulfill events detected';
    }

    const totalTransfers = (ethTransferAmount > 0n ? 1 : 0) + tokenTransfers.length;

    return `
🔗 EVM FULFILL TRANSACTION ANALYSIS (${chainConfig.name})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 Transaction Details:
   • Hash: ${parsed.hash}
   • Block: ${parsed.blockNumber}
   • Timestamp: ${new Date(parsed.blockTimestamp * 1000).toISOString()}
   • Solver: ${parsed.from}
   • Gas Used: ${parsed.gasUsed.toLocaleString()}

💸 SOLVER COSTS:
   • Gas Cost: ${gasCostInEth} ${nativeTokenSymbol} (${gasCost.toString()} wei)
   
🚀 TRANSFERS (Solver → Recipients):
${transfersInfo}

📅 SWIFT EVENTS:
${eventsInfo}

💰 EXTRACTED FULFILL DATA:
   • Total Transfers: ${totalTransfers}
   • ETH Sent: ${ethTransferAmount > 0n ? ethers.formatEther(ethTransferAmount) + ' ' + nativeTokenSymbol : 'None'}
   • Token Transfers: ${tokenTransfers.length}
   • Gas Cost in ${nativeTokenSymbol}: ${gasCostInEth}
   • Solver Address: ${parsed.from}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  }

  /**
   * Parse a SWIFT unlock/redeem transaction from EVM chain
   */
  async parseSwiftUnlockTransaction(txHash: string, orderData?: SwiftOrder): Promise<EvmUnlockTransactionParsed> {
    try {
      console.log(`🔍 Fetching EVM unlock transaction: ${txHash} on ${this.chainConfig.name}`);
      
      // Fetch transaction and receipt in parallel
      const [tx, receipt] = await Promise.all([
        this.provider.getTransaction(txHash),
        this.provider.getTransactionReceipt(txHash)
      ]);

      if (!tx || !receipt) {
        throw new Error(`Transaction not found: ${txHash}`);
      }

      console.log(`✅ Unlock transaction found in block: ${tx.blockNumber}`);
      
      // Get block timestamp
      const block = await this.provider.getBlock(tx.blockNumber!);
      
      // Calculate gas costs
      const gasUsed = receipt.gasUsed;
      const gasPrice = tx.gasPrice || 0n;
      const gasCost = gasUsed * gasPrice;
      
      // Parse token transfers (assets being unlocked FROM SWIFT contract)
      const unlockedTokenTransfers = await this.parseUnlockTokenTransfers(receipt);
      
      // Parse OrderUnlocked events (the main events we care about for gas cost distribution)
      const orderUnlockedEvents = this.parseOrderUnlockedEvents(receipt);
      const unlockedOrderHashes = orderUnlockedEvents.map(event => event.orderHash);
      const totalUnlockedOrders = orderUnlockedEvents.length;
      
      // Calculate gas cost per order (divide total gas cost by number of unlocked orders)
      const gasCostPerOrder = totalUnlockedOrders > 0 ? gasCost / BigInt(totalUnlockedOrders) : gasCost;
      const gasCostPerOrderInEth = ethers.formatEther(gasCostPerOrder);
      
      // Parse any other SWIFT-related unlock events
      const swiftUnlockEvents = this.parseSwiftUnlockEvents(receipt);
      
      // Check for ETH being unlocked (from SWIFT contract to recipient)
      let unlockedEthAmount: bigint = 0n;
      let unlockedEthRecipient: string | undefined;
      
      // For unlock transactions, ETH is usually transferred FROM the SWIFT contract, not TO it
      // We need to look at internal transactions or balance changes
      // For now, we'll detect if this transaction resulted in ETH being sent
      if (tx.value > 0n) {
        // This might be a gas fee payment, not the unlocked ETH
        // We'll rely more on token transfers and events
        console.log(`🔍 Transaction has value: ${ethers.formatEther(tx.value)} ${this.chainConfig.nativeToken.symbol}`);
      }

      const unlockInitiator = tx.from; // Who initiated the unlock
      const totalUnlockedAssets = unlockedTokenTransfers.length + (unlockedEthAmount > 0n ? 1 : 0);

      console.log(`🔓 Found ${totalUnlockedOrders} OrderUnlocked events, gas cost per order: ${gasCostPerOrderInEth} ${this.chainConfig.nativeToken.symbol}`);

      return {
        hash: tx.hash,
        blockNumber: tx.blockNumber!,
        blockTimestamp: block!.timestamp,
        from: tx.from, // Who initiated the unlock
        to: tx.to!,
        value: tx.value,
        gasUsed,
        gasPrice,
        gasCost,
        gasCostInEth: ethers.formatEther(gasCost),
        unlockedTokenTransfers,
        unlockedEthAmount,
        unlockedEthRecipient,
        orderUnlockedEvents,
        unlockedOrderHashes,
        totalUnlockedOrders,
        gasCostPerOrder,
        gasCostPerOrderInEth,
        swiftUnlockEvents,
        nativeTokenSymbol: this.chainConfig.nativeToken.symbol,
        totalUnlockedAssets,
        unlockInitiator
      };

    } catch (error) {
      console.error(`❌ Failed to parse EVM unlock transaction ${txHash}:`, error);
      throw error;
    }
  }

  /**
   * Parse token transfers for unlock transactions (assets leaving SWIFT contract)
   */
  private async parseUnlockTokenTransfers(receipt: ethers.TransactionReceipt): Promise<TokenTransferParsed[]> {
    const transfers: TokenTransferParsed[] = [];
    
    const erc20Interface = new ethers.Interface([
      "event Transfer(address indexed from, address indexed to, uint256 value)"
    ]);

    const swiftContractAddress = this.swiftContract.target.toString().toLowerCase();
    
    for (const log of receipt.logs) {
      try {
        const parsed = erc20Interface.parseLog({
          topics: log.topics,
          data: log.data
        });
        
        if (parsed && parsed.name === 'Transfer') {
          const from = parsed.args[0].toLowerCase();
          const to = parsed.args[1].toLowerCase();
          const value = parsed.args[2];
          
          // We're interested in transfers FROM the SWIFT contract (assets being unlocked)
          if (from === swiftContractAddress) {
            // Try to get token symbol and decimals
            const tokenSymbol = await this.getTokenSymbol(log.address);
            const tokenDecimals = await this.getTokenDecimals(log.address);
            
            const transfer: TokenTransferParsed = {
              tokenAddress: log.address,
              tokenSymbol: tokenSymbol || 'Unknown',
              tokenDecimals: tokenDecimals || 18,
              from,
              to,
              rawAmount: value,
              formattedAmount: ethers.formatUnits(value, tokenDecimals || 18),
              logIndex: log.index
            };
            
            transfers.push(transfer);
            
            console.log(`🔓 Detected asset unlock: ${transfer.formattedAmount} ${transfer.tokenSymbol} to ${to.slice(0, 8)}...`);
          }
        }
      } catch (e) {
        // Skip logs that aren't Transfer events
        continue;
      }
    }
    
    return transfers;
  }

  /**
   * Parse OrderUnlocked events from transaction receipt
   */
  private parseOrderUnlockedEvents(receipt: ethers.TransactionReceipt): OrderUnlockedEvent[] {
    const events: OrderUnlockedEvent[] = [];
    
    const orderUnlockedInterface = new ethers.Interface([
      "event OrderUnlocked(bytes32 orderHash)"
    ]);

    for (const log of receipt.logs) {
      try {
        const parsed = orderUnlockedInterface.parseLog({
          topics: log.topics,
          data: log.data
        });
        
        if (parsed && parsed.name === 'OrderUnlocked') {
          events.push({
            orderHash: parsed.args[0],
            logIndex: log.index,
            contractAddress: log.address
          });
          
          console.log(`🔓 Found OrderUnlocked event: ${parsed.args[0]}`);
        }
      } catch (e) {
        // Skip logs that aren't OrderUnlocked events
        continue;
      }
    }
    
    return events;
  }

  /**
   * Parse SWIFT unlock events from transaction receipt
   */
  private parseSwiftUnlockEvents(receipt: ethers.TransactionReceipt): SwiftUnlockEvent[] {
    const events: SwiftUnlockEvent[] = [];
    
    // Common SWIFT unlock event signatures
    const unlockEvents = [
      "event OrderUnlocked(bytes32 indexed orderHash, address indexed recipient, uint256 amount)",
      "event AssetRedeemed(bytes32 indexed orderHash, address indexed recipient, uint256 amount)",
      "event SwiftUnlock(bytes32 indexed orderHash, address indexed recipient, uint256 amount)"
    ];
    
    for (const eventSig of unlockEvents) {
      try {
        const iface = new ethers.Interface([eventSig]);
        
        for (const log of receipt.logs) {
          try {
            const parsed = iface.parseLog({
              topics: log.topics,
              data: log.data
            });
            
            if (parsed) {
              events.push({
                eventName: parsed.name,
                orderHash: parsed.args[0],
                recipient: parsed.args[1],
                amount: parsed.args[2],
                logIndex: log.index,
                contractAddress: log.address
              });
            }
          } catch (e) {
            // Skip logs that don't match this event signature
            continue;
          }
        }
      } catch (e) {
        // Skip invalid event signatures
        continue;
      }
    }
    
    return events;
  }

  /**
   * Get human-readable unlock transaction summary
   */
  static getUnlockTransactionSummary(parsed: EvmUnlockTransactionParsed, chainConfig: ChainConfig): string {
    const { 
      unlockedTokenTransfers, 
      gasCost, 
      gasCostInEth, 
      nativeTokenSymbol, 
      unlockedEthAmount, 
      unlockedEthRecipient,
      orderUnlockedEvents,
      unlockedOrderHashes,
      totalUnlockedOrders,
      gasCostPerOrder,
      gasCostPerOrderInEth
    } = parsed;

    let unlockedAssetsInfo = '';
    
    // Show unlocked ETH first
    if (unlockedEthAmount > 0n) {
      unlockedAssetsInfo += `   • Unlocked: ${ethers.formatEther(unlockedEthAmount)} ${nativeTokenSymbol} to ${unlockedEthRecipient}\n`;
    }
    
    // Then show unlocked tokens
    if (unlockedTokenTransfers.length > 0) {
      unlockedAssetsInfo += unlockedTokenTransfers.map(transfer => 
        `   • Unlocked: ${transfer.formattedAmount} ${transfer.tokenSymbol} to ${transfer.to.slice(0, 8)}...`
      ).join('\n');
    }
    
    if (unlockedAssetsInfo === '') {
      unlockedAssetsInfo = '   • No asset unlocks detected from SWIFT contract';
    }

    let orderUnlockedInfo = '';
    if (orderUnlockedEvents.length > 0) {
      orderUnlockedInfo = orderUnlockedEvents.map((event, index) => 
        `   ${index + 1}. ${event.orderHash}`
      ).join('\n');
    } else {
      orderUnlockedInfo = '   • No OrderUnlocked events found';
    }

    let eventsInfo = '';
    if (parsed.swiftUnlockEvents.length > 0) {
      eventsInfo = parsed.swiftUnlockEvents.map(event => 
        `   • ${event.eventName}: ${event.orderHash.slice(0, 10)}... → ${event.recipient.slice(0, 8)}...`
      ).join('\n');
    } else {
      eventsInfo = '   • No other SWIFT unlock events detected';
    }

    const totalUnlocked = (unlockedEthAmount > 0n ? 1 : 0) + unlockedTokenTransfers.length;

    return `
🔗 EVM UNLOCK/REDEEM TRANSACTION ANALYSIS (${chainConfig.name})
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 Transaction Details:
   • Hash: ${parsed.hash}
   • Block: ${parsed.blockNumber}
   • Timestamp: ${new Date(parsed.blockTimestamp * 1000).toISOString()}
   • Unlock Initiator: ${parsed.from}
   • Gas Used: ${parsed.gasUsed.toLocaleString()}

💸 UNLOCK COSTS:
   • Total Gas Cost: ${gasCostInEth} ${nativeTokenSymbol} (${gasCost.toString()} wei)
   • Orders Unlocked: ${totalUnlockedOrders}
   • Gas Cost Per Order: ${gasCostPerOrderInEth} ${nativeTokenSymbol} (${gasCostPerOrder.toString()} wei)
   
🔓 UNLOCKED ORDERS (OrderUnlocked Events):
${orderUnlockedInfo}

🔓 UNLOCKED ASSETS (SWIFT Contract → Recipients):
${unlockedAssetsInfo}

📅 OTHER SWIFT UNLOCK EVENTS:
${eventsInfo}

💰 EXTRACTED UNLOCK DATA:
   • Total Unlocked Orders: ${totalUnlockedOrders}
   • Total Unlocked Assets: ${totalUnlocked}
   • ETH Unlocked: ${unlockedEthAmount > 0n ? ethers.formatEther(unlockedEthAmount) + ' ' + nativeTokenSymbol : 'None'}
   • Token Unlocks: ${unlockedTokenTransfers.length}
   • Total Gas Cost: ${gasCostInEth} ${nativeTokenSymbol}
   • Gas Cost Per Order: ${gasCostPerOrderInEth} ${nativeTokenSymbol}
   • Unlock Initiator: ${parsed.from}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  }
} 