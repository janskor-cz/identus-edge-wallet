/**
 * Encrypted Storage Utility
 *
 * Provides secure storage for sensitive data (API keys, tokens) using
 * wallet's own X25519 encryption keys. Data is encrypted before storage
 * and can only be decrypted by the wallet that encrypted it.
 *
 * Storage Strategy:
 * - Uses wallet's X25519 keys for encryption (self-encryption)
 * - Stores encrypted data in localStorage with wallet-specific prefixes
 * - Each encrypted item has its own nonce for security
 * - Keys are derived from Security Clearance credentials
 *
 * Security Model:
 * - API keys never stored in plaintext
 * - Encrypted using NaCl secretbox (XSalsa20-Poly1305)
 * - Wallet's X25519 private key required for decryption
 * - Private keys never leave user's device
 */

import { getItem, setItem, removeItem } from './prefixedStorage';
import { getSecurityClearanceKeys } from './securityKeyStorage';
import * as nacl from 'tweetnacl';
import { decodeUTF8, encodeUTF8, encodeBase64, decodeBase64 } from 'tweetnacl-util';

/**
 * Storage key constants
 */
const STORAGE_KEYS = {
  ENCRYPTED_API_KEY: (walletId: string) => `encrypted-api-key-${walletId}`,
  ENCRYPTED_DATA: (dataId: string) => `encrypted-data-${dataId}`
};

/**
 * Encrypted data structure
 */
interface EncryptedData {
  ciphertext: string;      // Base64-encoded encrypted data
  nonce: string;           // Base64-encoded nonce (24 bytes)
  timestamp: number;       // When encrypted
  dataType: string;        // Type of data (e.g., 'api-key', 'token')
  metadata?: any;          // Optional metadata (unencrypted)
}

/**
 * API key storage metadata
 */
interface APIKeyMetadata {
  enterpriseAgentUrl: string;
  walletId: string;
  employeeId: string;
  storedAt: number;
}

/**
 * Derive encryption key from X25519 key pair
 *
 * Uses the wallet's own X25519 private key to create a symmetric encryption key.
 * This allows the wallet to encrypt data that only it can decrypt.
 *
 * @param connectionDID - DID of the connection (to find X25519 keys)
 * @returns 32-byte encryption key or null if keys not found
 */
function deriveEncryptionKey(connectionDID?: string): Uint8Array | null {
  try {
    // Get all Security Clearance keys
    const allKeys = getSecurityClearanceKeys(connectionDID);

    if (!allKeys || !allKeys.x25519PrivateKey) {
      console.warn('[EncryptedStorage] No X25519 keys found for encryption');
      return null;
    }

    // Use X25519 private key bytes directly as encryption key
    // In NaCl secretbox, we use the private key as symmetric key
    const privateKeyBytes = decodeBase64(allKeys.x25519PrivateKey);

    // Ensure key is 32 bytes
    if (privateKeyBytes.length !== 32) {
      console.error('[EncryptedStorage] Invalid key length:', privateKeyBytes.length);
      return null;
    }

    return privateKeyBytes;
  } catch (error) {
    console.error('[EncryptedStorage] Error deriving encryption key:', error);
    return null;
  }
}

/**
 * Encrypt plaintext data using wallet's X25519 key
 *
 * @param plaintext - Data to encrypt
 * @param connectionDID - DID to find encryption keys (optional, uses first available)
 * @returns Encrypted data structure or null on failure
 */
export function encryptData(
  plaintext: string,
  dataType: string,
  connectionDID?: string,
  metadata?: any
): EncryptedData | null {
  try {
    console.log('🔐 [EncryptedStorage] Encrypting data type:', dataType);

    // Derive encryption key from X25519 keys
    const encryptionKey = deriveEncryptionKey(connectionDID);
    if (!encryptionKey) {
      console.error('[EncryptedStorage] Cannot derive encryption key');
      return null;
    }

    // Generate random nonce (24 bytes for NaCl secretbox)
    const nonce = nacl.randomBytes(24);

    // Convert plaintext to bytes
    const plaintextBytes = decodeUTF8(plaintext);

    // Encrypt using NaCl secretbox (XSalsa20-Poly1305 authenticated encryption)
    const ciphertext = nacl.secretbox(plaintextBytes, nonce, encryptionKey);

    if (!ciphertext) {
      console.error('[EncryptedStorage] Encryption failed');
      return null;
    }

    // Encode to base64 for storage
    const encryptedData: EncryptedData = {
      ciphertext: encodeBase64(ciphertext),
      nonce: encodeBase64(nonce),
      timestamp: Date.now(),
      dataType,
      metadata
    };

    console.log('✅ [EncryptedStorage] Data encrypted successfully');
    return encryptedData;

  } catch (error) {
    console.error('[EncryptedStorage] Encryption error:', error);
    return null;
  }
}

