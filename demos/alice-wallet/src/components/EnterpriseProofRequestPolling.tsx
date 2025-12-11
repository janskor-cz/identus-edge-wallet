/**
 * Enterprise Proof Request Modal Component
 *
 * Displays proof requests from the Enterprise Cloud Agent API
 * and allows manual user approval/rejection.
 *
 * Architecture:
 * - Presentation requests polled from Enterprise Cloud Agent REST API
 * - pollPendingProofRequests() fetches /present-proof/presentations endpoint
 * - Filters for status='RequestReceived' and role='Prover'
 * - This component displays them in a modal for user interaction
 * - Uses enterprise-specific approveProofRequest()/rejectProofRequest() actions
 *
 * User Flow:
 * 1. Enterprise Agent creates proof request (Verifier role)
 * 2. Wallet polls /present-proof/presentations API (every 5 seconds)
 * 3. pollPendingProofRequests() adds to state.enterpriseAgent.pendingProofRequests
 * 4. This modal appears when requests exist
 * 5. User selects credential and clicks Approve/Reject
 * 6. approveProofRequest() sends proof to Enterprise Agent via REST API
 * 7. Enterprise Agent verifies proof and updates presentation record
 *
 * Key Difference from DIDComm Proof Requests:
 * - Enterprise: REST API polling + presentationId field
 * - DIDComm: Message polling + id field + sendVerifiablePresentation() action
 */

import React, { useState, useEffect } from 'react';
import { useAppSelector, useAppDispatch } from '@/reducers/store';
import SDK from '@hyperledger/identus-edge-agent-sdk';
import { approveProofRequest, rejectProofRequest } from '@/actions/enterpriseAgentActions';

interface EnterpriseProofRequestPollingProps {
  // No props needed - automatically displays when requests arrive
}

