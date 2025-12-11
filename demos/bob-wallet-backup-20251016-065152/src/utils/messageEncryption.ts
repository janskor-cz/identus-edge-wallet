/**
 * Message Encryption/Decryption using NaCl Box (XSalsa20-Poly1305)
 *
 * Implements authenticated encryption for DIDComm messages using:
 * - Ed25519 keys from Security Clearance VCs (converted to X25519)
 * - XSalsa20-Poly1305 authenticated encryption (NaCl box)
 * - Base64url encoding for wire format
 */

import * as nacl from 'tweetnacl';
import * as sodium from 'libsodium-wrappers';
import { base64url } from 'jose';

/**
 * Encrypted message body structure
 * This replaces the plaintext message body in DIDComm messages
 */
export interface EncryptedMessageBody {
  /** Indicates this is an encrypted message */
  encrypted: true;

  /** Encryption algorithm identifier */
  algorithm: 'XSalsa20-Poly1305';

  /** Encryption format version */
  version: '1.0';

  /** Encrypted message content (base64url encoded) */
  ciphertext: string;

  /** 24-byte nonce for XSalsa20-Poly1305 (base64url encoded) */
  nonce: string;

  /** Recipient's X25519 public key (base64url encoded) */
  recipientPublicKey: string;
}

/**
 * Encrypt a plaintext message using NaCl box authenticated encryption
 *
 * Process:
 * 1. Convert Ed25519 signing keys to X25519 encryption keys
 * 2. Generate random 24-byte nonce
 * 3. Perform authenticated encryption using ECDH + XSalsa20-Poly1305
 * 4. Return encrypted message structure
 *
 * @param plaintext - Message content to encrypt
 * @param senderEd25519PrivateKey - Sender's Ed25519 private key (64 bytes: seed + pubkey)
 * @param recipientEd25519PublicKey - Recipient's Ed25519 public key (32 bytes)
 * @returns Encrypted message body structure
 *
 * @throws Error if libsodium initialization fails
 * @throws Error if key conversion fails
 * @throws Error if encryption fails
 *
 * @example
 * const senderPrivateKey = base64url.decode(senderKey.privateKeyBytes);
 * const recipientPublicKey = base64url.decode(recipientVC.credentialSubject.publicKey);
 *
 * const encrypted = await encryptMessage(
 *   "The package arrives at midnight",
 *   senderPrivateKey,
 *   recipientPublicKey
 * );
 *
 * // encrypted.ciphertext contains encrypted content
 * // encrypted.nonce contains unique nonce
 */
export async function encryptMessage(
  plaintext: string,
  senderEd25519PrivateKey: Uint8Array,
  recipientEd25519PublicKey: Uint8Array
): Promise<EncryptedMessageBody> {
  // Ensure libsodium is ready
  await sodium.ready;

  // Validate inputs
  if (!plaintext) {
    throw new Error('[messageEncryption] Plaintext message cannot be empty');
  }

  if (senderEd25519PrivateKey.length !== 64) {
    throw new Error(
      `[messageEncryption] Invalid sender private key length: ${senderEd25519PrivateKey.length} bytes (expected 64)`
    );
  }

  if (recipientEd25519PublicKey.length !== 32) {
    throw new Error(
      `[messageEncryption] Invalid recipient public key length: ${recipientEd25519PublicKey.length} bytes (expected 32)`
    );
  }

  try {
    // Convert Ed25519 keys to X25519 encryption keys
    // Ed25519 private key format: [32-byte seed][32-byte public key]
    // We use the 32-byte seed for conversion
    const senderEd25519Seed = senderEd25519PrivateKey.slice(0, 32);

    const senderX25519Private = sodium.crypto_sign_ed25519_sk_to_curve25519(senderEd25519Seed);
    const recipientX25519Public = sodium.crypto_sign_ed25519_pk_to_curve25519(recipientEd25519PublicKey);

    console.log('✅ [messageEncryption] Keys converted Ed25519 → X25519');

    // Generate random 24-byte nonce (required for XSalsa20-Poly1305)
    const nonce = nacl.randomBytes(24);

    // Encode plaintext to bytes
    const messageBytes = new TextEncoder().encode(plaintext);

    // Perform authenticated encryption
    // nacl.box uses ECDH to derive shared secret, then encrypts with XSalsa20-Poly1305
    const ciphertext = nacl.box(
      messageBytes,
      nonce,
      recipientX25519Public,
      senderX25519Private
    );

    if (!ciphertext) {
      throw new Error('[messageEncryption] Encryption failed - nacl.box returned null');
    }

    console.log('✅ [messageEncryption] Message encrypted', {
      plaintextLength: plaintext.length,
      ciphertextLength: ciphertext.length,
      nonceLength: nonce.length
    });

    // Return encrypted message structure
    return {
      encrypted: true,
      algorithm: 'XSalsa20-Poly1305',
      version: '1.0',
      ciphertext: base64url.encode(ciphertext),
      nonce: base64url.encode(nonce),
      recipientPublicKey: base64url.encode(recipientX25519Public)
    };
  } catch (error) {
    console.error('❌ [messageEncryption] Encryption error:', error);
    throw error;
  }
}

