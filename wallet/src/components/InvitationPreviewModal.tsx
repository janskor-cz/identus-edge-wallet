import React, { useState, useEffect } from 'react';
import { InviterIdentity, FIELD_LABELS } from '../types/invitations';
import { VerificationBadge } from './VerificationBadge';
import { VCProofDisplay } from './VCProofDisplay';
import { SelectiveDisclosure } from './SelectiveDisclosure';
import { invitationStateManager } from '../utils/InvitationStateManager';
import { useAppSelector } from '../reducers/store';
import { ValidatedCAConfig } from '../utils/caValidation';
import { ValidatedCompanyConfig } from '../utils/companyValidation';

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
  // ✅ NEW: Credential selection props for response
  availableCredentials?: any[];
  selectedVCForRequest?: any | null;
  onVCSelectionChange?: (credential: any | null) => void;
  onFieldSelection?: (fields: string[], level: 'minimal' | 'partial' | 'full') => void;
  // ✅ CA IDENTITY VERIFICATION: CA config props
  caConfig?: ValidatedCAConfig | null;
  isCAInvitation?: boolean;
  caAlreadyPinned?: boolean;
  // ✅ COMPANY IDENTITY VERIFICATION: Company config props
  companyConfig?: ValidatedCompanyConfig | null;
  isCompanyInvitation?: boolean;
  companyAlreadyPinned?: boolean;
  companyCAVerification?: { verified: boolean; caName?: string; issuerDID?: string } | null;
  // ✅ WALLET SELECTION: Wallet selection props
  walletType?: 'local' | 'cloud';
  cloudConfig?: any;
  onWalletSelect?: (walletType: 'local' | 'cloud') => void;
}

