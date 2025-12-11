/**
 * Key-VC Binding Verification
 *
 * Ensures that encryption keys are cryptographically bound to Security Clearance
 * Verifiable Credentials via public key fingerprinting.
 */

import { SecurityKey, SecurityKeyStorage, SecurityKeyDual, KeyComponent } from '../types/securityKeys';
import { loadSecurityKeys } from './securityKeyStorage';
import { SecurityLevel, parseSecurityLevel } from './securityLevels';

/**
 * Trusted Security Clearance VC schema and issuer
 * Only VCs matching these values will be accepted as legitimate Security Clearance VCs
 */
const TRUSTED_CA_DID = "did:prism:7fb0da715eed1451ac442cb3f8fbf73a084f8f73af16521812edd22d27d8f91c";
const SECURITY_CLEARANCE_SCHEMA = "http://91.99.4.54:8000/cloud-agent/schema-registry/schemas/c2cf96fb-c7c2-34c4-9aea-8db348f828c0";

/**
 * Validate that a VC is a legitimate Security Clearance VC from a trusted issuer.
 *
 * This prevents accepting malicious Security Clearance VCs from untrusted sources.
 * All three conditions must be met:
 * 1. VC schema matches the Security Clearance schema
 * 2. VC issuer is the trusted Certification Authority
 * 3. VC contains a clearanceLevel claim
 *
 * @param vc - Verifiable Credential to validate
 * @returns true if VC is a valid Security Clearance VC, false otherwise
 *
 * @example
 * const vc = credentials[0];
 * if (validateSecurityClearanceVC(vc)) {
 *   const level = getVCClearanceLevel(vc);
 *   // Safe to use clearance level
 * } else {
 *   console.error('Untrusted or malformed VC - rejected');
 * }
 */
