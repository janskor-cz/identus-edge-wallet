import React from 'react';
import { CredentialStatus } from '@/utils/credentialStatus';

/**
 * RevocationStatusBadge Component
 *
 * Displays credential revocation status consistently across the application.
 * Supports multiple status states with appropriate visual indicators and optional tooltip details.
 *
 * @example
 * ```tsx
 * <RevocationStatusBadge
 *   status={credentialStatus}
 *   compact={false}
 *   showTimestamp={true}
 *   className="mb-4"
 * />
 * ```
 */

interface RevocationStatusBadgeProps {
  /**
   * Credential status object from credentialStatus.ts utility
   * If null, no badge is displayed
   */
  status: CredentialStatus | null;

  /**
   * Optional compact mode for smaller display (reduces padding and font size)
   * @default false
   */
  compact?: boolean;

  /**
   * Optional timestamp display showing when status was last checked
   * @default false
   */
  showTimestamp?: boolean;

  /**
   * Optional additional CSS classes to apply to the badge container
   */
  className?: string;
}

/**
 * Formats ISO timestamp to human-readable format
 */
const formatTimestamp = (isoString: string): string => {
  try {
    const date = new Date(isoString);
    return date.toLocaleString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      hour12: true
    });
  } catch {
    return 'Unknown';
  }
};

/**
 * Generates tooltip content with full status details
 */
const getTooltipContent = (status: CredentialStatus): string => {
  const lines = [
    `Status Purpose: ${status.statusPurpose}`,
    `Revoked: ${status.revoked ? 'Yes' : 'No'}`,
    `Suspended: ${status.suspended ? 'Yes' : 'No'}`,
    `Checked At: ${formatTimestamp(status.checkedAt)}`
  ];

  if (status.error) {
    lines.push(`Error: ${status.error}`);
  }

  return lines.join('\n');
};

export default function RevocationStatusBadge({
  status,
  compact = false,
  showTimestamp = false,
  className = ''
}: RevocationStatusBadgeProps): JSX.Element | null {
  // Don't render if no status provided
  if (!status) {
    return null;
  }

  // Determine badge configuration based on status
  const getBadgeConfig = () => {
    // Priority 1: Revoked status (highest priority)
    if (status.revoked) {
      return {
        icon: '✗',
        label: 'REVOKED',
        bgColor: 'bg-red-100 dark:bg-red-900/20',
        textColor: 'text-red-800 dark:text-red-200',
        borderColor: 'border-red-200 dark:border-red-800',
        description: 'This credential has been revoked by the issuer'
      };
    }

    // Priority 2: Suspended status
    if (status.suspended) {
      return {
        icon: '⚠',
        label: 'SUSPENDED',
        bgColor: 'bg-orange-100 dark:bg-orange-900/20',
        textColor: 'text-orange-800 dark:text-orange-200',
        borderColor: 'border-orange-200 dark:border-orange-800',
        description: 'This credential has been temporarily suspended by the issuer'
      };
    }

    // Priority 3: Error status
    if (status.statusPurpose === 'error' || status.error) {
      return {
        icon: '⚠',
        label: 'Error',
        bgColor: 'bg-gray-100 dark:bg-gray-700',
        textColor: 'text-gray-800 dark:text-gray-200',
        borderColor: 'border-gray-200 dark:border-gray-600',
        description: `Status check failed: ${status.error || 'Unknown error'}`
      };
    }

    // Priority 4: Unknown status (no credentialStatus property)
    if (status.statusPurpose === 'none') {
      return {
        icon: '?',
        label: 'Unknown',
        bgColor: 'bg-yellow-100 dark:bg-yellow-900/20',
        textColor: 'text-yellow-800 dark:text-yellow-200',
        borderColor: 'border-yellow-200 dark:border-yellow-800',
        description: 'This credential does not include revocation status information'
      };
    }

    // Priority 5: Valid status (default for revocation/suspension purposes)
    return {
      icon: '✓',
      label: 'Valid',
      bgColor: 'bg-green-100 dark:bg-green-900/20',
      textColor: 'text-green-800 dark:text-green-200',
      borderColor: 'border-green-200 dark:border-green-800',
      description: 'This credential is valid and not revoked'
    };
  };

  const badgeConfig = getBadgeConfig();

  // Size classes based on compact mode
  const sizeClasses = compact
    ? 'px-2 py-0.5 text-xs'
    : 'px-3 py-1 text-sm';

  return (
    <div className={className}>
      <span
        className={`inline-flex items-center rounded-full font-medium border ${sizeClasses} ${badgeConfig.bgColor} ${badgeConfig.textColor} ${badgeConfig.borderColor}`}
        title={getTooltipContent(status)}
        style={{ cursor: 'help' }}
      >
        <span className="mr-1">{badgeConfig.icon}</span>
        <span>{badgeConfig.label}</span>
      </span>

      {showTimestamp && (
        <div className={`mt-1 ${compact ? 'text-xs' : 'text-sm'} text-gray-500 dark:text-gray-400`}>
          Checked at: {formatTimestamp(status.checkedAt)}
        </div>
      )}
    </div>
  );
}
