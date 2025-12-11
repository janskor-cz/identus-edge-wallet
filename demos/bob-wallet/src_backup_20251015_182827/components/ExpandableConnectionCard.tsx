import React, { useState } from 'react';
import { InvitationRecord } from '../utils/InvitationStateManager';
import { ConnectionRequestItem } from '../utils/connectionRequestQueue';
// Simple time formatting utility
const formatTimeAgo = (timestamp: number): string => {
  const now = Date.now();
  const diff = now - timestamp;
  const minutes = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(diff / (1000 * 60 * 60));
  const days = Math.floor(diff / (1000 * 60 * 60 * 24));

  if (minutes < 1) return 'Just now';
  if (minutes < 60) return `${minutes}m ago`;
  if (hours < 24) return `${hours}h ago`;
  return `${days}d ago`;
};

interface ExpandableConnectionCardProps {
  invitation: InvitationRecord;
  onAcceptRequest?: (requestId: string, invitationId: string) => void;
  onRejectRequest?: (requestId: string, invitationId: string) => void;
  className?: string;
}

/**
 * Expandable Connection Card Component
 * Displays invitation status with expandable section for connection requests
 * Implements the user's suggested approach: orange for pending, green for connected
 */
export const ExpandableConnectionCard: React.FC<ExpandableConnectionCardProps> = ({
  invitation,
  onAcceptRequest,
  onRejectRequest,
  className = ""
}) => {
  const [isExpanded, setIsExpanded] = useState(false);

  // Determine status color and display
  const getStatusDisplay = () => {
    switch (invitation.status) {
      // ✅ Alice (Inviter) States
      case 'InvitationGenerated':
        return {
          color: 'bg-orange-100 border-orange-300 text-orange-800',
          icon: '📋',
          text: 'Invitation Generated',
          description: 'Waiting for connection requests'
        };
      case 'ConnectionRequested':
        return {
          color: 'bg-yellow-100 border-yellow-300 text-yellow-800',
          icon: '📞',
          text: 'Connection Requested',
          description: `${invitation.pendingRequests.length} pending request(s)`
        };
      case 'Connected':
        return {
          color: 'bg-green-100 border-green-300 text-green-800',
          icon: '✅',
          text: 'Connected',
          description: 'Connection established'
        };
      case 'Rejected':
        return {
          color: 'bg-red-100 border-red-300 text-red-800',
          icon: '❌',
          text: 'Rejected',
          description: 'Connection was rejected'
        };

      // ✅ Bob (Invitee) States
      case 'InvitationReceived':
        return {
          color: 'bg-blue-100 border-blue-300 text-blue-800',
          icon: '📨',
          text: 'Invitation Received',
          description: 'Invitation pasted and parsed'
        };
      case 'InvitationPreviewed':
        return {
          color: 'bg-purple-100 border-purple-300 text-purple-800',
          icon: '👁️',
          text: 'Invitation Previewed',
          description: 'Reviewing invitation details'
        };
      case 'ConnectionRequestSent':
        return {
          color: 'bg-yellow-100 border-yellow-300 text-yellow-800',
          icon: '📤',
          text: 'Connection Request Sent',
          description: 'Waiting for inviter to accept'
        };
      case 'ConnectionEstablished':
        return {
          color: 'bg-green-100 border-green-300 text-green-800',
          icon: '✅',
          text: 'Connection Established',
          description: 'Connection fully established'
        };
      case 'InvitationRejected':
        return {
          color: 'bg-red-100 border-red-300 text-red-800',
          icon: '❌',
          text: 'Invitation Rejected',
          description: 'You declined this invitation'
        };

      default:
        return {
          color: 'bg-gray-100 border-gray-300 text-gray-800',
          icon: '❓',
          text: 'Unknown',
          description: 'Unknown status'
        };
    }
  };

  const statusDisplay = getStatusDisplay();
  const hasPendingRequests = invitation.pendingRequests.length > 0;

  const handleAccept = (requestId: string) => {
    if (onAcceptRequest) {
      onAcceptRequest(requestId, invitation.invitationId);
    }
  };

  const handleReject = (requestId: string) => {
    if (onRejectRequest) {
      onRejectRequest(requestId, invitation.invitationId);
    }
  };

  const copyToClipboard = async (text: string) => {
    try {
      await navigator.clipboard.writeText(text);
    } catch (error) {
      console.warn('Failed to copy to clipboard:', error);
    }
  };

  return (
    <div className={`border rounded-lg shadow-sm ${statusDisplay.color} ${className}`}>
      {/* Main Card Header */}
      <div
        className="p-4 cursor-pointer"
        onClick={() => setIsExpanded(!isExpanded)}
      >
        <div className="flex items-center justify-between">
          <div className="flex items-center space-x-3">
            <span className="text-xl">{statusDisplay.icon}</span>
            <div>
              <h3 className="font-semibold text-sm">
                {invitation.label || 'DIDComm Invitation'}
              </h3>
              <p className="text-xs opacity-75">
                {statusDisplay.description}
              </p>
            </div>
          </div>
          <div className="flex items-center space-x-2">
            <span className="px-2 py-1 text-xs font-medium rounded-full bg-white bg-opacity-50">
              {statusDisplay.text}
            </span>
            <span className="text-sm">
              {isExpanded ? '🔽' : '▶️'}
            </span>
          </div>
        </div>
      </div>

      {/* Expandable Content */}
      {isExpanded && (
        <div className="border-t bg-white bg-opacity-50 p-4 space-y-4">
          {/* Invitation Details */}
          <div className="space-y-2">
            <h4 className="font-semibold text-sm text-gray-700">Invitation Details</h4>
            <div className="text-xs space-y-1">
              <div className="flex justify-between">
                <span className="font-medium">Created:</span>
                <span>{formatTimeAgo(invitation.createdAt)}</span>
              </div>

              {/* Show previewed timestamp for Bob-side invitations */}
              {invitation.previewedAt && (
                <div className="flex justify-between">
                  <span className="font-medium">Previewed:</span>
                  <span>{formatTimeAgo(invitation.previewedAt)}</span>
                </div>
              )}

              {/* Show accepted/rejected timestamp */}
              {invitation.acceptedAt && (
                <div className="flex justify-between">
                  <span className="font-medium">Accepted:</span>
                  <span>{formatTimeAgo(invitation.acceptedAt)}</span>
                </div>
              )}
              {invitation.rejectedAt && (
                <div className="flex justify-between">
                  <span className="font-medium">Rejected:</span>
                  <span>{formatTimeAgo(invitation.rejectedAt)}</span>
                </div>
              )}

              <div className="flex justify-between">
                <span className="font-medium">Invitation ID:</span>
                <button
                  onClick={() => copyToClipboard(invitation.invitationId)}
                  className="text-blue-600 hover:text-blue-800 underline truncate max-w-32"
                  title="Click to copy"
                >
                  {invitation.invitationId.substring(0, 16)}...
                </button>
              </div>

              {/* Show inviter DID for Alice, invitee DID for Bob */}
              {invitation.inviterDID && (
                <div className="flex justify-between">
                  <span className="font-medium">
                    {invitation.inviterLabel ? 'Inviter' : 'From'} DID:
                  </span>
                  <button
                    onClick={() => copyToClipboard(invitation.inviterDID!)}
                    className="text-blue-600 hover:text-blue-800 underline truncate max-w-32"
                    title="Click to copy"
                  >
                    {invitation.inviterDID.substring(0, 20)}...
                  </button>
                </div>
              )}

              {invitation.inviteeDID && (
                <div className="flex justify-between">
                  <span className="font-medium">My DID:</span>
                  <button
                    onClick={() => copyToClipboard(invitation.inviteeDID!)}
                    className="text-blue-600 hover:text-blue-800 underline truncate max-w-32"
                    title="Click to copy"
                  >
                    {invitation.inviteeDID.substring(0, 20)}...
                  </button>
                </div>
              )}

              {/* Show inviter label for Bob-side invitations */}
              {invitation.inviterLabel && (
                <div className="flex justify-between">
                  <span className="font-medium">Inviter:</span>
                  <span className="font-semibold">{invitation.inviterLabel}</span>
                </div>
              )}

              {/* Show VC proof information for Bob-side invitations */}
              {invitation.hasVCProof && (
                <div className="flex justify-between">
                  <span className="font-medium">VC Proof:</span>
                  <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-green-100 text-green-800">
                    ✅ {invitation.vcProofType || 'Verified'}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* Connection Requests Section */}
          {hasPendingRequests && (
            <div className="space-y-3">
              <h4 className="font-semibold text-sm text-gray-700">
                Pending Connection Requests ({invitation.pendingRequests.length})
              </h4>

              {invitation.pendingRequests.map((request) => (
                <div key={request.id} className="border rounded-md p-3 bg-white">
                  <div className="flex items-center justify-between mb-2">
                    <div className="flex items-center space-x-2">
                      <span className="text-sm">📥</span>
                      <span className="text-xs font-medium text-gray-600">
                        Request from: {request.message.from?.toString().substring(0, 20)}...
                      </span>
                    </div>
                    <span className="text-xs text-gray-500">
                      {formatTimeAgo(request.timestamp)}
                    </span>
                  </div>

                  {/* Request Details */}
                  <div className="text-xs text-gray-600 mb-3">
                    <div>Status: <span className="font-medium">{request.status}</span></div>
                    {request.attachedCredential && (
                      <div className="mt-1">
                        <span className="inline-flex items-center px-2 py-1 rounded-full text-xs bg-blue-100 text-blue-800">
                          🎫 VC Proof Attached
                        </span>
                      </div>
                    )}
                  </div>

                  {/* Action Buttons */}
                  {request.status === 'pending' && (
                    <div className="flex space-x-2">
                      <button
                        onClick={() => handleAccept(request.id)}
                        className="px-3 py-1 text-xs bg-green-600 text-white rounded hover:bg-green-700 transition-colors"
                      >
                        ✅ Accept
                      </button>
                      <button
                        onClick={() => handleReject(request.id)}
                        className="px-3 py-1 text-xs bg-red-600 text-white rounded hover:bg-red-700 transition-colors"
                      >
                        ❌ Reject
                      </button>
                    </div>
                  )}

                  {/* Status Indicator for Processed Requests */}
                  {request.status !== 'pending' && (
                    <div className="text-xs">
                      {request.status === 'accepted' && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full bg-green-100 text-green-800">
                          ✅ Accepted
                        </span>
                      )}
                      {request.status === 'rejected' && (
                        <span className="inline-flex items-center px-2 py-1 rounded-full bg-red-100 text-red-800">
                          ❌ Rejected
                        </span>
                      )}
                    </div>
                  )}
                </div>
              ))}
            </div>
          )}

          {/* No Requests Message */}
          {!hasPendingRequests && invitation.status === 'InvitationGenerated' && (
            <div className="text-center p-4 text-gray-500">
              <p className="text-sm">No connection requests yet</p>
              <p className="text-xs">Share your invitation URL to receive connection requests</p>
            </div>
          )}

          {/* Invitation URL (if available) */}
          {invitation.invitationUrl && (
            <div className="space-y-2">
              <h4 className="font-semibold text-sm text-gray-700">Invitation URL</h4>
              <div className="flex items-center space-x-2">
                <input
                  type="text"
                  value={invitation.invitationUrl}
                  readOnly
                  className="flex-1 px-2 py-1 text-xs border rounded bg-gray-50 font-mono"
                />
                <button
                  onClick={() => copyToClipboard(invitation.invitationUrl!)}
                  className="px-2 py-1 text-xs bg-blue-600 text-white rounded hover:bg-blue-700 transition-colors"
                >
                  📋 Copy
                </button>
              </div>
            </div>
          )}
        </div>
      )}
    </div>
  );
};