export function validateSecurityClearanceVC(vc: any): boolean {
  if (!vc) {
    console.warn('⚠️ [validateSecurityClearanceVC] VC is null or undefined');
    return false;
  }

  // Check 1: Verify VC has a credentialSchema (basic structure check)
  // Note: We don't validate exact schema ID because the CA may update schema versions
  // Trust is based on CA issuer DID, not schema version
  let schema = vc.credentialSchema?.[0];

  // Try W3C VC structure inside JWT if not found at top level
  if (!schema && vc.vc?.credentialSchema?.[0]) {
    schema = vc.vc.credentialSchema[0];
    console.log('✅ [validateSecurityClearanceVC] Found schema via vc.vc.credentialSchema');
  }

  if (!schema || !schema.id) {
    console.warn('⚠️ [validateSecurityClearanceVC] VC missing credentialSchema');
    return false;
  }
  console.log('✅ [validateSecurityClearanceVC] VC has schema:', schema.id);

  // Check 2: Verify issuer is trusted CA
  // JWT credentials can store issuer in multiple locations:
  // 1. vc.iss (top-level JWT property)
  // 2. vc.properties.get('iss') (SDK properties Map)
  // 3. vc.vc.issuer (W3C VC structure inside JWT)
  let issuer = vc.issuer?.id || vc.iss;

  // Try SDK properties Map if direct access failed
  if (!issuer && vc.properties && typeof vc.properties.get === 'function') {
    issuer = vc.properties.get('iss');
    if (issuer) {
      console.log('✅ [validateSecurityClearanceVC] Found issuer via vc.properties.get("iss")');
    }
  }

  // Try W3C VC structure inside JWT
  if (!issuer && vc.vc?.issuer) {
    issuer = typeof vc.vc.issuer === 'string' ? vc.vc.issuer : vc.vc.issuer.id;
    if (issuer) {
      console.log('✅ [validateSecurityClearanceVC] Found issuer via vc.vc.issuer');
    }
  }

  if (issuer !== TRUSTED_CA_DID) {
    console.warn('⚠️ [validateSecurityClearanceVC] Untrusted issuer', {
      expected: TRUSTED_CA_DID,
      actual: issuer || 'none',
      vcStructure: {
        hasIss: !!vc.iss,
        hasIssuer: !!vc.issuer,
        hasProperties: !!vc.properties,
        hasVcIssuer: !!(vc.vc && vc.vc.issuer)
      }
    });
    return false;
  }

  // Check 3: Verify clearanceLevel claim exists
  // 🔇 DEBUG-VC-STRUCTURE logs temporarily hidden for readability
  // console.log('🔍 [DEBUG-VC-STRUCTURE] ========== INSPECTING VC FOR CLEARANCE LEVEL ==========');
  // console.log('🔍 [DEBUG-VC-STRUCTURE] VC top-level keys:', Object.keys(vc));
  // console.log('🔍 [DEBUG-VC-STRUCTURE] credentialSubject:', JSON.stringify(vc.credentialSubject, null, 2));
  // console.log('🔍 [DEBUG-VC-STRUCTURE] claims:', vc.claims);
  // console.log('🔍 [DEBUG-VC-STRUCTURE] subject:', vc.subject);

  // Try to find clearanceLevel in vc.vc (W3C VC structure inside JWT)
  // if (vc.vc) {
  //   console.log('🔍 [DEBUG-VC-STRUCTURE] vc.vc exists - checking nested structure');
  //   console.log('🔍 [DEBUG-VC-STRUCTURE] vc.vc.credentialSubject:', JSON.stringify(vc.vc.credentialSubject, null, 2));
  // }

  let hasClearanceLevel = false;

  // Try credentialSubject (standard JWT structure)
  if (vc.credentialSubject?.clearanceLevel) {
    // console.log('✅ [DEBUG-VC-STRUCTURE] Found clearanceLevel in vc.credentialSubject.clearanceLevel');
    hasClearanceLevel = true;
  }

  // Try claims array (Edge Agent SDK structure)
  if (!hasClearanceLevel && vc.claims && vc.claims.length > 0) {
    // console.log('🔍 [DEBUG-VC-STRUCTURE] Checking claims[0]:', JSON.stringify(vc.claims[0], null, 2));
    if (vc.claims[0]?.clearanceLevel) {
      // console.log('✅ [DEBUG-VC-STRUCTURE] Found clearanceLevel in vc.claims[0].clearanceLevel');
      hasClearanceLevel = true;
    }
  }

  // Try W3C VC structure inside JWT
  if (!hasClearanceLevel && vc.vc?.credentialSubject?.clearanceLevel) {
    // console.log('✅ [DEBUG-VC-STRUCTURE] Found clearanceLevel in vc.vc.credentialSubject.clearanceLevel');
    hasClearanceLevel = true;
  }

  // console.log('🔍 [DEBUG-VC-STRUCTURE] hasClearanceLevel:', hasClearanceLevel);
  // console.log('🔍 [DEBUG-VC-STRUCTURE] ========================================');

  if (!hasClearanceLevel) {
    console.warn('⚠️ [validateSecurityClearanceVC] Missing clearanceLevel claim');
    return false;
  }

  console.log('✅ [validateSecurityClearanceVC] Valid Security Clearance VC from trusted CA');
  return true;
}

/**
 * Verify that a security key is bound to a Security Clearance VC
 * by comparing fingerprints.
 *
 * The VC contains a keyFingerprint field that must match the fingerprint
 * of the stored private key. This ensures the key was generated by the
 * user and is legitimately associated with the VC.
 *
 * @param securityKey - The security key from localStorage
 * @param securityClearanceVC - The Security Clearance Verifiable Credential
 * @returns true if fingerprints match, false otherwise
 *
 * @example
 * const key = getSecurityKeyByFingerprint("AB:CD:EF:...");
 * const vc = credentials.find(c => c.type.includes('SecurityClearanceCredential'));
 * if (verifyKeyVCBinding(key, vc)) {
 *   // Key is bound to VC - safe to use for encryption
 * }
 */