export const InvitationPreviewModal: React.FC<InvitationPreviewModalProps> = ({
  isOpen,
  onClose,
  onAccept,
  onReject, // ✅ PHASE 3: Extract reject callback
  inviterIdentity,
  inviterLabel,
  invitationData,
  // ✅ NEW: Extract credential selection props
  availableCredentials,
  selectedVCForRequest,
  onVCSelectionChange,
  onFieldSelection,
  // ✅ CA IDENTITY VERIFICATION: Extract CA props
  caConfig,
  isCAInvitation,
  caAlreadyPinned,
  // ✅ COMPANY IDENTITY VERIFICATION: Extract company props
  companyConfig,
  isCompanyInvitation,
  companyAlreadyPinned,
  companyCAVerification,
  // ✅ WALLET SELECTION: Extract wallet selection props
  walletType = 'local',
  cloudConfig,
  onWalletSelect
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
                {companyCAVerification ? (
                  // Show CA verification status if available
                  companyCAVerification.verified ? (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                      ✅ Verified by {companyCAVerification.caName}
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-yellow-100 text-yellow-800 dark:bg-yellow-900 dark:text-yellow-200">
                      ⚠️ Unverified (TOFU)
                    </span>
                  )
                ) : (
                  // Fallback to VerificationBadge for non-company invitations
                  <VerificationBadge inviterIdentity={inviterIdentity} size="md" showLabel={true} />
                )}
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

            {/* ✅ CA IDENTITY VERIFICATION: CA Identity Section */}
            {isCAInvitation && caConfig && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                    🏛️ Certification Authority Identity:
                  </h3>
                  {caAlreadyPinned ? (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                      ✅ Previously Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                      🆕 First Connection (TOFU)
                    </span>
                  )}
                </div>

                <div className="bg-gradient-to-br from-blue-50 to-indigo-50 dark:from-blue-900/30 dark:to-indigo-900/30 rounded-lg border-2 border-blue-200 dark:border-blue-700 p-5 space-y-4">
                  {/* Organization Name */}
                  <div className="flex items-start space-x-3">
                    <div className="flex-shrink-0 w-12 h-12 bg-blue-600 dark:bg-blue-500 rounded-lg flex items-center justify-center">
                      <span className="text-2xl">🏛️</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase mb-1">
                        Organization Name
                      </p>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">
                        {caConfig.organizationName}
                      </p>
                    </div>
                  </div>

                  {/* Website */}
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase">
                      Website
                    </p>
                    <a
                      href={caConfig.website}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="inline-flex items-center space-x-2 text-blue-600 dark:text-blue-400 hover:underline"
                    >
                      <span>{caConfig.website}</span>
                      <span className="text-sm">🔗</span>
                    </a>
                  </div>

                  {/* Jurisdiction & Registration Number */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase">
                        Jurisdiction
                      </p>
                      <p className="text-base font-medium text-gray-900 dark:text-white">
                        {caConfig.jurisdiction}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase">
                        Registration #
                      </p>
                      <p className="text-base font-medium text-gray-900 dark:text-white font-mono">
                        {caConfig.registrationNumber}
                      </p>
                    </div>
                  </div>

                  {/* Authority Level */}
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase">
                      Authority Level
                    </p>
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-sm font-medium bg-purple-100 text-purple-800 dark:bg-purple-900 dark:text-purple-200">
                      {caConfig.authorityLevel}
                    </span>
                  </div>

                  {/* CA DID */}
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase">
                      CA DID (Identifier)
                    </p>
                    <div className="flex items-center space-x-2">
                      <p className="flex-1 font-mono text-xs text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-800 px-3 py-2 rounded border border-gray-200 dark:border-gray-700 break-all">
                        {caConfig.caDID}
                      </p>
                      <button
                        onClick={() => copyToClipboard(caConfig.caDID, 'CA DID')}
                        className="flex-shrink-0 p-2 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900 rounded transition-colors"
                        title="Copy CA DID"
                      >
                        📋
                      </button>
                    </div>
                  </div>

                  {/* TOFU Information Badge */}
                  {!caAlreadyPinned && (
                    <div className="bg-blue-100 dark:bg-blue-900/50 border border-blue-300 dark:border-blue-700 rounded-lg p-3">
                      <div className="flex items-start space-x-2">
                        <span className="text-blue-600 dark:text-blue-400 text-lg flex-shrink-0">ℹ️</span>
                        <div className="text-sm text-blue-800 dark:text-blue-200">
                          <p className="font-semibold mb-1">Trust On First Use (TOFU)</p>
                          <p>
                            This is your first connection to this Certification Authority.
                            By accepting, you will trust this CA's identity. Future connections
                            will be verified against this saved identity to detect any changes
                            (potential man-in-the-middle attacks).
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Re-verification Badge */}
                  {caAlreadyPinned && (
                    <div className="bg-green-100 dark:bg-green-900/50 border border-green-300 dark:border-green-700 rounded-lg p-3">
                      <div className="flex items-start space-x-2">
                        <span className="text-green-600 dark:text-green-400 text-lg flex-shrink-0">✅</span>
                        <div className="text-sm text-green-800 dark:text-green-200">
                          <p className="font-semibold mb-1">CA Identity Verified</p>
                          <p>
                            This Certification Authority's identity has been verified against
                            your saved pin. The CA DID matches your previous connection,
                            confirming this is the same trusted authority.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

            {/* ✅ COMPANY IDENTITY VERIFICATION: Company Identity Section */}
            {isCompanyInvitation && companyConfig && (
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                    🏢 Company Identity:
                  </h3>
                  {companyAlreadyPinned ? (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-200">
                      ✅ Previously Verified
                    </span>
                  ) : (
                    <span className="inline-flex items-center px-3 py-1 rounded-full text-xs font-medium bg-blue-100 text-blue-800 dark:bg-blue-900 dark:text-blue-200">
                      🆕 First Connection (TOFU)
                    </span>
                  )}
                </div>

                {/* ✅ CA VERIFICATION: Display CA trust status */}
                {companyCAVerification && (
                  <div className={`rounded-lg p-3 ${companyCAVerification.verified ? 'bg-green-50 dark:bg-green-900/20 border border-green-200 dark:border-green-700' : 'bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-700'}`}>
                    {companyCAVerification.verified ? (
                      <div className="flex items-start space-x-2">
                        <span className="text-lg">✅</span>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-green-800 dark:text-green-300">
                            Verified by Certification Authority
                          </p>
                          <p className="text-xs text-green-700 dark:text-green-400 mt-1">
                            This company's identity credential was issued by <span className="font-mono font-bold">{companyCAVerification.caName}</span>, a CA you have an established connection with.
                          </p>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start space-x-2">
                        <span className="text-lg">⚠️</span>
                        <div className="flex-1">
                          <p className="text-sm font-semibold text-yellow-800 dark:text-yellow-300">
                            Unverified Issuer - TOFU Applies
                          </p>
                          <p className="text-xs text-yellow-700 dark:text-yellow-400 mt-1">
                            This company's credential was not issued by a known CA. Trust-On-First-Use (TOFU) security model applies.
                          </p>
                        </div>
                      </div>
                    )}
                  </div>
                )}

                <div className="bg-gradient-to-br from-green-50 to-emerald-50 dark:from-green-900/30 dark:to-emerald-900/30 rounded-lg border-2 border-green-200 dark:border-green-700 p-5 space-y-4">
                  {/* Company Name */}
                  <div className="flex items-start space-x-3">
                    <div className="flex-shrink-0 w-12 h-12 bg-green-600 dark:bg-green-500 rounded-lg flex items-center justify-center">
                      <span className="text-2xl">🏢</span>
                    </div>
                    <div className="flex-1 min-w-0">
                      <p className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase mb-1">
                        Company Name
                      </p>
                      <p className="text-xl font-bold text-gray-900 dark:text-white">
                        {companyConfig.companyName}
                      </p>
                    </div>
                  </div>

                  {/* Website (if present) */}
                  {companyConfig.website && (
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase">
                        Website
                      </p>
                      <a
                        href={companyConfig.website}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="inline-flex items-center space-x-2 text-green-600 dark:text-green-400 hover:underline"
                      >
                        <span>{companyConfig.website}</span>
                        <span className="text-sm">🔗</span>
                      </a>
                    </div>
                  )}

                  {/* Jurisdiction & Registration Number */}
                  <div className="grid grid-cols-2 gap-4">
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase">
                        Jurisdiction
                      </p>
                      <p className="text-base font-medium text-gray-900 dark:text-white">
                        {companyConfig.jurisdiction}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase">
                        Registration #
                      </p>
                      <p className="text-base font-medium text-gray-900 dark:text-white font-mono">
                        {companyConfig.registrationNumber}
                      </p>
                    </div>
                  </div>

                  {/* Industry (if present) */}
                  {companyConfig.industry && (
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase">
                        Industry
                      </p>
                      <p className="text-base font-medium text-gray-900 dark:text-white">
                        {companyConfig.industry}
                      </p>
                    </div>
                  )}

                  {/* Address (if present) */}
                  {companyConfig.address && (
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase">
                        Address
                      </p>
                      <p className="text-base font-medium text-gray-900 dark:text-white">
                        {companyConfig.address}
                      </p>
                    </div>
                  )}

                  {/* Contact Email (if present) */}
                  {companyConfig.contactEmail && (
                    <div className="space-y-1">
                      <p className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase">
                        Contact Email
                      </p>
                      <a
                        href={`mailto:${companyConfig.contactEmail}`}
                        className="inline-flex items-center space-x-2 text-green-600 dark:text-green-400 hover:underline"
                      >
                        <span>{companyConfig.contactEmail}</span>
                        <span className="text-sm">📧</span>
                      </a>
                    </div>
                  )}

                  {/* Company DID */}
                  <div className="space-y-1">
                    <p className="text-sm font-semibold text-gray-600 dark:text-gray-400 uppercase">
                      Company DID (Identifier)
                    </p>
                    <div className="flex items-center space-x-2">
                      <p className="flex-1 font-mono text-xs text-gray-800 dark:text-gray-200 bg-white dark:bg-gray-800 px-3 py-2 rounded border border-gray-200 dark:border-gray-700 break-all">
                        {companyConfig.companyDID}
                      </p>
                      <button
                        onClick={() => copyToClipboard(companyConfig.companyDID, 'Company DID')}
                        className="flex-shrink-0 p-2 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900 rounded transition-colors"
                        title="Copy Company DID"
                      >
                        📋
                      </button>
                    </div>
                  </div>

                  {/* TOFU Information Badge */}
                  {!companyAlreadyPinned && (
                    <div className="bg-green-100 dark:bg-green-900/50 border border-green-300 dark:border-green-700 rounded-lg p-3">
                      <div className="flex items-start space-x-2">
                        <span className="text-green-600 dark:text-green-400 text-lg flex-shrink-0">ℹ️</span>
                        <div className="text-sm text-green-800 dark:text-green-200">
                          <p className="font-semibold mb-1">Trust On First Use (TOFU)</p>
                          <p>
                            This is your first connection to this company.
                            By accepting, you will trust this company's identity. Future connections
                            will be verified against this saved identity to detect any changes
                            (potential man-in-the-middle attacks).
                          </p>
                        </div>
                      </div>
                    </div>
                  )}

                  {/* Re-verification Badge */}
                  {companyAlreadyPinned && (
                    <div className="bg-green-100 dark:bg-green-900/50 border border-green-300 dark:border-green-700 rounded-lg p-3">
                      <div className="flex items-start space-x-2">
                        <span className="text-green-600 dark:text-green-400 text-lg flex-shrink-0">✅</span>
                        <div className="text-sm text-green-800 dark:text-green-200">
                          <p className="font-semibold mb-1">Company Identity Verified</p>
                          <p>
                            This company's identity has been verified against
                            your saved pin. The Company DID matches your previous connection,
                            confirming this is the same trusted company.
                          </p>
                        </div>
                      </div>
                    </div>
                  )}
                </div>
              </div>
            )}

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

            {/* ✅ NEW: Credential Selection Section */}
            {availableCredentials && availableCredentials.length > 0 && onVCSelectionChange && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                  Share Your Credential (Optional):
                </h3>

                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 space-y-3">
                  {/* Credential Dropdown */}
                  <div className="space-y-2">
                    <label className="block text-sm font-medium text-gray-700 dark:text-gray-300">
                      Select a credential to share:
                    </label>
                    <select
                      value={selectedVCForRequest ? JSON.stringify({ id: selectedVCForRequest.id }) : ''}
                      onChange={(e) => {
                        if (e.target.value === '') {
                          onVCSelectionChange(null);
                        } else {
                          const selectedId = JSON.parse(e.target.value).id;
                          const credential = availableCredentials.find(c => c.id === selectedId);
                          onVCSelectionChange(credential || null);
                        }
                      }}
                      className="w-full px-3 py-2 bg-white dark:bg-gray-800 border border-gray-300 dark:border-gray-600 rounded-md text-gray-900 dark:text-white focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                    >
                      <option value="">-- None (Skip credential sharing) --</option>
                      {availableCredentials.map((credential) => {
                        const credentialSubject = credential.credentialSubject || credential.vc?.credentialSubject;
                        const displayName = credentialSubject?.firstName && credentialSubject?.lastName
                          ? `${credentialSubject.firstName} ${credentialSubject.lastName}`
                          : credential.id?.substring(0, 20) || 'Unknown Credential';
                        return (
                          <option key={credential.id} value={JSON.stringify({ id: credential.id })}>
                            {displayName}
                          </option>
                        );
                      })}
                    </select>
                  </div>

                  {/* Disclosure Level Selection (if credential selected) */}
                  {selectedVCForRequest && onFieldSelection && (
                    <div className="pt-4 border-t border-gray-200 dark:border-gray-600">
                      <SelectiveDisclosure
                        credential={selectedVCForRequest}
                        onFieldSelection={onFieldSelection}
                        initialLevel="minimal"
                      />
                    </div>
                  )}
                </div>
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

            {/* Wallet Selection Section */}
            {onWalletSelect && (
              <div className="space-y-4">
                <h3 className="text-sm font-semibold text-gray-700 dark:text-gray-300 uppercase tracking-wide">
                  🔐 Select Wallet to Accept Connection:
                </h3>

                <div className="space-y-3">
                  {/* Personal Local Wallet Option */}
                  <label
                    className={`flex items-start space-x-4 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                      walletType === 'local'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                        : 'border-gray-300 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-700'
                    }`}
                  >
                    <input
                      type="radio"
                      name="wallet-selection"
                      value="local"
                      checked={walletType === 'local'}
                      onChange={() => onWalletSelect('local')}
                      className="mt-1 w-4 h-4 text-blue-600 focus:ring-blue-500"
                    />
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <span className="text-lg">💻</span>
                        <p className="font-semibold text-gray-900 dark:text-white">
                          Personal Local Wallet
                        </p>
                      </div>
                      <p className="text-sm text-gray-600 dark:text-gray-400">
                        Connection stored in your browser's local wallet (IndexedDB).
                        Full control, always available.
                      </p>
                    </div>
                  </label>

                  {/* Enterprise Cloud Wallet Option */}
                  <label
                    className={`flex items-start space-x-4 p-4 rounded-lg border-2 cursor-pointer transition-all ${
                      walletType === 'cloud'
                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30'
                        : cloudConfig
                        ? 'border-gray-300 dark:border-gray-600 hover:border-blue-300 dark:hover:border-blue-700'
                        : 'border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-800 opacity-60 cursor-not-allowed'
                    }`}
                  >
                    <input
                      type="radio"
                      name="wallet-selection"
                      value="cloud"
                      checked={walletType === 'cloud'}
                      onChange={() => cloudConfig && onWalletSelect('cloud')}
                      disabled={!cloudConfig}
                      className="mt-1 w-4 h-4 text-blue-600 focus:ring-blue-500 disabled:opacity-50"
                    />
                    <div className="flex-1">
                      <div className="flex items-center space-x-2 mb-1">
                        <span className="text-lg">☁️</span>
                        <p className="font-semibold text-gray-900 dark:text-white">
                          Enterprise Cloud Wallet
                          {cloudConfig && (
                            <span className="ml-2 text-xs text-green-600 dark:text-green-400">
                              ✓ Available
                            </span>
                          )}
                        </p>
                      </div>
                      {cloudConfig ? (
                        <>
                          <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                            Connection managed by {cloudConfig.enterpriseAgentName || 'Enterprise Cloud Agent'}.
                            Company-managed enterprise identity.
                          </p>
                          <div className="text-xs text-gray-500 dark:text-gray-500 space-y-1">
                            <p>🏢 Agent: {cloudConfig.enterpriseAgentName || 'Enterprise Agent'}</p>
                            <p>🔗 URL: {cloudConfig.enterpriseAgentUrl || 'N/A'}</p>
                          </div>
                        </>
                      ) : (
                        <p className="text-sm text-gray-500 dark:text-gray-500">
                          ⚠️ Enterprise wallet not configured. Accept a ServiceConfiguration VC to enable.
                        </p>
                      )}
                    </div>
                  </label>
                </div>

                {/* Info Notice */}
                <div className="bg-yellow-50 dark:bg-yellow-900/20 border border-yellow-200 dark:border-yellow-800 rounded-lg p-3">
                  <div className="flex items-start space-x-2">
                    <span className="text-yellow-600 dark:text-yellow-400 text-sm flex-shrink-0 mt-0.5">💡</span>
                    <p className="text-xs text-yellow-800 dark:text-yellow-200">
                      <strong>Choose carefully:</strong> This determines which wallet will store the connection.
                      Personal wallet for private connections, Enterprise wallet for company-managed identities.
                    </p>
                  </div>
                </div>
              </div>
            )}
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
