import { Connection, PublicKey, type ParsedTransactionWithMeta, LAMPORTS_PER_SOL, SystemInstruction, SystemProgram } from '@solana/web3.js';
import type { 
  SolanaConnectionConfig, 
  SolanaTransactionParsed, 
  SwiftLockInstruction,
  SolanaTokenTransfer,
  SolanaFulfillTransactionParsed,
  SolTransferParsed,
  SplTokenTransferParsed,
  SolanaTransactionCost,
  SolanaMultiTransactionCostAnalysis,
  SolanaBalanceChange,
  SolanaAssetLock
} from '../types/solana-transaction.js';
import type { SwiftOrder, SwiftTransaction } from '../types/swift-order.js';

export class SolanaService {
  private connection: Connection;

  constructor(config: SolanaConnectionConfig = { endpoint: 'https://hidden-lively-tent.solana-mainnet.quiknode.pro/7bd6e5517afa716b119c2da43c2c098b57144872/' }) {
    this.connection = new Connection(config.endpoint, config.commitment || 'confirmed');
  }

  /**
   * Fetch and parse a SWIFT source transaction
   */
  async parseSwiftSourceTransaction(signature: string): Promise<SolanaTransactionParsed> {
    try {
      console.log(`🔍 Fetching Solana transaction: ${signature}`);
      
      // Fetch the parsed transaction
      const transaction = await this.connection.getParsedTransaction(signature, {
        maxSupportedTransactionVersion: 0,
        commitment: 'confirmed'
      });

      if (!transaction) {
        throw new Error(`Transaction not found: ${signature}`);
      }

      console.log(`✅ Transaction found in slot: ${transaction.slot}`);
      
      // Parse all instructions (legacy approach)
      const instructions = this.parseInstructions(transaction);
      
      // Find the lock instruction (4th instruction = index 3) - legacy approach
      const lockInstruction = instructions[3]; // 4th instruction
      
      // NEW: Parse balance changes to detect actual locked assets
      const balanceChanges = await this.parseSourceBalanceChanges(transaction);
      const detectedLocks = this.detectAssetLocks(balanceChanges);
      
      let lockedAmount: string | undefined;
      let lockedToken: string | undefined;
      
      // Use detected locks for more accurate information
      if (detectedLocks.length > 0) {
        const primaryLock = detectedLocks[0]; // Take the first (usually largest) lock
        lockedAmount = primaryLock.formattedAmount;
        lockedToken = primaryLock.lockType === 'SOL' ? 'SOL' : (primaryLock.tokenSymbol || primaryLock.tokenMint);
      } else if (lockInstruction && lockInstruction.type === 'TOKEN_TRANSFER') {
        // Fallback to legacy instruction parsing
        const transferData = lockInstruction.data as SolanaTokenTransfer;
        lockedAmount = transferData.amount;
        lockedToken = transferData.tokenSymbol || transferData.tokenMint;
      }

      return {
        signature,
        slot: transaction.slot,
        blockTime: transaction.blockTime || 0,
        fee: transaction.meta?.fee || 0,
        instructions,
        lockInstruction,
        lockedAmount,
        lockedToken,
        balanceChanges,
        detectedLocks,
        totalLockedAssets: detectedLocks.length
      };

    } catch (error) {
      console.error(`❌ Failed to parse Solana transaction ${signature}:`, error);
      throw error;
    }
  }

  /**
   * Parse all instructions from a transaction
   */
  private parseInstructions(transaction: ParsedTransactionWithMeta): SwiftLockInstruction[] {
    const instructions: SwiftLockInstruction[] = [];

    if (!transaction.transaction.message.instructions) {
      return instructions;
    }

    transaction.transaction.message.instructions.forEach((instruction, index) => {
      try {
        const parsed = this.parseInstruction(instruction, index);
        if (parsed) {
          instructions.push(parsed);
        }
      } catch (error) {
        console.warn(`⚠️ Failed to parse instruction ${index}:`, error);
        // Add as unknown instruction
        instructions.push({
          instructionIndex: index,
          programId: 'programId' in instruction ? instruction.programId.toString() : 'unknown',
          type: 'UNKNOWN',
          data: instruction
        });
      }
    });

    return instructions;
  }

  /**
   * Parse a single instruction
   */
  private parseInstruction(instruction: any, index: number): SwiftLockInstruction | null {
    // Handle parsed instructions
    if (instruction.parsed && instruction.program === 'spl-token') {
      return this.parseTokenInstruction(instruction, index);
    }

    // Handle raw instructions (might be SWIFT-specific)
    if (instruction.programId) {
      return {
        instructionIndex: index,
        programId: instruction.programId.toString(),
        type: 'UNKNOWN',
        data: instruction
      };
    }

    return null;
  }

  /**
   * Parse SPL Token instructions
   */
  private parseTokenInstruction(instruction: any, index: number): SwiftLockInstruction {
    const parsed = instruction.parsed;
    
    if (parsed.type === 'transfer') {
      const info = parsed.info;
      
      return {
        instructionIndex: index,
        programId: instruction.program,
        type: 'TOKEN_TRANSFER',
        data: {
          programId: instruction.program,
          source: info.source,
          destination: info.destination,
          authority: info.authority,
          amount: info.amount,
          tokenMint: info.mint,
        } as SolanaTokenTransfer
      };
    }

    return {
      instructionIndex: index,
      programId: instruction.program,
      type: 'UNKNOWN',
      data: parsed
    };
  }