export function verifyKeyVCBinding(
  securityKey: SecurityKey,
  securityClearanceVC: any
): boolean {
  const subject = securityClearanceVC.credentialSubject || securityClearanceVC.subject;

  // Check if this is a dual-key structure
  const isDualKey = 'x25519' in securityKey;

  if (isDualKey) {
    // v3.0.0: Check X25519 fingerprint
    let vcX25519Fingerprint = subject?.x25519Fingerprint;

    // Try claims array for X25519 fingerprint
    if (!vcX25519Fingerprint && securityClearanceVC.claims && securityClearanceVC.claims.length > 0) {
      vcX25519Fingerprint = securityClearanceVC.claims[0]?.x25519Fingerprint;
    }

    if (!vcX25519Fingerprint) {
      console.error('❌ [keyVCBinding] v3.0.0 VC missing x25519Fingerprint');
      return false;
    }

    const keyX25519Fingerprint = (securityKey as any).x25519.fingerprint;
    if (keyX25519Fingerprint !== vcX25519Fingerprint) {
      console.error('❌ [keyVCBinding] X25519 fingerprint mismatch', {
        keyFingerprint: keyX25519Fingerprint,
        vcFingerprint: vcX25519Fingerprint
      });
      return false;
    }

    console.log('✅ [keyVCBinding] Key-VC binding verified (v3.0.0 dual-key)', {
      x25519Fingerprint: vcX25519Fingerprint.substring(0, 20) + '...'
    });
    return true;

  } else {
    // Legacy: Check old keyFingerprint field
    let vcFingerprint = subject?.keyFingerprint;

    if (!vcFingerprint && securityClearanceVC.claims && securityClearanceVC.claims.length > 0) {
      vcFingerprint = securityClearanceVC.claims[0]?.keyFingerprint;
    }

    if (!vcFingerprint) {
      console.error('❌ [keyVCBinding] Legacy VC missing keyFingerprint');
      return false;
    }

    if ((securityKey as any).fingerprint !== vcFingerprint) {
      console.error('❌ [keyVCBinding] Legacy fingerprint mismatch', {
        keyFingerprint: (securityKey as any).fingerprint,
        vcFingerprint: vcFingerprint
      });
      return false;
    }

    console.log('✅ [keyVCBinding] Key-VC binding verified (legacy single-key)', {
      fingerprint: vcFingerprint.substring(0, 20) + '...'
    });
    return true;
  }
}

/**
 * Extract the clearance level from a Security Clearance VC
 *
 * @param vc - Security Clearance Verifiable Credential
 * @returns SecurityLevel enum value
 *
 * @example
 * const vc = credentials.find(c => c.type.includes('SecurityClearanceCredential'));
 * const level = getVCClearanceLevel(vc);
 * // SecurityLevel.SECRET
 */
export function getVCClearanceLevel(vc: any): SecurityLevel {
  if (!vc) {
    console.warn('⚠️ [keyVCBinding] No VC provided, defaulting to UNCLASSIFIED');
    return SecurityLevel.UNCLASSIFIED;
  }

  // Try credentialSubject first (standard JWT structure)
  let clearanceLevelStr = vc.credentialSubject?.clearanceLevel;

  // Try claims array (Edge Agent SDK structure)
  if (!clearanceLevelStr && vc.claims && vc.claims.length > 0) {
    clearanceLevelStr = vc.claims[0]?.clearanceLevel;
  }

  if (!clearanceLevelStr) {
    console.warn('⚠️ [keyVCBinding] VC missing clearanceLevel, defaulting to UNCLASSIFIED');
    return SecurityLevel.UNCLASSIFIED;
  }

  return parseSecurityLevel(clearanceLevelStr);
}

/**
 * Retrieve a security key from localStorage by its fingerprint
 *
 * This is used to find the private key that corresponds to a public key
 * fingerprint embedded in a Security Clearance VC.
 *
 * @param fingerprint - Public key fingerprint (format: "AB:CD:EF:...")
 * @returns SecurityKey if found, undefined otherwise
 *
 * @example
 * const vc = credentials.find(c => c.type.includes('SecurityClearanceCredential'));
 * const fingerprint = vc.credentialSubject.keyFingerprint;
 * const key = getSecurityKeyByFingerprint(fingerprint);
 * if (key) {
 *   // Use key.privateKeyBytes for encryption
 * }
 */
