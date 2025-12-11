/**
 * Secure Dashboard Bridge - window.postMessage Integration
 *
 * Enables zero-network-traffic decryption of secure dashboard content:
 * - Dashboard opens wallet in new window
 * - Dashboard sends encrypted content via window.postMessage
 * - Wallet decrypts locally using X25519 keys from Security Clearance VC
 * - Wallet sends plaintext back via window.postMessage
 * - 100% local decryption - no server involved in decrypt phase
 *
 * Architecture:
 * 1. Dashboard opens wallet: window.open('http://91.99.4.54:3001')
 * 2. Wallet detects opener and sends ready signal
 * 3. Dashboard sends DECRYPT_REQUEST via postMessage
 * 4. Wallet receives request, decrypts using stored X25519 keys
 * 5. Wallet sends DECRYPT_RESPONSE with plaintext
 * 6. Dashboard updates DOM with decrypted content
 *
 * Version: 2.0.0 (Migrated from BroadcastChannel to postMessage)
 * Updated: October 31, 2025
 */

import { base64url } from 'jose';
import { decryptMessage, EncryptedMessageBody } from './messageEncryption';
import { getItem } from './prefixedStorage';
import { findKeyByFingerprintInPluto, extractKeysFromPrismDID } from './plutoKeyExtractor';

// Module-level agent reference for Pluto fallback
let _sdkAgent: any = null;

// Store walletId for deferred WALLET_READY signal
let _walletId: string | null = null;

/**
 * Set the SDK agent for Pluto fallback key lookup
 * Call this after agent is initialized to enable PRISM DID key fallback
 *
 * CRITICAL: This is when WALLET_READY is sent to opener (not at init time)
 * This ensures the agent is available before dashboard sends DECRYPT_REQUEST
 */
export function setSecureDashboardAgent(agent: any): void {
  _sdkAgent = agent;
  console.log('🔐 [SecureDashboardBridge] Agent set for Pluto fallback');

  // NOW send WALLET_READY signal to opener (if this is a popup)
  // Previously this was done in initSecureDashboardBridge() BEFORE agent was set
  if (typeof window !== 'undefined' && window.opener && !window.opener.closed && _walletId) {
    console.log('🔗 [SecureDashboardBridge] Agent ready - NOW sending WALLET_READY to opener');

    ALLOWED_ORIGINS.forEach(origin => {
      try {
        window.opener.postMessage({
          type: 'WALLET_READY',
          walletId: _walletId,
          timestamp: Date.now()
        }, origin);
        console.log(`✅ [SecureDashboardBridge] WALLET_READY sent to ${origin}`);
      } catch (error) {
        console.warn(`⚠️ [SecureDashboardBridge] Failed to send WALLET_READY to ${origin}:`, error);
      }
    });
  }
}

/**
 * Message types for postMessage communication
 */
export type DashboardMessage =
  | {
      type: 'PING';
      source: string;
      timestamp: number;
    }
  | {
      type: 'DECRYPT_REQUEST';
      requestId: string;
      sectionId: string;
      encryptedContent: EncryptedMessageBody;
      timestamp: number;
    }
  | {
      type: 'DOCUMENT_ACCESS_REQUEST';
      requestId: string;
      documentDID: string;
      clearanceLevel: number;
      timestamp: number;
    };

// Allowed dashboard origins
const ALLOWED_ORIGINS = [
  'http://91.99.4.54:3005',     // CA Server (IP access)
  'http://localhost:3005',      // Local development
  'https://identuslabel.cz',    // CA Server (domain access via HTTPS)
  'http://91.99.4.54:3010',     // Company Admin Portal (IP access)
  'http://localhost:3010',      // Company Admin Portal (local development)
];

/**
 * Initialize Secure Dashboard Bridge
 * Sets up postMessage listener for dashboard communication
 *
 * @param walletId - Unique wallet identifier ('alice' or 'bob')
 */