  /**
   * Get human-readable transaction summary
   */
  static getTransactionSummary(parsed: SolanaTransactionParsed): string {
    const lockInfo = parsed.lockInstruction;
    const lockData = lockInfo?.data as SolanaTokenTransfer;

    // New: Format detected locks information
    let detectedLocksInfo = '';
    if (parsed.detectedLocks.length > 0) {
      detectedLocksInfo = parsed.detectedLocks.map((lock, index) => {
        const accountDisplay = typeof lock.fromAccount === 'string' ? 
          lock.fromAccount.slice(0, 8) + '...' : 
          `Account_${index}`;
        return `   ${index + 1}. ${lock.formattedAmount} ${lock.lockType === 'SOL' ? 'SOL' : (lock.tokenSymbol || 'Token')} from ${accountDisplay}`;
      }).join('\n');
    } else {
      detectedLocksInfo = '   • No asset locks detected from balance changes';
    }

    // Format balance changes summary
    let balanceChangesInfo = '';
    const solChanges = parsed.balanceChanges.filter(c => c.changeType === 'SOL');
    const tokenChanges = parsed.balanceChanges.filter(c => c.changeType === 'SPL_TOKEN');
    
    if (solChanges.length > 0) {
      balanceChangesInfo += `   • SOL Changes: ${solChanges.length} accounts\n`;
    }
    if (tokenChanges.length > 0) {
      balanceChangesInfo += `   • Token Changes: ${tokenChanges.length} accounts\n`;
    }
    if (balanceChangesInfo === '') {
      balanceChangesInfo = '   • No significant balance changes detected';
    }

    return `
🔗 SOLANA SOURCE TRANSACTION ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 Transaction Details:
   • Signature: ${parsed.signature}
   • Slot: ${parsed.slot}
   • Block Time: ${parsed.blockTime ? new Date(parsed.blockTime * 1000).toISOString() : 'N/A'}
   • Total Instructions: ${parsed.instructions.length}

🔓 DETECTED ASSET LOCKS (Balance-Based Detection):
${detectedLocksInfo}

📊 BALANCE CHANGES SUMMARY:
${balanceChangesInfo}

🔒 LEGACY LOCK INSTRUCTION (Instruction #4):
${lockInfo ? `   • Type: ${lockInfo.type}
   • Program: ${lockInfo.programId}
   ${lockData ? `• Source: ${lockData.source}
   • Destination: ${lockData.destination}
   • Authority: ${lockData.authority}
   • Amount: ${lockData.amount}${lockData.tokenSymbol ? ' ' + lockData.tokenSymbol : ''}` : '• Raw Data: ' + JSON.stringify(lockInfo.data, null, 6)}` : '   • No lock instruction found at index 3'}

📊 ALL INSTRUCTIONS:
${parsed.instructions.map((inst, i) => 
  `   ${i + 1}. ${inst.type} (${inst.programId})`
).join('\n')}

💰 EXTRACTED DATA:
   • Locked Amount: ${parsed.lockedAmount || 'Not detected'}
   • Locked Token: ${parsed.lockedToken || 'Not detected'}
   • Detected Locks: ${parsed.totalLockedAssets}
   • Balance Changes: ${parsed.balanceChanges.length}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  }

  /**
   * Parse a SWIFT fulfill transaction from Solana
   */
  async parseSwiftFulfillTransaction(signature: string, orderData?: SwiftOrder): Promise<SolanaFulfillTransactionParsed> {
    try {
      console.log(`🔍 Fetching Solana fulfill transaction: ${signature}`);
      
      const transaction = await this.connection.getTransaction(signature, {
        maxSupportedTransactionVersion: 0
      });

      if (!transaction) {
        throw new Error(`Transaction not found: ${signature}`);
      }

      console.log(`✅ Fulfill transaction found in slot: ${transaction.slot}`);

      // Extract basic transaction info
      const fee = transaction.meta?.fee || 0;
      const feeInSol = (fee / LAMPORTS_PER_SOL).toString();
      
      // Get account keys to identify accounts - handle address lookup tables safely
      let accountKeys: any;
      try {
        if (transaction.transaction.message.version === 'legacy') {
          accountKeys = transaction.transaction.message.accountKeys;
        } else {
          // For versioned transactions, try to get account keys but handle lookup table errors
          try {
            accountKeys = transaction.transaction.message.getAccountKeys();
          } catch (lookupError) {
            // If lookup tables aren't resolved, use the static account keys
            console.log('⚠️  Address lookup tables not resolved, using static account keys only');
            accountKeys = (transaction.transaction.message as any).staticAccountKeys || [];
          }
        }
      } catch (error) {
        console.log('⚠️  Failed to get account keys, using empty array');
        accountKeys = [];
      }
      
      const solver = Array.isArray(accountKeys) ? accountKeys[0]?.toString() : accountKeys.get(0)?.toString(); // First account is usually the signer/solver

      // Parse SOL transfers
      const solTransfers = this.parseSolTransfers(transaction);
      
      // Parse SPL token transfers  
      const splTokenTransfers = await this.parseSplTokenTransfers(transaction);

      const totalTransfers = solTransfers.length + splTokenTransfers.length;

      return {
        signature,
        slot: transaction.slot,
        blockTime: transaction.blockTime ?? 0,
        fee,
        feeInSol,
        solTransfers,
        splTokenTransfers,
        solver,
        totalTransfers
      };

    } catch (error) {
      console.error(`❌ Failed to parse Solana fulfill transaction ${signature}:`, error);
      throw error;
    }
  }

  /**
   * Parse SOL transfers from transaction
   */
  private parseSolTransfers(transaction: any): SolTransferParsed[] {
    const transfers: SolTransferParsed[] = [];
    
    if (!transaction.meta) {
      return transfers;
    }

    // Get instructions safely - handle both legacy and versioned transactions
    const messageInstructions = transaction.transaction.message.instructions || [];
    const innerInstructions = transaction.meta.innerInstructions || [];
    
    // Look through all instructions and inner instructions for system transfers
    const allInstructions = [
      ...messageInstructions,
      ...innerInstructions.flatMap((inner: any) => inner.instructions || [])
    ];

    allInstructions.forEach((instruction: any, index: number) => {
      try {
        // Get account keys properly for versioned transactions
        const accountKeys = transaction.transaction.message.version === 'legacy' 
          ? transaction.transaction.message.accountKeys 
          : transaction.transaction.message.getAccountKeys();
        
        // Check if this is a system program transfer instruction
        const programIdKey = Array.isArray(accountKeys) 
          ? accountKeys[instruction.programIdIndex] 
          : accountKeys.get(instruction.programIdIndex);
        
        const programId = programIdKey?.toString();
        
        if (programId === SystemProgram.programId.toString()) {
          // Try to decode as system transfer
          const decoded = SystemInstruction.decodeTransfer(instruction);
          
          if (decoded) {
            const from = decoded.fromPubkey.toString();
            const to = decoded.toPubkey.toString();
            const amount = decoded.lamports;
            
            transfers.push({
              from,
              to,
              amount: Number(amount),
              amountInSol: (Number(amount) / LAMPORTS_PER_SOL).toString(),
              instructionIndex: index
            });
            
            console.log(`🔍 Detected SOL transfer: ${(Number(amount) / LAMPORTS_PER_SOL).toFixed(6)} SOL from ${from.slice(0, 8)}... to ${to.slice(0, 8)}...`);
          }
        }
      } catch (e) {
        // Skip instructions that can't be decoded as transfers
      }
    });

    return transfers;
  }

  /**
   * Parse SPL token transfers from transaction
   */
  private async parseSplTokenTransfers(transaction: any): Promise<SplTokenTransferParsed[]> {
    const transfers: SplTokenTransferParsed[] = [];
    
    if (!transaction.meta?.preTokenBalances || !transaction.meta?.postTokenBalances) {
      return transfers;
    }

    const preBalances = transaction.meta.preTokenBalances || [];
    const postBalances = transaction.meta.postTokenBalances || [];

    // Get account keys to identify accounts - handle address lookup tables safely
    let accountKeys: any;
    try {
      if (transaction.transaction.message.version === 'legacy') {
        accountKeys = transaction.transaction.message.accountKeys;
      } else {
        // For versioned transactions, try to get account keys but handle lookup table errors
        try {
          accountKeys = transaction.transaction.message.getAccountKeys();
        } catch (lookupError) {
          // If lookup tables aren't resolved, use the static account keys
          console.log('⚠️  Address lookup tables not resolved, using static account keys only');
          accountKeys = (transaction.transaction.message as any).staticAccountKeys || [];
        }
      }
    } catch (error) {
      console.log('⚠️  Failed to get account keys, using empty array');
      accountKeys = [];
    }

    // Get the solver (first signer)
    const solverKey = Array.isArray(accountKeys) ? accountKeys[0] : accountKeys.get(0);
    const solverAddress = solverKey?.toString();

    // Then fall back to balance changes for anything we missed
    await this.parseBalanceChanges(transaction, accountKeys, solverAddress, transfers, preBalances, postBalances);

    return transfers;
  }

  /**
   * Decode transfer amount from instruction data (simplified)
   */
  private decodeTransferAmount(data: string): number | null {
    try {
      // Token transfer instruction data format: [instruction_type(1), amount(8)]
      // For now, we'll return null and rely on balance changes
      // This would need proper SPL token instruction decoding
      return null;
    } catch (error) {
      return null;
    }
  }

  /**
   * Parse balance changes (original logic)
   */
  private async parseBalanceChanges(transaction: any, accountKeys: any, solverAddress: string, transfers: SplTokenTransferParsed[], preBalances: any[], postBalances: any[]): Promise<void> {
    // Compare pre and post token balances to find transfers
    for (const postBalance of postBalances) {
      const preBalance = preBalances.find(
        (pre: any) => pre.accountIndex === postBalance.accountIndex && pre.mint === postBalance.mint
      );

      if (preBalance && postBalance.uiTokenAmount?.amount !== preBalance.uiTokenAmount?.amount && postBalance.owner === solverAddress) {
        const postAmount = postBalance.uiTokenAmount?.amount || '0';
        const preAmount = preBalance.uiTokenAmount?.amount || '0';
        const amountChange = BigInt(postAmount) - BigInt(preAmount);
        
        if (amountChange !== 0n) {
          // Get account address safely
          const accountKey = Array.isArray(accountKeys) 
            ? accountKeys[postBalance.accountIndex] 
            : accountKeys.get(postBalance.accountIndex);
          
          const accountAddress = accountKey?.toString() || 'Unknown';
          
          // Try to get token info
          const tokenMint = postBalance.mint;
          const decimals = postBalance.uiTokenAmount?.decimals || 0;

          // Check if this is an outflow (negative change) 
          // For fulfill transactions, we track all outflows as these represent tokens being sent
          // The solver might operate through intermediaries or associated token accounts
          if (amountChange < 0n) {
            const transfer: SplTokenTransferParsed = {
              tokenMint,
              tokenDecimals: decimals,
              from: accountAddress, // Token account that sent tokens
              to: 'Recipients', // We know tokens went to recipients
              rawAmount: amountChange.toString(),
              formattedAmount: (Math.abs(Number(amountChange)) / Math.pow(10, decimals)).toString(),
              instructionIndex: postBalance.accountIndex,
              authority: postBalance.owner // The owner/authority of the token account
            };

            // Try to get token symbol
            transfer.tokenSymbol = await this.getTokenSymbol(tokenMint);

            transfers.push(transfer);
          }
        }
      }
    }

    // Also check for accounts that were completely drained (have pre-balance but no post-balance)
    for (const preBalance of preBalances) {
      const hasPostBalance = postBalances.find(
        (post: any) => post.accountIndex === preBalance.accountIndex && post.mint === preBalance.mint
      );

      if (!hasPostBalance && preBalance.uiTokenAmount?.amount && preBalance.uiTokenAmount.amount !== '0') {
        // This account was completely drained
        const preAmount = preBalance.uiTokenAmount.amount;
        const amountChange = -BigInt(preAmount); // Negative because it all went out
        
        // Get account address safely
        const accountKey = Array.isArray(accountKeys) 
          ? accountKeys[preBalance.accountIndex] 
          : accountKeys.get(preBalance.accountIndex);

        const accountAddress = accountKey?.toString() || 'Unknown';

        // Try to get token info
        const tokenMint = preBalance.mint;
        const decimals = preBalance.uiTokenAmount?.decimals || 0;
        
        const transfer: SplTokenTransferParsed = {
          tokenMint,
          tokenDecimals: decimals,
          from: accountAddress, // Token account that was drained
          to: 'Recipients', // All tokens went to recipients
          rawAmount: amountChange.toString(),
          formattedAmount: (Math.abs(Number(amountChange)) / Math.pow(10, decimals)).toString(),
          instructionIndex: preBalance.accountIndex,
          authority: preBalance.owner // The owner/authority of the token account
        };

        // Try to get token symbol
        transfer.tokenSymbol = await this.getTokenSymbol(tokenMint);

        transfers.push(transfer);
      }
    }
  }

  /**
   * Get token symbol from mint address
   */
  private async getTokenSymbol(mintAddress: string): Promise<string | undefined> {
    const tokenMap: Record<string, string> = {
      'EPjFWdd5AufqSSqeM2qN1xzybapC8G4wEGGkZwyTDt1v': 'USDC',
      'So11111111111111111111111111111111111111112': 'SOL',
      '7vfCXTUXx5WJV5JADk17DUJ4ksgau7utNKj4b963voxs': 'WETH'
    };
    
    return tokenMap[mintAddress];
  }

  /**
   * Parse balance changes for source transactions (detect locked assets)
   */
  private async parseSourceBalanceChanges(transaction: any): Promise<SolanaBalanceChange[]> {
    const changes: SolanaBalanceChange[] = [];
    
    if (!transaction.meta) {
      return changes;
    }

    // Get account keys with better error handling
    let accountKeys: any;
    try {
      if (transaction.transaction.message.version === 'legacy') {
        accountKeys = transaction.transaction.message.accountKeys;
      } else {
        // For versioned transactions, try multiple approaches
        try {
          accountKeys = transaction.transaction.message.getAccountKeys();
        } catch (lookupError) {
          // If lookup tables aren't resolved, use static account keys
          console.log('⚠️ Address lookup tables not resolved, using static account keys only');
          accountKeys = (transaction.transaction.message as any).staticAccountKeys || 
                       (transaction.transaction.message as any).accountKeys || [];
        }
      }
    } catch (error) {
      console.log('⚠️ Failed to get account keys, using account indices');
      // Create a fallback array with account indices
      const maxIndex = Math.max(
        transaction.meta.preBalances?.length || 0,
        transaction.meta.postBalances?.length || 0,
        ...(transaction.meta.preTokenBalances?.map((b: any) => b.accountIndex) || []),
        ...(transaction.meta.postTokenBalances?.map((b: any) => b.accountIndex) || [])
      );
      accountKeys = Array.from({ length: maxIndex + 1 }, (_, i) => ({ toString: () => `Account_${i}` }));
    }

    // Parse SOL balance changes
    const preBalances = transaction.meta.preBalances || [];
    const postBalances = transaction.meta.postBalances || [];
    
    for (let i = 0; i < preBalances.length && i < postBalances.length; i++) {
      const preBalance = preBalances[i];
      const postBalance = postBalances[i];
      const balanceChange = postBalance - preBalance;
      
      if (balanceChange !== 0) {
        const accountKey = Array.isArray(accountKeys) ? accountKeys[i] : accountKeys.get?.(i) || accountKeys[i];
        const accountAddress = accountKey?.toString() || `Account_${i}`;
        
        changes.push({
          accountIndex: i,
          accountAddress,
          changeType: 'SOL',
          solBalanceChange: balanceChange,
          solBalanceChangeInSol: (balanceChange / LAMPORTS_PER_SOL).toString()
        });
        
        console.log(`🔍 SOL balance change: Account ${i} (${accountAddress.slice(0, 8)}...) ${balanceChange > 0 ? '+' : ''}${(balanceChange / LAMPORTS_PER_SOL).toFixed(6)} SOL`);
      }
    }

    // Parse SPL token balance changes
    const preTokenBalances = transaction.meta.preTokenBalances || [];
    const postTokenBalances = transaction.meta.postTokenBalances || [];
    
    for (const postBalance of postTokenBalances) {
      const preBalance = preTokenBalances.find(
        (pre: any) => pre.accountIndex === postBalance.accountIndex && pre.mint === postBalance.mint
      );
      
      const postAmount = postBalance.uiTokenAmount?.amount || '0';
      const preAmount = preBalance?.uiTokenAmount?.amount || '0';
      const amountChange = BigInt(postAmount) - BigInt(preAmount);
      
      if (amountChange !== 0n) {
        const accountKey = Array.isArray(accountKeys) ? accountKeys[postBalance.accountIndex] : 
                          accountKeys.get?.(postBalance.accountIndex) || 
                          accountKeys[postBalance.accountIndex];
        const accountAddress = accountKey?.toString() || `Account_${postBalance.accountIndex}`;
        
        const tokenSymbol = await this.getTokenSymbol(postBalance.mint);
        const formattedChange = (Number(amountChange) / Math.pow(10, postBalance.uiTokenAmount?.decimals || 0));
        
        changes.push({
          accountIndex: postBalance.accountIndex,
          accountAddress,
          owner: postBalance.owner,
          changeType: 'SPL_TOKEN',
          tokenMint: postBalance.mint,
          tokenSymbol,
          tokenDecimals: postBalance.uiTokenAmount?.decimals || 0,
          tokenBalanceChange: amountChange.toString(),
          tokenBalanceChangeFormatted: formattedChange.toString()
        });
        
        console.log(`🔍 Token balance change: ${tokenSymbol || postBalance.mint.slice(0, 8)} ${formattedChange > 0 ? '+' : ''}${formattedChange} from account ${postBalance.accountIndex}`);
      }
    }

    return changes;
  }

  /**
   * Detect asset locks from balance changes (negative changes = assets being locked/sent)
   */
  private detectAssetLocks(balanceChanges: SolanaBalanceChange[]): SolanaAssetLock[] {
    const locks: SolanaAssetLock[] = [];
    const solLocks: SolanaAssetLock[] = [];
    const tokenLocks: SolanaAssetLock[] = [];
    
    // Analyze the transaction pattern to identify user locks vs pool operations
    const solChanges = balanceChanges.filter(c => c.changeType === 'SOL');
    const tokenChanges = balanceChanges.filter(c => c.changeType === 'SPL_TOKEN');
    
    // For SOL changes, look for significant positive additions to pools (indicates SOL being deposited)
    for (const change of solChanges) {
      const isFeePayer = change.accountIndex === 0;
      
      if (change.solBalanceChange && change.solBalanceChange > 0 && !isFeePayer) {
        // Positive SOL change in non-fee-payer account likely indicates SOL being deposited/locked
        const solAmount = Number(change.solBalanceChangeInSol || '0');
        
        // Filter out small amounts (likely fees/rent)
        if (solAmount > 0.01) { // Only consider SOL amounts > 0.01 
          const solLock = {
            lockType: 'SOL' as const,
            amount: change.solBalanceChange.toString(),
            formattedAmount: solAmount.toString(),
            fromAccount: change.accountAddress,
            authority: change.accountAddress
          };
          
          solLocks.push(solLock);
          console.log(`🔍 Found potential SOL lock: ${solAmount} SOL deposited to account ${change.accountIndex}`);
        }
      }
    }
    
    // For SPL tokens, look for patterns that indicate user sending (not pool operations)
    for (const change of tokenChanges) {
      if (change.tokenBalanceChange && BigInt(change.tokenBalanceChange) < 0n) {
        const formattedAmount = Math.abs(Number(change.tokenBalanceChangeFormatted || '0'));
        
        // Look for significant negative token changes from user accounts
        // Skip if this looks like a pool operation (very large amounts in pool accounts)
        const isLikelyUserTransfer = formattedAmount < 1000000; // Arbitrary threshold for pool detection
        
        if (isLikelyUserTransfer && formattedAmount > 0.001) { // Filter out dust
          const tokenLock = {
            lockType: 'SPL_TOKEN' as const,
            amount: BigInt(change.tokenBalanceChange).toString().replace('-', ''),
            formattedAmount: formattedAmount.toString(),
            tokenMint: change.tokenMint,
            tokenSymbol: change.tokenSymbol,
            tokenDecimals: change.tokenDecimals,
            fromAccount: change.accountAddress,
            authority: change.owner
          };
          
          tokenLocks.push(tokenLock);
          console.log(`🔓 Detected SPL token lock: ${formattedAmount} ${change.tokenSymbol} from account ${change.accountIndex}`);
        }
      }
    }
    
    // PRIORITY LOGIC: If SPL token locks exist, ignore SOL locks (they're likely intermediate swap steps)
    if (tokenLocks.length > 0) {
      console.log(`✅ Using SPL token locks only (${tokenLocks.length} found), ignoring SOL locks as they're likely swap intermediates`);
      locks.push(...tokenLocks);
    } else if (solLocks.length > 0) {
      console.log(`✅ Using SOL locks only (${solLocks.length} found), no SPL token locks detected`);
      locks.push(...solLocks);
    } else {
      console.log('⚠️ No obvious locks detected, falling back to original detection logic');
      
      // Fallback to original approach
      for (const change of balanceChanges) {
        const isFeePayer = change.accountIndex === 0;
        
        if (change.changeType === 'SOL') {
          if (change.solBalanceChange && change.solBalanceChange < 0 && !isFeePayer) {
            locks.push({
              lockType: 'SOL',
              amount: Math.abs(change.solBalanceChange).toString(),
              formattedAmount: Math.abs(Number(change.solBalanceChangeInSol || '0')).toString(),
              fromAccount: change.accountAddress,
              authority: change.accountAddress
            });
          }
        } else if (change.changeType === 'SPL_TOKEN') {
          if (change.tokenBalanceChange && BigInt(change.tokenBalanceChange) < 0n) {
            locks.push({
              lockType: 'SPL_TOKEN',
              amount: BigInt(change.tokenBalanceChange).toString().replace('-', ''),
              formattedAmount: Math.abs(Number(change.tokenBalanceChangeFormatted || '0')).toString(),
              tokenMint: change.tokenMint,
              tokenSymbol: change.tokenSymbol,
              tokenDecimals: change.tokenDecimals,
              fromAccount: change.accountAddress,
              authority: change.owner
            });
          }
        }
      }
    }
    
