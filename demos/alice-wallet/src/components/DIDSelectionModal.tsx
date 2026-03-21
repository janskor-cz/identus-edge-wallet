import React, { useState } from 'react';

/**
 * DIDSelectionModal Component
 *
 * Allows users to choose between creating a new PRISM DID or reusing
 * an existing one when accepting a credential offer.
 *
 * Shows ALL PRISM DIDs including CA-connection DIDs for maximum user flexibility.
 */

interface ExistingDID {
    did: string;
    alias?: string;
}

interface DIDSelectionModalProps {
    isOpen: boolean;
    onClose: () => void;
    onSelect: (selectedDID: string | null) => void;  // null = create new
    existingDIDs: ExistingDID[];
    credentialType: string;  // e.g., "RealPerson"
}

export const DIDSelectionModal: React.FC<DIDSelectionModalProps> = ({
    isOpen,
    onClose,
    onSelect,
    existingDIDs,
    credentialType
}) => {
    // Default to "create new"
    const [selectedOption, setSelectedOption] = useState<string>('new');

    if (!isOpen) return null;

    // Show all PRISM DIDs (including CA connection DID) for user selection
    const credentialDIDs = existingDIDs;

    const handleConfirm = () => {
        if (selectedOption === 'new') {
            onSelect(null);  // null means create new DID
        } else {
            onSelect(selectedOption);  // Pass selected DID string
        }
    };

    const formatDID = (did: string): string => {
        if (did.length <= 50) return did;
        return `${did.substring(0, 25)}...${did.substring(did.length - 20)}`;
    };

    return (
        <div
            className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10000]"
            style={{ backdropFilter: 'blur(2px)' }}
            onClick={onClose}
        >
            <div
                className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-lg w-full mx-4 max-h-[80vh] overflow-y-auto"
                onClick={(e) => e.stopPropagation()}
            >
                {/* Header */}
                <div className="sticky top-0 bg-gradient-to-r from-green-600 to-green-500 text-white px-6 py-4 rounded-t-xl">
                    <div className="flex items-center space-x-3">
                        <span className="text-2xl">🔑</span>
                        <div>
                            <h2 className="text-xl font-bold">
                                Select DID for {credentialType} Credential
                            </h2>
                            <p className="text-green-100 text-sm mt-1">
                                Choose which identity to use for this credential
                            </p>
                        </div>
                    </div>
                </div>

                {/* Options */}
                <div className="px-6 py-4 space-y-3">
                    {/* Create New DID Option */}
                    <label
                        className={`
                            block p-4 rounded-lg border-2 cursor-pointer transition-all
                            ${selectedOption === 'new'
                                ? 'border-green-500 bg-green-50 dark:bg-green-900/20'
                                : 'border-gray-200 dark:border-gray-700 hover:border-green-300'
                            }
                        `}
                    >
                        <div className="flex items-start">
                            <input
                                type="radio"
                                name="did-selection"
                                value="new"
                                checked={selectedOption === 'new'}
                                onChange={(e) => setSelectedOption(e.target.value)}
                                className="mt-1 h-4 w-4 text-green-600 focus:ring-green-500"
                            />
                            <div className="ml-3">
                                <div className="flex items-center">
                                    <span className="font-medium text-gray-900 dark:text-white">
                                        Create New PRISM DID
                                    </span>
                                    <span className="ml-2 px-2 py-0.5 text-xs font-semibold bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200 rounded">
                                        Recommended
                                    </span>
                                </div>
                                <p className="text-sm text-gray-500 dark:text-gray-400 mt-1">
                                    Creates a new identity specifically for this credential
                                </p>
                            </div>
                        </div>
                    </label>

                    {/* Existing DIDs */}
                    {credentialDIDs.length > 0 && (
                        <>
                            <div className="relative py-2">
                                <div className="absolute inset-0 flex items-center">
                                    <div className="w-full border-t border-gray-200 dark:border-gray-700"></div>
                                </div>
                                <div className="relative flex justify-center">
                                    <span className="px-3 bg-white dark:bg-gray-800 text-sm text-gray-500">
                                        Or reuse existing DID
                                    </span>
                                </div>
                            </div>

                            {credentialDIDs.map((did, index) => (
                                <label
                                    key={index}
                                    className={`
                                        block p-4 rounded-lg border-2 cursor-pointer transition-all
                                        ${selectedOption === did.did
                                            ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/20'
                                            : 'border-gray-200 dark:border-gray-700 hover:border-blue-300'
                                        }
                                    `}
                                >
                                    <div className="flex items-start">
                                        <input
                                            type="radio"
                                            name="did-selection"
                                            value={did.did}
                                            checked={selectedOption === did.did}
                                            onChange={(e) => setSelectedOption(e.target.value)}
                                            className="mt-1 h-4 w-4 text-blue-600 focus:ring-blue-500"
                                        />
                                        <div className="ml-3 flex-1 min-w-0">
                                            <div className="font-medium text-gray-900 dark:text-white">
                                                {did.alias || 'Unnamed DID'}
                                            </div>
                                            <p className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-mono break-all">
                                                {formatDID(did.did)}
                                            </p>
                                        </div>
                                    </div>
                                </label>
                            ))}
                        </>
                    )}

                    {credentialDIDs.length === 0 && (
                        <div className="text-center py-4 text-gray-500 dark:text-gray-400">
                            <p className="text-sm">No existing credential DIDs found.</p>
                            <p className="text-xs mt-1">A new DID will be created for this credential.</p>
                        </div>
                    )}
                </div>

                {/* Action Buttons */}
                <div className="sticky bottom-0 bg-gray-50 dark:bg-gray-900 px-6 py-4 rounded-b-xl border-t border-gray-200 dark:border-gray-700">
                    <div className="flex space-x-3">
                        <button
                            onClick={onClose}
                            className="flex-1 px-4 py-3 bg-gray-200 hover:bg-gray-300 dark:bg-gray-700 dark:hover:bg-gray-600
                                     text-gray-800 dark:text-white font-medium rounded-lg transition-colors duration-200
                                     focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
                        >
                            Cancel
                        </button>
                        <button
                            onClick={handleConfirm}
                            className="flex-1 px-4 py-3 bg-green-600 hover:bg-green-700
                                     text-white font-medium rounded-lg transition-colors duration-200
                                     focus:outline-none focus:ring-2 focus:ring-green-500 focus:ring-offset-2"
                        >
                            Confirm Selection
                        </button>
                    </div>
                </div>
            </div>
        </div>
    );
};