export function initSecureDashboardBridge(walletId: string): void {
  try {
    console.log(`🔐 [SecureDashboardBridge] Initializing for wallet: ${walletId}`);

    // Set up postMessage listener
    const messageHandler = async (event: MessageEvent) => {
      // EARLY EXIT: Ignore messages from self (prevents log spam)
      if (event.source === window) {
        return;
      }

      // EARLY EXIT: Ignore messages without valid type (non-dashboard messages)
      if (!event.data?.type) {
        return;
      }

      // Security: Validate origin
      if (!ALLOWED_ORIGINS.includes(event.origin)) {
        console.warn(`⚠️ [SecureDashboardBridge] Rejected message from unauthorized origin: ${event.origin}`);
        return;
      }

      const message: DashboardMessage = event.data;

      console.log(`📨 [SecureDashboardBridge] Received message:`, message.type);

      switch (message.type) {
        case 'PING':
          handlePing(event.source as Window, event.origin, walletId);
          break;

        case 'DECRYPT_REQUEST':
          await handleDecryptRequest(event.source as Window, event.origin, message);
          break;

        case 'DOCUMENT_ACCESS_REQUEST':
          await handleDocumentAccessRequest(event.source as Window, event.origin, message);
          break;

        default:
          console.warn(`⚠️ [SecureDashboardBridge] Unknown message type:`, message);
      }
    };

    window.addEventListener('message', messageHandler);

    console.log('✅ [SecureDashboardBridge] postMessage listener initialized');

    // Store handler reference for cleanup
    (window as any).__secureDashboardMessageHandler = messageHandler;

    // Store walletId for deferred WALLET_READY signal (sent when agent is set)
    _walletId = walletId;

    // NOTE: WALLET_READY is now sent LATER in setSecureDashboardAgent() after agent is available
    // This fixes the race condition where dashboard sends DECRYPT_REQUEST before agent is ready
    if (window.opener && !window.opener.closed) {
      console.log('🔗 [SecureDashboardBridge] Detected opener window - WALLET_READY will be sent when agent is ready');
    }

    console.log('✅ [SecureDashboardBridge] Initialized successfully (waiting for agent to send WALLET_READY)');
  } catch (error) {
    console.error('❌ [SecureDashboardBridge] Initialization failed:', error);
  }
}

/**
 * Handle PING request from dashboard
 * Responds with PONG to indicate wallet is active
 */
function handlePing(source: Window, origin: string, walletId: string): void {
  console.log('🏓 [SecureDashboardBridge] PING received, sending PONG');

  try {
    source.postMessage({
      type: 'PONG',
      walletId: walletId,
      timestamp: Date.now()
    }, origin);
  } catch (error) {
    console.error('❌ [SecureDashboardBridge] Failed to send PONG:', error);
  }
}

/**
 * Handle DECRYPT_REQUEST from dashboard
 * Decrypts content using X25519 keys and sends back plaintext
 *
 * Two-pass key lookup:
 * 1. Fast path: localStorage (manually generated keys)
 * 2. Fallback: Pluto (PRISM DID keys) - if agent is available
 */
