import React, { useState, useEffect } from 'react';
import { Box } from '@/app/Box';
import SDK from '@hyperledger/identus-edge-agent-sdk';
import * as jose from 'jose';
import { trimString } from '../app/utils';
import { SecurityKey, SecurityKeyExport } from '../types/securityKeys';
import {
  loadSecurityKeys,
  addSecurityKey,
  addSecurityKeyDual,
  getActiveSecurityKey,
  setActiveSecurityKey,
  deleteSecurityKey,
  exportPublicKey,
  updateKeyUsage,
  generateFingerprint
} from '../utils/securityKeyStorage';
import * as sodium from 'libsodium-wrappers';

const apollo = new SDK.Apollo();

export function SecurityClearanceKeyManager() {
  const [keys, setKeys] = useState<SecurityKey[]>([]);
  const [activeKey, setActiveKey] = useState<SecurityKey | undefined>();
  const [isGenerating, setIsGenerating] = useState(false);
  const [showExportModal, setShowExportModal] = useState(false);
  const [exportData, setExportData] = useState<SecurityKeyExport | undefined>();
  const [newKeyLabel, setNewKeyLabel] = useState('');

  // Load keys on component mount
  useEffect(() => {
    refreshKeys();
  }, []);

  const refreshKeys = () => {
    const storage = loadSecurityKeys();
    setKeys(storage.keys);
    setActiveKey(getActiveSecurityKey());
  };

  const handleGenerateKey = async () => {
    if (isGenerating) return;

    setIsGenerating(true);
    try {
      // Ensure libsodium is ready
      await sodium.ready;

      // Step 1: Generate Ed25519 key pair using SDK Apollo
      const mnemonics = apollo.createRandomMnemonics();
      const seed = apollo.createSeed(mnemonics, "security-clearance-seed");

      const ed25519PrivateKey = apollo.createPrivateKey({
        type: SDK.Domain.KeyTypes.EC,
        curve: SDK.Domain.Curve.ED25519,
        seed: Array.from(seed.value).map(b => b.toString(16).padStart(2, '0')).join(''),
      });

      const ed25519PublicKey = ed25519PrivateKey.publicKey();

      // Step 2: Derive X25519 key pair from Ed25519 seed using libsodium
      // libsodium requires exactly 32 bytes for crypto_sign_seed_keypair
      // SDK's createSeed() may return 64 bytes - we need to truncate to 32
      const seedBytes = new Uint8Array(seed.value).slice(0, 32);

      // Generate proper libsodium Ed25519 keypair from seed (for correct key derivation)
      const libsodiumEd25519Keypair = sodium.crypto_sign_seed_keypair(seedBytes);

      // Derive X25519 keys from Ed25519 keys
      const x25519PrivateKey = sodium.crypto_sign_ed25519_sk_to_curve25519(libsodiumEd25519Keypair.privateKey);
      const x25519PublicKey = sodium.crypto_sign_ed25519_pk_to_curve25519(libsodiumEd25519Keypair.publicKey);

      // Step 3: Convert all keys to base64url for storage
      const ed25519PrivateKeyB64 = jose.base64url.encode(ed25519PrivateKey.value);
      const ed25519PublicKeyB64 = jose.base64url.encode(ed25519PublicKey.value);
      const x25519PrivateKeyB64 = jose.base64url.encode(x25519PrivateKey);
      const x25519PublicKeyB64 = jose.base64url.encode(x25519PublicKey);

      // Step 4: Generate fingerprints for both keys
      const ed25519Fingerprint = generateFingerprint(ed25519PublicKeyB64);
      const x25519Fingerprint = generateFingerprint(x25519PublicKeyB64);

      // Step 5: Store dual-key in localStorage
      const newKey = await addSecurityKeyDual(
        ed25519PrivateKeyB64,
        ed25519PublicKeyB64,
        ed25519Fingerprint,
        x25519PrivateKeyB64,
        x25519PublicKeyB64,
        x25519Fingerprint,
        newKeyLabel || undefined
      );

      console.log('✅ Generated new dual-key security clearance key:', {
        keyId: newKey.keyId,
        ed25519: {
          fingerprint: newKey.ed25519.fingerprint,
          curve: 'Ed25519',
          purpose: 'signing'
        },
        x25519: {
          fingerprint: newKey.x25519.fingerprint,
          curve: 'X25519',
          purpose: 'encryption'
        }
      });

      // Reset form and refresh
      setNewKeyLabel('');
      refreshKeys();

    } catch (error) {
      console.error('❌ Failed to generate security key:', error);
      alert('Failed to generate security key. Please try again.');
    } finally {
      setIsGenerating(false);
    }
  };

  const handleSetActive = (keyId: string) => {
    setActiveSecurityKey(keyId);
    refreshKeys();
  };

  const handleDeleteKey = (keyId: string) => {
    if (confirm('Are you sure you want to delete this security key? This action cannot be undone.')) {
      deleteSecurityKey(keyId);
      refreshKeys();
    }
  };

  const handleExportKey = (keyId: string) => {
    const exportData = exportPublicKey(keyId);
    if (exportData) {
      setExportData(exportData);
      setShowExportModal(true);
      updateKeyUsage(keyId);
      refreshKeys();
    }
  };

  const copyToClipboard = (text: string, label: string) => {
    if (navigator.clipboard && navigator.clipboard.writeText) {
      navigator.clipboard.writeText(text).then(() => {
        alert(`${label} copied to clipboard!`);
      }).catch(err => {
        console.error('Failed to copy with Clipboard API:', err);
        fallbackCopyToClipboard(text, label);
      });
    } else {
      fallbackCopyToClipboard(text, label);
    }
  };

  const fallbackCopyToClipboard = (text: string, label: string) => {
    try {
      const textArea = document.createElement('textarea');
      textArea.value = text;
      textArea.style.position = 'fixed';
      textArea.style.top = '0';
      textArea.style.left = '0';
      textArea.style.width = '2em';
      textArea.style.height = '2em';
      textArea.style.padding = '0';
      textArea.style.border = 'none';
      textArea.style.outline = 'none';
      textArea.style.boxShadow = 'none';
      textArea.style.background = 'transparent';
      document.body.appendChild(textArea);
      textArea.focus();
      textArea.select();

      const successful = document.execCommand('copy');
      document.body.removeChild(textArea);

      if (successful) {
        alert(`${label} copied to clipboard!`);
      } else {
        alert(`Please manually copy the ${label.toLowerCase()}: ${text}`);
      }
    } catch (err) {
      console.error('Fallback copy failed:', err);
      alert(`Please manually copy the ${label.toLowerCase()}: ${text}`);
    }
  };

  const formatDate = (isoString: string) => {
    return new Date(isoString).toLocaleString();
  };

  return (
    <Box>
      <div className="mb-6">
        <h1 className="mb-4 text-2xl font-extrabold leading-none tracking-tight text-gray-900 dark:text-white">
          🔐 Security Clearance Key Manager
        </h1>
        <p className="text-lg font-normal text-gray-500 dark:text-gray-400 mb-4">
          Generate and manage Ed25519 keys for Security Clearance Verifiable Credentials.
          Private keys are stored securely in your wallet and never shared with the Certification Authority.
        </p>
      </div>

      {/* Key Generation Section */}
      <div className="mb-8 p-6 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
        <h2 className="text-xl font-bold text-blue-900 dark:text-blue-100 mb-4">
          Generate New Security Key
        </h2>

        <div className="mb-4">
          <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
            Key Label (Optional)
          </label>
          <input
            type="text"
            value={newKeyLabel}
            onChange={(e) => setNewKeyLabel(e.target.value)}
            placeholder="e.g., Main Security Key, Backup Key..."
            className="block w-full p-3 text-gray-900 border border-gray-300 rounded-lg bg-gray-50 dark:bg-gray-700 dark:border-gray-600 dark:text-white"
            disabled={isGenerating}
          />
        </div>

        <button
          onClick={handleGenerateKey}
          disabled={isGenerating}
          className="px-6 py-3 text-base font-medium text-white bg-blue-700 rounded-lg hover:bg-blue-800 focus:ring-4 focus:ring-blue-300 dark:focus:ring-blue-900 disabled:bg-gray-400"
        >
          {isGenerating ? 'Generating Dual Keys...' : '🔑 Generate Dual-Key (Ed25519 + X25519)'}
        </button>

        <div className="mt-4 text-sm text-blue-800 dark:text-blue-200">
          <strong>⚠️ Security Note:</strong> Your private key will be stored locally in your wallet.
          Only the public key will be submitted to the Certification Authority.
        </div>
      </div>

      {/* Keys List */}
      <div className="mb-6">
        <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
          Your Security Keys ({keys.length})
        </h2>

        {keys.length === 0 ? (
          <div className="text-center py-8 text-gray-500 dark:text-gray-400">
            <p>No security keys generated yet.</p>
            <p>Generate your first key above to get started.</p>
          </div>
        ) : (
          <div className="space-y-4">
            {keys.map((key) => (
              <div
                key={key.keyId}
                className={`p-6 rounded-lg border ${
                  activeKey?.keyId === key.keyId
                    ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                    : 'border-gray-300 bg-white dark:bg-gray-800 dark:border-gray-600'
                }`}
              >
                <div className="flex justify-between items-start mb-4">
                  <div>
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
                      {key.label}
                      {activeKey?.keyId === key.keyId && (
                        <span className="ml-2 px-2 py-1 text-xs font-medium text-green-800 bg-green-100 rounded-full dark:bg-green-900 dark:text-green-200">
                          Active
                        </span>
                      )}
                    </h3>
                    <p className="text-sm text-gray-600 dark:text-gray-400">
                      Key ID: {key.keyId}
                    </p>
                  </div>

                  <div className="flex space-x-2">
                    {activeKey?.keyId !== key.keyId && (
                      <button
                        onClick={() => handleSetActive(key.keyId)}
                        className="px-3 py-1 text-sm text-blue-700 border border-blue-700 rounded hover:bg-blue-50 dark:text-blue-400 dark:border-blue-400"
                      >
                        Set Active
                      </button>
                    )}
                    <button
                      onClick={() => handleExportKey(key.keyId)}
                      className="px-3 py-1 text-sm text-green-700 border border-green-700 rounded hover:bg-green-50 dark:text-green-400 dark:border-green-400"
                    >
                      Export Public Key
                    </button>
                    <button
                      onClick={() => handleDeleteKey(key.keyId)}
                      className="px-3 py-1 text-sm text-red-700 border border-red-700 rounded hover:bg-red-50 dark:text-red-400 dark:border-red-400"
                    >
                      Delete
                    </button>
                  </div>
                </div>

                <div className="text-sm space-y-3">
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                    <div>
                      <strong>Created:</strong> {formatDate(key.createdAt)}
                    </div>
                    <div>
                      <strong>Usage Count:</strong> {key.usageCount}
                    </div>
                  </div>

                  {('ed25519' in key && 'x25519' in key) ? (
                    // Dual-key format
                    <>
                      <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                        <div className="font-semibold text-blue-900 dark:text-blue-100 mb-2">
                          🔐 Ed25519 (Signing Key)
                        </div>
                        <div className="space-y-2">
                          <div>
                            <strong className="text-xs">Fingerprint:</strong>
                            <div className="mt-1 font-mono text-xs bg-white dark:bg-gray-700 px-2 py-1 rounded border break-all">
                              {(key as any).ed25519.fingerprint}
                            </div>
                          </div>
                          <div>
                            <strong className="text-xs">Public Key:</strong>
                            <div className="mt-1">
                              <input
                                readOnly
                                value={trimString((key as any).ed25519.publicKeyBytes, 80)}
                                className="w-full p-2 text-xs font-mono bg-white dark:bg-gray-700 border rounded"
                              />
                            </div>
                          </div>
                        </div>
                      </div>

                      <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                        <div className="font-semibold text-green-900 dark:text-green-100 mb-2">
                          🔒 X25519 (Encryption Key)
                        </div>
                        <div className="space-y-2">
                          <div>
                            <strong className="text-xs">Fingerprint:</strong>
                            <div className="mt-1 font-mono text-xs bg-white dark:bg-gray-700 px-2 py-1 rounded border break-all">
                              {(key as any).x25519.fingerprint}
                            </div>
                          </div>
                          <div>
                            <strong className="text-xs">Public Key:</strong>
                            <div className="mt-1">
                              <input
                                readOnly
                                value={trimString((key as any).x25519.publicKeyBytes, 80)}
                                className="w-full p-2 text-xs font-mono bg-white dark:bg-gray-700 border rounded"
                              />
                            </div>
                          </div>
                        </div>
                      </div>
                    </>
                  ) : (
                    // Legacy single-key format
                    <>
                      <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                        <div>
                          <strong>Curve:</strong> {(key as any).curve}
                        </div>
                        <div>
                          <strong>Purpose:</strong> {(key as any).purpose}
                        </div>
                      </div>
                      <div>
                        <strong>Fingerprint:</strong>
                        <span className="ml-2 font-mono text-xs bg-gray-100 dark:bg-gray-700 px-2 py-1 rounded">
                          {(key as any).fingerprint}
                        </span>
                      </div>
                      <div>
                        <strong>Public Key:</strong>
                        <div className="mt-1">
                          <input
                            readOnly
                            value={trimString((key as any).publicKeyBytes, 80)}
                            className="w-full p-2 text-xs font-mono bg-gray-100 dark:bg-gray-700 border rounded"
                          />
                        </div>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Export Modal */}
      {showExportModal && exportData && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50">
          <div className="bg-white dark:bg-gray-800 p-6 rounded-lg max-w-2xl w-full mx-4">
            <h3 className="text-xl font-bold text-gray-900 dark:text-white mb-4">
              Export Public Key for Certification Authority
            </h3>

            <div className="space-y-4">
              {('ed25519PublicKey' in exportData && 'x25519PublicKey' in exportData) ? (
                // Dual-key export format
                <>
                  <div className="p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
                    <h4 className="font-semibold text-blue-900 dark:text-blue-100 mb-3">
                      🔐 Ed25519 (Signing Key)
                    </h4>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Public Key (Base64URL)
                        </label>
                        <textarea
                          readOnly
                          value={(exportData as any).ed25519PublicKey}
                          className="w-full h-20 p-2 text-xs font-mono bg-white dark:bg-gray-700 border rounded"
                        />
                        <button
                          onClick={() => copyToClipboard((exportData as any).ed25519PublicKey, 'Ed25519 public key')}
                          className="mt-2 px-3 py-1 text-xs text-blue-700 border border-blue-700 rounded hover:bg-blue-50"
                        >
                          Copy Ed25519 Public Key
                        </button>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Fingerprint
                        </label>
                        <input
                          readOnly
                          value={(exportData as any).ed25519Fingerprint}
                          className="w-full p-2 text-xs font-mono bg-white dark:bg-gray-700 border rounded"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="p-4 bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800">
                    <h4 className="font-semibold text-green-900 dark:text-green-100 mb-3">
                      🔒 X25519 (Encryption Key)
                    </h4>
                    <div className="space-y-3">
                      <div>
                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Public Key (Base64URL)
                        </label>
                        <textarea
                          readOnly
                          value={(exportData as any).x25519PublicKey}
                          className="w-full h-20 p-2 text-xs font-mono bg-white dark:bg-gray-700 border rounded"
                        />
                        <button
                          onClick={() => copyToClipboard((exportData as any).x25519PublicKey, 'X25519 public key')}
                          className="mt-2 px-3 py-1 text-xs text-green-700 border border-green-700 rounded hover:bg-green-50"
                        >
                          Copy X25519 Public Key
                        </button>
                      </div>
                      <div>
                        <label className="block text-xs font-medium text-gray-700 dark:text-gray-300 mb-2">
                          Fingerprint
                        </label>
                        <input
                          readOnly
                          value={(exportData as any).x25519Fingerprint}
                          className="w-full p-2 text-xs font-mono bg-white dark:bg-gray-700 border rounded"
                        />
                      </div>
                    </div>
                  </div>

                  <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded border border-yellow-200 dark:border-yellow-800">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      <strong>⚠️ Instructions:</strong> Copy both Ed25519 and X25519 public keys above and submit them to the
                      Certification Authority when requesting a Security Clearance VC. Never share your private keys!
                    </p>
                  </div>

                  <div className="text-sm text-gray-600 dark:text-gray-400">
                    <strong>Created:</strong> {formatDate(exportData.createdAt)}
                  </div>
                </>
              ) : (
                // Legacy single-key export format
                <>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Public Key (Base64URL)
                    </label>
                    <textarea
                      readOnly
                      value={(exportData as any).publicKeyBytes}
                      className="w-full h-24 p-3 text-sm font-mono bg-gray-100 dark:bg-gray-700 border rounded"
                    />
                    <button
                      onClick={() => copyToClipboard((exportData as any).publicKeyBytes, 'Public key')}
                      className="mt-2 px-3 py-1 text-sm text-blue-700 border border-blue-700 rounded hover:bg-blue-50"
                    >
                      Copy Public Key
                    </button>
                  </div>

                  <div>
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
                      Key Fingerprint
                    </label>
                    <input
                      readOnly
                      value={(exportData as any).fingerprint}
                      className="w-full p-3 text-sm font-mono bg-gray-100 dark:bg-gray-700 border rounded"
                    />
                    <button
                      onClick={() => copyToClipboard((exportData as any).fingerprint, 'Fingerprint')}
                      className="mt-2 px-3 py-1 text-sm text-blue-700 border border-blue-700 rounded hover:bg-blue-50"
                    >
                      Copy Fingerprint
                    </button>
                  </div>

                  <div className="grid grid-cols-2 gap-4">
                    <div>
                      <strong>Algorithm:</strong> {(exportData as any).algorithm}
                    </div>
                    <div>
                      <strong>Created:</strong> {formatDate(exportData.createdAt)}
                    </div>
                  </div>

                  <div className="bg-yellow-50 dark:bg-yellow-900/20 p-4 rounded border border-yellow-200 dark:border-yellow-800">
                    <p className="text-sm text-yellow-800 dark:text-yellow-200">
                      <strong>⚠️ Instructions:</strong> Copy the public key above and submit it to the
                      Certification Authority when requesting a Security Clearance VC. Never share your private key!
                    </p>
                  </div>
                </>
              )}
            </div>

            <div className="flex justify-end space-x-3 mt-6">
              <button
                onClick={() => setShowExportModal(false)}
                className="px-4 py-2 text-gray-700 border border-gray-300 rounded hover:bg-gray-50 dark:text-gray-300 dark:border-gray-600"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </Box>
  );
}