/**
 * Secure Dashboard Bridge - BroadcastChannel Integration
 *
 * Enables zero-network-traffic decryption of secure dashboard content:
 * - Dashboard sends encrypted content via BroadcastChannel
 * - Wallet decrypts locally using X25519 keys from Security Clearance VC
 * - Wallet sends plaintext back via BroadcastChannel
 * - 100% local decryption - no server involved in decrypt phase
 *
 * Architecture:
 * 1. Dashboard fetches encrypted content from CA server
 * 2. Dashboard sends DECRYPT_REQUEST via BroadcastChannel
 * 3. Wallet receives request, decrypts using stored X25519 keys
 * 4. Wallet sends DECRYPT_RESPONSE with plaintext
 * 5. Dashboard updates DOM with decrypted content
 *
 * Version: 1.0.0
 * Created: October 31, 2025
 */

import { base64url } from 'jose';
import { decryptMessage, EncryptedMessageBody } from './messageEncryption';
import { getItem } from './prefixedStorage';

/**
 * Message types for BroadcastChannel communication
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
    };

/**
 * Initialize Secure Dashboard Bridge
 * Sets up BroadcastChannel listener for dashboard communication
 *
 * @param walletId - Unique wallet identifier ('alice' or 'bob')
 */
export function initSecureDashboardBridge(walletId: string): void {
  try {
    console.log(`[SecureDashboardBridge] Initializing for wallet: ${walletId}`);

    // Create BroadcastChannel
    const channel = new BroadcastChannel('identus-wallet-decrypt');

    // Set up message handler
    channel.onmessage = async (event) => {
      const message: DashboardMessage = event.data;

      console.log(`[SecureDashboardBridge] Received message:`, message.type);

      switch (message.type) {
        case 'PING':
          handlePing(channel, walletId);
          break;

        case 'DECRYPT_REQUEST':
          await handleDecryptRequest(channel, message);
          break;

        default:
          console.warn(`[SecureDashboardBridge] Unknown message type:`, message);
      }
    };

    channel.onerror = (error) => {
      console.error('[SecureDashboardBridge] BroadcastChannel error:', error);
    };

    console.log('[SecureDashboardBridge] ✅ Initialized successfully');

    // Store channel reference for cleanup
    (window as any).__secureDashboardChannel = channel;
  } catch (error) {
    console.error('[SecureDashboardBridge] Initialization failed:', error);
  }
}

/**
 * Handle PING request from dashboard
 * Responds with PONG to indicate wallet is active
 */
function handlePing(channel: BroadcastChannel, walletId: string): void {
  console.log('[SecureDashboardBridge] PING received, sending PONG');

  channel.postMessage({
    type: 'PONG',
    walletId: walletId,
    timestamp: Date.now()
  });
}

/**
 * Handle DECRYPT_REQUEST from dashboard
 * Decrypts content using X25519 keys and sends back plaintext
 */
async function handleDecryptRequest(
  channel: BroadcastChannel,
  message: Extract<DashboardMessage, { type: 'DECRYPT_REQUEST' }>
): Promise<void> {
  const { requestId, sectionId, encryptedContent } = message;

  console.log(`[SecureDashboardBridge] Decrypt request for section: ${sectionId}`);

  try {
    // Retrieve X25519 keys from localStorage
    // These were stored when user generated Security Clearance keys
    const securityKeysDataStr = getItem('security-clearance-keys'); // Note: plural 'keys'

    if (!securityKeysDataStr) {
      throw new Error('Security clearance keys not found. Please generate Security Clearance credential first.');
    }

    console.log('[SecureDashboardBridge] Found security-clearance-keys in storage');

    const securityKeysData = JSON.parse(securityKeysDataStr);

    // Extract active key from the keys array
    const activeKeyId = securityKeysData.activeKeyId;
    const activeKey = securityKeysData.keys.find((k: any) => k.keyId === activeKeyId);

    if (!activeKey) {
      throw new Error('Active security clearance key not found');
    }

    if (!activeKey.x25519 || !activeKey.x25519.privateKeyBytes || !activeKey.x25519.publicKeyBytes) {
      throw new Error('X25519 keys missing in security clearance data');
    }

    console.log('[SecureDashboardBridge] Retrieved X25519 keys from active key:', activeKeyId);

    // Keys are already in base64url format in storage
    const privateKeyBytes = base64url.decode(activeKey.x25519.privateKeyBytes);
    const publicKeyBytes = base64url.decode(activeKey.x25519.publicKeyBytes);

    console.log('[SecureDashboardBridge] Keys decoded, calling decryptMessage()');

    // Decrypt content using wallet's decryptMessage utility
    const plaintext = await decryptMessage(
      encryptedContent,
      privateKeyBytes,
      publicKeyBytes
    );

    console.log(`[SecureDashboardBridge] ✅ Decryption successful for section: ${sectionId}`);

    // Send decrypted plaintext back to dashboard
    channel.postMessage({
      type: 'DECRYPT_RESPONSE',
      requestId,
      sectionId,
      plaintext,
      timestamp: Date.now()
    });

    console.log(`[SecureDashboardBridge] DECRYPT_RESPONSE sent for section: ${sectionId}`);

  } catch (error) {
    console.error(`[SecureDashboardBridge] Decryption failed for section ${sectionId}:`, error);

    // Send error response to dashboard
    channel.postMessage({
      type: 'DECRYPT_ERROR',
      requestId,
      sectionId,
      error: error instanceof Error ? error.message : 'Unknown decryption error',
      timestamp: Date.now()
    });
  }
}

/**
 * Cleanup function to close BroadcastChannel
 * Call this when wallet is unmounted/closed
 */
export function cleanupSecureDashboardBridge(): void {
  const channel = (window as any).__secureDashboardChannel;

  if (channel) {
    console.log('[SecureDashboardBridge] Closing BroadcastChannel');
    channel.close();
    delete (window as any).__secureDashboardChannel;
  }
}
