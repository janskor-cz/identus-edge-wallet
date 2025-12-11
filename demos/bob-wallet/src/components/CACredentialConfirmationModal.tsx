import React from 'react';

/**
 * CACredentialConfirmationModal Component
 *
 * Displays CA credentials embedded in invitation's requests_attach field
 * and allows users to accept or reject the credential before establishing
 * the DIDComm connection.
 *
 * Security Features:
 * - Shows credential details transparently
 * - Warns user about automatic credential storage
 * - Blocks connection until user makes a decision
 * - Different from CredentialOfferModal (invitation context, not issued VC)
 */

interface CACredentialProps {
    credential: any; // Credential from requests_attach
    onAccept: () => void;
    onReject: () => void;
    visible: boolean;
}

export const CACredentialConfirmationModal: React.FC<CACredentialProps> = ({
    credential,
    onAccept,
    onReject,
    visible
}) => {
    if (!visible) return null;

    /**
     * Extract credential attributes from various VC formats
     */
    const extractCredentialData = () => {
        try {
            // Handle different credential formats
            const credentialSubject = credential?.credentialSubject || credential?.claims;
            const issuerDID = credential?.issuerDID || credential?.issuer || 'Unknown Issuer';
            const credentialType = credential?.credentialType || credential?.type || ['VerifiableCredential'];
            const issuedDate = credential?.issuedDate || credential?.issuanceDate || new Date().toISOString();

            // Extract attributes from credentialSubject or claims
            const attributes: { name: string; value: string }[] = [];

            if (credentialSubject && typeof credentialSubject === 'object') {
                Object.entries(credentialSubject).forEach(([key, value]) => {
                    // Skip internal fields
                    if (key === 'id' || key === '@context') return;

                    attributes.push({
                        name: key,
                        value: String(value)
                    });
                });
            }

            return {
                attributes,
                issuerDID,
                credentialType: Array.isArray(credentialType) ? credentialType.join(', ') : credentialType,
                issuedDate
            };
        } catch (error) {
            console.error('❌ [CA CREDENTIAL] Failed to extract credential data:', error);
            return {
                attributes: [],
                issuerDID: 'Unknown',
                credentialType: 'Unknown',
                issuedDate: new Date().toISOString()
            };
        }
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

    /**
     * Format DID for display (truncate if too long)
     */
    const formatDID = (did: string): string => {
        if (did.length <= 40) return did;
        return `${did.substring(0, 20)}...${did.substring(did.length - 17)}`;
    };

    const { attributes, issuerDID, credentialType, issuedDate } = extractCredentialData();

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
                        <span className="text-2xl">🏛️</span>
                        <div>
                            <h2 className="text-xl font-bold">Certification Authority Credential</h2>
                            <p className="text-blue-100 text-sm mt-1">
                                The CA is providing its identity credential for verification
                            </p>
                        </div>
                    </div>
                </div>

                {/* Issuer Info */}
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="space-y-2">
                        <div>
                            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Issuer DID:</span>
                            <p className="text-sm font-mono text-gray-900 dark:text-gray-100 mt-1 break-all">
                                {formatDID(issuerDID)}
                            </p>
                        </div>
                        <div>
                            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Credential Type:</span>
                            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                                {credentialType}
                            </p>
                        </div>
                        <div>
                            <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Issued Date:</span>
                            <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                                {new Date(issuedDate).toLocaleString()}
                            </p>
                        </div>
                    </div>
                </div>

                {/* Security Notice */}
                <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
                    <div className="bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg p-4">
                        <div className="flex items-start space-x-3">
                            <span className="text-blue-600 dark:text-blue-400 text-xl">ℹ️</span>
                            <div>
                                <p className="text-sm text-blue-800 dark:text-blue-200 font-medium">
                                    About this credential:
                                </p>
                                <p className="text-sm text-blue-700 dark:text-blue-300 mt-1">
                                    This credential is embedded in the connection invitation from the Certification Authority.
                                    If you accept, this credential will be automatically stored in your wallet.
                                </p>
                            </div>
                        </div>
                    </div>
                </div>

                {/* Attributes Table */}
                <div className="px-6 py-4">
                    <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                        Credential Attributes:
                    </h3>

                    {attributes.length === 0 ? (
                        <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
                            <p className="text-yellow-800 dark:text-yellow-200 text-sm">
                                ⚠️ No attributes found in this credential.
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
                                            </td>
                                        </tr>
                                    ))}
                                </tbody>
                            </table>
                        </div>
                    )}
                </div>

                {/* Action Buttons */}
                <div className="sticky bottom-0 bg-gray-50 dark:bg-gray-900 px-6 py-4 rounded-b-xl border-t border-gray-200 dark:border-gray-700">
                    <div className="flex space-x-3">
                        <button
                            onClick={onReject}
                            className="flex-1 px-4 py-3 bg-red-600 hover:bg-red-700
                                     text-white font-medium rounded-lg transition-colors duration-200
                                     focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
                        >
                            ❌ Reject & Cancel Connection
                        </button>
                        <button
                            onClick={onAccept}
                            disabled={attributes.length === 0}
                            className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-700 disabled:bg-green-400
                                     text-white font-medium rounded-lg transition-colors duration-200
                                     disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                        >
                            ✅ Accept CA Credential
                        </button>
                    </div>

                    {/* Helper Text */}
                    <p className="text-xs text-gray-500 dark:text-gray-400 text-center mt-3">
                        This credential will be stored in your wallet if you accept
                    </p>
                </div>
            </div>
        </div>
    );
};