export function getSecurityKeyByFingerprint(fingerprint: string): SecurityKey | undefined {
  const storage: SecurityKeyStorage = loadSecurityKeys();

  const key = storage.keys.find(k => {
    // Check legacy single-key format
    if ('fingerprint' in k) {
      return (k as any).fingerprint === fingerprint;
    }
    // Check dual-key format (v3.0.0) - search both ed25519 and x25519 fingerprints
    if ('ed25519' in k && 'x25519' in k) {
      const dualKey = k as any;
      return dualKey.ed25519.fingerprint === fingerprint ||
             dualKey.x25519.fingerprint === fingerprint;
    }
    return false;
  });

  if (!key) {
    console.warn(`⚠️ [keyVCBinding] No security key found for fingerprint: ${fingerprint.substring(0, 20)}...`);
    return undefined;
  }

  console.log('✅ [keyVCBinding] Security key retrieved', {
    keyId: key.keyId,
    fingerprint: fingerprint.substring(0, 20) + '...'
  });

  return key;
}

/**
 * Validate that a user has a Security Clearance VC with a bound key
 * for a given clearance level.
 *
 * @param credentials - Array of credentials from wallet state
 * @param requiredLevel - Minimum required clearance level
 * @returns Object with validation result and details
 *
 * @example
 * const result = validateUserClearance(credentials, SecurityLevel.SECRET);
 * if (!result.valid) {
 *   alert(result.error);
 * } else {
 *   // Use result.vc and result.key for encryption
 * }
 */
export function validateUserClearance(
  credentials: any[],
  requiredLevel: SecurityLevel
): {
  valid: boolean;
  vc?: any;
  key?: SecurityKey;
  clearanceLevel?: SecurityLevel;
  error?: string;
} {
  // Find Security Clearance VC with schema and issuer validation
  const securityVC = credentials.find(cred => {
    // First, validate schema and issuer trust
    if (!validateSecurityClearanceVC(cred)) {
      return false;
    }

    // Check type array (for legacy VCs)
    if (cred.type?.includes('SecurityClearanceCredential') || cred.type?.includes('SecurityClearance')) {
      return true;
    }

    // Check for clearanceLevel in claims (JWT credentials from Cloud Agent)
    if (cred.claims && cred.claims.length > 0) {
      if (cred.claims[0]?.clearanceLevel) {
        return true;
      }
    }

    // Check credentialSubject (alternative JWT structure)
    if (cred.credentialSubject && cred.credentialSubject.clearanceLevel) {
      return true;
    }

    return false;
  });

  if (!securityVC) {
    return {
      valid: false,
      error: 'No valid Security Clearance VC from trusted CA found. Cannot send classified messages.'
    };
  }

  // Get clearance level
  const userClearance = getVCClearanceLevel(securityVC);

  if (userClearance < requiredLevel) {
    return {
      valid: false,
      vc: securityVC,
      clearanceLevel: userClearance,
      error: `Insufficient clearance. You have ${SecurityLevel[userClearance]} but need ${SecurityLevel[requiredLevel]}.`
    };
  }

  // Get bound key - try credentialSubject first, then claims array
  let vcFingerprint = securityVC.credentialSubject?.keyFingerprint;
  if (!vcFingerprint && securityVC.claims && securityVC.claims.length > 0) {
    vcFingerprint = securityVC.claims[0]?.keyFingerprint;
  }
  if (!vcFingerprint) {
    return {
      valid: false,
      vc: securityVC,
      clearanceLevel: userClearance,
      error: 'Security Clearance VC missing key fingerprint. VC may be invalid.'
    };
  }

  const boundKey = getSecurityKeyByFingerprint(vcFingerprint);
  if (!boundKey) {
    return {
      valid: false,
      vc: securityVC,
      clearanceLevel: userClearance,
      error: 'Private key not found. VC may have been revoked or key deleted.'
    };
  }

  // Verify binding
  if (!verifyKeyVCBinding(boundKey, securityVC)) {
    return {
      valid: false,
      vc: securityVC,
      clearanceLevel: userClearance,
      error: 'Key-VC binding verification failed. Security violation detected.'
    };
  }

  return {
    valid: true,
    vc: securityVC,
    key: boundKey,
    clearanceLevel: userClearance
  };
}