/**
 * Decrypt encrypted data using wallet's X25519 key
 *
 * @param encryptedData - Encrypted data structure
 * @param connectionDID - DID to find decryption keys (optional)
 * @returns Decrypted plaintext or null on failure
 */
export function decryptData(
  encryptedData: EncryptedData,
  connectionDID?: string
): string | null {
  try {
    console.log('🔓 [EncryptedStorage] Decrypting data type:', encryptedData.dataType);

    // Derive decryption key from X25519 keys
    const decryptionKey = deriveEncryptionKey(connectionDID);
    if (!decryptionKey) {
      console.error('[EncryptedStorage] Cannot derive decryption key');
      return null;
    }

    // Decode from base64
    const ciphertext = decodeBase64(encryptedData.ciphertext);
    const nonce = decodeBase64(encryptedData.nonce);

    // Decrypt using NaCl secretbox
    const plaintextBytes = nacl.secretbox.open(ciphertext, nonce, decryptionKey);

    if (!plaintextBytes) {
      console.error('[EncryptedStorage] Decryption failed - invalid key or corrupted data');
      return null;
    }

    // Convert bytes to string
    const plaintext = encodeUTF8(plaintextBytes);

    console.log('✅ [EncryptedStorage] Data decrypted successfully');
    return plaintext;

  } catch (error) {
    console.error('[EncryptedStorage] Decryption error:', error);
    return null;
  }
}

/**
 * Store encrypted API key for enterprise agent
 *
 * @param apiKey - Plaintext API key from ServiceConfiguration VC
 * @param walletId - Enterprise wallet ID
 * @param metadata - Additional metadata (URL, employee ID, etc.)
 * @param connectionDID - DID to find encryption keys (optional)
 * @returns Success status
 */
export function storeEncryptedApiKey(
  apiKey: string,
  walletId: string,
  metadata: APIKeyMetadata,
  connectionDID?: string
): boolean {
  try {
    console.log('💾 [EncryptedStorage] Storing encrypted API key for wallet:', walletId);

    // Validate inputs
    if (!apiKey || !walletId) {
      console.error('[EncryptedStorage] Invalid API key or wallet ID');
      return false;
    }

    // Encrypt API key
    const encryptedData = encryptData(apiKey, 'api-key', connectionDID, metadata);
    if (!encryptedData) {
      console.error('[EncryptedStorage] Failed to encrypt API key');
      return false;
    }

    // Store in localStorage with wallet-specific prefix
    const storageKey = STORAGE_KEYS.ENCRYPTED_API_KEY(walletId);
    setItem(storageKey, encryptedData);

    console.log('✅ [EncryptedStorage] API key stored successfully');
    return true;

  } catch (error) {
    console.error('[EncryptedStorage] Error storing encrypted API key:', error);
    return false;
  }
}

/**
 * Retrieve and decrypt API key for enterprise agent
 *
 * @param walletId - Enterprise wallet ID
 * @param connectionDID - DID to find decryption keys (optional)
 * @returns Decrypted API key or null if not found/decryption failed
 */
export function retrieveApiKey(
  walletId: string,
  connectionDID?: string
): string | null {
  try {
    console.log('🔍 [EncryptedStorage] Retrieving API key for wallet:', walletId);

    // Get encrypted data from storage
    const storageKey = STORAGE_KEYS.ENCRYPTED_API_KEY(walletId);
    const encryptedData = getItem(storageKey);

    if (!encryptedData) {
      console.warn('[EncryptedStorage] No encrypted API key found for wallet:', walletId);
      return null;
    }

    // Decrypt API key
    const apiKey = decryptData(encryptedData, connectionDID);
    if (!apiKey) {
      console.error('[EncryptedStorage] Failed to decrypt API key');
      return null;
    }

    console.log('✅ [EncryptedStorage] API key retrieved successfully');
    return apiKey;

  } catch (error) {
    console.error('[EncryptedStorage] Error retrieving API key:', error);
    return null;
  }
}

/**
 * Get API key metadata without decrypting the key
 *
 * @param walletId - Enterprise wallet ID
 * @returns Metadata or null if not found
 */
export function getApiKeyMetadata(walletId: string): APIKeyMetadata | null {
  try {
    const storageKey = STORAGE_KEYS.ENCRYPTED_API_KEY(walletId);
    const encryptedData = getItem(storageKey);

    if (!encryptedData || !encryptedData.metadata) {
      return null;
    }

    return encryptedData.metadata;
  } catch (error) {
    console.error('[EncryptedStorage] Error getting metadata:', error);
    return null;
  }
}

