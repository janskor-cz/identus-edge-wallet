// Security Key Storage Utilities for Ed25519-based Security Clearance VCs

import { SecurityKey, SecurityKeyStorage, SecurityKeyExport } from '../types/securityKeys';
import * as jose from 'jose';

const STORAGE_KEY = 'security-clearance-keys';

/**
 * Generate a fingerprint from a public key (SHA256 hash formatted as XX:XX:XX...)
 */
export async function generateFingerprint(publicKeyBytes: string): Promise<string> {
  try {
    // Decode base64url to bytes
    const keyBytes = jose.base64url.decode(publicKeyBytes);

    // Use Web Crypto API for SHA256
    const hashBuffer = await crypto.subtle.digest('SHA-256', keyBytes);

    // Convert to hex string
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    const hash = hashArray.map(b => b.toString(16).padStart(2, '0')).join('').toUpperCase();

    // Format as XX:XX:XX:XX...
    return hash.match(/.{2}/g)?.join(':') || hash;
  } catch (error) {
    console.error('Error generating fingerprint:', error);
    // Fallback to simple hash
    return `SHA256:${publicKeyBytes.substring(0, 16)}...`;
  }
}

/**
 * Generate a unique key ID
 */
export function generateKeyId(): string {
  return `sec-key-${Date.now()}-${Math.random().toString(36).substring(2, 9)}`;
}

/**
 * Load security keys from localStorage
 */
export function loadSecurityKeys(): SecurityKeyStorage {
  try {
    const stored = localStorage.getItem(STORAGE_KEY);
    if (stored) {
      return JSON.parse(stored) as SecurityKeyStorage;
    }
  } catch (error) {
    console.error('Failed to load security keys:', error);
  }

  return { keys: [] };
}

/**
 * Save security keys to localStorage
 */
export function saveSecurityKeys(storage: SecurityKeyStorage): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(storage));
  } catch (error) {
    console.error('Failed to save security keys:', error);
  }
}

/**
 * Add a new security key to storage
 */
export async function addSecurityKey(
  privateKeyBytes: string,
  publicKeyBytes: string,
  label?: string
): Promise<SecurityKey> {
  const storage = loadSecurityKeys();

  const newKey: SecurityKey = {
    keyId: generateKeyId(),
    privateKeyBytes,
    publicKeyBytes,
    fingerprint: await generateFingerprint(publicKeyBytes),
    curve: 'Ed25519',
    purpose: 'security-clearance',
    label: label || `Security Key ${storage.keys.length + 1}`,
    createdAt: new Date().toISOString(),
    usageCount: 0
  };

  storage.keys.push(newKey);

  // Set as active if it's the first key
  if (storage.keys.length === 1) {
    storage.activeKeyId = newKey.keyId;
  }

  saveSecurityKeys(storage);
  return newKey;
}

/**
 * Get a security key by ID
 */
export function getSecurityKey(keyId: string): SecurityKey | undefined {
  const storage = loadSecurityKeys();
  return storage.keys.find(key => key.keyId === keyId);
}

/**
 * Get the active security key
 */
export function getActiveSecurityKey(): SecurityKey | undefined {
  const storage = loadSecurityKeys();
  if (!storage.activeKeyId) {
    return storage.keys[0]; // Return first key if no active key set
  }
  return storage.keys.find(key => key.keyId === storage.activeKeyId);
}

/**
 * Set the active security key
 */
export function setActiveSecurityKey(keyId: string): void {
  const storage = loadSecurityKeys();
  if (storage.keys.some(key => key.keyId === keyId)) {
    storage.activeKeyId = keyId;
    saveSecurityKeys(storage);
  }
}

/**
 * Delete a security key
 */
export function deleteSecurityKey(keyId: string): void {
  const storage = loadSecurityKeys();
  storage.keys = storage.keys.filter(key => key.keyId !== keyId);

  // If we deleted the active key, set a new one
  if (storage.activeKeyId === keyId) {
    storage.activeKeyId = storage.keys[0]?.keyId;
  }

  saveSecurityKeys(storage);
}

/**
 * Export a public key for submission to CA
 */
export function exportPublicKey(keyId: string): SecurityKeyExport | undefined {
  const key = getSecurityKey(keyId);
  if (!key) return undefined;

  return {
    publicKeyBytes: key.publicKeyBytes,
    fingerprint: key.fingerprint,
    algorithm: 'Ed25519',
    createdAt: key.createdAt,
    keyId: key.keyId
  };
}

/**
 * Update key usage statistics
 */
export function updateKeyUsage(keyId: string): void {
  const storage = loadSecurityKeys();
  const key = storage.keys.find(k => k.keyId === keyId);

  if (key) {
    key.usageCount++;
    key.lastUsedAt = new Date().toISOString();
    saveSecurityKeys(storage);
  }
}

/**
 * Check if a key has expired
 */
export function isKeyExpired(key: SecurityKey): boolean {
  if (!key.expiresAt) return false;
  return new Date(key.expiresAt) < new Date();
}

/**
 * Get all valid (non-expired) keys
 */
export function getValidKeys(): SecurityKey[] {
  const storage = loadSecurityKeys();
  return storage.keys.filter(key => !isKeyExpired(key));
}

/**
 * Clear all security keys (use with caution!)
 */
export function clearAllKeys(): void {
  localStorage.removeItem(STORAGE_KEY);
}