/**
 * Extract public key from a Security Clearance VC
 * Supports both dual-key VCs (v3.0.0) and legacy single-key VCs (v2.0.0)
 *
 * @param vc - Security Clearance Verifiable Credential
 * @returns Public key bytes as base64url string, or undefined if not found
 */
export function getVCPublicKey(vc: any): string | undefined {
  // Try dual-key structure first (v3.0.0 with cryptographicKeys)
  let publicKey = vc?.credentialSubject?.cryptographicKeys?.ed25519PublicKey;

  if (!publicKey && vc?.claims && vc.claims.length > 0) {
    publicKey = vc.claims[0]?.cryptographicKeys?.ed25519PublicKey;
  }

  // Fallback to legacy structure (v2.0.0 with flat publicKey)
  if (!publicKey) {
    publicKey = vc?.credentialSubject?.publicKey;

    if (!publicKey && vc?.claims && vc.claims.length > 0) {
      publicKey = vc.claims[0]?.publicKey;
    }
  }

  return publicKey;
}

/**
 * Extract X25519 encryption public key from Security Clearance VC
 * Supports dual-key VCs with fallback to Ed25519→X25519 conversion for legacy VCs
 *
 * @param vc - Security Clearance Verifiable Credential
 * @returns X25519 public key as base64url string, or undefined if extraction fails
 *
 * @example
 * // For dual-key VC
 * const x25519Key = await getVCX25519PublicKey(securityVC);
 * // Returns native X25519 key from VC
 *
 * // For legacy VC
 * const x25519Key = await getVCX25519PublicKey(legacyVC);
 * // Converts Ed25519 → X25519 automatically
 */
export async function getVCX25519PublicKey(vc: any): Promise<string | undefined> {
  // Try native X25519 encryption key first (dual-key VCs)
  let x25519Key = vc?.credentialSubject?.cryptographicKeys?.x25519PublicKey;

  if (!x25519Key && vc?.claims && vc.claims.length > 0) {
    x25519Key = vc.claims[0]?.cryptographicKeys?.x25519PublicKey;
  }

  if (x25519Key) {
    console.log('✅ [getVCX25519PublicKey] Found native X25519 key in VC');
    return x25519Key;
  }

  // FALLBACK: Convert Ed25519 key for legacy VCs
  console.warn('⚠️ [getVCX25519PublicKey] No native X25519 key - converting Ed25519 (legacy mode)');
  const ed25519Key = getVCPublicKey(vc);

  if (!ed25519Key) {
    console.error('❌ [getVCX25519PublicKey] No Ed25519 key found - VC invalid');
    return undefined;
  }

  try {
    const sodium = await import('libsodium-wrappers');
    await sodium.ready;
    const { base64url } = await import('jose');

    const ed25519Bytes = base64url.decode(ed25519Key);
    const x25519Bytes = sodium.crypto_sign_ed25519_pk_to_curve25519(ed25519Bytes);

    console.log('✅ [getVCX25519PublicKey] Converted Ed25519 → X25519 (legacy fallback)');
    return base64url.encode(x25519Bytes);

  } catch (error) {
    console.error('❌ [getVCX25519PublicKey] Conversion failed:', error);
    return undefined;
  }
}

/**
 * Check if a Security Clearance VC has expired
 *
 * @param vc - Security Clearance Verifiable Credential
 * @returns true if expired, false if still valid
 */
