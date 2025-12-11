/**
 * WebAssembly Memory Guard - Prevents WASM memory allocation errors
 *
 * This component aggressively monitors and cleans up WebAssembly memory
 * to prevent "Out of memory: Cannot allocate Wasm memory" errors.
 */

import React, { useEffect, useRef } from 'react';

interface WasmMemoryStats {
  instances: number;
  totalMemory: number;
  lastCleanup: number;
}

const WasmMemoryGuard: React.FC = () => {
  const statsRef = useRef<WasmMemoryStats>({
    instances: 0,
    totalMemory: 0,
    lastCleanup: Date.now()
  });

  const cleanupWasmMemory = () => {

    try {
      // Force garbage collection if available
      if (typeof window !== 'undefined' && (window as any).gc) {
        (window as any).gc();
      }

      // Clear any cached WASM modules
      if (typeof window !== 'undefined') {
        // Clear IndexedDB caches that might hold WASM instances
        const clearIndexedDB = async () => {
          try {
            const dbs = await window.indexedDB.databases();
            for (const db of dbs) {
              // Don't delete wallet databases, only temporary caches
              if (db.name && (db.name.includes('cache') || db.name.includes('temp'))) {
                window.indexedDB.deleteDatabase(db.name);
              }
            }
          } catch (error) {
            console.warn('⚠️ [WasmGuard] Could not clear IndexedDB caches:', error);
          }
        };
        clearIndexedDB();
      }

      statsRef.current.lastCleanup = Date.now();
    } catch (error) {
      console.error('❌ [WasmGuard] Error during WASM cleanup:', error);
    }
  };

  const checkMemoryPressure = () => {
    if (typeof window === 'undefined' || !(window as any).performance?.memory) {
      return;
    }

    const memory = (window as any).performance.memory;
    const usedMB = Math.round(memory.usedJSHeapSize / 1024 / 1024);
    const limitMB = Math.round(memory.jsHeapSizeLimit / 1024 / 1024);
    const percentage = Math.round((memory.usedJSHeapSize / memory.jsHeapSizeLimit) * 100);

    // Aggressive cleanup at 70% memory usage
    if (percentage >= 70) {
      console.warn(`⚠️ [WasmGuard] High memory usage detected: ${usedMB}MB / ${limitMB}MB (${percentage}%)`);

      // Only cleanup if last cleanup was more than 30 seconds ago
      const timeSinceLastCleanup = Date.now() - statsRef.current.lastCleanup;
      if (timeSinceLastCleanup > 30000) {
        cleanupWasmMemory();
      }
    }

    // Critical alert at 85%
    if (percentage >= 85) {
      console.error(`🔴 [WasmGuard] CRITICAL memory usage: ${percentage}%`);
      console.error('🔴 [WasmGuard] User should perform hard refresh (Ctrl+Shift+R)');

      // Show user-visible warning
      const showWarning = () => {
        const warningDiv = document.createElement('div');
        warningDiv.id = 'wasm-memory-warning';
        warningDiv.style.cssText = `
          position: fixed;
          top: 20px;
          right: 20px;
          background: #ff4444;
          color: white;
          padding: 20px;
          border-radius: 8px;
          box-shadow: 0 4px 12px rgba(0,0,0,0.3);
          z-index: 10000;
          max-width: 400px;
          font-family: sans-serif;
        `;
        warningDiv.innerHTML = `
          <strong>⚠️ High Memory Usage Detected</strong>
          <p style="margin: 10px 0;">The wallet is using too much memory (${percentage}%).</p>
          <p style="margin: 10px 0;"><strong>Please perform a hard refresh:</strong></p>
          <ul style="margin: 5px 0; padding-left: 20px;">
            <li>Windows/Linux: Ctrl + Shift + R</li>
            <li>Mac: Cmd + Shift + R</li>
          </ul>
          <button onclick="location.reload(true)" style="
            background: white;
            color: #ff4444;
            border: none;
            padding: 10px 20px;
            border-radius: 4px;
            cursor: pointer;
            margin-top: 10px;
            font-weight: bold;
          ">Reload Now</button>
        `;

        // Remove existing warning if present
        const existing = document.getElementById('wasm-memory-warning');
        if (existing) {
          existing.remove();
        }

        document.body.appendChild(warningDiv);
      };

      showWarning();

      // Force cleanup immediately
      cleanupWasmMemory();
    }
  };

  useEffect(() => {

    // Initial cleanup on mount
    cleanupWasmMemory();

    // Check memory every 10 seconds
    const memoryCheckInterval = setInterval(checkMemoryPressure, 10000);

    // Cleanup on route changes
    const handleRouteChange = () => {
      cleanupWasmMemory();
    };

    // Listen for Next.js route changes
    if (typeof window !== 'undefined') {
      window.addEventListener('popstate', handleRouteChange);

      // Also listen for visibility changes
      document.addEventListener('visibilitychange', () => {
        if (!document.hidden) {
          checkMemoryPressure();
        }
      });
    }

    // Cleanup on unmount
    return () => {
      clearInterval(memoryCheckInterval);
      if (typeof window !== 'undefined') {
        window.removeEventListener('popstate', handleRouteChange);
      }
    };
  }, []);

  // This component doesn't render anything
  return null;
};

export default WasmMemoryGuard;
