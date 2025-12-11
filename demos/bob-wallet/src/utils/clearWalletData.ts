/**
 * Utility to completely clear all wallet data
 *
 * Credentials can persist in multiple locations:
 * 1. IndexedDB (Pluto database) - SDK credential storage
 * 2. localStorage - Prefixed wallet-specific data
 * 3. Redux state - In-memory state
 * 4. Browser cache - Next.js page cache
 *
 * This utility helps diagnose and clear stale credentials
 */

import { clearWalletStorage } from './prefixedStorage';

export interface WalletDataLocations {
  indexedDB: {
    databases: string[];
    credentialCount: number;
  };
  localStorage: {
    keys: string[];
    credentialRelatedKeys: string[];
  };
  caches: string[];
}

/**
 * Scan all locations where wallet data might be stored
 */
export async function scanWalletData(): Promise<WalletDataLocations> {
  const result: WalletDataLocations = {
    indexedDB: {
      databases: [],
      credentialCount: 0
    },
    localStorage: {
      keys: [],
      credentialRelatedKeys: []
    },
    caches: []
  };

  // Scan IndexedDB databases
  if ('indexedDB' in window) {
    try {
      const databases = await window.indexedDB.databases();
      result.indexedDB.databases = databases.map(db => db.name || 'unnamed');

      // Try to count credentials in wallet DB
      const walletDB = databases.find(db => db.name?.includes('identus-wallet'));
      if (walletDB && walletDB.name) {
        try {
          const db = await openIndexedDB(walletDB.name);
          const count = await countCredentials(db);
          result.indexedDB.credentialCount = count;
          db.close();
        } catch (error) {
          console.warn('[scanWalletData] Could not count credentials:', error);
        }
      }
    } catch (error) {
      console.warn('[scanWalletData] Could not scan IndexedDB:', error);
    }
  }

  // Scan localStorage
  try {
    const allKeys: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key) {
        allKeys.push(key);

        // Check if key is credential-related
        if (key.includes('credential') || key.includes('vc') || key.includes('security-clearance')) {
          result.localStorage.credentialRelatedKeys.push(key);
        }
      }
    }
    result.localStorage.keys = allKeys;
  } catch (error) {
    console.warn('[scanWalletData] Could not scan localStorage:', error);
  }

  // Scan cache storage
  if ('caches' in window) {
    try {
      const cacheNames = await caches.keys();
      result.caches = cacheNames;
    } catch (error) {
      console.warn('[scanWalletData] Could not scan cache storage:', error);
    }
  }

  return result;
}

/**
 * Helper to open IndexedDB
 */
function openIndexedDB(dbName: string): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(dbName);

    request.onsuccess = () => {
      resolve(request.result);
    };

    request.onerror = () => {
      reject(request.error);
    };
  });
}

/**
 * Helper to count credentials in IndexedDB
 */
function countCredentials(db: IDBDatabase): Promise<number> {
  return new Promise((resolve, reject) => {
    try {
      // Try to find credentials object store
      const storeNames = ['credentials', 'Credential', 'verifiableCredentials'];
      let storeName: string | null = null;

      for (const name of storeNames) {
        if (db.objectStoreNames.contains(name)) {
          storeName = name;
          break;
        }
      }

      if (!storeName) {
        resolve(0);
        return;
      }

      const transaction = db.transaction([storeName], 'readonly');
      const objectStore = transaction.objectStore(storeName);
      const countRequest = objectStore.count();

      countRequest.onsuccess = () => {
        resolve(countRequest.result);
      };

      countRequest.onerror = () => {
        reject(countRequest.error);
      };
    } catch (error) {
      resolve(0);
    }
  });
}

/**
 * Completely clear all wallet data
 * USE WITH CAUTION - This is irreversible
 */
export async function clearAllWalletData(): Promise<{
  success: boolean;
  clearedLocations: string[];
  errors: string[];
}> {
  const clearedLocations: string[] = [];
  const errors: string[] = [];

  // 1. Clear IndexedDB
  try {
    const databases = await window.indexedDB.databases();
    for (const dbInfo of databases) {
      if (dbInfo.name && dbInfo.name.includes('identus-wallet')) {
        await deleteIndexedDB(dbInfo.name);
        clearedLocations.push(`IndexedDB: ${dbInfo.name}`);
      }
    }
  } catch (error) {
    errors.push(`IndexedDB clearing failed: ${error}`);
  }

  // 2. Clear localStorage (wallet-prefixed only)
  try {
    clearWalletStorage();
    clearedLocations.push('localStorage: wallet-prefixed keys');
  } catch (error) {
    errors.push(`localStorage clearing failed: ${error}`);
  }

  // 3. Clear cache storage
  try {
    const cacheNames = await caches.keys();
    for (const cacheName of cacheNames) {
      await caches.delete(cacheName);
      clearedLocations.push(`Cache: ${cacheName}`);
    }
  } catch (error) {
    errors.push(`Cache clearing failed: ${error}`);
  }

  return {
    success: errors.length === 0,
    clearedLocations,
    errors
  };
}

/**
 * Helper to delete IndexedDB
 */
function deleteIndexedDB(dbName: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.deleteDatabase(dbName);

    request.onsuccess = () => {
      resolve();
    };

    request.onerror = () => {
      reject(request.error);
    };

    request.onblocked = () => {
      console.warn(`[deleteIndexedDB] Deletion of ${dbName} blocked. Close all tabs and try again.`);
      reject(new Error('Database deletion blocked'));
    };
  });
}

/**
 * Print diagnostic report to console
 */
export async function printWalletDataReport(): Promise<void> {
  console.log('========================================');
  console.log('WALLET DATA DIAGNOSTIC REPORT');
  console.log('========================================');

  const data = await scanWalletData();

  console.log('\n📊 IndexedDB:');
  console.log(`  Databases: ${data.indexedDB.databases.join(', ') || 'None'}`);
  console.log(`  Credentials stored: ${data.indexedDB.credentialCount}`);

  console.log('\n📊 localStorage:');
  console.log(`  Total keys: ${data.localStorage.keys.length}`);
  console.log(`  Credential-related keys: ${data.localStorage.credentialRelatedKeys.length}`);
  if (data.localStorage.credentialRelatedKeys.length > 0) {
    console.log('  Keys:');
    data.localStorage.credentialRelatedKeys.forEach(key => {
      console.log(`    - ${key}`);
    });
  }

  console.log('\n📊 Cache Storage:');
  console.log(`  Caches: ${data.caches.join(', ') || 'None'}`);

  console.log('\n========================================');
  console.log('To clear all data, run: clearAllWalletData()');
  console.log('========================================\n');
}

// Export for console access
if (typeof window !== 'undefined') {
  (window as any).scanWalletData = scanWalletData;
  (window as any).clearAllWalletData = clearAllWalletData;
  (window as any).printWalletDataReport = printWalletDataReport;

  console.log('💡 Wallet data utilities loaded:');
  console.log('  - printWalletDataReport() - Show where data is stored');
  console.log('  - scanWalletData() - Get data locations programmatically');
  console.log('  - clearAllWalletData() - Clear all wallet data (irreversible)');
}