/**
 * Decrypt an encrypted message using NaCl box authenticated decryption
 *
 * Process:
 * 1. Convert Ed25519 signing keys to X25519 encryption keys
 * 2. Decode ciphertext and nonce from base64url
 * 3. Perform authenticated decryption using ECDH + XSalsa20-Poly1305
 * 4. Return plaintext message
 *
 * @param encryptedBody - Encrypted message body structure
 * @param recipientEd25519PrivateKey - Recipient's Ed25519 private key (64 bytes)
 * @param senderEd25519PublicKey - Sender's Ed25519 public key (32 bytes)
 * @returns Decrypted plaintext message
 *
 * @throws Error if libsodium initialization fails
 * @throws Error if key conversion fails
 * @throws Error if decryption fails (wrong key or tampered message)
 *
 * @example
 * const recipientPrivateKey = base64url.decode(recipientKey.privateKeyBytes);
 * const senderPublicKey = base64url.decode(senderVC.credentialSubject.publicKey);
 *
 * const plaintext = await decryptMessage(
 *   encryptedMessageBody,
 *   recipientPrivateKey,
 *   senderPublicKey
 * );
 *
 * console.log('Decrypted:', plaintext);
 * // "The package arrives at midnight"
 */
export async function decryptMessage(
  encryptedBody: EncryptedMessageBody,
  recipientEd25519PrivateKey: Uint8Array,
  senderEd25519PublicKey: Uint8Array
): Promise<string> {
  // Ensure libsodium is ready
  await sodium.ready;

  // Validate inputs
  if (!encryptedBody || !encryptedBody.encrypted) {
    throw new Error('[messageEncryption] Invalid encrypted message body');
  }

  if (encryptedBody.algorithm !== 'XSalsa20-Poly1305') {
    throw new Error(
      `[messageEncryption] Unsupported encryption algorithm: ${encryptedBody.algorithm}`
    );
  }

  if (recipientEd25519PrivateKey.length !== 64) {
    throw new Error(
      `[messageEncryption] Invalid recipient private key length: ${recipientEd25519PrivateKey.length} bytes (expected 64)`
    );
  }

  if (senderEd25519PublicKey.length !== 32) {
    throw new Error(
      `[messageEncryption] Invalid sender public key length: ${senderEd25519PublicKey.length} bytes (expected 32)`
    );
  }

  try {
    // Convert Ed25519 keys to X25519 encryption keys
    const recipientEd25519Seed = recipientEd25519PrivateKey.slice(0, 32);

    const recipientX25519Private = sodium.crypto_sign_ed25519_sk_to_curve25519(recipientEd25519Seed);
    const senderX25519Public = sodium.crypto_sign_ed25519_pk_to_curve25519(senderEd25519PublicKey);

    console.log('✅ [messageEncryption] Keys converted Ed25519 → X25519 for decryption');

    // Decode ciphertext and nonce from base64url
    const ciphertext = base64url.decode(encryptedBody.ciphertext);
    const nonce = base64url.decode(encryptedBody.nonce);

    // Validate nonce length
    if (nonce.length !== 24) {
      throw new Error(
        `[messageEncryption] Invalid nonce length: ${nonce.length} bytes (expected 24)`
      );
    }

    // Perform authenticated decryption
    // nacl.box.open uses ECDH to derive shared secret, then decrypts with XSalsa20-Poly1305
    // Returns null if decryption fails (wrong key, tampered message, etc.)
    const plaintext = nacl.box.open(
      ciphertext,
      nonce,
      senderX25519Public,
      recipientX25519Private
    );

    if (!plaintext) {
      throw new Error(
        '[messageEncryption] Decryption failed - invalid key or corrupted message. ' +
        'Possible causes: wrong private key, tampered ciphertext, or mismatched sender public key.'
      );
    }

    // Decode bytes to string
    const decryptedText = new TextDecoder().decode(plaintext);

    console.log('✅ [messageEncryption] Message decrypted successfully', {
      ciphertextLength: ciphertext.length,
      plaintextLength: decryptedText.length
    });

    return decryptedText;
  } catch (error) {
    console.error('❌ [messageEncryption] Decryption error:', error);
    throw error;
  }
}

/**
 * Validate that an encrypted message body has the correct structure
 *
 * @param body - Potential encrypted message body
 * @returns true if valid, false otherwise
 */
export function isValidEncryptedMessageBody(body: any): body is EncryptedMessageBody {
  return (
    body &&
    body.encrypted === true &&
    body.algorithm === 'XSalsa20-Poly1305' &&
    body.version === '1.0' &&
    typeof body.ciphertext === 'string' &&
    typeof body.nonce === 'string' &&
    typeof body.recipientPublicKey === 'string'
  );
}

/**
 * Get encryption metadata for logging/debugging
 *
 * @param encryptedBody - Encrypted message body
 * @returns Metadata object (safe to log - no secrets)
 */
export function getEncryptionMetadata(encryptedBody: EncryptedMessageBody) {
  return {
    algorithm: encryptedBody.algorithm,
    version: encryptedBody.version,
    ciphertextLength: encryptedBody.ciphertext.length,
    noncePreview: encryptedBody.nonce.substring(0, 12) + '...',
    recipientKeyPreview: encryptedBody.recipientPublicKey.substring(0, 12) + '...'
  };
}
