// Security Key TypeScript Interfaces for Ed25519-based Security Clearance VCs

export interface SecurityKey {
  keyId: string;                      // Unique identifier for this key
  privateKeyBytes: string;            // base64url encoded private key
  publicKeyBytes: string;             // base64url encoded public key
  fingerprint: string;                // SHA256 hash formatted as XX:XX:XX...
  curve: 'Ed25519';                   // Curve type (always Ed25519 for security)
  purpose: 'security-clearance';      // Purpose of this key
  label?: string;                     // Optional user-friendly label
  createdAt: string;                  // ISO 8601 timestamp
  expiresAt?: string;                 // Optional expiration timestamp
  lastUsedAt?: string;                // Track last usage
  usageCount: number;                 // Track how many times key has been used
}

export interface SecurityKeyPair {
  privateKey: any;  // SDK.Domain.PrivateKey instance
  publicKey: any;   // SDK.Domain.PublicKey instance
  curve: string;    // SDK.Domain.Curve value
}

export interface SecurityKeyExport {
  publicKeyBytes: string;             // Public key for CA submission
  fingerprint: string;                // Key fingerprint for identification
  algorithm: 'Ed25519';               // Algorithm identifier
  createdAt: string;                  // Creation timestamp
  keyId: string;                      // Key identifier
}

export interface SecurityKeyStorage {
  keys: SecurityKey[];                // Array of all stored keys
  activeKeyId?: string;               // Currently active key for operations
}