async function handleDecryptRequest(
  source: Window,
  origin: string,
  message: Extract<DashboardMessage, { type: 'DECRYPT_REQUEST' }>
): Promise<void> {
  const { requestId, sectionId, encryptedContent } = message;

  console.log(`🔓 [SecureDashboardBridge] Decrypt request for section: ${sectionId}`);
  console.log(`🔓 [SecureDashboardBridge] Agent available: ${_sdkAgent ? 'YES' : 'NO (Pluto fallback disabled)'}`);

  try {
    let privateKeyBytes: Uint8Array | null = null;
    let publicKeyBytes: Uint8Array | null = null;
    let keySource = '';

    // ============================================================
    // PASS 1: Try localStorage (fast path - manually generated keys)
    // ============================================================
    const securityKeysDataStr = getItem('security-clearance-keys');

    if (securityKeysDataStr) {
      console.log('🔑 [SecureDashboardBridge] Found security-clearance-keys in localStorage');

      try {
        const securityKeysData = JSON.parse(securityKeysDataStr);
        const activeKeyId = securityKeysData.activeKeyId;
        const activeKey = securityKeysData.keys.find((k: any) => k.keyId === activeKeyId);

        if (activeKey?.x25519?.privateKeyBytes && activeKey?.x25519?.publicKeyBytes) {
          privateKeyBytes = base64url.decode(activeKey.x25519.privateKeyBytes);
          publicKeyBytes = base64url.decode(activeKey.x25519.publicKeyBytes);
          keySource = 'localStorage';
          console.log('🔑 [SecureDashboardBridge] Using localStorage keys:', activeKeyId);
        }
      } catch (parseError) {
        console.warn('⚠️ [SecureDashboardBridge] Failed to parse localStorage keys:', parseError);
      }
    }

    // ============================================================
    // PASS 2: Try Pluto fallback (PRISM DID keys)
    // ============================================================
    if (!privateKeyBytes && _sdkAgent) {
      console.log('🔍 [SecureDashboardBridge] localStorage keys not found, trying Pluto fallback...');

      try {
        // Get all PRISM DIDs and check for X25519 keys
        const prismDIDs = await _sdkAgent.pluto.getAllPrismDIDs();

        if (prismDIDs && prismDIDs.length > 0) {
          console.log(`📦 [SecureDashboardBridge] Found ${prismDIDs.length} PRISM DIDs in Pluto`);

          // Try each PRISM DID until we find X25519 keys
          for (const prismDID of prismDIDs) {
            const didString = prismDID.did.toString();
            const plutoKeys = await extractKeysFromPrismDID(_sdkAgent, didString);

            if (plutoKeys?.x25519) {
              privateKeyBytes = base64url.decode(plutoKeys.x25519.privateKeyBytes);
              publicKeyBytes = base64url.decode(plutoKeys.x25519.publicKeyBytes);
              keySource = `Pluto (${didString.substring(0, 30)}...)`;
              console.log('🔑 [SecureDashboardBridge] Using Pluto keys from PRISM DID');
              break;
            }
          }
        }
      } catch (plutoError) {
        console.warn('⚠️ [SecureDashboardBridge] Pluto fallback failed:', plutoError);
      }
    }

    // ============================================================
    // Check if we found any keys
    // ============================================================
    if (!privateKeyBytes || !publicKeyBytes) {
      const errorMsg = _sdkAgent
        ? 'No X25519 keys found in localStorage or Pluto. Please generate Security Clearance credential first.'
        : 'Security clearance keys not found. Please generate Security Clearance credential first.';
      throw new Error(errorMsg);
    }

    console.log(`🔧 [SecureDashboardBridge] Keys decoded from ${keySource}, calling decryptMessage()`);

    // Decrypt content using wallet's decryptMessage utility
    const plaintext = await decryptMessage(
      encryptedContent,
      privateKeyBytes,
      publicKeyBytes
    );

    console.log(`✅ [SecureDashboardBridge] Decryption successful for section: ${sectionId}`);

    // Send decrypted plaintext back to dashboard
    source.postMessage({
      type: 'DECRYPT_RESPONSE',
      requestId,
      sectionId,
      plaintext,
      timestamp: Date.now()
    }, origin);

    console.log(`📤 [SecureDashboardBridge] DECRYPT_RESPONSE sent for section: ${sectionId}`);

  } catch (error) {
    console.error(`❌ [SecureDashboardBridge] Decryption failed for section ${sectionId}:`, error);

    // Send error response to dashboard
    try {
      source.postMessage({
        type: 'DECRYPT_ERROR',
        requestId,
        sectionId,
        error: error instanceof Error ? error.message : 'Unknown decryption error',
        timestamp: Date.now()
      }, origin);
    } catch (postError) {
      console.error('❌ [SecureDashboardBridge] Failed to send error response:', postError);
    }
  }
}

/**
 * Wait for the SDK agent to be set (with timeout)
 * Used for DOCUMENT_ACCESS_REQUEST which requires Pluto access for signing keys
 */
async function waitForAgent(timeoutMs: number = 10000): Promise<boolean> {
  if (_sdkAgent) return true;

  const startTime = Date.now();
  const pollInterval = 200; // Check every 200ms

  return new Promise((resolve) => {
    const checkAgent = () => {
      if (_sdkAgent) {
        console.log('✅ [SecureDashboardBridge] Agent is now available');
        resolve(true);
        return;
      }

      if (Date.now() - startTime >= timeoutMs) {
        console.warn(`⏱️ [SecureDashboardBridge] Agent not available after ${timeoutMs}ms timeout`);
        resolve(false);
        return;
      }

      setTimeout(checkAgent, pollInterval);
    };

    console.log('⏳ [SecureDashboardBridge] Waiting for agent to be available...');
    checkAgent();
  });
}

/**
 * Get Ed25519 signing key from localStorage or Pluto fallback
 * Two-pass lookup: localStorage (fast) → Pluto (PRISM DID keys)
 */
