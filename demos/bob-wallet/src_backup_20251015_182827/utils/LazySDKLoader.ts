/**
 * Lazy SDK Loader - Memory-efficient WebAssembly module loading
 *
 * This utility implements lazy loading for the Hyperledger Identus SDK
 * to prevent WebAssembly memory allocation errors by loading modules
 * only when needed and implementing proper cleanup strategies.
 */

// Type definitions for SDK modules
type SDKModule = typeof import("@hyperledger/identus-edge-agent-sdk");
type ApolloModule = typeof import("@hyperledger/identus-edge-agent-sdk").Apollo;
type PlutoModule = typeof import("@hyperledger/identus-edge-agent-sdk").Pluto;
type CastorModule = typeof import("@hyperledger/identus-edge-agent-sdk").Castor;

interface LazySDKCache {
  SDK?: SDKModule;
  Apollo?: ApolloModule;
  Pluto?: PlutoModule;
  Castor?: CastorModule;
  loadPromises: Map<string, Promise<any>>;
  lastCleanup: number;
}

class LazySDKLoader {
  private cache: LazySDKCache;
  private readonly CLEANUP_INTERVAL = 5 * 60 * 1000; // 5 minutes
  private readonly MEMORY_LIMIT = 64 * 1024 * 1024; // 64MB
  private cleanupTimer?: NodeJS.Timeout;

  constructor() {
    this.cache = {
      loadPromises: new Map(),
      lastCleanup: Date.now(),
    };

    // Set up automatic cleanup
    this.setupMemoryCleanup();

    // Monitor memory usage if available
    this.setupMemoryMonitoring();
  }

  /**
   * Load the main SDK module with memory optimization
   */
  async loadSDK(): Promise<SDKModule> {
    if (this.cache.SDK) {
      return this.cache.SDK;
    }

    const cacheKey = 'SDK';
    if (this.cache.loadPromises.has(cacheKey)) {
      return this.cache.loadPromises.get(cacheKey)!;
    }

    const loadPromise = this.loadWithMemoryOptimization(async () => {
      console.log('🔄 [LazySDK] Loading main SDK module...');

      // Use dynamic import to avoid initial bundle size
      const SDKModule = await import("@hyperledger/identus-edge-agent-sdk");

      console.log('✅ [LazySDK] Main SDK module loaded successfully');
      return SDKModule.default;
    });

    this.cache.loadPromises.set(cacheKey, loadPromise);

    try {
      this.cache.SDK = await loadPromise;
      return this.cache.SDK;
    } catch (error) {
      this.cache.loadPromises.delete(cacheKey);
      console.error('❌ [LazySDK] Failed to load main SDK module:', error);
      throw new Error(`Failed to load SDK: ${error.message}`);
    }
  }

  /**
   * Load Apollo module (cryptographic operations)
   */
  async loadApollo(): Promise<ApolloModule> {
    if (this.cache.Apollo) {
      return this.cache.Apollo;
    }

    const cacheKey = 'Apollo';
    if (this.cache.loadPromises.has(cacheKey)) {
      return this.cache.loadPromises.get(cacheKey)!;
    }

    const loadPromise = this.loadWithMemoryOptimization(async () => {
      console.log('🔄 [LazySDK] Loading Apollo crypto module...');

      const SDK = await this.loadSDK();
      this.cache.Apollo = SDK.Apollo;

      console.log('✅ [LazySDK] Apollo crypto module loaded successfully');
      return this.cache.Apollo;
    });

    this.cache.loadPromises.set(cacheKey, loadPromise);

    try {
      const apollo = await loadPromise;
      return apollo;
    } catch (error) {
      this.cache.loadPromises.delete(cacheKey);
      console.error('❌ [LazySDK] Failed to load Apollo module:', error);
      throw new Error(`Failed to load Apollo: ${error.message}`);
    }
  }

  /**
   * Load Pluto module (storage operations)
   */
  async loadPluto(): Promise<PlutoModule> {
    if (this.cache.Pluto) {
      return this.cache.Pluto;
    }

    const cacheKey = 'Pluto';
    if (this.cache.loadPromises.has(cacheKey)) {
      return this.cache.loadPromises.get(cacheKey)!;
    }

    const loadPromise = this.loadWithMemoryOptimization(async () => {
      console.log('🔄 [LazySDK] Loading Pluto storage module...');

      const SDK = await this.loadSDK();
      this.cache.Pluto = SDK.Pluto;

      console.log('✅ [LazySDK] Pluto storage module loaded successfully');
      return this.cache.Pluto;
    });

    this.cache.loadPromises.set(cacheKey, loadPromise);

    try {
      const pluto = await loadPromise;
      return pluto;
    } catch (error) {
      this.cache.loadPromises.delete(cacheKey);
      console.error('❌ [LazySDK] Failed to load Pluto module:', error);
      throw new Error(`Failed to load Pluto: ${error.message}`);
    }
  }

  /**
   * Load Castor module (DID operations)
   */
  async loadCastor(): Promise<CastorModule> {
    if (this.cache.Castor) {
      return this.cache.Castor;
    }

    const cacheKey = 'Castor';
    if (this.cache.loadPromises.has(cacheKey)) {
      return this.cache.loadPromises.get(cacheKey)!;
    }

    const loadPromise = this.loadWithMemoryOptimization(async () => {
      console.log('🔄 [LazySDK] Loading Castor DID module...');

      const SDK = await this.loadSDK();
      this.cache.Castor = SDK.Castor;

      console.log('✅ [LazySDK] Castor DID module loaded successfully');
      return this.cache.Castor;
    });

    this.cache.loadPromises.set(cacheKey, loadPromise);

    try {
      const castor = await loadPromise;
      return castor;
    } catch (error) {
      this.cache.loadPromises.delete(cacheKey);
      console.error('❌ [LazySDK] Failed to load Castor module:', error);
      throw new Error(`Failed to load Castor: ${error.message}`);
    }
  }

