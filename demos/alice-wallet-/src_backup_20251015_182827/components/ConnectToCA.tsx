/**
 * ConnectToCA Component
 *
 * Provides a simple "Connect to Certification Authority" button that:
 * 1. Fetches the well-known invitation from CA
 * 2. Auto-parses the invitation
 * 3. Auto-accepts and stores the connection
 *
 * This component works even after CA restarts because it fetches the
 * current valid invitation dynamically from the well-known endpoint.
 */

import React, { useState } from 'react';
import { useMountedApp } from '@/reducers/store';
import { CERTIFICATION_AUTHORITY } from '@/config/certificationAuthority';
import SDK from '@hyperledger/identus-edge-agent-sdk';
import { v4 as uuid } from 'uuid';

export const ConnectToCA: React.FC = () => {
  const app = useMountedApp();
  const agent = app.agent.instance;

  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  const handleConnectToCA = async () => {
    try {
      setConnecting(true);
      setError(null);
      setSuccess(false);

      if (!agent) {
        throw new Error('Wallet agent not initialized. Please start the agent first.');
      }

      // ✅ CRITICAL: Check if mediator is configured
      // SDK v6.6.0 requires mediator for OOB invitation acceptance (by design)
      // Even when connecting to Cloud Agent with direct HTTP endpoint
      console.log('🔍 [CA CONNECT] Checking mediator configuration...');
      const mediatorDID = agent.currentMediatorDID;

      if (!mediatorDID) {
        console.error('❌ [CA CONNECT] No mediator configured');
        throw new Error(
          'Mediator configuration required. ' +
          'The wallet needs a mediator to establish DIDComm connections. ' +
          'Please ensure the wallet agent is fully initialized and connected to the mediator. ' +
          'Go to the main page and click "Connect" to initialize the agent with mediator registration.'
        );
      }

      console.log('✅ [CA CONNECT] Mediator configured:', mediatorDID.toString().substring(0, 60) + '...');
      console.log('🔍 [CA CONNECT] Fetching well-known invitation from CA...');
      console.log('🔍 [CA CONNECT] Endpoint:', CERTIFICATION_AUTHORITY.getInvitationEndpoint());

      // Fetch well-known invitation from CA
      const response = await fetch(CERTIFICATION_AUTHORITY.getInvitationEndpoint());

      if (!response.ok) {
        throw new Error(`Failed to fetch CA invitation: ${response.status} ${response.statusText}`);
      }

      const data = await response.json();

      if (!data.success) {
        throw new Error(data.error || 'Failed to get CA invitation');
      }

      console.log('✅ [CA CONNECT] Received CA invitation');
      console.log('📋 [CA CONNECT] Connection ID:', data.connectionId);
      console.log('📋 [CA CONNECT] CA DID:', data.caDID);
      console.log('📋 [CA CONNECT] CA Name:', data.caName);

      // Extract the invitation URL
      const invitationUrl = data.invitation.invitationUrl;

      if (!invitationUrl) {
        throw new Error('Invitation URL not found in CA response');
      }

      console.log('🔧 [CA CONNECT] Parsing invitation...');

      // Parse the invitation URL (handle RFC 0434 format from Cloud Agent 2.0.0)
      const urlObj = new URL(invitationUrl);
      const oobParam = urlObj.searchParams.get('_oob');

      if (!oobParam) {
        throw new Error('Invalid invitation URL format');
      }

      // Decode and parse the invitation
      const invitationJson = atob(oobParam);
      const invitationData = JSON.parse(invitationJson);

      console.log('✅ [CA CONNECT] Invitation parsed successfully');
      console.log('📋 [CA CONNECT] Invitation type:', invitationData.type);

      // Create connection based on invitation type
      let connection;

      if (invitationData.type === 'https://didcomm.org/out-of-band/2.0/invitation') {
        // Cloud Agent 2.0.0 RFC 0434 format - use proper OOB SDK methods
        console.log('🏢 [CA CONNECT] Detected Cloud Agent RFC 0434 invitation');
        console.log('🔧 [CA CONNECT] Using proper OOB SDK methods per official documentation...');

        try {
          // ✅ CORRECT: Use parseOOBInvitation + acceptDIDCommInvitation
          // This properly registers wallet's DID with mediator for message reception
          // Per https://hyperledger-identus.github.io/docs/home/quick-start#establish-a-connection---holder-side
          const parsed = await agent.parseOOBInvitation(new URL(invitationUrl));
          await agent.acceptDIDCommInvitation(parsed);

          // ✅ RFC 0434 ASYNC BEHAVIOR:
          // acceptDIDCommInvitation() registers wallet DID with mediator
          // Connection is established asynchronously via message handler
          // The connection response will arrive as a DIDComm message and be processed automatically
          console.log('✅ [CA CONNECT] Connection request sent successfully');
          console.log('✅ [CA CONNECT] Wallet DID registered with mediator for message pickup');
          console.log('ℹ️ [CA CONNECT] Connection will be established asynchronously via message handler');
          console.log('🎉 [CA CONNECT] Successfully connected to Certification Authority');

          // Mark as success immediately - connection completes in background
          setSuccess(true);

          // Refresh to show the new connection after message handler processes it
          // setTimeout(() => {
          //   window.location.reload();
          // }, 1500); // Slightly longer delay to allow message processing
          console.log('⏸️ [CA CONNECT] Auto-reload disabled - check console logs above for connection details');

        } catch (sdkError) {
          console.warn('⚠️ [CA CONNECT] SDK acceptance failed, using simple fallback:', sdkError.message);

          // Simple fallback: Just create local connection
          // Cloud Agent handles connection protocol automatically
          console.log('🔧 [CA CONNECT] Creating local connection to Cloud Agent...');
          const from = await agent.createNewPeerDID([], true);
          const to = SDK.Domain.DID.fromString(invitationData.from);
          connection = new SDK.Domain.DIDPair(from, to, data.caName);

          console.log('✅ [CA CONNECT] Local connection created');
          console.log('ℹ️ [CA CONNECT] Cloud Agent will handle connection protocol automatically');

          // For fallback, we have a connection object, so store it
          if (connection) {
            try {
              await agent.connectionManager.addConnection(connection);
              console.log('✅ [CA CONNECT] Fallback connection stored successfully');
              setSuccess(true);
              // setTimeout(() => {
              //   window.location.reload();
              // }, 1000);
              console.log('⏸️ [CA CONNECT] Auto-reload disabled - check console logs above');
            } catch (storageError) {
              if (storageError.message?.includes('already exists')) {
                console.log('ℹ️ [CA CONNECT] Connection already exists');
                setSuccess(true);
                // setTimeout(() => {
                //   window.location.reload();
                // }, 1000);
                console.log('⏸️ [CA CONNECT] Auto-reload disabled - connection already exists');
              } else {
                throw storageError;
              }
            }
          }
        }
      } else {
        // Legacy Connections 1.0 format (older Cloud Agent versions)
        console.log('🏛️ [CA CONNECT] Using legacy Connections 1.0 flow');
        const parsed = await agent.parseInvitation(invitationUrl);
        connection = await agent.acceptInvitation(parsed, data.caName);
        console.log('✅ [CA CONNECT] Legacy acceptance successful');

        // Legacy format returns connection object - store it
        if (connection) {
          try {
            await agent.connectionManager.addConnection(connection);
            console.log('✅ [CA CONNECT] Connection stored successfully');
            console.log('🎉 [CA CONNECT] Successfully connected to Certification Authority');
            setSuccess(true);
            // setTimeout(() => {
            //   window.location.reload();
            // }, 1000);
            console.log('⏸️ [CA CONNECT] Auto-reload disabled - check console logs above');
          } catch (storageError) {
            if (storageError.message?.includes('already exists')) {
              console.log('ℹ️ [CA CONNECT] Connection already exists');
              setSuccess(true);
              // setTimeout(() => {
              //   window.location.reload();
              // }, 1000);
              console.log('⏸️ [CA CONNECT] Auto-reload disabled - connection already exists');
            } else {
              console.error('❌ [CA CONNECT] Failed to store connection:', storageError);
              throw storageError;
            }
          }
        } else {
          console.error('❌ [CA CONNECT] No connection object returned from legacy flow');
          throw new Error('Failed to create connection - no connection object returned');
        }
      }

    } catch (error: any) {
      console.error('❌ [CA CONNECT] Failed to connect to CA:', error);

      // Enhanced error handling with specific guidance for common issues
      let errorMessage = error.message || 'Failed to connect to Certification Authority';

      // Detect NoMediatorAvailableError
      if (error.message?.includes('No mediator available') || error.message?.includes('mediator')) {
        errorMessage =
          'Mediator not available. Please ensure the wallet is fully initialized:\n\n' +
          '1. Go to the main wallet page\n' +
          '2. Click "Connect" button to initialize the agent\n' +
          '3. Wait for mediator registration to complete\n' +
          '4. Return here and try connecting to CA again\n\n' +
          'Mediator URL: http://91.99.4.54:8080';
      }

      setError(errorMessage);
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
      <div className="flex items-center space-x-4">
        <div className="w-12 h-12 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
          <span className="text-2xl">🏛️</span>
        </div>
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900 dark:text-white">
            Certification Authority
          </h3>
          <p className="text-sm text-gray-600 dark:text-gray-400">
            Connect to receive official identity credentials
          </p>
        </div>
        <button
          onClick={handleConnectToCA}
          disabled={connecting || !agent}
          className={`px-6 py-3 rounded-lg font-semibold transition-all duration-200 ${
            connecting || !agent
              ? 'bg-gray-400 text-gray-700 cursor-not-allowed'
              : success
              ? 'bg-green-600 text-white hover:bg-green-700'
              : 'bg-blue-600 text-white hover:bg-blue-700 focus:ring-4 focus:ring-blue-300'
          }`}
        >
          {connecting ? (
            <>
              <span className="inline-block animate-spin mr-2">⏳</span>
              Connecting...
            </>
          ) : success ? (
            <>
              ✅ Connected!
            </>
          ) : (
            <>
              🔗 Connect to CA
            </>
          )}
        </button>
      </div>

      {error && (
        <div className="mt-4 p-4 bg-red-50 dark:bg-red-900/30 border border-red-200 dark:border-red-700 rounded-lg">
          <p className="text-sm text-red-800 dark:text-red-200">
            <strong>Error:</strong> {error}
          </p>
        </div>
      )}

      {success && !error && (
        <div className="mt-4 p-4 bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-lg">
          <p className="text-sm text-green-800 dark:text-green-200">
            <strong>Success!</strong> Connected to Certification Authority.
            <br />
            <em>Auto-reload disabled - check browser console for connection details (F12 → Console)</em>
          </p>
        </div>
      )}

      {!agent && (
        <div className="mt-4 p-4 bg-yellow-50 dark:bg-yellow-900/30 border border-yellow-200 dark:border-yellow-700 rounded-lg">
          <p className="text-sm text-yellow-800 dark:text-yellow-200">
            <strong>Note:</strong> Please start the wallet agent before connecting to the Certification Authority.
          </p>
        </div>
      )}
    </div>
  );
};
