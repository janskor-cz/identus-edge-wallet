import React, { useState } from 'react';
import SDK from '@hyperledger/identus-edge-agent-sdk';
import { copyToClipboardWithLog } from '@/utils/clipboard';
import {
  getConnectionState,
  needsUserAction,
  getStateColor,
  getStateLabel,
} from '@/utils/connectionStates';
import {
  getVCRequestsForConnection,
  getLatestActivity,
  formatTimeAgo,
} from '@/utils/vcRequestTracking';
import { Message } from './Message';
import { VCRequestDialog } from './VCRequestDialog';

interface ConnectionCardProps {
  connection: SDK.Domain.DIDPair;
  messages: SDK.Domain.Message[];
  selfDID?: string;
  onDelete?: (connection: SDK.Domain.DIDPair) => void;
  onSendMessage?: (connection: SDK.Domain.DIDPair) => void;
}

export const ConnectionCard: React.FC<ConnectionCardProps> = ({
  connection,
  messages,
  selfDID,
  onDelete,
  onSendMessage,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [showVCRequestDialog, setShowVCRequestDialog] = useState(false);
  const [expandedStatistic, setExpandedStatistic] = useState<'messages' | 'vcRequests' | null>(null);

  const state = getConnectionState(connection, messages);
  const hasAction = needsUserAction(connection, messages, selfDID);
  const stateColors = getStateColor(state);
  const stateLabel = getStateLabel(state);
  const vcRequests = getVCRequestsForConnection(connection, messages);
  const lastActivity = getLatestActivity(connection, messages);

  // Get connection-specific messages
  const connectionMessages = messages.filter(m =>
    [connection.host.toString(), connection.receiver.toString()].includes(m.from?.toString() || '') ||
    [connection.host.toString(), connection.receiver.toString()].includes(m.to?.toString() || '')
  ).sort((a, b) => {
    const aTime = a.createdTime ? new Date(a.createdTime).getTime() : 0;
    const bTime = b.createdTime ? new Date(b.createdTime).getTime() : 0;
    return bTime - aTime; // Newest first
  });

  const copyToClipboard = async (text: string, label: string) => {
    try {
      await copyToClipboardWithLog(text, label);
    } catch (error) {
      console.error(`Failed to copy ${label}:`, error);
    }
  };

  const handleDelete = () => {
    if (showDeleteConfirm && onDelete) {
      onDelete(connection);
      setShowDeleteConfirm(false);
    } else {
      setShowDeleteConfirm(true);
      setTimeout(() => setShowDeleteConfirm(false), 3000);
    }
  };

  return (
    <div className={`glass-card p-6 mb-4 border-l-4 ${stateColors.border} ${hasAction ? 'ring-2 ring-yellow-500 animate-pulse-slow' : ''} hover:transform hover:scale-105 transition-all duration-300`}>
      {/* Header */}
      <div className={`${stateColors.bg} ${stateColors.text} rounded-lg p-4 text-center mb-4`}>
        <div className="flex items-center justify-between">
          <h2 className="text-2xl font-bold gradient-text">
            {stateColors.badge} {connection.name || 'Unnamed Connection'}
          </h2>
          {hasAction && (
            <span className="px-3 py-1 bg-yellow-500 text-white rounded-full text-xs font-bold animate-pulse">
              ACTION REQUIRED
            </span>
          )}
        </div>
        <div className="flex items-center justify-center space-x-4 mt-2">
          <div className="flex items-center space-x-2">
            <div className={`w-3 h-3 rounded-full ${stateColors.border.replace('border-', 'bg-')} ${hasAction ? 'animate-pulse' : ''}`}></div>
            <span className="text-lg font-semibold">{stateLabel}</span>
          </div>
          <span className="text-sm opacity-70">• {formatTimeAgo(lastActivity)}</span>
        </div>
      </div>

      {/* Action Buttons */}
      <div className="flex space-x-3 mb-4">
        {onSendMessage && (
          <button
            onClick={() => onSendMessage(connection)}
            className="btn-primary flex-1"
          >
            💬 Send Message
          </button>
        )}
        <button
          onClick={() => setShowVCRequestDialog(true)}
          className="px-4 py-2 glass-card border-2 border-blue-500/50 hover:border-blue-500 hover:bg-blue-500/10 transition-all duration-300 rounded-lg"
        >
          📋 Request VC
        </button>
        <button
          onClick={() => setIsExpanded(!isExpanded)}
          className="px-4 py-2 glass-card border-2 border-white/20 hover:border-white/40 transition-all duration-300 rounded-lg"
        >
          {isExpanded ? '🔼 Hide' : '🔽 Details'}
        </button>
        {onDelete && (
          <button
            onClick={handleDelete}
            className={`px-4 py-2 glass-card border-2 ${showDeleteConfirm ? 'border-red-500 bg-red-500/20' : 'border-white/20'} hover:border-red-500 transition-all duration-300 rounded-lg`}
          >
            {showDeleteConfirm ? '⚠️ Confirm?' : '🗑️'}
          </button>
        )}
      </div>

      {/* Expanded Details */}
      {isExpanded && (
        <div className="space-y-4 animate-fadeIn">
          {/* VC Requests Section */}
          {vcRequests.length > 0 && (
            <div className="glass-card p-4">
              <h3 className="text-lg font-bold mb-3">📋 VC Requests ({vcRequests.length})</h3>
              <div className="space-y-3">
                {vcRequests.map((req, idx) => (
                  <div key={req.requestId} className="glass-card p-3 border border-white/10">
                    <div className="flex items-center justify-between mb-2">
                      <span className={`text-sm font-semibold ${req.direction === 'RECEIVED' ? 'text-yellow-500' : 'text-blue-500'}`}>
                        {req.direction === 'RECEIVED' ? '⬅️ Received' : '➡️ Sent'}
                      </span>
                      <span className={`text-xs px-2 py-1 rounded-full ${req.status === 'PENDING' ? 'bg-yellow-500/20 text-yellow-500' : 'bg-green-500/20 text-green-500'}`}>
                        {req.status}
                      </span>
                    </div>
                    <p className="text-sm opacity-80 mb-2">{req.requestType}</p>
                    <p className="text-xs opacity-60">{formatTimeAgo(req.createdAt)}</p>

                    {/* Show the actual message component for received requests */}
                    {req.direction === 'RECEIVED' && req.status === 'PENDING' && (
                      <div className="mt-3 border-t border-white/10 pt-3">
                        <Message message={req.message} />
                      </div>
                    )}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Technical Details */}
          <div className="glass-card p-4">
            <h3 className="text-lg font-bold mb-3">🔧 Technical Details</h3>
            <div className="space-y-3">
              <div className="glass-card p-3 border border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold opacity-80">
                    Host DID (Your Identity)
                  </label>
                  <button
                    onClick={() => copyToClipboard(connection.host.toString(), 'Host DID')}
                    className="text-sm opacity-60 hover:opacity-100 transition-opacity"
                  >
                    📋 Copy
                  </button>
                </div>
                <p className="text-xs font-mono opacity-70 break-all glass-card p-2 border border-white/10">
                  {connection.host.toString()}
                </p>
              </div>

              <div className="glass-card p-3 border border-white/10">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm font-semibold opacity-80">
                    Receiver DID (Connected Party)
                  </label>
                  <button
                    onClick={() => copyToClipboard(connection.receiver.toString(), 'Receiver DID')}
                    className="text-sm opacity-60 hover:opacity-100 transition-opacity"
                  >
                    📋 Copy
                  </button>
                </div>
                <p className="text-xs font-mono opacity-70 break-all glass-card p-2 border border-white/10">
                  {connection.receiver.toString()}
                </p>
              </div>
            </div>
          </div>

          {/* Enhanced Connection Statistics */}
          <div className="glass-card p-4">
            <h3 className="text-lg font-bold mb-3">📊 Connection Statistics</h3>
            <div className="grid grid-cols-2 gap-3">
              {/* Total Messages Card */}
              <div
                className="glass-card p-3 text-center cursor-pointer hover:bg-white/10 transition-all duration-300 border-2 border-transparent hover:border-blue-500/50"
                onClick={() => setExpandedStatistic(expandedStatistic === 'messages' ? null : 'messages')}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-2xl font-bold text-blue-500">{connectionMessages.length}</div>
                  <div className="text-sm text-blue-500">
                    {expandedStatistic === 'messages' ? '🔼' : '🔽'}
                  </div>
                </div>
                <div className="text-xs opacity-70">Total Messages</div>
                {connectionMessages.length > 0 && (
                  <div className="text-xs text-blue-400 mt-1">Click to view</div>
                )}
              </div>

              {/* VC Requests Card */}
              <div
                className="glass-card p-3 text-center cursor-pointer hover:bg-white/10 transition-all duration-300 border-2 border-transparent hover:border-green-500/50"
                onClick={() => setExpandedStatistic(expandedStatistic === 'vcRequests' ? null : 'vcRequests')}
              >
                <div className="flex items-center justify-between mb-2">
                  <div className="text-2xl font-bold text-green-500">{vcRequests.length}</div>
                  <div className="text-sm text-green-500">
                    {expandedStatistic === 'vcRequests' ? '🔼' : '🔽'}
                  </div>
                </div>
                <div className="text-xs opacity-70">VC Requests</div>
                {vcRequests.length > 0 && (
                  <div className="text-xs text-green-400 mt-1">Click to manage</div>
                )}
              </div>
            </div>

            {/* Expanded Messages Section */}
            {expandedStatistic === 'messages' && (
              <div className="mt-4 animate-fadeIn">
                <h4 className="text-md font-bold mb-3 text-blue-500">💬 All Messages ({connectionMessages.length})</h4>
                {connectionMessages.length === 0 ? (
                  <div className="text-center py-4 opacity-70">
                    <div className="text-2xl mb-2">📭</div>
                    <p className="text-sm">No messages yet</p>
                  </div>
                ) : (
                  <div className="max-h-96 overflow-y-auto space-y-2">
                    {connectionMessages.map((msg, idx) => (
                      <div key={`msg-${idx}`} className="glass-card p-3 border border-white/10">
                        <div className="flex items-center justify-between mb-2">
                          <span className="text-xs opacity-60">
                            {msg.direction === 'SENT' ? '➡️ Sent' : '⬅️ Received'}
                          </span>
                          <span className="text-xs opacity-60">
                            {msg.createdTime ? new Date(msg.createdTime).toLocaleString() : 'Unknown time'}
                          </span>
                        </div>
                        <Message message={msg} />
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Expanded VC Requests Section */}
            {expandedStatistic === 'vcRequests' && (
              <div className="mt-4 animate-fadeIn">
                <h4 className="text-md font-bold mb-3 text-green-500">📋 VC Request Management ({vcRequests.length})</h4>
                {vcRequests.length === 0 ? (
                  <div className="text-center py-4 opacity-70">
                    <div className="text-2xl mb-2">📋</div>
                    <p className="text-sm">No VC requests</p>
                  </div>
                ) : (
                  <div className="max-h-96 overflow-y-auto space-y-3">
                    {vcRequests.map((req, idx) => (
                      <div key={`req-${idx}`} className="glass-card p-3 border border-white/10">
                        <div className="flex items-center justify-between mb-2">
                          <span className={`text-sm font-semibold ${req.direction === 'RECEIVED' ? 'text-yellow-500' : 'text-blue-500'}`}>
                            {req.direction === 'RECEIVED' ? '⬅️ Received Request' : '➡️ Sent Request'}
                          </span>
                          <span className={`text-xs px-2 py-1 rounded-full ${req.status === 'PENDING' ? 'bg-yellow-500/20 text-yellow-500' : 'bg-green-500/20 text-green-500'}`}>
                            {req.status}
                          </span>
                        </div>
                        <p className="text-sm opacity-80 mb-2">{req.requestType}</p>
                        <p className="text-xs opacity-60 mb-3">
                          {req.createdAt ? req.createdAt.toLocaleString() : 'Unknown time'}
                        </p>

                        {/* Action buttons for pending received requests */}
                        {req.direction === 'RECEIVED' && req.status === 'PENDING' && (
                          <div className="border-t border-white/10 pt-3">
                            <Message message={req.message} />
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
        </div>
      )}

      {/* VC Request Dialog */}
      <VCRequestDialog
        connection={connection}
        isOpen={showVCRequestDialog}
        onClose={() => setShowVCRequestDialog(false)}
        onRequestSent={() => {
          console.log('VC request sent successfully');
          // Could refresh VC requests or show a success notification here
        }}
      />
    </div>
  );
};