async function getEd25519KeyFromPluto(): Promise<Uint8Array | null> {
  // ============================================================
  // PASS 1: Try localStorage (fast path - manually generated keys)
  // ============================================================
  const securityKeysDataStr = getItem('security-clearance-keys');

  if (securityKeysDataStr) {
    try {
      const securityKeysData = JSON.parse(securityKeysDataStr);
      const activeKeyId = securityKeysData.activeKeyId;
      const activeKey = securityKeysData.keys.find((k: any) => k.keyId === activeKeyId);

      if (activeKey?.ed25519?.privateKeyBytes) {
        console.log('🔑 [SecureDashboardBridge] Using localStorage Ed25519 key');
        return base64url.decode(activeKey.ed25519.privateKeyBytes);
      }
    } catch (parseError) {
      console.warn('⚠️ [SecureDashboardBridge] Failed to parse localStorage keys:', parseError);
    }
  }

  // ============================================================
  // PASS 2: Try Pluto fallback (PRISM DID keys)
  // ============================================================
  if (_sdkAgent) {
    try {
      const prismDIDs = await _sdkAgent.pluto.getAllPrismDIDs();

      if (prismDIDs && prismDIDs.length > 0) {
        for (const prismDID of prismDIDs) {
          const didString = prismDID.did.toString();
          const plutoKeys = await extractKeysFromPrismDID(_sdkAgent, didString);

          if (plutoKeys?.ed25519?.privateKeyBytes) {
            console.log('🔑 [SecureDashboardBridge] Using Pluto Ed25519 key from PRISM DID');
            return base64url.decode(plutoKeys.ed25519.privateKeyBytes);
          }
        }
      }
    } catch (plutoError) {
      console.warn('⚠️ [SecureDashboardBridge] Pluto Ed25519 fallback failed:', plutoError);
    }
  }

  return null;
}

/**
 * Handle DOCUMENT_ACCESS_REQUEST from Employee Portal Dashboard
 *
 * Flow:
 * 1. Generate ephemeral X25519 keypair (perfect forward secrecy)
 * 2. Get Ed25519 key from Pluto for request signing
 * 3. Sign access request payload
 * 4. POST to Company Admin Portal /api/ephemeral-documents/{documentDID}/access
 * 5. Decrypt response with ephemeral key
 * 6. Send decrypted document back to Employee Portal
 */