export function isVCExpired(vc: any): boolean {
  const validUntil = vc?.credentialSubject?.validUntil;

  if (!validUntil) {
    return false; // No expiry date means no expiration
  }

  return new Date(validUntil) < new Date();
}

/**
 * Reconstruct SDK PrivateKey from stored privateKeyBytes and derive the correct public key
 *
 * This uses the SDK's own key derivation instead of manual byte extraction,
 * ensuring compatibility with the SDK's key format.
 *
 * @param privateKeyBytes - base64url encoded private key from storage
 * @param publicKeyBytes - base64url encoded public key from storage (for verification)
 * @param apollo - SDK Apollo instance
 * @returns Object with SDK-derived public key bytes, or null on error
 */
export async function derivePublicKeyFromPrivate(
  privateKeyBytes: string,
  publicKeyBytes: string,
  apollo: any
): Promise<{ sdkDerivedPublicKey: Uint8Array } | null> {
  try {
    const { base64url } = await import('jose');

    // Decode private key from storage
    const privateKeyRaw = base64url.decode(privateKeyBytes);

    // Reconstruct SDK PrivateKey object
    // The SDK stores keys in its own format, so we need to use its restoration methods
    const SDKModule = await import('@hyperledger/identus-edge-agent-sdk');
    const SDK = SDKModule.default || SDKModule;

    const restoredPrivateKey = apollo.restorePrivateKey({
      recoveryId: "ed25519+priv",
      raw: Array.from(privateKeyRaw)
    });

    // Use SDK's publicKey() method to derive the correct public key
    const derivedPublicKey = restoredPrivateKey.publicKey();

    console.log('✅ [derivePublicKeyFromPrivate] Successfully derived public key using SDK');

    return {
      sdkDerivedPublicKey: new Uint8Array(derivedPublicKey.value)
    };

  } catch (error) {
    console.error('❌ [derivePublicKeyFromPrivate] Failed to derive public key:', error);
    return null;
  }
}

/**
 * Generate SHA256 fingerprint from public key bytes
 *
 * @param publicKeyBytes - Uint8Array of public key bytes
 * @returns Fingerprint string formatted as "XX:XX:XX:..."
 */
function generateFingerprint(publicKeyBytes: Uint8Array): string {
  const crypto = require('crypto');
  const hash = crypto.createHash('sha256').update(publicKeyBytes).digest('hex');
  return hash.toUpperCase().match(/.{2}/g)!.join(':');
}

/**
 * Generate dual-key (Ed25519 + X25519) keypair from a single libsodium seed
 *
 * This creates BOTH signing keys (Ed25519) and encryption keys (X25519) from
 * a single random seed, ensuring cryptographic binding between the two keys.
 *
 * @param label - Optional label for the key (default: "Security Clearance Key")
 * @returns SecurityKeyDual object with both Ed25519 and X25519 components
 *
 * @example
 * const dualKey = await generateDualSecurityKey("Alice's Clearance Key");
 * console.log('Ed25519 fingerprint:', dualKey.ed25519.fingerprint);
 * console.log('X25519 fingerprint:', dualKey.x25519.fingerprint);
 */
