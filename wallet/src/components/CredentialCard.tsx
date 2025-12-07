/**
 * Enhanced Credential Card Component
 *
 * Modern credential card with:
 * - Expand/collapse functionality (collapsed by default)
 * - Type-specific layouts (ID card vs Certificate)
 * - Status badges (Valid/Revoked/Expired)
 * - Smooth animations
 *
 * Created: November 2, 2025
 * Purpose: Enhanced visual presentation replacing simple Credential.tsx
 */

import React, { useState } from 'react';
import { ChevronRightIcon, ChevronDownIcon, TrashIcon } from '@heroicons/react/solid';
import { getCredentialLayout } from './CredentialCardTypeLayouts';
import {
  getCredentialType,
  getCredentialHolderName,
  isCredentialExpired
} from '@/utils/credentialTypeDetector';
import { checkCredentialStatus, CredentialStatus } from '@/utils/credentialStatus';

interface CredentialCardProps {
  credential: any;
  onDelete?: (credential: any) => void;
  status?: CredentialStatus;
}

/**
 * Enhanced Credential Card
 *
 * Displays credential in collapsed or expanded state:
 * - Collapsed: Name + Type badge + Status badge + Expand button
 * - Expanded: Full type-specific layout with all details
 */
export function CredentialCard({ credential, onDelete, status }: CredentialCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  // Get credential metadata
  const credentialType = getCredentialType(credential);
  const holderName = getCredentialHolderName(credential);
  const isExpired = isCredentialExpired(credential);

  // Determine overall status
  const displayStatus = isExpired ? 'expired' : (status === 'revoked' ? 'revoked' : 'valid');

  // Get type display name and icon
  const getTypeInfo = () => {
    switch (credentialType) {
      case 'RealPersonIdentity':
        return { name: 'Identity', icon: '🪪', color: 'bg-blue-100 text-blue-800 border-blue-300' };
      case 'SecurityClearance':
        return { name: 'Clearance', icon: '🛡️', color: 'bg-purple-100 text-purple-800 border-purple-300' };
      case 'ServiceConfiguration':
        return { name: 'Enterprise Config', icon: '🏢', color: 'bg-indigo-100 text-indigo-800 border-indigo-300' };
      case 'EmployeeRole':
        return { name: 'Employee Role', icon: '👔', color: 'bg-cyan-100 text-cyan-800 border-cyan-300' };
      default:
        return { name: 'Unknown', icon: '❓', color: 'bg-gray-100 text-gray-800 border-gray-300' };
    }
  };

  const typeInfo = getTypeInfo();

  // Get status badge
  const getStatusBadge = () => {
    switch (displayStatus) {
      case 'valid':
        return <span className="px-2 py-1 text-xs font-semibold bg-green-100 text-green-800 border border-green-300 rounded-full">✓ Valid</span>;
      case 'revoked':
        return <span className="px-2 py-1 text-xs font-semibold bg-red-100 text-red-800 border border-red-300 rounded-full">✗ REVOKED</span>;
      case 'expired':
        return <span className="px-2 py-1 text-xs font-semibold bg-orange-100 text-orange-800 border border-orange-300 rounded-full">⏱️ EXPIRED</span>;
      default:
        return <span className="px-2 py-1 text-xs font-semibold bg-yellow-100 text-yellow-800 border border-yellow-300 rounded-full">? Unknown</span>;
    }
  };

  // Handle delete
  const handleDelete = async (e: React.MouseEvent) => {
    e.stopPropagation(); // Prevent expand/collapse when clicking delete

    if (!onDelete) return;

    const confirmed = window.confirm(`Are you sure you want to delete this credential?\n\n${holderName} (${typeInfo.name})`);

    if (confirmed) {
      setIsDeleting(true);
      try {
        await onDelete(credential);
      } catch (error) {
        console.error('Failed to delete credential:', error);
        alert('Failed to delete credential. Please try again.');
        setIsDeleting(false);
      }
    }
  };

  return (
    <div className={`border-2 rounded-lg overflow-hidden transition-all duration-200 ${
      isExpanded ? 'shadow-lg' : 'shadow-md hover:shadow-lg'
    } ${isDeleting ? 'opacity-50' : ''}`}>
      {/* Collapsed View - Always Visible */}
      <div
        className="bg-white p-4 cursor-pointer hover:bg-gray-50 transition-colors"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          {/* Left: Name + Type */}
          <div className="flex items-center gap-3 flex-1">
            {/* Expand/Collapse Icon */}
            <div className="flex-shrink-0">
              {isExpanded ? (
                <ChevronDownIcon className="w-5 h-5 text-gray-500" />
              ) : (
                <ChevronRightIcon className="w-5 h-5 text-gray-500" />
              )}
            </div>

            {/* Credential Name */}
            <div className="flex-1">
              <div className="font-semibold text-gray-900">{holderName}</div>
              <div className="flex items-center gap-2 mt-1">
                <span className={`px-2 py-0.5 text-xs font-medium border rounded-full ${typeInfo.color}`}>
                  {typeInfo.icon} {typeInfo.name}
                </span>
              </div>
            </div>
          </div>

          {/* Right: Status Badge + Delete Button */}
          <div className="flex items-center gap-3">
            {getStatusBadge()}

            {onDelete && (
              <button
                onClick={handleDelete}
                disabled={isDeleting}
                className="p-2 rounded-lg hover:bg-red-100 text-red-600 hover:text-red-700 transition-colors disabled:opacity-50"
                title="Delete credential"
              >
                <TrashIcon className="w-5 h-5" />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Expanded View - Type-Specific Layout */}
      {isExpanded && (
        <div className="border-t-2 border-gray-200 p-4 bg-gray-50 animate-fadeIn">
          {getCredentialLayout(credential)}

          {/* Issuer Information */}
          <div className="mt-4 pt-4 border-t border-gray-300">
            <div className="text-xs text-gray-600">
              <span className="font-semibold">Issuer:</span>{' '}
              <span className="font-mono">{credential.issuer || 'Unknown'}</span>
            </div>
            {credential.id && (
              <div className="text-xs text-gray-600 mt-1">
                <span className="font-semibold">Credential ID:</span>{' '}
                <span className="font-mono text-xs">{credential.id}</span>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

export default CredentialCard;
