import React, { useState, useEffect } from 'react';
import '../app/index.css';
import { Box } from "@/app/Box";
import { useMountedApp, useAppSelector, useAppDispatch } from '@/reducers/store';
import { DBConnect } from '@/components/DBConnect';
import { PageHeader } from '@/components/PageHeader';
import { PrismDIDCard } from '@/components/PrismDIDCard';
import { createLongFormPrismDID, refreshPrismDIDs } from '@/actions';
import { refreshEnterpriseDIDs } from '@/actions/enterpriseAgentActions';
import {
    FingerPrintIcon,
    PlusIcon,
    RefreshIcon,
    OfficeBuildingIcon,
    IdentificationIcon
} from '@heroicons/react/solid';
import {
    selectEnterpriseDIDs,
    selectIsEnterpriseConfigured,
    selectIsLoadingDIDs
} from '@/reducers/enterpriseAgent';

/**
 * DID Management Page
 *
 * Provides UI for creating and managing DIDs:
 * 1. Long-form PRISM DIDs (self-resolving, for credential issuance)
 * 2. Enterprise DIDs (from Cloud Agent, if configured)
 *
 * Note: Only shows PRISM DIDs that have an alias (user-created DIDs)
 */
const DIDManagementPage: React.FC = () => {
    const dispatch = useAppDispatch();
    const app = useMountedApp();

    // Redux state
    const prismDIDs = useAppSelector(state => state.app.prismDIDs);
    const isCreating = useAppSelector(state => state.app.isCreatingPrismDID);
    const enterpriseDIDs = useAppSelector(selectEnterpriseDIDs);
    const isEnterpriseConfigured = useAppSelector(selectIsEnterpriseConfigured);
    const isLoadingEnterpriseDIDs = useAppSelector(selectIsLoadingDIDs);

    // Local state
    const [alias, setAlias] = useState('');
    const [createSuccess, setCreateSuccess] = useState<string | null>(null);
    const [createError, setCreateError] = useState<string | null>(null);

    // Get agent from Redux store via useMountedApp hook
    const agent = app.agent.instance;

    // Filter PRISM DIDs to show only those with an alias (user-created)
    const displayedPrismDIDs = (prismDIDs || []).filter(
        (did: any) => did?.alias
    );

    /**
     * Load PRISM DIDs from Pluto storage
     */
    const loadPrismDIDs = async () => {
        if (agent) {
            dispatch(refreshPrismDIDs({ agent }));
        }
    };

    /**
     * Load Enterprise DIDs from Cloud Agent
     */
    const loadEnterpriseDIDs = async () => {
        if (isEnterpriseConfigured) {
            dispatch(refreshEnterpriseDIDs());
        }
    };

    /**
     * Create a new long-form PRISM DID
     */
    const handleCreatePrismDID = async () => {
        if (!agent) {
            setCreateError('Agent not initialized. Please wait for wallet to start.');
            return;
        }

        setCreateError(null);
        setCreateSuccess(null);

        try {
            const result = await dispatch(createLongFormPrismDID({
                agent,
                alias: alias.trim() || undefined,
                defaultSeed: app.defaultSeed
            })).unwrap();

            setCreateSuccess(`Created: ${result.did.toString().substring(0, 50)}...`);
            setAlias('');

            // Clear success message after 5 seconds
            setTimeout(() => setCreateSuccess(null), 5000);
        } catch (error: any) {
            console.error('[DID Management] Failed to create PRISM DID:', error);
            setCreateError(error?.message || 'Failed to create PRISM DID');
        }
    };

    // Initial load
    useEffect(() => {
        loadPrismDIDs();
    }, [agent]);

    // Load enterprise DIDs when enterprise is configured
    useEffect(() => {
        if (isEnterpriseConfigured) {
            console.log('[DID Management] Enterprise configured, loading DIDs...');
            loadEnterpriseDIDs();
        }
    }, [isEnterpriseConfigured]);

    // Auto-refresh every 30 seconds
    useEffect(() => {
        const interval = setInterval(() => {
            console.log('[DID Management] Auto-refreshing DIDs...');
            loadPrismDIDs();
            if (isEnterpriseConfigured) {
                loadEnterpriseDIDs();
            }
        }, 30000);

        return () => clearInterval(interval);
    }, [agent, isEnterpriseConfigured]);

    return (
        <div className="mx-10 mt-5 mb-30">
            <PageHeader>
                <h1 className="mb-4 text-4xl font-extrabold leading-none tracking-tight text-gray-900 md:text-5xl lg:text-6xl dark:text-white">
                    <span className="underline underline-offset-3 decoration-8 decoration-green-400 dark:decoration-green-600">
                        DID Management
                    </span>
                </h1>
            </PageHeader>

            <DBConnect>
                <Box>
                    {/* Create Long-Form PRISM DID Section */}
                    <div className="mb-8 bg-green-50 border-2 border-green-500 rounded-lg p-6">
                        <div className="flex items-center mb-4">
                            <FingerPrintIcon className="w-8 h-8 text-green-600 mr-3" />
                            <h2 className="text-2xl font-semibold text-green-700">
                                Create Long-Form PRISM DID
                            </h2>
                        </div>

                        <p className="text-gray-600 mb-4">
                            Create a self-resolving PRISM DID for use as holder/subject in Verifiable Credentials.
                            Long-form DIDs don't require blockchain publication and can be used immediately.
                        </p>

                        <div className="flex flex-col sm:flex-row gap-4">
                            <input
                                type="text"
                                placeholder="Optional alias (e.g., 'Work Identity')"
                                value={alias}
                                onChange={(e) => setAlias(e.target.value)}
                                className="flex-1 px-4 py-2 border border-gray-300 rounded-lg focus:ring-2 focus:ring-green-500 focus:border-green-500"
                                disabled={isCreating}
                            />
                            <button
                                onClick={handleCreatePrismDID}
                                disabled={isCreating || !agent}
                                className="px-6 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center transition-colors"
                            >
                                {isCreating ? (
                                    <>
                                        <RefreshIcon className="w-5 h-5 mr-2 animate-spin" />
                                        Creating...
                                    </>
                                ) : (
                                    <>
                                        <PlusIcon className="w-5 h-5 mr-2" />
                                        Create PRISM DID
                                    </>
                                )}
                            </button>
                        </div>

                        {/* Success/Error Messages */}
                        {createSuccess && (
                            <div className="mt-4 p-3 bg-green-100 border border-green-300 rounded-lg text-green-800 text-sm">
                                {createSuccess}
                            </div>
                        )}
                        {createError && (
                            <div className="mt-4 p-3 bg-red-100 border border-red-300 rounded-lg text-red-800 text-sm">
                                {createError}
                            </div>
                        )}
                    </div>

                    {/* My PRISM DIDs Section */}
                    <div className="mb-8">
                        <div className="flex items-center justify-between mb-4">
                            <div className="flex items-center">
                                <FingerPrintIcon className="w-6 h-6 text-green-600 mr-2" />
                                <h2 className="text-xl font-semibold text-green-700">
                                    My PRISM DIDs ({displayedPrismDIDs.length})
                                </h2>
                            </div>
                            <button
                                onClick={loadPrismDIDs}
                                className="p-2 text-gray-600 hover:text-green-600 hover:bg-green-50 rounded-lg transition-colors"
                                title="Refresh PRISM DIDs"
                            >
                                <RefreshIcon className="w-5 h-5" />
                            </button>
                        </div>

                        {displayedPrismDIDs.length === 0 ? (
                            <div className="bg-gray-50 border border-gray-200 rounded-lg p-6 text-center">
                                <FingerPrintIcon className="w-12 h-12 text-gray-400 mx-auto mb-3" />
                                <p className="text-gray-600">No PRISM DIDs created yet</p>
                                <p className="text-sm text-gray-500 mt-2">
                                    Create a PRISM DID with an alias above to see it here
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-3">
                                {displayedPrismDIDs.map((did, index) => (
                                    <PrismDIDCard key={index} did={did} index={index} agent={agent} />
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Visual Separator */}
                    <div className="border-t-4 border-blue-500 my-8"></div>

                    {/* Enterprise DIDs Section */}
                    <div>
                        <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-t-lg p-4 flex items-center justify-between">
                            <div className="flex items-center">
                                <OfficeBuildingIcon className="w-8 h-8 mr-3" />
                                <h2 className="text-xl font-semibold">
                                    Enterprise DIDs (Cloud Agent) {isEnterpriseConfigured && `(${enterpriseDIDs.length})`}
                                </h2>
                            </div>
                            {isEnterpriseConfigured && (
                                <button
                                    onClick={loadEnterpriseDIDs}
                                    disabled={isLoadingEnterpriseDIDs}
                                    className="p-2 text-white hover:bg-blue-700 rounded-lg transition-colors disabled:opacity-50"
                                    title="Refresh Enterprise DIDs"
                                >
                                    <RefreshIcon className={`w-5 h-5 ${isLoadingEnterpriseDIDs ? 'animate-spin' : ''}`} />
                                </button>
                            )}
                        </div>

                        {!isEnterpriseConfigured ? (
                            <div className="bg-white border-4 border-blue-500 border-t-0 rounded-b-lg p-8 text-center">
                                <OfficeBuildingIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                                <p className="text-gray-600 font-semibold mb-2">Enterprise wallet not configured</p>
                                <p className="text-sm text-gray-500">
                                    Connect to your organization's Cloud Agent by obtaining a Service Configuration credential
                                </p>
                            </div>
                        ) : isLoadingEnterpriseDIDs ? (
                            <div className="bg-white border-4 border-blue-500 border-t-0 rounded-b-lg p-12">
                                <div className="flex justify-center">
                                    <RefreshIcon className="w-8 h-8 text-blue-600 animate-spin" />
                                </div>
                            </div>
                        ) : enterpriseDIDs.length === 0 ? (
                            <div className="bg-white border-4 border-blue-500 border-t-0 rounded-b-lg p-8 text-center">
                                <IdentificationIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                                <p className="text-gray-600">No enterprise DIDs found</p>
                                <p className="text-sm text-gray-500 mt-2">
                                    Enterprise DIDs will appear here after they are created in your Cloud Agent
                                </p>
                            </div>
                        ) : (
                            <div className="bg-white border-4 border-blue-500 border-t-0 rounded-b-lg p-6 space-y-3">
                                {enterpriseDIDs.map((did, index) => (
                                    <div
                                        key={index}
                                        className="bg-blue-50 border border-blue-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                                    >
                                        <div className="flex items-center space-x-3 mb-2">
                                            <span className="text-xs font-semibold text-blue-700 bg-blue-200 px-2 py-1 rounded uppercase">
                                                {did.method || 'PRISM'}
                                            </span>
                                            <span className={`text-xs font-semibold px-2 py-1 rounded ${
                                                did.status === 'PUBLISHED'
                                                    ? 'bg-green-100 text-green-700'
                                                    : did.status === 'PUBLICATION_PENDING'
                                                    ? 'bg-yellow-100 text-yellow-700'
                                                    : 'bg-gray-100 text-gray-700'
                                            }`}>
                                                {did.status}
                                            </span>
                                        </div>
                                        <div className="text-sm text-gray-700 font-mono break-all">
                                            {did.did}
                                        </div>
                                        {did.createdAt && (
                                            <div className="text-xs text-gray-500 mt-2">
                                                Created: {new Date(did.createdAt).toLocaleString()}
                                            </div>
                                        )}
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>

                    {/* Refresh Info */}
                    <div className="mt-6 text-center text-sm text-gray-500">
                        Auto-refreshing every 30 seconds
                    </div>
                </Box>
            </DBConnect>
        </div>
    );
};

export default DIDManagementPage;