/**
 * Clear encrypted API key for enterprise agent
 *
 * @param walletId - Enterprise wallet ID
 * @returns Success status
 */
export function clearApiKey(walletId: string): boolean {
  try {
    console.log('🗑️ [EncryptedStorage] Clearing API key for wallet:', walletId);

    const storageKey = STORAGE_KEYS.ENCRYPTED_API_KEY(walletId);
    removeItem(storageKey);

    console.log('✅ [EncryptedStorage] API key cleared successfully');
    return true;

  } catch (error) {
    console.error('[EncryptedStorage] Error clearing API key:', error);
    return false;
  }
}

/**
 * Store arbitrary encrypted data
 *
 * Generic function for encrypting and storing any sensitive data.
 *
 * @param dataId - Unique identifier for this data
 * @param plaintext - Data to encrypt
 * @param dataType - Type of data (for logging/metadata)
 * @param connectionDID - DID to find encryption keys (optional)
 * @param metadata - Optional unencrypted metadata
 * @returns Success status
 */
export function storeEncryptedData(
  dataId: string,
  plaintext: string,
  dataType: string,
  connectionDID?: string,
  metadata?: any
): boolean {
  try {
    console.log('💾 [EncryptedStorage] Storing encrypted data:', dataId);

    // Encrypt data
    const encryptedData = encryptData(plaintext, dataType, connectionDID, metadata);
    if (!encryptedData) {
      console.error('[EncryptedStorage] Failed to encrypt data');
      return false;
    }

    // Store in localStorage
    const storageKey = STORAGE_KEYS.ENCRYPTED_DATA(dataId);
    setItem(storageKey, encryptedData);

    console.log('✅ [EncryptedStorage] Encrypted data stored successfully');
    return true;

  } catch (error) {
    console.error('[EncryptedStorage] Error storing encrypted data:', error);
    return false;
  }
}

/**
 * Retrieve and decrypt arbitrary data
 *
 * @param dataId - Unique identifier for the data
 * @param connectionDID - DID to find decryption keys (optional)
 * @returns Decrypted data or null
 */
export function retrieveEncryptedData(
  dataId: string,
  connectionDID?: string
): string | null {
  try {
    console.log('🔍 [EncryptedStorage] Retrieving encrypted data:', dataId);

    // Get encrypted data from storage
    const storageKey = STORAGE_KEYS.ENCRYPTED_DATA(dataId);
    const encryptedData = getItem(storageKey);

    if (!encryptedData) {
      console.warn('[EncryptedStorage] No encrypted data found:', dataId);
      return null;
    }

    // Decrypt data
    const plaintext = decryptData(encryptedData, connectionDID);
    if (!plaintext) {
      console.error('[EncryptedStorage] Failed to decrypt data');
      return null;
    }

    console.log('✅ [EncryptedStorage] Encrypted data retrieved successfully');
    return plaintext;

  } catch (error) {
    console.error('[EncryptedStorage] Error retrieving encrypted data:', error);
    return null;
  }
}

/**
 * Clear arbitrary encrypted data
 *
 * @param dataId - Unique identifier for the data
 * @returns Success status
 */
export function clearEncryptedData(dataId: string): boolean {
  try {
    console.log('🗑️ [EncryptedStorage] Clearing encrypted data:', dataId);

    const storageKey = STORAGE_KEYS.ENCRYPTED_DATA(dataId);
    removeItem(storageKey);

    console.log('✅ [EncryptedStorage] Encrypted data cleared successfully');
    return true;

  } catch (error) {
    console.error('[EncryptedStorage] Error clearing encrypted data:', error);
    return false;
  }
}

/**
 * Check if API key exists for wallet (without decrypting)
 *
 * @param walletId - Enterprise wallet ID
 * @returns True if encrypted API key exists
 */
export function hasApiKey(walletId: string): boolean {
  const storageKey = STORAGE_KEYS.ENCRYPTED_API_KEY(walletId);
  const encryptedData = getItem(storageKey);
  return !!encryptedData;
}

/**
 * List all stored encrypted API keys (metadata only)
 *
 * @returns Array of wallet IDs with encrypted API keys
 */
export function listEncryptedApiKeys(): Array<{ walletId: string; metadata: APIKeyMetadata }> {
  try {
    // This would require scanning localStorage for keys matching pattern
    // For now, return empty array (would need enhancement to prefixedStorage.ts)
    console.warn('[EncryptedStorage] listEncryptedApiKeys() not fully implemented yet');
    return [];
  } catch (error) {
    console.error('[EncryptedStorage] Error listing API keys:', error);
    return [];
  }
}