export const EnterpriseProofRequestPolling: React.FC<EnterpriseProofRequestPollingProps> = () => {
  const dispatch = useAppDispatch();

  // ✅ FIX: Get presentation requests from enterprise agent polling (not DIDComm)
  // The pollPendingProofRequests() action stores data in state.enterpriseAgent.pendingProofRequests
  const pendingProofRequests = useAppSelector(
    state => state.enterpriseAgent?.pendingProofRequests || []
  );

  // Enterprise proof requests are already filtered by pollPendingProofRequests()
  // (only includes status='RequestReceived' and role='Prover')
  const pendingRequests = pendingProofRequests;

  // Get wallet credentials for selection
  const credentials = useAppSelector(state => state.app?.credentials || []);

  // Local component state
  const [selectedCredentialId, setSelectedCredentialId] = useState<string | null>(null);
  const [isProcessing, setIsProcessing] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /**
   * Reset selection when proof request changes
   */
  useEffect(() => {
    setSelectedCredentialId(null);
    setError(null);
  }, [pendingRequests.length]);

  /**
   * Handle approve button click
   */
  const handleApprove = async () => {
    if (!selectedCredentialId) {
      setError('Please select a credential to share');
      return;
    }

    if (pendingRequests.length === 0) {
      setError('No pending proof request');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const currentRequest = pendingRequests[0];

      console.log('[EnterpriseProofModal] Approving proof request:', currentRequest.presentationId);
      console.log('[EnterpriseProofModal] Using credential ID:', selectedCredentialId);

      // Find the selected credential from wallet
      const credential = credentials.find(c => c.id === selectedCredentialId);
      if (!credential) {
        throw new Error('Selected credential not found in wallet');
      }

      // Build proof object from credential
      // The enterprise agent expects a proof in the format of a Verifiable Presentation
      const proof = {
        credential: credential,
        type: 'VerifiablePresentation'
      };

      // Use enterprise-specific approveProofRequest action
      // This sends the proof to the Enterprise Cloud Agent's /present-proof/presentations/{id} endpoint
      await dispatch(approveProofRequest({
        presentationId: currentRequest.presentationId,
        proof: proof
      })).unwrap();

      console.log('[EnterpriseProofModal] ✅ Proof request approved');

      // Reset selection (modal will auto-close as request removed from pending list)
      setSelectedCredentialId(null);
    } catch (err) {
      console.error('[EnterpriseProofModal] ❌ Failed to approve proof request:', err);
      setError(err instanceof Error ? err.message : 'Failed to approve proof request');
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Handle reject button click
   */
  const handleReject = async () => {
    if (pendingRequests.length === 0) {
      setError('No pending proof request');
      return;
    }

    setIsProcessing(true);
    setError(null);

    try {
      const currentRequest = pendingRequests[0];

      console.log('[EnterpriseProofModal] Rejecting proof request:', currentRequest.presentationId);

      // Use enterprise-specific rejectProofRequest action
      // This sends 'request-reject' action to Enterprise Cloud Agent
      await dispatch(rejectProofRequest(currentRequest.presentationId)).unwrap();

      console.log('[EnterpriseProofModal] ✅ Proof request rejected');

      // Reset selection (modal will auto-close as request removed from pending list)
      setSelectedCredentialId(null);
    } catch (err) {
      console.error('[EnterpriseProofModal] ❌ Failed to reject proof request:', err);
      setError(err instanceof Error ? err.message : 'Failed to reject proof request');
    } finally {
      setIsProcessing(false);
    }
  };

  /**
   * Format DID for display
   */
  const formatDID = (did: string): string => {
    if (!did || did.length <= 40) return did || 'Unknown';
    return `${did.substring(0, 20)}...${did.substring(did.length - 17)}`;
  };

  /**
   * Get credential display name
   */
  const getCredentialDisplayName = (cred: SDK.Domain.Credential): string => {
    try {
      // Extract subject name if available
      if (cred.credentialSubject) {
        const subject = cred.credentialSubject as any;
        if (subject.firstName && subject.lastName) {
          return `${subject.firstName} ${subject.lastName}`;
        }
        if (subject.name) {
          return subject.name;
        }
      }

      // Fallback to credential type
      if (cred.credentialType) {
        return cred.credentialType;
      }

      // Fallback to issuer
      return `Credential from ${formatDID(cred.issuer)}`;
    } catch (error) {
      return 'Unknown Credential';
    }
  };

  // Don't render if no pending proof requests
  if (pendingRequests.length === 0) {
    return null;
  }

  // Show first pending request (FIFO)
  const currentRequest = pendingRequests[0];

  // Extract goal/comment from request
  // Enterprise presentation records have goal/goalCode at the top level
  const goal = currentRequest.goal || currentRequest.goalCode || '';
  const comment = ''; // Enterprise API doesn't include comment in presentation records

  return (
    <div
      className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-[10000]"
      style={{ backdropFilter: 'blur(2px)' }}
    >
      <div
        className="bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="sticky top-0 bg-gradient-to-r from-purple-600 to-purple-500 text-white px-6 py-4 rounded-t-xl">
          <div className="flex items-center space-x-3">
            <span className="text-2xl">🏢</span>
            <div>
              <h2 className="text-xl font-bold">
                Enterprise Proof Request
              </h2>
              <p className="text-sm opacity-90">
                Your company is requesting credential verification
              </p>
            </div>
          </div>
        </div>

        {/* Request Info */}
        <div className="px-6 py-4 border-b border-gray-200 dark:border-gray-700">
          <div className="space-y-3">
            {goal && (
              <div className="p-3 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-800 rounded-lg">
                <p className="text-sm italic text-purple-900 dark:text-purple-100">
                  "{goal}"
                </p>
              </div>
            )}
            {comment && (
              <div className="p-3 bg-blue-50 dark:bg-blue-900/20 border border-blue-200 dark:border-blue-800 rounded-lg">
                <p className="text-sm text-blue-900 dark:text-blue-100">
                  {comment}
                </p>
              </div>
            )}
            <div>
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Request ID:</span>
              <p className="text-xs font-mono text-gray-600 dark:text-gray-400 mt-1">
                {currentRequest.presentationId}
              </p>
            </div>
            {currentRequest.connectionId && (
              <div>
                <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Connection ID:</span>
                <p className="text-xs font-mono text-gray-600 dark:text-gray-400 mt-1">
                  {currentRequest.connectionId}
                </p>
              </div>
            )}
            <div>
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Status:</span>
              <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                {currentRequest.status}
              </p>
            </div>
            <div>
              <span className="text-sm font-medium text-gray-500 dark:text-gray-400">Role:</span>
              <p className="text-sm text-gray-700 dark:text-gray-300 mt-1">
                {currentRequest.role}
              </p>
            </div>
          </div>
        </div>

        {/* Credential Selection */}
        <div className="px-6 py-4">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
            Select credential to share:
          </h3>

          {credentials.length === 0 ? (
            <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-4">
              <p className="text-yellow-800 dark:text-yellow-200 text-sm">
                ⚠️ No credentials available in your wallet. You need to obtain credentials before responding to this request.
              </p>
            </div>
          ) : (
            <div className="space-y-3">
              {credentials.map((cred) => {
                const isSelected = selectedCredentialId === cred.id;
                const displayName = getCredentialDisplayName(cred);

                return (
                  <label
                    key={cred.id}
                    className={`
                      block p-4 border-2 rounded-lg cursor-pointer transition-all duration-200
                      ${isSelected
                        ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/20'
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
                        className="mt-1 h-4 w-4 text-purple-600 focus:ring-purple-500 disabled:opacity-50"
                      />
                      <div className="flex-1">
                        <div className="font-semibold text-gray-900 dark:text-white">
                          {displayName}
                        </div>
                        <div className="text-xs text-gray-500 dark:text-gray-400 mt-1 font-mono">
                          Issuer: {formatDID(cred.issuer)}
                        </div>
                        {cred.credentialType && (
                          <div className="text-xs text-gray-500 dark:text-gray-400 mt-1">
                            Type: {cred.credentialType}
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
              onClick={handleReject}
              disabled={isProcessing}
              className="flex-1 px-4 py-3 bg-gray-500 hover:bg-gray-600 disabled:bg-gray-400
                       text-white font-medium rounded-lg transition-colors duration-200
                       disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
            >
              {isProcessing ? '⏳ Processing...' : '🚫 Reject'}
            </button>
            <button
              onClick={handleApprove}
              disabled={isProcessing || credentials.length === 0 || !selectedCredentialId}
              className="flex-1 px-4 py-3 bg-purple-600 hover:bg-purple-700 disabled:bg-purple-400
                       text-white font-medium rounded-lg transition-colors duration-200
                       disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-purple-500 focus:ring-offset-2"
            >
              {isProcessing ? '⏳ Approving...' : '✅ Approve & Send'}
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