  /**
   * Load module with memory optimization and monitoring
   */
  private async loadWithMemoryOptimization<T>(loader: () => Promise<T>): Promise<T> {
    // Check memory before loading
    await this.checkMemoryBeforeLoad();

    try {
      const result = await loader();

      // Trigger cleanup after successful load
      await this.scheduleMemoryCleanup();

      return result;
    } catch (error) {
      // Force cleanup on error
      await this.performMemoryCleanup();
      throw error;
    }
  }

  /**
   * Check available memory before loading modules
   */
  private async checkMemoryBeforeLoad(): Promise<void> {
    if (typeof window !== 'undefined' && (window as any).performance?.memory) {
      const memory = (window as any).performance.memory;
      const usedMemory = memory.usedJSHeapSize;
      const memoryLimit = memory.jsHeapSizeLimit;

      console.log(`🔍 [LazySDK] Memory check - Used: ${Math.round(usedMemory / 1024 / 1024)}MB, Limit: ${Math.round(memoryLimit / 1024 / 1024)}MB`);

      // If memory usage is high, perform cleanup
      if (usedMemory > memoryLimit * 0.8) {
        console.warn('⚠️ [LazySDK] High memory usage detected, performing cleanup...');
        await this.performMemoryCleanup();
      }
    }
  }

  /**
   * Set up automatic memory cleanup
   */
  private setupMemoryCleanup(): void {
    if (typeof window !== 'undefined') {
      // Cleanup on page unload
      window.addEventListener('beforeunload', () => {
        this.performMemoryCleanup();
      });

      // Cleanup on visibility change (tab switch)
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          this.scheduleMemoryCleanup();
        }
      });
    }

    // Set up periodic cleanup
    this.cleanupTimer = setInterval(() => {
      this.performMemoryCleanup();
    }, this.CLEANUP_INTERVAL);
  }

  /**
   * Set up memory monitoring
   */
  private setupMemoryMonitoring(): void {
    if (typeof window !== 'undefined' && (window as any).performance?.memory) {
      setInterval(() => {
        const memory = (window as any).performance.memory;
        const usedMB = Math.round(memory.usedJSHeapSize / 1024 / 1024);

        if (usedMB > 100) { // Log if using more than 100MB
          console.log(`📊 [LazySDK] Memory usage: ${usedMB}MB`);
        }
      }, 30000); // Check every 30 seconds
    }
  }

  /**
   * Schedule memory cleanup
   */
  private async scheduleMemoryCleanup(): Promise<void> {
    const now = Date.now();
    if (now - this.cache.lastCleanup > this.CLEANUP_INTERVAL) {
      await this.performMemoryCleanup();
    }
  }

  /**
   * Perform memory cleanup
   */
  private async performMemoryCleanup(): Promise<void> {
    console.log('🧹 [LazySDK] Performing memory cleanup...');

    // Clear load promises that might be holding references
    this.cache.loadPromises.clear();

    // Force garbage collection if available
    if (typeof window !== 'undefined' && (window as any).gc) {
      try {
        (window as any).gc();
        console.log('✅ [LazySDK] Forced garbage collection completed');
      } catch (error) {
        console.warn('⚠️ [LazySDK] Garbage collection not available:', error);
      }
    }

    this.cache.lastCleanup = Date.now();
  }

  /**
   * Clear all cached modules (for complete cleanup)
   */
  async clearCache(): Promise<void> {
    console.log('🗑️ [LazySDK] Clearing SDK cache...');

    this.cache.SDK = undefined;
    this.cache.Apollo = undefined;
    this.cache.Pluto = undefined;
    this.cache.Castor = undefined;
    this.cache.loadPromises.clear();

    await this.performMemoryCleanup();

    console.log('✅ [LazySDK] SDK cache cleared');
  }

  /**
   * Get memory usage statistics
   */
  getMemoryStats(): { used: number; limit: number; percentage: number } | null {
    if (typeof window !== 'undefined' && (window as any).performance?.memory) {
      const memory = (window as any).performance.memory;
      const used = memory.usedJSHeapSize;
      const limit = memory.jsHeapSizeLimit;
      return {
        used: Math.round(used / 1024 / 1024), // MB
        limit: Math.round(limit / 1024 / 1024), // MB
        percentage: Math.round((used / limit) * 100)
      };
    }
    return null;
  }

  /**
   * Cleanup on destroy
   */
  destroy(): void {
    if (this.cleanupTimer) {
      clearInterval(this.cleanupTimer);
    }
    this.clearCache();
  }
}

// Export singleton instance
export const lazySDKLoader = new LazySDKLoader();

// Export hook for React components
export function useLazySDK() {
  return {
    loadSDK: () => lazySDKLoader.loadSDK(),
    loadApollo: () => lazySDKLoader.loadApollo(),
    loadPluto: () => lazySDKLoader.loadPluto(),
    loadCastor: () => lazySDKLoader.loadCastor(),
    clearCache: () => lazySDKLoader.clearCache(),
    getMemoryStats: () => lazySDKLoader.getMemoryStats(),
  };
}

export default lazySDKLoader;