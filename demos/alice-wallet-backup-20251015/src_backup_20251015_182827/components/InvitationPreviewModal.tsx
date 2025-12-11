import React, { useState, useEffect } from 'react';
import { InviterIdentity, FIELD_LABELS } from '../types/invitations';
import { VerificationBadge } from './VerificationBadge';
import { VCProofDisplay } from './VCProofDisplay';
import { invitationStateManager } from '../utils/InvitationStateManager';
import { useAppSelector } from '../reducers/store';

interface InvitationPreviewModalProps {
  isOpen: boolean;
  onClose: () => void;
  onAccept: () => Promise<void>;
  onReject?: () => Promise<void>; // ✅ PHASE 3: Add reject callback
  inviterIdentity: InviterIdentity | null;
  inviterLabel: string;
  invitationData?: {
    id?: string;
    from?: string;
    type?: string;
    goal?: string;
  };
}

export const InvitationPreviewModal: React.FC<InvitationPreviewModalProps> = ({
  isOpen,
  onClose,
  onAccept,
  onReject, // ✅ PHASE 3: Extract reject callback
  inviterIdentity,
  inviterLabel,
  invitationData
}) => {
  const [isAccepting, setIsAccepting] = useState(false);
  const app = useAppSelector((state) => state.app);

  // ✅ PHASE 3: Mark invitation as previewed when modal opens
  useEffect(() => {
    const markAsPreviewed = async () => {
      if (!isOpen || !invitationData?.id || !app.wallet?.walletId) return;

      try {
        const success = await invitationStateManager.markPreviewed(
          app.wallet.walletId,
          invitationData.id
        );

        if (success) {
          console.log('✅ [INVITATION STATE] Marked invitation as InvitationPreviewed:', invitationData.id);
        } else {
          console.warn('⚠️ [INVITATION STATE] Could not mark as previewed (invitation may not exist):', invitationData.id);
        }
      } catch (error) {
        console.error('❌ [INVITATION STATE] Failed to mark invitation as previewed:', error);
        // Don't throw - modal should still display
      }
    };

    markAsPreviewed();
  }, [isOpen, invitationData?.id, app.wallet?.walletId]);

  if (!isOpen) return null;

  const handleAccept = async () => {
    setIsAccepting(true);
    try {
      await onAccept();
      // Don't close modal here - let parent handle it after successful connection
    } catch (error) {
      console.error('Failed to accept invitation:', error);
      alert('Failed to accept invitation. Please try again.');
    } finally {
      setIsAccepting(false);
    }
  };

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert(`${label} copied to clipboard!`);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto">
      {/* Backdrop */}
      <div
        className="fixed inset-0 bg-black bg-opacity-50 transition-opacity"
        onClick={onClose}
      />

      {/* Modal Container */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div className="relative bg-white dark:bg-gray-800 rounded-xl shadow-2xl max-w-2xl w-full max-h-[90vh] overflow-y-auto">
          {/* Modal Header */}
          <div className="sticky top-0 bg-white dark:bg-gray-800 border-b border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between z-10">
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                <span className="text-blue-600 dark:text-blue-400 text-xl">🔗</span>
              </div>
              <div>
                <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                  Connection Invitation
                </h2>
                <p className="text-sm text-gray-600 dark:text-gray-400">
                  Review invitation details before accepting
                </p>
              </div>
            </div>
            <button
              onClick={onClose}
              className="text-gray-400 hover:text-gray-600 dark:hover:text-gray-300 transition-colors"
            >
              <span className="text-2xl">×</span>
            </button>
          </div>

          {/* Modal Body */}
          <div className="px-6 py-6 space-y-6">
            {/* Inviter Identity Section */}
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                  Invitation From:
                </h3>
                <VerificationBadge inviterIdentity={inviterIdentity} size="md" showLabel={true} />
              </div>

              <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 space-y-3">
                {/* Inviter Label */}
                {inviterLabel && (
                  <div className="flex items-center space-x-3">
                    <div className="flex-shrink-0 w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-full flex items-center justify-center">
                      <span className="text-xl">👤</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-lg font-bold text-gray-900 dark:text-white truncate">
                        {inviterLabel}
                      </p>
                    </div>
                  </div>
                )}

                {/* Inviter DID */}
                {invitationData?.from && (
                  <div className="space-y-1">
                    <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">
                      Inviter DID:
                    </p>
                    <div className="flex items-center space-x-2">
                      <p className="flex-1 font-mono text-xs text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded break-all">
                        {invitationData.from}
                      </p>
                      <button
                        onClick={() => copyToClipboard(invitationData.from!, 'DID')}
                        className="flex-shrink-0 p-1 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900 rounded"
                        title="Copy DID"
                      >
                        📋
                      </button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* VC Proof Section - ✅ PHASE 4 FIX: Display if vcProof exists (more reliable) */}
            {inviterIdentity && inviterIdentity.vcProof && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                  Attached Credential Proof:
                </h3>

                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4">
                  <VCProofDisplay inviterIdentity={inviterIdentity} />
                </div>

                {/* ✅ PHASE 2: Show validation warnings for unverified credentials */}
                {!inviterIdentity.isVerified && inviterIdentity.validationResult.warnings && inviterIdentity.validationResult.warnings.length > 0 && (
                  <div className="bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-lg p-3">
                    <div className="flex items-start space-x-2">
                      <span className="text-yellow-600 dark:text-yellow-400 text-lg flex-shrink-0">⚠️</span>
                      <div className="text-sm text-yellow-800 dark:text-yellow-200">
                        <p className="font-semibold mb-1">Validation Warnings:</p>
                        <ul className="space-y-1 ml-4 list-disc">
                          {inviterIdentity.validationResult.warnings.map((warning: string, i: number) => (
                            <li key={i}>{warning}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}

                {/* ✅ PHASE 2: Show validation errors if present */}
                {inviterIdentity.validationResult.errors && inviterIdentity.validationResult.errors.length > 0 && (
                  <div className="bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg p-3">
                    <div className="flex items-start space-x-2">
                      <span className="text-red-600 dark:text-red-400 text-lg flex-shrink-0">🚨</span>
                      <div className="text-sm text-red-800 dark:text-red-200">
                        <p className="font-semibold mb-1">Validation Errors:</p>
                        <ul className="space-y-1 ml-4 list-disc">
                          {inviterIdentity.validationResult.errors.map((error: string, i: number) => (
                            <li key={i}>{error}</li>
                          ))}
                        </ul>
                      </div>
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Invitation Details Section */}
            {invitationData && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                  Invitation Details:
                </h3>

                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 space-y-3 text-sm">
                  {invitationData.id && (
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-gray-600 dark:text-gray-400">Invitation ID:</span>
                      <span className="font-mono text-xs text-gray-900 dark:text-white">{invitationData.id.substring(0, 20)}...</span>
                    </div>
                  )}
                  {invitationData.type && (
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-gray-600 dark:text-gray-400">Type:</span>
                      <span className="text-gray-900 dark:text-white">RFC 0434 Out-of-Band</span>
                    </div>
                  )}
                  {invitationData.goal && (
                    <div className="flex justify-between items-center">
                      <span className="font-medium text-gray-600 dark:text-gray-400">Purpose:</span>
                      <span className="text-gray-900 dark:text-white">{invitationData.goal}</span>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* Security Notice */}
            <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
              <div className="flex items-start space-x-3">
                <span className="text-blue-600 dark:text-blue-400 text-xl flex-shrink-0">ℹ️</span>
                <div className="text-sm text-blue-800 dark:text-blue-200">
                  <p className="font-semibold mb-1">Security Recommendation:</p>
                  <p>
                    Review the inviter's identity and attached credentials before accepting.
                    Only accept invitations from trusted sources.
                  </p>
                </div>
              </div>
            </div>
          </div>

          {/* Modal Footer */}
          <div className="sticky bottom-0 bg-white dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 px-6 py-4 flex items-center justify-between">
            <button
              onClick={onClose}
              className="px-4 py-2 text-gray-700 dark:text-gray-300 bg-transparent hover:bg-gray-100 dark:hover:bg-gray-700 rounded-lg transition-colors"
              disabled={isAccepting}
            >
              Close
            </button>

            {/* ✅ PHASE 3: Action buttons - Reject and Accept */}
            <div className="flex space-x-3">
              {onReject && (
                <button
                  onClick={onReject}
                  disabled={isAccepting}
                  className="px-6 py-3 bg-red-600 text-white font-semibold rounded-lg hover:bg-red-700 focus:ring-4 focus:ring-red-300 dark:focus:ring-red-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                >
                  ✗ Reject
                </button>
              )}
              <button
                onClick={handleAccept}
                disabled={isAccepting}
                className="px-8 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 dark:focus:ring-blue-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
              >
                {isAccepting ? '⏳ Accepting...' : '✓ Accept Invitation'}
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
};
