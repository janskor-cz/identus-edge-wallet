import React, { useState } from 'react';
import SDK from '@hyperledger/identus-edge-agent-sdk';
import { useMountedApp } from '@/reducers/store';

interface CredentialOfferProps {
  message: SDK.Domain.Message;
}

interface CredentialAttribute {
  name: string;
  value: string;
}

interface CredentialPreview {
  body: {
    attributes: CredentialAttribute[];
  };
  schema_id: string;
  type: string;
}

export const CredentialOffer: React.FC<CredentialOfferProps> = ({ message }) => {
  const app = useMountedApp();
  const [isProcessing, setIsProcessing] = useState(false);
  const [isAccepted, setIsAccepted] = useState(false);
  const [isRejected, setIsRejected] = useState(false);

  // Parse the credential offer from message body
  let credentialPreview: CredentialPreview | null = null;
  let issuerDID = '';
  let goalCode = '';

  try {
    const body = typeof message.body === 'string' ? JSON.parse(message.body) : message.body;
    credentialPreview = body.credential_preview;
    goalCode = body.goal_code || 'Credential Offer';
    issuerDID = message.from?.toString() || '';
  } catch (error) {
    console.error('Error parsing credential offer:', error);
    return (
      <div className="p-4 border border-red-200 rounded-lg bg-red-50">
        <p className="text-red-600">Error parsing credential offer</p>
      </div>
    );
  }

  if (!credentialPreview) {
    return (
      <div className="p-4 border border-yellow-200 rounded-lg bg-yellow-50">
        <p className="text-yellow-600">Invalid credential offer format</p>
      </div>
    );
  }

  const handleAccept = async () => {
    if (!app.agent || isProcessing) return;

    setIsProcessing(true);
    try {
      console.log('🟢 Accepting credential offer:', message.id);
      await app.acceptCredentialOffer({
        agent: app.agent,
        message: message
      });
      setIsAccepted(true);
      console.log('✅ Credential offer accepted successfully');
    } catch (error) {
      console.error('❌ Error accepting credential offer:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const handleReject = async () => {
    if (!app.agent || isProcessing) return;

    setIsProcessing(true);
    try {
      console.log('🔴 Rejecting credential offer:', message.id);
      await app.rejectCredentialOffer({
        agent: app.agent,
        message: message
      });
      setIsRejected(true);
      console.log('✅ Credential offer rejected successfully');
    } catch (error) {
      console.error('❌ Error rejecting credential offer:', error);
    } finally {
      setIsProcessing(false);
    }
  };

  const formatDID = (did: string) => {
    return did.length > 60 ? `${did.substring(0, 60)}...` : did;
  };

  const formatAttribute = (attr: CredentialAttribute) => {
    const name = attr.name.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase());
    return `${name}: ${attr.value}`;
  };

  if (isAccepted) {
    return (
      <div className="p-4 border border-green-200 rounded-lg bg-green-50">
        <div className="flex items-center space-x-2">
          <span className="text-green-600 text-lg">✅</span>
          <div>
            <h3 className="font-semibold text-green-800">Credential Offer Accepted</h3>
            <p className="text-green-600 text-sm">The credential will be issued and stored in your wallet.</p>
          </div>
        </div>
      </div>
    );
  }

  if (isRejected) {
    return (
      <div className="p-4 border border-gray-200 rounded-lg bg-gray-50">
        <div className="flex items-center space-x-2">
          <span className="text-gray-600 text-lg">❌</span>
          <div>
            <h3 className="font-semibold text-gray-800">Credential Offer Rejected</h3>
            <p className="text-gray-600 text-sm">This credential offer has been declined.</p>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6 border border-blue-200 rounded-lg bg-blue-50 shadow-sm">
      {/* Header */}
      <div className="flex items-center space-x-2 mb-4">
        <span className="text-blue-600 text-xl">🎫</span>
        <div>
          <h3 className="text-lg font-semibold text-blue-900">{goalCode}</h3>
          <p className="text-sm text-blue-600">ID: {message.id}</p>
        </div>
      </div>

      {/* Issuer Information */}
      <div className="mb-4">
        <h4 className="font-medium text-gray-700 mb-2">Issuer:</h4>
        <div className="bg-white p-3 rounded border">
          <p className="text-sm font-mono text-gray-600" title={issuerDID}>
            {formatDID(issuerDID)}
          </p>
        </div>
      </div>

      {/* Credential Preview */}
      <div className="mb-6">
        <h4 className="font-medium text-gray-700 mb-2">Credential Information:</h4>
        <div className="bg-white p-4 rounded border space-y-2">
          {credentialPreview.body.attributes.map((attr, index) => (
            <div key={index} className="flex justify-between py-1">
              <span className="font-medium text-gray-700">
                {attr.name.replace(/([A-Z])/g, ' $1').replace(/^./, str => str.toUpperCase())}:
              </span>
              <span className="text-gray-900">{attr.value}</span>
            </div>
          ))}
        </div>
      </div>

      {/* Schema Information */}
      {credentialPreview.schema_id && (
        <div className="mb-6">
          <h4 className="font-medium text-gray-700 mb-2">Schema:</h4>
          <div className="bg-white p-3 rounded border">
            <p className="text-xs font-mono text-gray-600 break-all">
              {credentialPreview.schema_id}
            </p>
          </div>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex space-x-4">
        <button
          onClick={handleAccept}
          disabled={isProcessing}
          className="flex-1 bg-green-600 hover:bg-green-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded transition-colors"
        >
          {isProcessing ? '⏳ Processing...' : '🎫 Accept Credential'}
        </button>
        <button
          onClick={handleReject}
          disabled={isProcessing}
          className="flex-1 bg-red-600 hover:bg-red-700 disabled:bg-gray-400 text-white font-medium py-2 px-4 rounded transition-colors"
        >
          {isProcessing ? '⏳ Processing...' : '❌ Reject Credential'}
        </button>
      </div>

      {/* Processing Status */}
      {isProcessing && (
        <div className="mt-4 p-3 bg-yellow-50 border border-yellow-200 rounded">
          <p className="text-yellow-800 text-sm">Processing your request...</p>
        </div>
      )}
    </div>
  );
};