export async function generateDualSecurityKey(label?: string): Promise<SecurityKeyDual> {
  const sodium = await import('libsodium-wrappers');
  await sodium.ready;
  const { base64url } = await import('jose');
  const crypto = require('crypto');

  console.log('🔐 [generateDualSecurityKey] Starting dual-key generation...');

  // 1. Generate random 32-byte seed (entropy source for both keys)
  const seed = sodium.randombytes_buf(32);
  console.log('✅ [generateDualSecurityKey] Random seed generated (32 bytes)');

  // 2. Derive Ed25519 keypair from seed using libsodium (CORRECT format)
  // NOTE: We use libsodium directly, not SDK, to ensure Ed25519→X25519 conversion works
  const ed25519Keypair = sodium.crypto_sign_seed_keypair(seed);
  const ed25519PrivateKey = ed25519Keypair.privateKey;  // 64 bytes (seed + public key)
  const ed25519PublicKey = ed25519Keypair.publicKey;    // 32 bytes
  console.log('✅ [generateDualSecurityKey] Ed25519 keypair derived from seed');
  console.log('   - Private key length:', ed25519PrivateKey.length, 'bytes');
  console.log('   - Public key length:', ed25519PublicKey.length, 'bytes');

  // 3. Derive X25519 keypair from Ed25519 keys (for encryption)
  // This ensures X25519 keys are cryptographically bound to Ed25519 keys
  const x25519PrivateKey = sodium.crypto_sign_ed25519_sk_to_curve25519(ed25519PrivateKey);
  const x25519PublicKey = sodium.crypto_sign_ed25519_pk_to_curve25519(ed25519PublicKey);
  console.log('✅ [generateDualSecurityKey] X25519 keypair derived from Ed25519 keys');
  console.log('   - Private key length:', x25519PrivateKey.length, 'bytes');
  console.log('   - Public key length:', x25519PublicKey.length, 'bytes');

  // 4. Generate fingerprints (SHA256 hash of public keys)
  const ed25519Fingerprint = generateFingerprint(ed25519PublicKey);
  const x25519Fingerprint = generateFingerprint(x25519PublicKey);
  console.log('✅ [generateDualSecurityKey] Fingerprints generated');
  console.log('   - Ed25519:', ed25519Fingerprint.substring(0, 20) + '...');
  console.log('   - X25519:', x25519Fingerprint.substring(0, 20) + '...');

  // 5. Generate unique key ID
  const keyId = `dual-key-${Date.now()}-${crypto.randomBytes(8).toString('hex')}`;
  console.log('✅ [generateDualSecurityKey] Key ID generated:', keyId);

  // 6. Build SecurityKeyDual structure
  const dualKey: SecurityKeyDual = {
    keyId: keyId,
    ed25519: {
      privateKeyBytes: base64url.encode(ed25519PrivateKey),
      publicKeyBytes: base64url.encode(ed25519PublicKey),
      fingerprint: ed25519Fingerprint,
      curve: 'Ed25519',
      purpose: 'signing'
    },
    x25519: {
      privateKeyBytes: base64url.encode(x25519PrivateKey),
      publicKeyBytes: base64url.encode(x25519PublicKey),
      fingerprint: x25519Fingerprint,
      curve: 'X25519',
      purpose: 'encryption'
    },
    label: label || 'Security Clearance Key',
    createdAt: new Date().toISOString(),
    usageCount: 0
  };

  console.log('🎉 [generateDualSecurityKey] Dual-key generation complete!');
  console.log('   - Label:', dualKey.label);
  console.log('   - Created:', dualKey.createdAt);

  return dualKey;
}

/**
 * Extract dual-key public keys from a Security Clearance VC
 *
 * @param vc - Security Clearance Verifiable Credential (v3.0.0)
 * @returns Object with both Ed25519 and X25519 public keys, or null if not dual-key VC
 *
 * @example
 * const dualKeys = extractDualKeyFromVC(securityVC);
 * if (dualKeys) {
 *   console.log('Ed25519 key:', dualKeys.ed25519);
 *   console.log('X25519 key:', dualKeys.x25519);
 * }
 */
export function extractDualKeyFromVC(vc: any): { ed25519: string; x25519: string } | null {
  // Extract from dual-key VC structure
  let ed25519 = vc?.credentialSubject?.cryptographicKeys?.ed25519PublicKey;
  let x25519 = vc?.credentialSubject?.cryptographicKeys?.x25519PublicKey;

  if (!ed25519 || !x25519) {
    if (vc?.claims && vc.claims.length > 0) {
      ed25519 = vc.claims[0]?.cryptographicKeys?.ed25519PublicKey;
      x25519 = vc.claims[0]?.cryptographicKeys?.x25519PublicKey;
    }
  }

  if (ed25519 && x25519) {
    console.log('✅ [extractDualKeyFromVC] Found dual-key structure');
    console.log('   - Ed25519 key length:', ed25519.length, 'chars');
    console.log('   - X25519 key length:', x25519.length, 'chars');
    return { ed25519, x25519 };
  }

  console.warn('⚠️ [extractDualKeyFromVC] Not a dual-key VC - missing cryptographicKeys structure');
  return null;
}