async function handleDocumentAccessRequest(
  source: Window,
  origin: string,
  message: Extract<DashboardMessage, { type: 'DOCUMENT_ACCESS_REQUEST' }>
): Promise<void> {
  const { requestId, documentDID, clearanceLevel, sessionToken } = message;

  console.log(`📄 [SecureDashboardBridge] Document access request for: ${documentDID.substring(0, 50)}...`);
  console.log(`📄 [SecureDashboardBridge] Clearance level: ${clearanceLevel}`);
  console.log(`📄 [SecureDashboardBridge] Session token: ${sessionToken ? 'present' : 'MISSING'}`);
  console.log(`📄 [SecureDashboardBridge] Agent available: ${_sdkAgent ? 'YES' : 'NO'}`);

  try {
    // CRITICAL: Wait for agent to be ready (needed for Pluto key lookup)
    // The request may arrive before agent initialization completes
    if (!_sdkAgent) {
      console.log('⏳ [SecureDashboardBridge] Agent not ready, waiting up to 15 seconds...');
      const agentReady = await waitForAgent(15000);
      if (!agentReady) {
        throw new Error('Wallet agent not ready. Please wait for the wallet to fully load and try again.');
      }
    }

    // Dynamic import of tweetnacl for NaCl cryptography
    const nacl = await import('tweetnacl');

    // 1. Generate ephemeral X25519 keypair (perfect forward secrecy)
    const ephemeralKeyPair = nacl.box.keyPair();
    const ephemeralPublicKey = base64url.encode(ephemeralKeyPair.publicKey);
    console.log('🔐 [SecureDashboardBridge] Generated ephemeral X25519 keypair');

    // 2. Get Ed25519 signing key from Pluto (agent is now guaranteed available)
    const ed25519PrivateKey = await getEd25519KeyFromPluto();
    if (!ed25519PrivateKey) {
      throw new Error('No Ed25519 signing key found. Please ensure you have a PRISM DID (connect to CA first).');
    }

    // 3. Create and sign access request payload
    const timestamp = new Date().toISOString();
    const nonce = crypto.randomUUID();
    const payload = JSON.stringify({
      documentDID,
      ephemeralPublicKey,
      timestamp,
      nonce
    });

    const signature = nacl.sign.detached(
      new Uint8Array(new TextEncoder().encode(payload)),
      ed25519PrivateKey
    );
    const signatureBase64 = base64url.encode(signature);
    console.log('✍️ [SecureDashboardBridge] Signed access request payload');

    // 4. POST to Company Admin Portal
    // Determine the Company Admin Portal base URL
    // The origin from postMessage is the Employee Portal Dashboard,
    // but we need to POST to the Company Admin Portal server
    const companyAdminPortalUrl = origin.includes('localhost')
      ? 'http://localhost:3010'
      : 'https://identuslabel.cz/company-admin';

    const accessEndpoint = `${companyAdminPortalUrl}/api/ephemeral-documents/access`;

    console.log(`📤 [SecureDashboardBridge] Posting to: ${accessEndpoint}`);

    // Create ephemeralDID from the ephemeral public key (did:key format with multibase z prefix)
    const ephemeralPublicKeyBytes = Buffer.from(ephemeralKeyPair.publicKey);
    const ephemeralDID = 'did:key:z' + ephemeralPublicKeyBytes.toString('hex');

    // Use the CA's issuer DID (this is the trusted issuer for Security Clearance VCs)
    // In production, this would be extracted from the user's Security Clearance VC
    const issuerDID = 'did:prism:6ee757c2913a76aa4eb2f09e9cd3cc40ead73cfaffc7d712c303ee5bc38f21bf';

    console.log(`🔑 [SecureDashboardBridge] Ephemeral DID: ${ephemeralDID.substring(0, 50)}...`);

    // Build headers - include session token if provided for server authentication
    const headers: Record<string, string> = { 'Content-Type': 'application/json' };
    if (sessionToken) {
      headers['X-Session-ID'] = sessionToken;
      console.log('🔑 [SecureDashboardBridge] Including X-Session-ID header for authentication');
    } else {
      console.warn('⚠️ [SecureDashboardBridge] No session token provided - request may be rejected');
    }

    const response = await fetch(accessEndpoint, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        documentDID,
        requestorDID: 'did:prism:wallet-user', // Will be replaced with actual PRISM DID
        issuerDID,
        clearanceLevel,
        ephemeralDID,
        ephemeralPublicKey,
        signature: signatureBase64,
        timestamp,
        nonce
      })
    });

    const data = await response.json();

    if (!data.success) {
      throw new Error(data.error || data.message || 'Document access denied');
    }

    console.log(`✅ [SecureDashboardBridge] Access granted for document`);

    // 5. Decrypt response with ephemeral key
    if (data.ciphertext && data.nonce && data.serverPublicKey) {
      const ciphertext = base64url.decode(data.ciphertext);
      const decryptNonce = base64url.decode(data.nonce);
      const serverPubKey = base64url.decode(data.serverPublicKey);

      const decrypted = nacl.box.open(
        ciphertext,
        decryptNonce,
        serverPubKey,
        ephemeralKeyPair.secretKey
      );

      if (!decrypted) {
        throw new Error('Failed to decrypt document content');
      }

      console.log(`🔓 [SecureDashboardBridge] Decrypted ${decrypted.length} bytes`);

      // 6. Send decrypted document back to Employee Portal
      source.postMessage({
        type: 'DOCUMENT_ACCESS_RESPONSE',
        requestId,
        success: true, // Explicit success flag for Employee Portal
        documentBlob: Array.from(decrypted), // Convert Uint8Array for postMessage
        filename: data.filename,
        mimeType: data.mimeType || 'application/pdf',
        copyId: data.copyId,
        timestamp: Date.now()
      }, origin);

      console.log(`📤 [SecureDashboardBridge] DOCUMENT_ACCESS_RESPONSE sent`);
    } else {
      throw new Error('Invalid response format - missing encrypted content');
    }

  } catch (error) {
    console.error(`❌ [SecureDashboardBridge] Document access failed:`, error);

    // Send error response to Employee Portal
    try {
      source.postMessage({
        type: 'DOCUMENT_ACCESS_ERROR',
        requestId,
        error: error instanceof Error ? error.message : 'Unknown document access error',
        timestamp: Date.now()
      }, origin);
    } catch (postError) {
      console.error('❌ [SecureDashboardBridge] Failed to send error response:', postError);
    }
  }
}

/**
 * Cleanup function to remove postMessage listener
 * Call this when wallet is unmounted/closed
 */
export function cleanupSecureDashboardBridge(): void {
  const handler = (window as any).__secureDashboardMessageHandler;

  if (handler) {
    console.log('🧹 [SecureDashboardBridge] Removing postMessage listener');
    window.removeEventListener('message', handler);
    delete (window as any).__secureDashboardMessageHandler;
  }
}
