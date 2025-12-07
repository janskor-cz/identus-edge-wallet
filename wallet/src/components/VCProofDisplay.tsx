import React, { useState } from 'react';
import { InviterIdentity, FIELD_LABELS } from '../types/invitations';

interface VCProofDisplayProps {
  inviterIdentity: InviterIdentity;
  className?: string;
}

/**
 * VCProofDisplay Component
 *
 * Displays Verifiable Credential proof information with the following features:
 * - ALWAYS shows VC contents regardless of verification status
 * - Smart badge display based on validation result
 * - Revealed claims/data display with human-readable labels
 * - Credential metadata (issuer, dates, type)
 * - Expandable raw JSON view for technical inspection
 * - Copy-to-clipboard for DIDs
 *
 * This component implements the core design principle: Users must see what the
 * inviter is sharing, even if the credential uses a different schema or fails validation.
 */
export const VCProofDisplay: React.FC<VCProofDisplayProps> = ({
  inviterIdentity,
  className = ''
}) => {
  const [showRawVC, setShowRawVC] = useState(false);

  const { isVerified, vcProof, validationResult, revealedData } = inviterIdentity;

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await navigator.clipboard.writeText(text);
      alert(`${label} copied to clipboard!`);
    } catch (error) {
      console.error('Failed to copy:', error);
    }
  };

  return (
    <div className={`vc-proof-display space-y-4 ${className}`}>
      {/* Credential Type */}
      <div>
        <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase mb-1">
          Credential Type:
        </p>
        <p className="text-base font-medium text-gray-900 dark:text-white">
          {vcProof.type?.join(', ') || 'Unknown Type'}
        </p>
      </div>

      {/* Issuer Information */}
      {validationResult.issuer && (
        <div>
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase mb-1">
            Issued By:
          </p>
          <div className="flex items-center space-x-2">
            <p className="flex-1 font-mono text-xs text-gray-800 dark:text-gray-200 bg-gray-100 dark:bg-gray-800 px-2 py-1 rounded break-all">
              {validationResult.issuer}
            </p>
            <button
              onClick={() => copyToClipboard(validationResult.issuer!, 'Issuer DID')}
              className="flex-shrink-0 p-1 text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-900 rounded"
              title="Copy Issuer DID"
            >
              📋
            </button>
          </div>
        </div>
      )}

      {/* Revealed Claims - ALWAYS DISPLAY regardless of verification status */}
      {revealedData && Object.keys(revealedData).length > 0 && (
        <div>
          <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase mb-2">
            Credential Data:
          </p>
          <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-600 rounded-lg p-3 space-y-2">
            {Object.entries(revealedData).map(([field, value]) => (
              <div key={field} className="flex justify-between items-center">
                <span className="text-sm font-medium text-gray-600 dark:text-gray-400">
                  • {FIELD_LABELS[field as keyof typeof FIELD_LABELS] || field}:
                </span>
                <span className="text-sm text-gray-900 dark:text-white font-semibold">
                  {value}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Credential Dates */}
      <div className="grid grid-cols-2 gap-4 text-sm">
        {validationResult.issuedAt && (
          <div>
            <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">
              Issued:
            </p>
            <p className="text-gray-900 dark:text-white">
              {new Date(validationResult.issuedAt).toLocaleDateString()}
            </p>
          </div>
        )}
        {validationResult.expiresAt && (
          <div>
            <p className="text-xs font-semibold text-gray-600 dark:text-gray-400 uppercase">
              Expires:
            </p>
            <p className="text-gray-900 dark:text-white">
              {new Date(validationResult.expiresAt).toLocaleDateString()}
            </p>
          </div>
        )}
      </div>

      {/* Show Raw Data Button */}
      <button
        onClick={() => setShowRawVC(!showRawVC)}
        className="w-full text-sm text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 font-medium transition-colors"
      >
        {showRawVC ? '▲ Hide Raw Data' : '▼ Show Raw Data'}
      </button>

      {/* Raw VC Data */}
      {showRawVC && vcProof && (
        <div className="bg-gray-900 dark:bg-black rounded-lg p-4 overflow-x-auto">
          <pre className="text-xs text-green-400 font-mono">
            {JSON.stringify(vcProof, null, 2)}
          </pre>
        </div>
      )}

      {/* Verification Notes - Show errors/warnings if present */}
      {validationResult.errors && validationResult.errors.length > 0 && (
        <div className="bg-amber-50 dark:bg-amber-900/30 border border-amber-200 dark:border-amber-700 rounded-lg p-4">
          <h4 className="text-sm font-semibold text-amber-800 dark:text-amber-200 mb-2">
            ⚠️ Verification Notes:
          </h4>
          <ul className="text-sm text-amber-700 dark:text-amber-300 space-y-1">
            {validationResult.errors.map((error, index) => (
              <li key={index}>• {error}</li>
            ))}
          </ul>
        </div>
      )}
    </div>
  );
};
