import type { SwiftOrder } from '../types/swift-order.js';

export class SwiftApiService {
  private readonly baseUrl = 'https://explorer-api.mayan.finance/v3';

  /**
   * Fetch order data by order ID
   * @param orderId - The SWIFT order ID (e.g., SWIFT_0x7b0e1c35f87697ba8fcea5b63fdbc54654c66841e27510f92d84a7f566be739c)
   */
  async getOrder(orderId: string): Promise<SwiftOrder> {
    try {
      const url = `${this.baseUrl}/swap/order-id/${orderId}`;
      console.log(`Fetching order data from: ${url}`);
      
      const response = await fetch(url);
      
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      
      const orderData: SwiftOrder = await response.json();
      
      // Validate that we got a valid order
      if (!orderData.orderId || !orderData.id) {
        throw new Error('Invalid order data received');
      }
      
      console.log(`✅ Successfully fetched order: ${orderData.orderId}`);
      console.log(`   Status: ${orderData.status}`);
      console.log(`   From: ${orderData.fromAmount} ${orderData.fromTokenSymbol} (${orderData.fromTokenChain})`);
      console.log(`   To: ${orderData.toAmount} ${orderData.toTokenSymbol} (${orderData.toTokenChain})`);
      
      return orderData;
    } catch (error) {
      console.error(`❌ Failed to fetch order ${orderId}:`, error);
      throw error;
    }
  }

  /**
   * Extract order ID from various formats
   * @param input - Can be a full order ID or just the hash part
   */
  static normalizeOrderId(input: string): string {
    // If it already starts with SWIFT_, return as is
    if (input.startsWith('SWIFT_')) {
      return input;
    }
    
    // If it's just a hash, add the SWIFT_ prefix
    if (input.match(/^0x[a-fA-F0-9]{64}$/)) {
      return `SWIFT_${input}`;
    }
    
    // Otherwise, assume it's already in the correct format
    return input;
  }

  /**
   * Validate if a string looks like a valid SWIFT order ID
   */
  static isValidOrderId(orderId: string): boolean {
    const pattern = /^SWIFT_0x[a-fA-F0-9]{64}$/;
    return pattern.test(orderId);
  }
} 