import React, { useState, useEffect } from 'react';
import { useMountedApp } from '@/reducers/store';
import SDK from '@hyperledger/identus-edge-agent-sdk';

/**
 * CredentialOfferModal Component
 *
 * Displays pending credential offers in a modal window and allows users to
 * accept or reject credential offers from issuers.
 *
 * Features:
 * - Shows one pending offer at a time (FIFO)
 * - Displays all credential attributes from credential_preview
 * - Shows issuer DID, schema ID, and timestamp information
 * - Provides "Accept Credential" and "Reject Credential" actions
 * - Modal overlay with gradient header matching PresentationRequestModal style
 */

interface CredentialAttribute {
    name: string;
    value: string;
    media_type?: string;
}

interface CredentialPreview {
    body: {
        attributes: CredentialAttribute[];
    };
    schema_id: string;
    type?: string;
}

interface CredentialOfferData {
    id: string;
    message: SDK.Domain.Message;
    from: string;
    timestamp: number;
    credentialPreview: CredentialPreview;
}

export const CredentialOfferModal: React.FC = () => {
    const app = useMountedApp();

    // Filter pending credential offer messages
    const pendingOffers: CredentialOfferData[] = app.messages
        .filter(msg => msg.piuri === 'https://didcomm.org/issue-credential/3.0/offer-credential')
        .map(msg => {
            try {
                const body = typeof msg.body === 'string' ? JSON.parse(msg.body) : msg.body;
                // Convert SDK timestamp (seconds) to milliseconds for Date constructor
                const timestampMs = msg.createdTime
                    ? (msg.createdTime < 1000000000000 ? msg.createdTime * 1000 : msg.createdTime)
                    : Date.now();

                return {
                    id: msg.id,
                    message: msg,
                    from: msg.from?.toString() || 'Unknown Issuer',
                    timestamp: timestampMs,
                    credentialPreview: body.credential_preview
                };
            } catch (error) {
                console.error('❌ Error parsing credential offer:', error);
                return null;
            }
        })
        .filter((offer): offer is CredentialOfferData => offer !== null && offer.credentialPreview !== undefined);

    // Local state
    const [isProcessing, setIsProcessing] = useState(false);
    const [error, setError] = useState<string | null>(null);

    // Reset error when offers change
    useEffect(() => {
        setError(null);
        setIsProcessing(false);
    }, [pendingOffers.length]);

    // Don't render modal until agent has fully started (prevents blocking initialization)
    if (!app.agent?.hasStarted) {
        return null;
    }

    // Don't render if no pending offers
    if (pendingOffers.length === 0) return null;

    // Show first pending offer (FIFO)
    const currentOffer = pendingOffers[0];

    const handleAccept = async () => {
        if (!app.agent?.instance || isProcessing) return;

        setIsProcessing(true);
        setError(null);

        try {
            console.log('🟢 [CREDENTIAL OFFER] Accepting offer:', currentOffer.id);

            await app.acceptCredentialOffer({
                agent: app.agent.instance,
                message: currentOffer.message
            });

            console.log('✅ [CREDENTIAL OFFER] Offer accepted successfully');

            // Modal auto-closes because Redux state update removes message
        } catch (err) {
            console.error('❌ [CREDENTIAL OFFER] Failed to accept offer:', err);
            setError(err instanceof Error ? err.message : 'Failed to accept credential offer');

            // Delete the failed offer message so modal doesn't reappear
            try {
                await app.agent.instance.pluto.deleteMessage(currentOffer.id);
                console.log('✅ [CREDENTIAL OFFER] Deleted failed offer message:', currentOffer.id);
            } catch (deleteError) {
                console.warn('⚠️ [CREDENTIAL OFFER] Failed to delete message:', deleteError);
            }
        } finally {
            setIsProcessing(false);
        }
    };

    const handleReject = async () => {
        if (!app.agent?.instance || isProcessing) return;

        setIsProcessing(true);
        setError(null);

        try {
            console.log('🔴 [CREDENTIAL OFFER] Rejecting offer:', currentOffer.id);

            await app.rejectCredentialOffer({
                message: currentOffer.message,
                pluto: app.agent.instance.pluto
            });

            console.log('✅ [CREDENTIAL OFFER] Offer rejected successfully');

            // Modal auto-closes because Redux state update removes message
        } catch (err) {
            console.error('❌ [CREDENTIAL OFFER] Failed to reject offer:', err);
            setError(err instanceof Error ? err.message : 'Failed to reject credential offer');
        } finally {
            setIsProcessing(false);
        }
    };

    /**
     * Format DID for display (truncate if too long)
     */
    const formatDID = (did: string): string => {
        if (did.length <= 40) return did;
        return `${did.substring(0, 20)}...${did.substring(did.length - 17)}`;
    };

    /**
     * Format attribute name from camelCase to Title Case
     */
    const formatAttributeName = (name: string): string => {
        return name
            .replace(/([A-Z])/g, ' $1') // Add space before capital letters
            .replace(/^./, str => str.toUpperCase()) // Capitalize first letter
            .trim();
    };

    const attributes = currentOffer.credentialPreview.body.attributes;
    const schemaId = currentOffer.credentialPreview.schema_id;

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
                        <span className="text-2xl">🎫</span>
                        <div>
                            <h2 className="text-xl font-bold">Credential Offer</h2>
                            <p className="text-blue-100 text-sm mt-1">
                                An issuer is offering you a verifiable credential
                            </p>
                        </div>
                    </div>
                </div>

                {/* Issuer Info */}
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="space-y-2">
                        <div>
                            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">From:</span>
                            <p className="text-sm font-mono text-gray-900 dark:text-gray-100 mt-1 break-all">
                                {formatDID(currentOffer.from)}
                            </p>
                        </div>
                        <div>
                            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Message ID:</span>
                            <p className="text-xs font-mono text-gray-600 dark:text-gray-400 mt-1">
                                {currentOffer.id}
                            </p>
                        </div>
                        <div>
                            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Time:</span>
                            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                                {new Date(currentOffer.timestamp).toLocaleString()}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Schema Info */}
                {schemaId && (
                    <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                        <div>
                            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Schema ID:</span>
                            <p className="text-xs font-mono text-gray-700 dark:text-gray-300 mt-1 break-all bg-gray-50 dark:bg-gray-900 p-2 rounded">
                                {schemaId}
                            </p>
                        </div>
                    </div>
                )}

                {/* Attributes Table */}
                <div className="px-6 py-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                        Credential Attributes:
                    </h3>

                    {attributes.length === 0 ? (
                        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                            <p className="text-yellow-800 dark:text-yellow-200 text-sm">
                                ⚠️ No attributes found in this credential offer.
                            </p>
                        </div>
                    ) : (
                        <div className="bg-gray-50 dark:bg-gray-900 rounded-lg border border-gray-200 dark:border-gray-700 overflow-hidden">
                            <table className="w-full">
                                <thead>
                                    <tr className="bg-gray-100 dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700">
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                                            Attribute
                                        </th>
                                        <th className="px-4 py-3 text-left text-xs font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wider">
                                            Value
                                        </th>
                                    </tr>
                                </thead>
                                <tbody>
                                    {attributes.map((attr, index) => (
                                        <tr
                                            key={index}
                                            className={`
                                                ${index % 2 === 0 ? 'bg-white dark:bg-gray-800' : 'bg-gray-50 dark:bg-gray-850'}
                                                border-b border-gray-200 dark:border-gray-700 last:border-b-0
                                            `}
                                        >
                                            <td className="px-4 py-3 text-sm font-medium text-gray-900 dark:text-gray-100">
                                                {formatAttributeName(attr.name)}
                                            </td>
                                            <td className="px-4 py-3 text-sm text-gray-700 dark:text-gray-300">
                                                {attr.value}
                                                {attr.media_type && (
                                                    <span className="ml-2 text-xs text-gray-500 dark:text-gray-400">
                                                        ({attr.media_type})
                                                    </span>
                                                )}
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
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
                            onClick={handleReject}
                            disabled={isProcessing}
                            className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700 disabled:bg-red-400
                                     text-white font-medium rounded-lg transition-colors duration-200
                                     disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                        >
                            {isProcessing ? '⏳ Processing...' : '❌ Reject Credential'}
                        </button>
                        <button
                            onClick={handleAccept}
                            disabled={isProcessing || attributes.length === 0}
                            className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-400
                                     text-white font-medium rounded-lg transition-colors duration-200
                                     disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                        >
                            {isProcessing ? '⏳ Processing...' : '🎫 Accept Credential'}
                        </button>
                    </div>

                    {/* Helper Text */}
                    <p className="text-xs text-gray-500 dark:text-gray-400 text-center mt-3">
                        {pendingOffers.length > 1
                            ? `${pendingOffers.length} pending offers (showing oldest first)`
                            : 'This is the only pending offer'
                        }
                    </p>
                </div>
            </div>
        </div>
    );
};
