import React, { useEffect, useRef, useState } from 'react';
import SDK from '@hyperledger/identus-edge-agent-sdk';
import { useMountedApp } from '@/reducers/store';
import { ChatMessage, MessageStatus } from '@/reducers/app';
import { SecurityLevel, SECURITY_LEVEL_NAMES, parseSecurityLevel } from '../utils/securityLevels';
import { getVCClearanceLevel } from '../utils/keyVCBinding';
import { SecurityLevelSelector } from './SecurityLevelSelector';
import { EncryptedMessageBadge } from './EncryptedMessageBadge';

interface ChatProps {
  messages: SDK.Domain.Message[];
  connection: SDK.Domain.DIDPair;
  onSendMessage: (content: string, toDID: string, securityLevel?: SecurityLevel) => Promise<void>;
}

export const Chat: React.FC<ChatProps> = ({ messages, connection, onSendMessage }) => {
  const app = useMountedApp();
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const [messageText, setMessageText] = useState('');
  const [isSending, setIsSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [selectedSecurityLevel, setSelectedSecurityLevel] = useState<SecurityLevel>(SecurityLevel.UNCLASSIFIED);

  const selfDID = app.agent.selfDID?.toString();
  // Determine the other party's DID for this connection
  // If selfDID matches the host, then the other DID is the receiver, and vice versa
  const otherDID = connection.host.toString() === selfDID
    ? connection.receiver.toString()
    : connection.host.toString();

  // Get user's maximum security clearance level
  const userSecurityClearanceVC = app.credentials.find(
    (cred: any) => {
      try {
        const types = cred.type || [];
        return types.includes('SecurityClearanceCredential') || types.includes('SecurityClearance');
      } catch (e) {
        return false;
      }
    }
  );
  const userMaxLevel = userSecurityClearanceVC
    ? getVCClearanceLevel(userSecurityClearanceVC)
    : SecurityLevel.UNCLASSIFIED;

  // Auto-scroll to bottom when new messages arrive
  useEffect(() => {
    scrollToBottom();
  }, [messages]);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  const handleSendMessage = async () => {
    if (!messageText.trim() || isSending) return;

    const messageContent = messageText;
    setMessageText(''); // Clear input immediately
    setIsSending(true);
    setSendError(null);

    try {
      await onSendMessage(messageContent, otherDID, selectedSecurityLevel);
      // Message sent successfully - reset to unclassified
      setSelectedSecurityLevel(SecurityLevel.UNCLASSIFIED);
    } catch (error: any) {
      // On error, restore the message text so user can retry
      setMessageText(messageContent);
      setSendError(error.message || 'Failed to send message. Please try again.');
      console.error('Failed to send message:', error);
    } finally {
      setIsSending(false);
    }
  };

  const handleKeyPress = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  };

  // Parse message body content (handles both plaintext and encrypted)
  const getMessageContent = (message: SDK.Domain.Message): string => {
    try {
      // Check if message was decrypted by handleMessages
      if ((message as any).decrypted === true) {
        return message.body?.toString() || '';
      }

      // Check for decryption errors
      if ((message as any).decryptionError) {
        return getDecryptionErrorMessage((message as any).decryptionError);
      }

      // Parse normal plaintext message
      const body = typeof message.body === 'string'
        ? JSON.parse(message.body)
        : message.body;

      // Check if body indicates encryption (not yet decrypted)
      if (body?.encrypted === true) {
        return '🔒 ENCRYPTED MESSAGE - Unable to decrypt';
      }

      return body.content || '';
    } catch (e) {
      return message.body?.toString() || '';
    }
  };

  // Get decryption error message for display
  const getDecryptionErrorMessage = (errorCode: string): string => {
    switch (errorCode) {
      case 'NO_CLEARANCE':
        return '🔒 ENCRYPTED - You do not have a Security Clearance credential';
      case 'INSUFFICIENT_CLEARANCE':
        return '🔒 CLASSIFIED - Insufficient Security Clearance';
      case 'KEY_NOT_FOUND':
        return '🔒 ENCRYPTED - Decryption key unavailable (credential may be revoked)';
      case 'DECRYPTION_FAILED':
        return '🔒 ENCRYPTED - Decryption failed';
      case 'SENDER_VC_NOT_FOUND':
        return '🔒 ENCRYPTED - Cannot verify sender\'s credentials';
      case 'VC_INVALID':
        return '🔒 ENCRYPTED - Invalid Security Clearance credential';
      default:
        return '🔒 ENCRYPTED - Unable to decrypt message';
    }
  };

  // Check if message is encrypted
  const isEncryptedMessage = (message: SDK.Domain.Message): boolean => {
    try {
      const body = typeof message.body === 'string'
        ? JSON.parse(message.body)
        : message.body;
      return body?.encrypted === true || (message as any).decryptionError !== undefined;
    } catch (e) {
      return false;
    }
  };

  // Get security level from message
  const getMessageSecurityLevel = (message: SDK.Domain.Message): SecurityLevel => {
    try {
      // Check if level was set during decryption
      if ((message as any).securityLevel !== undefined) {
        return (message as any).securityLevel;
      }

      // Check extraHeaders
      const extraHeaders = (message as any).extraHeaders;
      if (extraHeaders?.securityLevel) {
        return parseSecurityLevel(extraHeaders.securityLevel);
      }

      return SecurityLevel.UNCLASSIFIED;
    } catch (e) {
      return SecurityLevel.UNCLASSIFIED;
    }
  };

  // Check if user can decrypt the message
  const canDecryptMessage = (message: SDK.Domain.Message): boolean => {
    // If message was successfully decrypted, user can read it
    if ((message as any).decrypted === true) {
      return true;
    }

    // If there's a decryption error, user cannot read it
    if ((message as any).decryptionError) {
      return false;
    }

    // Plaintext messages are always readable
    return true;
  };

  // Format timestamp
  const formatTime = (message: SDK.Domain.Message): string => {
    if (!message.createdTime) {
      return 'No time';
    }

    const date = new Date(message.createdTime);

    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
      second: '2-digit'
    });
  };

  // Filter only basic messages for chat display
  const chatMessages = messages.filter(
    msg => msg.piuri === 'https://didcomm.org/basicmessage/2.0/message'
  );

  // Determine if message is from self using DID comparison
  const isOwnMessage = (message: SDK.Domain.Message): boolean => {
    const messageFromDID = message.from?.toString();
    const myDID = connection.host.toString(); // This wallet's DID in the connection


    return messageFromDID === myDID;
  };

  return (
    <div className="flex flex-col h-full max-h-[600px] bg-white dark:bg-gray-800 rounded-lg shadow-lg">
      {/* Chat Header */}
      <div className="bg-gradient-to-r from-blue-500 to-blue-600 text-white p-4 rounded-t-lg">
        <h3 className="text-lg font-semibold">
          💬 Chat with {connection.name || 'Unknown Contact'}
        </h3>
        <p className="text-xs opacity-80 truncate">
          {otherDID.substring(0, 50)}...
        </p>
      </div>

      {/* Messages Container */}
      <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-gray-50 dark:bg-gray-900">
        {chatMessages.length === 0 ? (
          <div className="text-center text-gray-500 dark:text-gray-400 py-8">
            <p>No messages yet. Start a conversation!</p>
          </div>
        ) : (
          chatMessages.map((message) => {
            const isOwn = isOwnMessage(message);
            const content = getMessageContent(message);
            const time = formatTime(message);
            const isEncrypted = isEncryptedMessage(message);
            const securityLevel = getMessageSecurityLevel(message);
            const canDecrypt = canDecryptMessage(message);
            const hasDecryptionError = (message as any).decryptionError !== undefined;

            return (
              <div
                key={message.id}
                className={`flex ${isOwn ? 'justify-end' : 'justify-start'}`}
              >
                <div
                  className={`max-w-xs lg:max-w-md px-4 py-2 rounded-lg ${
                    isOwn
                      ? 'bg-blue-500 text-white'
                      : 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white border border-gray-200 dark:border-gray-700'
                  }`}
                >
                  {/* Security Level Badge (for encrypted messages) */}
                  {isEncrypted && securityLevel !== SecurityLevel.UNCLASSIFIED && (
                    <div className="mb-2">
                      <EncryptedMessageBadge level={securityLevel} canDecrypt={canDecrypt} />
                    </div>
                  )}

                  {/* Message Content */}
                  <p
                    className={`text-sm break-words ${
                      hasDecryptionError ? 'italic text-gray-400' : ''
                    }`}
                  >
                    {content}
                  </p>

                  {/* Timestamp */}
                  <div
                    className={`text-xs mt-1 ${
                      isOwn ? 'text-blue-100' : 'text-gray-500 dark:text-gray-400'
                    }`}
                  >
                    {time}
                    {isOwn && (
                      <span className="ml-2">
                        {/* Add status indicators here if needed */}
                        ✓✓
                      </span>
                    )}
                  </div>
                </div>
              </div>
            );
          })
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Error Message */}
      {sendError && (
        <div className="px-4 py-2 bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-200 text-sm">
          {sendError}
        </div>
      )}

      {/* Message Input */}
      <div className="border-t border-gray-200 dark:border-gray-700 p-4">
        {/* Security Level Selector */}
        <SecurityLevelSelector
          selectedLevel={selectedSecurityLevel}
          userMaxLevel={userMaxLevel}
          onChange={setSelectedSecurityLevel}
          disabled={isSending}
        />

        {/* Message Input and Send Button */}
        <div className="flex space-x-2">
          <input
            type="text"
            value={messageText}
            onChange={(e) => setMessageText(e.target.value)}
            onKeyPress={handleKeyPress}
            placeholder="Type a message..."
            disabled={isSending}
            className="flex-1 px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-full
                     bg-white dark:bg-gray-800 text-gray-900 dark:text-white
                     focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                     disabled:opacity-50 disabled:cursor-not-allowed"
          />
          <button
            onClick={handleSendMessage}
            disabled={!messageText.trim() || isSending}
            className="px-6 py-2 bg-blue-500 hover:bg-blue-600 disabled:bg-gray-400
                     text-white rounded-full transition-colors duration-200
                     disabled:cursor-not-allowed focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {isSending ? (
              <span className="flex items-center">
                <svg className="animate-spin h-4 w-4 mr-2" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                </svg>
                Sending...
              </span>
            ) : (
              'Send'
            )}
          </button>
        </div>
      </div>
    </div>
  );
};