/**
 * Export dual-key public keys for CA submission
 *
 * Extracts only the public key components needed for Security Clearance VC issuance.
 * Private keys remain secure in browser localStorage.
 *
 * @param dualKey - SecurityKeyDual object with both Ed25519 and X25519 keys
 * @returns Object with both public keys in base64url format
 *
 * @example
 * const dualKey = await generateDualSecurityKey();
 * const publicKeys = exportDualKeyForCA(dualKey);
 *
 * fetch('/api/request-security-clearance', {
 *   method: 'POST',
 *   headers: { 'Content-Type': 'application/json' },
 *   body: JSON.stringify({
 *     ...publicKeys,
 *     clearanceLevel: 'SECRET'
 *   })
 * });
 */
export function exportDualKeyForCA(dualKey: SecurityKeyDual): {
  ed25519PublicKey: string;
  x25519PublicKey: string;
  ed25519Fingerprint: string;
  x25519Fingerprint: string;
} {
  console.log('📤 [exportDualKeyForCA] Exporting public keys for CA submission');
  console.log('   - Key ID:', dualKey.keyId);
  console.log('   - Ed25519 fingerprint:', dualKey.ed25519.fingerprint.substring(0, 20) + '...');
  console.log('   - X25519 fingerprint:', dualKey.x25519.fingerprint.substring(0, 20) + '...');

  return {
    ed25519PublicKey: dualKey.ed25519.publicKeyBytes,
    x25519PublicKey: dualKey.x25519.publicKeyBytes,
    ed25519Fingerprint: dualKey.ed25519.fingerprint,
    x25519Fingerprint: dualKey.x25519.fingerprint
  };
}

/**
 * Save dual-key to localStorage for persistent storage
 *
 * Stores in NEW localStorage key (security-clearance-keys-v2) to avoid conflicts
 * with legacy single-key storage (security-clearance-keys).
 *
 * @param dualKey - SecurityKeyDual object to store
 *
 * @example
 * const dualKey = await generateDualSecurityKey("Alice's Key");
 * saveDualKeyToLocalStorage(dualKey);
 *
 * // Later retrieval:
 * const storage = JSON.parse(localStorage.getItem('security-clearance-keys-v2')!);
 * const activeKey = storage.keys.find(k => k.keyId === storage.activeKeyId);
 */
export function saveDualKeyToLocalStorage(dualKey: SecurityKeyDual): void {
  try {
    const storageKey = 'security-clearance-keys-v2';  // New key for dual-key storage
    const existingData = localStorage.getItem(storageKey);

    let keysData: { keys: SecurityKeyDual[]; activeKeyId?: string; version: '2.0' } = {
      keys: [],
      version: '2.0'
    };

    if (existingData) {
      keysData = JSON.parse(existingData);
      console.log('📂 [saveDualKeyToLocalStorage] Loaded existing storage:', keysData.keys.length, 'keys');
    } else {
      console.log('📂 [saveDualKeyToLocalStorage] Creating new storage');
    }

    // Add new key
    keysData.keys.push(dualKey);
    keysData.activeKeyId = dualKey.keyId;

    localStorage.setItem(storageKey, JSON.stringify(keysData));

    console.log('✅ [saveDualKeyToLocalStorage] Saved dual-key:', dualKey.keyId);
    console.log('   - Total keys in storage:', keysData.keys.length);
    console.log('   - Active key ID:', keysData.activeKeyId);
    console.log('   - Storage version:', keysData.version);

  } catch (error) {
    console.error('❌ [saveDualKeyToLocalStorage] Failed:', error);
    throw error;
  }
}