    // Sort by amount (largest first) within the selected lock type
    locks.sort((a, b) => {
      const amountA = Number(a.formattedAmount);
      const amountB = Number(b.formattedAmount);
      return amountB - amountA;
    });
    
    return locks;
  }

  /**
   * Get human-readable fulfill transaction summary
   */
  static getFulfillTransactionSummary(parsed: SolanaFulfillTransactionParsed): string {
    const { solTransfers, splTokenTransfers, fee, feeInSol, solver } = parsed;

    let transfersInfo = '';
    
    // Show SOL transfers first
    if (solTransfers.length > 0) {
      transfersInfo += solTransfers.map(transfer => 
        `   • Sent: ${transfer.amountInSol} SOL to ${transfer.to.slice(0, 8)}...${transfer.to.slice(-4)}`
      ).join('\n') + '\n';
    }
    
    // Then show SPL token transfers (now these are all outflows from solver)
    if (splTokenTransfers.length > 0) {
      transfersInfo += splTokenTransfers.map(transfer => 
        `   • Sent: ${transfer.formattedAmount} ${transfer.tokenSymbol || transfer.tokenMint.slice(0, 8)} to recipients`
      ).join('\n');
    }
    
    if (transfersInfo === '') {
      transfersInfo = '   • No transfers detected';
    }

    return `
🔗 SOLANA FULFILL TRANSACTION ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

📝 Transaction Details:
   • Signature: ${parsed.signature}
   • Slot: ${parsed.slot}
   • Timestamp: ${new Date(parsed.blockTime * 1000).toISOString()}
   • Solver: ${solver?.slice(0, 8)}...${solver?.slice(-4)}

💸 SOLVER COSTS:
   • Transaction Fee: ${feeInSol} SOL (${fee} lamports)
   
🚀 TOKEN OUTFLOWS (All Accounts → Recipients):
${transfersInfo}

💰 EXTRACTED FULFILL DATA:
   • Total Transfers: ${parsed.totalTransfers}
   • SOL Transfers: ${solTransfers.length}
   • SPL Token Transfers: ${splTokenTransfers.length}
   • Transaction Fee: ${feeInSol} SOL
   • Solver Address: ${solver?.slice(0, 8)}...${solver?.slice(-4)}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  }

  /**
   * Calculate costs for multiple transaction types from txs array
   */
  async parseMultipleTransactionCosts(order: SwiftOrder, transactionTypes: string[] = ['CLOSE', 'SETTLE', 'REGISTER_ORDER']): Promise<SolanaMultiTransactionCostAnalysis | null> {
    if (!order.txs || order.txs.length === 0) {
      console.log('⚠️  No txs array found in order');
      return null;
    }

    const targetTransactions = order.txs.filter(tx => 
      tx.goals.some(goal => transactionTypes.includes(goal))
    );

    if (targetTransactions.length === 0) {
      console.log(`⚠️  No transactions found with goals: ${transactionTypes.join(', ')}`);
      return null;
    }

    console.log(`🔍 Analyzing ${targetTransactions.length} additional Solana transactions...`);

    const transactionCosts: SolanaTransactionCost[] = [];
    
    for (const tx of targetTransactions) {
      try {
        const cost = await this.parseTransactionCost(tx);
        if (cost) {
          transactionCosts.push(cost);
        }
      } catch (error) {
        console.warn(`⚠️  Failed to parse transaction ${tx.txHash}:`, error);
        // Add a failed transaction entry
        transactionCosts.push({
          signature: tx.txHash,
          transactionType: tx.goals.join(','),
          slot: 0,
          blockTime: 0,
          fee: 0,
          feeInSol: '0',
          success: false,
          solBalanceChange: 0,
          solBalanceChangeInSol: '0',
          netCost: 0,
          netCostInSol: '0'
        });
      }
    }

    // Calculate totals and costs by type
    return this.calculateCostAnalysis(transactionCosts);
  }

  /**
   * Parse cost information for a single transaction
   */
  private async parseTransactionCost(swiftTx: SwiftTransaction): Promise<SolanaTransactionCost | null> {
    try {
      console.log(`🔍 Fetching transaction cost for: ${swiftTx.txHash} (${swiftTx.goals.join(', ')})`);
      
      const transaction = await this.connection.getTransaction(swiftTx.txHash, {
        maxSupportedTransactionVersion: 0
      });

      if (!transaction) {
        console.warn(`❌ Transaction not found: ${swiftTx.txHash}`);
        return null;
      }

      const fee = transaction.meta?.fee || 0;
      const feeInSol = (fee / LAMPORTS_PER_SOL).toString();
      const success = transaction.meta?.err === null;

      // Get the transaction signer (fee payer)
      let from: string | undefined;
      let signerIndex = 0;
      try {
        if (transaction.transaction.message.version === 'legacy') {
          const accountKeys = transaction.transaction.message.accountKeys;
          from = accountKeys[0]?.toString();
          signerIndex = 0;
        } else {
          // For versioned transactions
          try {
            const accountKeys = transaction.transaction.message.getAccountKeys();
            from = Array.isArray(accountKeys) ? accountKeys[0]?.toString() : accountKeys.get(0)?.toString();
            signerIndex = 0;
          } catch (lookupError) {
            // If lookup tables aren't resolved, use static account keys
            const staticKeys = (transaction.transaction.message as any).staticAccountKeys || [];
            from = staticKeys[0]?.toString();
            signerIndex = 0;
          }
        }
      } catch (error) {
        console.warn('⚠️  Failed to get transaction signer');
      }

      // Calculate SOL balance change for the signer
      let solBalanceChange = 0;
      if (transaction.meta?.preBalances && transaction.meta?.postBalances && transaction.meta.preBalances.length > signerIndex && transaction.meta.postBalances.length > signerIndex) {
        const preBalance = transaction.meta.preBalances[signerIndex];
        const postBalance = transaction.meta.postBalances[signerIndex];
        solBalanceChange = postBalance - preBalance;
        
        // Note: this includes the fee deduction, so we add back the fee to get the actual balance change from operations
        solBalanceChange += fee;
      }

      const solBalanceChangeInSol = (solBalanceChange / LAMPORTS_PER_SOL).toString();
      const netCost = fee - solBalanceChange; // Actual cost after considering rent returns
      const netCostInSol = (netCost / LAMPORTS_PER_SOL).toString();

      const balanceInfo = solBalanceChange > 0 ? `(+${solBalanceChangeInSol} SOL rent return)` : 
                         solBalanceChange < 0 ? `(${solBalanceChangeInSol} SOL additional cost)` : '';

      console.log(`✅ ${swiftTx.goals.join(', ')} transaction: ${feeInSol} SOL fee, net cost: ${netCostInSol} SOL ${balanceInfo}`);

      return {
        signature: swiftTx.txHash,
        transactionType: swiftTx.goals.join(','),
        slot: transaction.slot,
        blockTime: transaction.blockTime ?? 0,
        fee,
        feeInSol,
        from,
        success,
        solBalanceChange,
        solBalanceChangeInSol,
        netCost,
        netCostInSol
      };

    } catch (error) {
      console.error(`❌ Failed to parse transaction cost for ${swiftTx.txHash}:`, error);
      return null;
    }
  }

  /**
   * Calculate cost analysis from transaction costs
   */
  private calculateCostAnalysis(transactionCosts: SolanaTransactionCost[]): SolanaMultiTransactionCostAnalysis {
    const totalFeeLamports = transactionCosts.reduce((sum, tx) => sum + tx.fee, 0);
    const totalFeeInSol = (totalFeeLamports / LAMPORTS_PER_SOL).toString();
    const totalSolBalanceChange = transactionCosts.reduce((sum, tx) => sum + tx.solBalanceChange, 0);
    const totalSolBalanceChangeInSol = (totalSolBalanceChange / LAMPORTS_PER_SOL).toString();
    const netTotalCost = transactionCosts.reduce((sum, tx) => sum + tx.netCost, 0);
    const netTotalCostInSol = (netTotalCost / LAMPORTS_PER_SOL).toString();

    // Group costs by transaction type
    const costsByType: Record<string, { 
      count: number; 
      totalFeeLamports: number; 
      totalFeeInSol: string;
      totalSolBalanceChange: number;
      totalSolBalanceChangeInSol: string;
      netTotalCost: number;
      netTotalCostInSol: string;
    }> = {};

    for (const tx of transactionCosts) {
      if (!costsByType[tx.transactionType]) {
        costsByType[tx.transactionType] = {
          count: 0,
          totalFeeLamports: 0,
          totalFeeInSol: '0',
          totalSolBalanceChange: 0,
          totalSolBalanceChangeInSol: '0',
          netTotalCost: 0,
          netTotalCostInSol: '0'
        };
      }

      costsByType[tx.transactionType].count++;
      costsByType[tx.transactionType].totalFeeLamports += tx.fee;
      costsByType[tx.transactionType].totalFeeInSol = (costsByType[tx.transactionType].totalFeeLamports / LAMPORTS_PER_SOL).toString();
      costsByType[tx.transactionType].totalSolBalanceChange += tx.solBalanceChange;
      costsByType[tx.transactionType].totalSolBalanceChangeInSol = (costsByType[tx.transactionType].totalSolBalanceChange / LAMPORTS_PER_SOL).toString();
      costsByType[tx.transactionType].netTotalCost += tx.netCost;
      costsByType[tx.transactionType].netTotalCostInSol = (costsByType[tx.transactionType].netTotalCost / LAMPORTS_PER_SOL).toString();
    }

    return {
      transactions: transactionCosts,
      totalCosts: {
        totalFeeLamports,
        totalFeeInSol,
        totalSolBalanceChange,
        totalSolBalanceChangeInSol,
        netTotalCost,
        netTotalCostInSol,
        transactionCount: transactionCosts.length
      },
      costsByType
    };
  }

  /**
   * Get human-readable summary for multi-transaction cost analysis
   */
  static getMultiTransactionCostSummary(analysis: SolanaMultiTransactionCostAnalysis): string {
    const { totalCosts, costsByType, transactions } = analysis;

    let costBreakdown = '';
    for (const [type, costs] of Object.entries(costsByType)) {
      const balanceInfo = costs.totalSolBalanceChange > 0 ? ` (+${costs.totalSolBalanceChangeInSol} SOL rent return)` :
                         costs.totalSolBalanceChange < 0 ? ` (${costs.totalSolBalanceChangeInSol} SOL additional cost)` : '';
      costBreakdown += `   • ${type}: ${costs.count} tx, ${costs.totalFeeInSol} SOL fees, net: ${costs.netTotalCostInSol} SOL${balanceInfo}\n`;
    }

    let transactionDetails = '';
    for (const tx of transactions) {
      const status = tx.success ? '✅' : '❌';
      const timestamp = tx.blockTime ? new Date(tx.blockTime * 1000).toISOString() : 'N/A';
      const balanceInfo = tx.solBalanceChange > 0 ? ` (+${tx.solBalanceChangeInSol} SOL)` :
                         tx.solBalanceChange < 0 ? ` (${tx.solBalanceChangeInSol} SOL)` : '';
      transactionDetails += `   ${status} ${tx.transactionType}: ${tx.feeInSol} SOL fee, net: ${tx.netCostInSol} SOL${balanceInfo}\n`;
    }

    const totalBalanceInfo = totalCosts.totalSolBalanceChange > 0 ? ` (+${totalCosts.totalSolBalanceChangeInSol} SOL rent returns)` :
                            totalCosts.totalSolBalanceChange < 0 ? ` (${totalCosts.totalSolBalanceChangeInSol} SOL additional costs)` : '';

    return `
🔗 SOLANA ADDITIONAL TRANSACTION COSTS ANALYSIS
━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━

💰 TOTAL COSTS:
   • Total Transactions: ${totalCosts.transactionCount}
   • Total Fees: ${totalCosts.totalFeeInSol} SOL (${totalCosts.totalFeeLamports} lamports)
   • Total Balance Changes: ${totalCosts.totalSolBalanceChangeInSol} SOL (${totalCosts.totalSolBalanceChange} lamports)${totalBalanceInfo}
   • Net Total Cost: ${totalCosts.netTotalCostInSol} SOL (${totalCosts.netTotalCost} lamports)

📊 COSTS BY TYPE:
${costBreakdown}

📝 TRANSACTION DETAILS:
${transactionDetails}

━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━
`;
  }
} 