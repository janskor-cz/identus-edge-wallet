import React, { useState, useEffect } from 'react';
import { useAppSelector, useAppDispatch } from '@/reducers/store';
import {
  selectEnterpriseDIDs,
  selectIsEnterpriseConfigured,
  selectIsLoadingDIDs,
  selectEnterpriseClient,
  startLoadingDIDs,
  setEnterpriseDIDs,
  setError
} from '@/reducers/enterpriseAgent';
import { ClipboardCopyIcon, CheckCircleIcon, IdentificationIcon, OfficeBuildingIcon } from '@heroicons/react/solid';

/**
 * DIDs Page
 *
 * Displays DIDs from both:
 * 1. Personal DIDs (Edge Wallet SDK)
 * 2. Enterprise DIDs (Cloud Agent API) - if Service Configuration VC present
 *
 * Features:
 * - Dual-section layout with visual separator
 * - Copy to clipboard functionality
 * - Auto-refresh every 30 seconds
 * - Loading and empty states
 */
const DIDsPage: React.FC = () => {
  const dispatch = useAppDispatch();

  // Redux state
  const enterpriseDIDs = useAppSelector(selectEnterpriseDIDs);
  const isEnterpriseConfigured = useAppSelector(selectIsEnterpriseConfigured);
  const isLoadingEnterpriseDIDs = useAppSelector(selectIsLoadingDIDs);
  const enterpriseClient = useAppSelector(selectEnterpriseClient);

  // Local state
  const [refreshKey, setRefreshKey] = useState<number>(0);
  const [copiedDID, setCopiedDID] = useState<string | null>(null);
  const [personalDIDs, setPersonalDIDs] = useState<any[]>([]);
  const [loadingPersonalDIDs, setLoadingPersonalDIDs] = useState(true);

  /**
   * Load personal DIDs from edge wallet SDK
   */
  const loadPersonalDIDs = async () => {
    try {
      setLoadingPersonalDIDs(true);

      // Get agent from Redux store
      const agent = (window as any).agent;

      if (!agent || !agent.pluto) {
        console.log('[DIDs] Agent not initialized yet');
        setPersonalDIDs([]);
        setLoadingPersonalDIDs(false);
        return;
      }

      // Get all DIDs from Pluto storage
      const dids = await agent.pluto.getAllPeerDIDs();

      console.log('[DIDs] Loaded', dids.length, 'personal DIDs from edge wallet');
      setPersonalDIDs(dids || []);
    } catch (error) {
      console.error('[DIDs] Error loading personal DIDs:', error);
      setPersonalDIDs([]);
    } finally {
      setLoadingPersonalDIDs(false);
    }
  };

  /**
   * Load enterprise DIDs from Cloud Agent API
   */
  const loadEnterpriseDIDs = async () => {
    if (!isEnterpriseConfigured || !enterpriseClient) {
      console.log('[DIDs] Enterprise not configured, skipping enterprise DIDs fetch');
      return;
    }

    try {
      dispatch(startLoadingDIDs());

      const response = await enterpriseClient.listDIDs();

      console.log('[DIDs] Loaded', response.contents?.length || 0, 'enterprise DIDs from Cloud Agent');

      // Transform Cloud Agent response to EnterpriseDID format
      const dids = (response.contents || []).map((did: any) => ({
        did: did.did,
        status: did.status,
        method: did.method || 'prism',
        createdAt: did.createdAt,
        updatedAt: did.updatedAt
      }));

      dispatch(setEnterpriseDIDs(dids));
    } catch (error: any) {
      console.error('[DIDs] Error loading enterprise DIDs:', error);
      dispatch(setError(error.message || 'Failed to load enterprise DIDs'));
      dispatch(setEnterpriseDIDs([]));
    }
  };

  /**
   * Copy DID to clipboard
   */
  const copyToClipboard = (did: string) => {
    navigator.clipboard.writeText(did).then(() => {
      setCopiedDID(did);
      setTimeout(() => setCopiedDID(null), 2000);
    });
  };

  /**
   * Format DID for display (truncate middle)
   */
  const formatDID = (did: string): string => {
    if (did.length <= 40) return did;
    return `${did.substring(0, 20)}...${did.substring(did.length - 20)}`;
  };

  /**
   * Initial load
   */
  useEffect(() => {
    loadPersonalDIDs();
    loadEnterpriseDIDs();
  }, [refreshKey]);

  /**
   * Auto-refresh every 30 seconds
   */
  useEffect(() => {
    const interval = setInterval(() => {
      console.log('[DIDs] Auto-refreshing DIDs...');
      setRefreshKey(prev => prev + 1);
    }, 30000); // 30 seconds

    return () => clearInterval(interval);
  }, []);

  return (
    <div className="container mx-auto p-6">
      <h1 className="text-3xl font-bold mb-6 text-gray-800">Decentralized Identifiers (DIDs)</h1>

      {/* Personal DIDs Section */}
      <div className="mb-8">
        <div className="flex items-center mb-4">
          <IdentificationIcon className="w-8 h-8 text-purple-600 mr-3" />
          <h2 className="text-2xl font-semibold text-gray-700">Personal DIDs</h2>
        </div>

        {loadingPersonalDIDs ? (
          <div className="flex justify-center items-center py-12">
            <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-purple-600"></div>
          </div>
        ) : personalDIDs.length === 0 ? (
          <div className="bg-gray-50 border border-gray-200 rounded-lg p-8 text-center">
            <IdentificationIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600">No personal DIDs found</p>
            <p className="text-sm text-gray-500 mt-2">
              DIDs will appear here after connecting to services
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {personalDIDs.map((did, index) => {
              const didString = did.toString();
              return (
                <div
                  key={index}
                  className="bg-white border border-gray-200 rounded-lg p-4 hover:shadow-md transition-shadow"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1">
                      <div className="flex items-center space-x-3">
                        <span className="text-xs font-semibold text-purple-600 bg-purple-100 px-2 py-1 rounded">
                          PEER
                        </span>
                        <span className="text-sm text-gray-600 font-mono">
                          {formatDID(didString)}
                        </span>
                      </div>
                    </div>
                    <button
                      onClick={() => copyToClipboard(didString)}
                      className="ml-4 p-2 text-gray-600 hover:text-purple-600 hover:bg-purple-50 rounded-lg transition-colors"
                      title="Copy to clipboard"
                    >
                      {copiedDID === didString ? (
                        <CheckCircleIcon className="w-5 h-5 text-green-600" />
                      ) : (
                        <ClipboardCopyIcon className="w-5 h-5" />
                      )}
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* Visual Separator */}
      <div className="border-t-4 border-blue-500 my-8"></div>

      {/* Enterprise DIDs Section */}
      <div>
        <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white rounded-t-lg p-4 flex items-center">
          <OfficeBuildingIcon className="w-8 h-8 mr-3" />
          <h2 className="text-2xl font-semibold">Enterprise DIDs (Cloud Agent)</h2>
        </div>

        {!isEnterpriseConfigured ? (
          <div className="bg-white border-4 border-blue-500 border-t-0 rounded-b-lg p-8 text-center">
            <OfficeBuildingIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
            <p className="text-gray-600 font-semibold mb-2">Enterprise wallet not configured</p>
            <p className="text-sm text-gray-500">
              Connect to your organization&apos;s Cloud Agent by obtaining a Service Configuration credential
            </p>
          </div>
        ) : isLoadingEnterpriseDIDs ? (
          <div className="bg-white border-4 border-blue-500 border-t-0 rounded-b-lg p-12">
            <div className="flex justify-center items-center">
              <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
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
                <div className="flex items-start justify-between">
                  <div className="flex-1">
                    <div className="flex items-center space-x-3 mb-2">
                      <span className="text-xs font-semibold text-blue-700 bg-blue-200 px-2 py-1 rounded uppercase">
                        {did.method || 'PRISM'}
                      </span>
                      <span
                        className={`text-xs font-semibold px-2 py-1 rounded ${
                          did.status === 'PUBLISHED'
                            ? 'bg-green-100 text-green-700'
                            : did.status === 'PUBLICATION_PENDING'
                            ? 'bg-yellow-100 text-yellow-700'
                            : 'bg-gray-100 text-gray-700'
                        }`}
                      >
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
                  <button
                    onClick={() => copyToClipboard(did.did)}
                    className="ml-4 p-2 text-gray-600 hover:text-blue-600 hover:bg-blue-100 rounded-lg transition-colors flex-shrink-0"
                    title="Copy to clipboard"
                  >
                    {copiedDID === did.did ? (
                      <CheckCircleIcon className="w-5 h-5 text-green-600" />
                    ) : (
                      <ClipboardCopyIcon className="w-5 h-5" />
                    )}
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>

      {/* Refresh Info */}
      <div className="mt-6 text-center text-sm text-gray-500">
        Auto-refreshing every 30 seconds
      </div>
    </div>
  );
};

export default DIDsPage;
