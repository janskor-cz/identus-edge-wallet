import React, { useState, useEffect, useMemo } from 'react';
import { useMountedApp, useAppSelector } from '@/reducers/store';
import SDK from '@hyperledger/identus-edge-agent-sdk';
import { sendVerifiablePresentation, declinePresentation, refreshConnections } from '@/actions';
import { SecurityKeyStorage, SecurityKeyDual, isDualKey } from '@/types/securityKeys';
import { verifyCredentialStatus, CredentialStatus } from '@/utils/credentialStatus';
import { getItem, setItem, removeItem, getKeysByPattern } from '@/utils/prefixedStorage';
import { getSchemaDisplayName, matchesSchema } from '@/utils/schemaMapping';

/**
 * PresentationRequestModal Component
 *
 * Displays pending presentation requests and allows users to manually select
 * which credential to share in response.
 *
 * Features:
 * - Shows one pending request at a time (FIFO)
 * - Lists all available credentials from wallet
 * - Allows single credential selection via radio buttons
 * - Provides "Send Selected" and "Decline" actions
 * - Modal overlay with click-outside-to-close disabled for security
 */
export const PresentationRequestModal: React.FC = () => {
    const app = useMountedApp();

    // Get pending presentation requests from Redux state
    const pendingRequests = app.presentationRequests.filter(
        req => req.status === 'pending'
    );

    // Get all credentials from wallet
    const credentials = app.credentials || [];

    // Local state for selected credential
    const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null);
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [revocationWarning, setRevocationWarning] = useState<string>('');
    const [validCredentials, setValidCredentials] = useState<SDK.Domain.Credential[]>([]);

    // Get connections from Redux state for connection name lookup
    const connections = useAppSelector(state => state.app.connections) || [];

    /**
     * Format DID for display (truncate if too long)
     */
    const formatDID = (did: string): string => {
        if (did.length <= 40) return did;
        return `${did.substring(0, 20)}...${did.substring(did.length - 17)}`;
    };

    // Resolve connection name from DID
    const connectionName = useMemo(() => {
        if (pendingRequests.length === 0) return '';
        const currentRequest = pendingRequests[0];

        // Try matching both receiver (their DID) and host (our DID with them)
        const connection = connections.find(c =>
            c.receiver.toString() === currentRequest.from ||
            c.host.toString() === currentRequest.from
        );

        return connection?.name || formatDID(currentRequest.from);
    }, [pendingRequests, connections]);

    // Force refresh connections when modal opens with pending requests
    useEffect(() => {
        if (pendingRequests.length > 0 && connections.length === 0 && app.agent.instance) {
            console.log('🔄 [MODAL] No connections in state, forcing refresh...');
            app.dispatch(refreshConnections());
        }
    }, [pendingRequests.length, connections.length, app.agent.instance, app.dispatch]);

    // Reset selection and auto-select based on schema ID when request changes
    useEffect(() => {
        setError(null);

        // Auto-select credential if schema ID matches (with revocation filtering)
        const autoSelectCredential = async () => {
            if (pendingRequests.length > 0 && credentials.length > 0) {
                const currentRequest = pendingRequests[0];
                const schemaId = currentRequest.schemaId;

                // Filter ALL credentials by revocation status (for dropdown display)
                console.log('🔍 [PRESENTATION] Checking revocation status for all credentials...');
                const allStatusCheckPromises = credentials.map(async (cred) => {
                    try {
                        const status = await verifyCredentialStatus(cred);
                        return { cred, status };
                    } catch (error) {
                        console.warn(`⚠️ [PRESENTATION] Failed to check status for credential ${cred.id}:`, error);
                        // On error, include the credential (don't block valid credentials)
                        return {
                            cred,
                            status: { revoked: false, suspended: false, statusPurpose: 'error', checkedAt: new Date().toISOString() } as CredentialStatus
                        };
                    }
                });

                const allStatusResults = await Promise.all(allStatusCheckPromises);

                // Filter out revoked/suspended credentials for dropdown
                const validCredsForDropdown = allStatusResults.filter(result => {
                    const isInvalid = result.status.revoked || result.status.suspended;
                    if (isInvalid) {
                        console.warn(`🚫 [PRESENTATION] Filtering credential from dropdown - ${result.cred.id} - revoked: ${result.status.revoked}, suspended: ${result.status.suspended}`);
                    }
                    return !isInvalid;
                }).map(result => result.cred);

                setValidCredentials(validCredsForDropdown);

                const totalFilteredOut = credentials.length - validCredsForDropdown.length;
                if (totalFilteredOut > 0) {
                    console.log(`🚫 [PRESENTATION] Filtered out ${totalFilteredOut} revoked/suspended credential(s) from dropdown`);
                }

                if (schemaId) {
                    console.log('🔍 [PRESENTATION] Auto-selecting credential for schema:', schemaId);

                    // Find credentials matching the schema (from valid credentials only)
                    const matchingCredentials = validCredsForDropdown.filter(cred =>
                        matchesSchema(cred, schemaId)
                    );

                    console.log(`🔍 [PRESENTATION] Found ${matchingCredentials.length} valid matching credentials for schema:`, schemaId);

                    // Set warning if credentials were filtered
                    if (totalFilteredOut > 0) {
                        const warningMsg = `${totalFilteredOut} credential${totalFilteredOut > 1 ? 's' : ''} filtered (revoked/suspended)`;
                        setRevocationWarning(warningMsg);
                        console.log(`⚠️ [PRESENTATION] ${warningMsg}`);

                        // Auto-dismiss warning after 5 seconds
                        setTimeout(() => setRevocationWarning(''), 5000);
                    } else {
                        setRevocationWarning('');
                    }

                    if (matchingCredentials.length > 0) {
                        // Auto-select first valid matching credential
                        setSelectedCredentialId(matchingCredentials[0].id);
                        console.log('✅ [PRESENTATION] Auto-selected credential:', matchingCredentials[0].id);
                    } else {
                        // No valid credentials found, reset selection
                        setSelectedCredentialId(null);
                        const totalMatching = credentials.filter(cred =>
                            matchesSchema(cred, schemaId)
                        ).length;

                        if (totalMatching > 0) {
                            console.log('⚠️ [PRESENTATION] All matching credentials are revoked/suspended');
                        } else {
                            console.log('⚠️ [PRESENTATION] No matching credentials found for schema:', schemaId);
                        }
                    }
                } else {
                    // No schema ID, reset selection (manual mode)
                    setSelectedCredentialId(null);
                }
            } else {
                // No requests or credentials, reset
                setSelectedCredentialId(null);
                setValidCredentials([]);
            }
        };

        autoSelectCredential();
    }, [pendingRequests.length, credentials.length]);

    // Don't render if no pending requests
    if (pendingRequests.length === 0) return null;

    // Show first pending request (FIFO)
    const currentRequest = pendingRequests[0];

    const handleSend = async () => {
        if (!selectedCredentialId) {
            setError('Please select a credential to share');
            return;
        }

        setIsProcessing(true);
        setError(null);

        try {
            await app.dispatch(sendVerifiablePresentation({
                requestId: currentRequest.id,
                credentialId: selectedCredentialId
            }));

            // Modal auto-closes because Redux state update removes pending status
            setSelectedCredentialId(null);
        } catch (err) {
            console.error('❌ [PRESENTATION] Failed to send credential:', err);
            setError(err instanceof Error ? err.message : 'Failed to send credential');
        } finally {
            setIsProcessing(false);
        }
    };

    const handleDecline = async () => {
        setIsProcessing(true);
        setError(null);

        try {
            console.log('🚫 [PRESENTATION] Declining request:', currentRequest.id);

            await app.dispatch(declinePresentation({
                requestId: currentRequest.id
            }));

            console.log('✅ [PRESENTATION] Request declined successfully');

            // Modal auto-closes because Redux state update removes pending status
            setSelectedCredentialId(null);
        } catch (err) {
            console.error('❌ [PRESENTATION] Failed to decline request:', err);
            setError(err instanceof Error ? err.message : 'Failed to decline request');
        } finally {
            setIsProcessing(false);
        }
    };

    /**
     * Extract credential type from SDK credential
     */
    const getCredentialType = (cred: SDK.Domain.Credential): string => {
        try {
            // Try to get type from credentialType property
            if (cred.credentialType) {
                return cred.credentialType;
            }

            // Try to extract from claims
            if (cred.claims && cred.claims.length > 0) {
                const firstClaim = cred.claims[0];
                // Look for common type indicators
                if (firstClaim.clearanceLevel !== undefined) {
                    return 'Security Clearance';
                }
                if (firstClaim.firstName !== undefined || firstClaim.lastName !== undefined) {
                    return 'RealPerson';
                }
            }

            // Fallback to issuer or generic
            return `Credential from ${formatDID(cred.issuer)}`;
        } catch (error) {
            console.warn('⚠️ Failed to extract credential type:', error);
            return 'Unknown Credential';
        }
    };

    /**
     * Extract credential attributes for preview
     */
    const getCredentialPreview = (cred: SDK.Domain.Credential): string[] => {
        try {
            if (!cred.claims || cred.claims.length === 0) return [];

            const firstClaim = cred.claims[0];
            const attributes: string[] = [];

            // Get first 3 non-id attributes
            Object.keys(firstClaim)
                .filter(key => key !== 'id' && key !== 'iss' && key !== 'sub')
                .slice(0, 3)
                .forEach(key => {
                    const value = firstClaim[key];
                    if (value !== undefined && value !== null) {
                        attributes.push(`${key}: ${value}`);
                    }
                });

            return attributes;
        } catch (error) {
            return [];
        }
    };

    /**
     * Check if credential is Security Clearance type
     */
    const isSecurityClearance = (cred: SDK.Domain.Credential): boolean => {
        try {
            // Check credentialSubject.clearanceLevel
            if (cred.credentialSubject?.clearanceLevel) return true;

            // Check claims array
            if (cred.claims && cred.claims.length > 0) {
                const firstClaim = cred.claims[0];
                if (firstClaim.clearanceLevel) return true;
            }

            return false;
        } catch (error) {
            return false;
        }
    };

    /**
     * Get dual keys (Ed25519 + X25519) from localStorage for Security Clearance credentials
     */
    const getDualKeys = (cred: SDK.Domain.Credential): SecurityKeyDual | null => {
        try {
            if (!isSecurityClearance(cred)) return null;

            const stored = getItem('security-clearance-keys');
            if (!stored) return null;

            const keyStorage: SecurityKeyStorage = JSON.parse(stored);
            const activeKey = keyStorage.keys.find(k => k.keyId === keyStorage.activeKeyId);

            if (activeKey && isDualKey(activeKey)) {
                return activeKey as SecurityKeyDual;
            }

            return null;
        } catch (error) {
            console.error('Failed to retrieve dual keys:', error);
            return null;
        }
    };

    return (
        <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[9999]"
            style={{ backdropFilter: 'blur(2px)' }}
        >
            <div
                className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="sticky top-0 bg-gradient-to-r from-blue-600 to-blue-500 text-white px-6 py-4 rounded-t-xl">
                    <div className="flex items-center space-x-3">
                        <span className="text-2xl">🔐</span>
                        <div>
                            <h2 className="text-xl font-bold">
                                {connectionName} is requesting a credential
                            </h2>
                        </div>
                    </div>
                </div>

                {/* Request Info */}
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="space-y-3">
                        {(currentRequest.requestMessage?.body?.comment || currentRequest.requestMessage?.body?.goal) && (
                            <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                                <p className="text-sm italic text-blue-900 dark:text-blue-100">
                                    "{currentRequest.requestMessage.body.comment || currentRequest.requestMessage.body.goal}"
                                </p>
                            </div>
                        )}
                        <div>
                            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Request ID:</span>
                            <p className="text-xs font-mono text-gray-600 dark:text-gray-400 mt-1">
                                {currentRequest.id}
                            </p>
                        </div>
                        <div>
                            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Time:</span>
                            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                                {new Date(currentRequest.timestamp).toLocaleString()}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Revocation Warning Banner */}
                {revocationWarning && (
                    <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                            <p className="text-yellow-800 dark:text-yellow-200 text-sm flex items-center">
                                <span className="text-lg mr-2">⚠️</span>
                                <span>{revocationWarning}</span>
                            </p>
                        </div>
                    </div>
                )}

                {/* Credential Selection */}
                <div className="px-6 py-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                        {currentRequest.schemaId
                            ? `Select ${getSchemaDisplayName(currentRequest.schemaId)} to share:`
                            : 'Select a credential to share:'
                        }
                    </h3>

                    {credentials.length === 0 ? (
                        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                            <p className="text-yellow-800 dark:text-yellow-200 text-sm">
                                ⚠️ No credentials available in your wallet. You need to obtain credentials before responding to this request.
                            </p>
                        </div>
                    ) : validCredentials.length === 0 ? (
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
                            <p className="text-red-800 dark:text-red-200 text-sm">
                                ❌ All matching credentials have been revoked or suspended. You cannot respond to this request.
                            </p>
                        </div>
                    ) : (
                        <div className="space-y-3">
                            {validCredentials.map((cred) => {
                                const credType = getCredentialType(cred);
                                const preview = getCredentialPreview(cred);
                                const isSelected = selectedCredentialId === cred.id;
                                const dualKeys = getDualKeys(cred);

                                return (
                                    <label
                                        key={cred.id}
                                        className={`
                                            block p-4 border-2 rounded-lg cursor-pointer transition-all duration-200
                                            ${isSelected
                                                ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                                                : 'border-gray-200 dark:border-gray-700 hover:border-gray-300 dark:hover:border-gray-600'
                                            }
                                        `}
                                    >
                                        <div className="flex items-start space-x-3">
                                            <input
                                                type="radio"
                                                name="credential"
                                                value={cred.id}
                                                checked={isSelected}
                                                onChange={() => setSelectedCredentialId(cred.id)}
                                                disabled={isProcessing}
                                                className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                                            />
                                            <div className="flex-1">
                                                <div className="font-semibold text-gray-900 dark:text-white">
                                                    {credType}
                                                </div>
                                                <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-mono">
                                                    Issuer: {formatDID(cred.issuer)}
                                                </div>
                                                {preview.length > 0 && (
                                                    <div className="mt-2 text-sm text-gray-600 dark:text-gray-300 space-y-1">
                                                        {preview.map((attr, idx) => (
                                                            <div key={idx} className="text-xs">
                                                                • {attr}
                                                            </div>
                                                        ))}
                                                    </div>
                                                )}
                                                {dualKeys && (
                                                    <div className="mt-3 p-3 bg-blue-50 dark:bg-blue-900/10 border border-blue-200 dark:border-blue-800 rounded-lg">
                                                        <div className="text-xs font-semibold text-blue-900 dark:text-blue-100 mb-2">
                                                            🔐 Cryptographic Keys (Dual-Key System)
                                                        </div>
                                                        <div className="space-y-2">
                                                            <div>
                                                                <div className="text-xs font-medium text-blue-800 dark:text-blue-200">
                                                                    Ed25519 (Signing):
                                                                </div>
                                                                <div className="font-mono text-xs text-blue-700 dark:text-blue-300 break-all">
                                                                    {dualKeys.ed25519.publicKeyBytes.substring(0, 40)}...
                                                                </div>
                                                                <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                                                                    {dualKeys.ed25519.fingerprint}
                                                                </div>
                                                            </div>
                                                            <div>
                                                                <div className="text-xs font-medium text-blue-800 dark:text-blue-200">
                                                                    X25519 (Encryption):
                                                                </div>
                                                                <div className="font-mono text-xs text-blue-700 dark:text-blue-300 break-all">
                                                                    {dualKeys.x25519.publicKeyBytes.substring(0, 40)}...
                                                                </div>
                                                                <div className="text-xs text-blue-600 dark:text-blue-400 mt-1">
                                                                    {dualKeys.x25519.fingerprint}
                                                                </div>
                                                            </div>
                                                        </div>
                                                    </div>
                                                )}
                                            </div>
                                        </div>
                                    </label>
                                );
                            })}
                        </div>
                    )}
                </div>

                {/* Error Display */}
                {error && (
                    <div className="px-6 pb-4">
                        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-3">
                            <p className="text-red-800 dark:text-red-200 text-sm">
                                ❌ {error}
                            </p>
                        </div>
                    </div>
                )}

                {/* Action Buttons */}
                <div className="sticky bottom-0 bg-gray-50 dark:bg-gray-900 px-6 py-4 rounded-b-xl border-t border-gray-200 dark:border-gray-700">
                    <div className="flex space-x-3">
                        <button
                            onClick={handleDecline}
                            disabled={isProcessing}
                            className="flex-1 px-4 py-3 bg-gray-500 hover:bg-gray-600 disabled:bg-gray-400
                                     text-white font-medium rounded-lg transition-colors duration-200
                                     disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
                        >
                            {isProcessing ? '⏳ Processing...' : '🚫 Decline'}
                        </button>
                        <button
                            onClick={handleSend}
                            disabled={isProcessing || credentials.length === 0 || validCredentials.length === 0}
                            className="flex-1 px-4 py-3 bg-blue-600 hover:bg-blue-700 disabled:bg-blue-400
                                     text-white font-medium rounded-lg transition-colors duration-200
                                     disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                        >
                            {isProcessing ? '⏳ Sending...' : '📤 Send Selected'}
                        </button>
                    </div>

                    {/* Helper Text */}
                    <p className="text-xs text-gray-500 dark:text-gray-400 text-center mt-3">
                        {pendingRequests.length > 1
                            ? `${pendingRequests.length} pending requests (showing oldest first)`
                            : 'This is the only pending request'
                        }
                    </p>
                </div>
            </div>
        </div>
    );
};
