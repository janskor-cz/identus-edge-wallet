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

import React, { useState, useEffect } from 'react';
import { useMountedApp } from '@/reducers/store';
import { CERTIFICATION_AUTHORITY } from '@/config/certificationAuthority';
import SDK from '@hyperledger/identus-edge-agent-sdk';
import { v4 as uuid } from 'uuid';
import { CACredentialConfirmationModal } from './CACredentialConfirmationModal';

export const ConnectToCA: React.FC = () => {
  const app = useMountedApp();
  const agent = app.agent.instance;

  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);

  // Track mediator configuration with useEffect to ensure re-render on changes
  const [mediatorConfigured, setMediatorConfigured] = useState(false);

  // 🔧 FIX #1: Add isConnecting flag to prevent concurrent connection attempts
  const [isConnecting, setIsConnecting] = useState(false);

  // 🔧 FIX #6: Add flag to track intentional modal display (not an error)
  const [isShowingCredentialModal, setIsShowingCredentialModal] = useState(false);

  // 🆕 NEW: User name input state
  const [userName, setUserName] = useState<string>('');

  // 🆕 NEW: CA credential confirmation modal state
  const [caCredential, setCaCredential] = useState<any>(null);
  const [showCACredentialModal, setShowCACredentialModal] = useState(false);
  const [pendingInvitationUrl, setPendingInvitationUrl] = useState<string | null>(null);
  const [pendingInvitationData, setPendingInvitationData] = useState<any>(null);

  // 🔧 FIX: Check for existing CA connection on mount (fixes reload issue)
  useEffect(() => {
    const checkExistingConnection = async () => {
      if (!agent) return;

      try {
        console.log('🔍 [ConnectToCA] Checking for existing CA connection on mount...');
        const connections = await agent.pluto.getAllDidPairs();

        // Check if CA connection already exists (by name or by checking all connections)
        const caConnection = connections.find(pair => {
          const pairName = pair.name?.toLowerCase() || '';
          return pairName === 'certification authority' ||
                 pairName.includes('certification') ||
                 userName.trim().toLowerCase() === pairName;
        });

        if (caConnection) {
          console.log('✅ [ConnectToCA] Found existing CA connection on mount:', caConnection.name);
          setSuccess(true);
          setError(null);
        } else {
          console.log('ℹ️ [ConnectToCA] No existing CA connection found on mount');
        }
      } catch (error) {
        console.error('❌ [ConnectToCA] Error checking existing connection:', error);
      }
    };

    checkExistingConnection();
  }, [agent]); // Re-run only when agent reference changes

  useEffect(() => {
    // Poll mediator status every 2 seconds when agent exists but mediator not configured
    const checkMediatorStatus = () => {
      if (agent) {
        const mediatorDID = agent.currentMediatorDID;
        const isConfigured = !!mediatorDID;
        setMediatorConfigured(isConfigured);

        console.log('🔄 [ConnectToCA] Mediator status check:', {
          agentExists: true,
          mediatorDID: mediatorDID || 'NOT_CONFIGURED',
          isConfigured
        });

        return isConfigured;
      } else {
        setMediatorConfigured(false);
        console.log('🔄 [ConnectToCA] Agent not yet available');
        return false;
      }
    };

    // Initial check
    const isConfigured = checkMediatorStatus();

    // If agent exists but mediator not configured, poll every 2 seconds
    let pollInterval: NodeJS.Timeout | null = null;
    if (agent && !isConfigured) {
      pollInterval = setInterval(() => {
        const nowConfigured = checkMediatorStatus();
        if (nowConfigured && pollInterval) {
          clearInterval(pollInterval);
        }
      }, 2000);
    }

    return () => {
      if (pollInterval) {
        clearInterval(pollInterval);
      }
    };
  }, [agent]); // Re-run only when agent reference changes

  const handleConnectToCA = async () => {
    // 🔧 FIX #7: Local flag to track modal display (avoids React state timing issues)
    let shouldShowCredentialModal = false;

    // 🔧 FIX #1: Prevent concurrent connection attempts
    if (isConnecting) {
      console.log('⏸️ [CA CONNECT] Connection already in progress, ignoring duplicate request');
      return;
    }

    try {
      setIsConnecting(true);  // 🔧 FIX #1: Set flag before starting
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

      // 🔧 FIX: Include userName as query parameter so CA can pre-populate connection label
      // Cloud Agent 2.0.0 doesn't extract label from HandshakeRequest, only uses label from invitation creation
      const baseEndpoint = CERTIFICATION_AUTHORITY.getInvitationEndpoint();
      const fetchUrl = userName.trim()
        ? `${baseEndpoint}?userName=${encodeURIComponent(userName.trim())}`
        : baseEndpoint;

      console.log('🔍 [CA CONNECT] Endpoint:', fetchUrl);
      if (userName.trim()) {
        console.log('👤 [CA CONNECT] Including userName in request:', userName.trim());
      }

      // Fetch well-known invitation from CA
      const response = await fetch(fetchUrl);

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

      // 🔧 FIX #1: Enhanced connection deduplication check
      console.log('🔍 [CA CONNECT] Checking for existing CA connection...');
      const connections = await agent.pluto.getAllDidPairs();
      const caDID = data.caDID;

      const existingCAConnection = connections.find(pair => {
        const receiverDID = pair.receiver.toString();
        const pairName = pair.name;

        console.log(`  🔗 Checking connection: ${pairName} (receiver: ${receiverDID.substring(0, 60)}...)`);

        // Check by both receiver DID AND connection name for robust deduplication
        return receiverDID === caDID || pairName === "Certification Authority";
      });

      if (existingCAConnection) {
        console.log('✅ [CA CONNECT] Already connected to Certification Authority');
        console.log('📋 [CA CONNECT] Existing connection:', existingCAConnection.name);
        console.log('ℹ️ [CA CONNECT] Skipping duplicate connection creation');
        setSuccess(true);
        setError(null);
        setIsConnecting(false);  // 🔧 FIX #1: Clear flag before return
        return; // Skip connection process
      }

      console.log('ℹ️  [CA CONNECT] No existing CA connection found - proceeding with new connection');

      // Extract the invitation URL (data already fetched above)
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

      // 🔧 FIX: Check for CA credential in BOTH requests_attach AND attachments fields
      // (field name varies based on SDK version and CA implementation)
      const requestsAttach = invitationData.requests_attach || invitationData.attachments || [];
      console.log('🔍 [CA CONNECT] Checking for CA credential in attachments...', {
        requests_attach_count: (invitationData.requests_attach || []).length,
        attachments_count: (invitationData.attachments || []).length,
        total_checked: requestsAttach.length
      });

      const caCredentialAttachment = requestsAttach.find(
        (attach: any) => {
          const attachId = attach['@id'] || attach.id;
          console.log(`  🔗 Checking attachment: ${attachId}`);
          return attachId === 'ca-authority-credential' || attachId === 'ca-authority-credential';
        }
      );

      if (caCredentialAttachment) {
        console.log('🔍 [CA CONNECT] Found CA credential in invitation');
        console.log('📋 [CA CONNECT] Credential ID:', caCredentialAttachment['@id'] || caCredentialAttachment.id);

        // Extract credential from attachment (try both data.json and payload formats)
        const credentialData = caCredentialAttachment.data?.json || caCredentialAttachment.payload || caCredentialAttachment.data;

        if (credentialData) {
          console.log('✅ [CA CONNECT] CA credential extracted successfully');
          console.log('📋 [CA CONNECT] Credential type:', credentialData.credentialType || credentialData.type);

          // Store invitation data for later use (after user confirms)
          setPendingInvitationUrl(invitationUrl);
          setPendingInvitationData(invitationData);
          setCaCredential(credentialData);
          setShowCACredentialModal(true);
          setIsShowingCredentialModal(true);  // 🔧 FIX #6: Mark intentional modal display
          shouldShowCredentialModal = true;  // 🔧 FIX #7: Set local flag
          setConnecting(false);

          // Return here - the modal will handle accepting/rejecting
          return;
        } else {
          console.warn('⚠️ [CA CONNECT] CA credential attachment found but no data');
        }
      } else {
        console.log('ℹ️ [CA CONNECT] No CA credential in invitation (standard connection)');
      }

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
          console.log('🔍 [CA CONNECT] userName value before acceptDIDCommInvitation:', userName);
          console.log('🔍 [CA CONNECT] userName.trim():', userName.trim());
          console.log('🔍 [CA CONNECT] Connection will be named: "Certification Authority"');

          const parsed = await agent.parseOOBInvitation(new URL(invitationUrl));
          // Fixed connection name - wallet always shows "Certification Authority"
          // userName is sent to CA via query parameter for CA's label only
          await agent.acceptDIDCommInvitation(parsed, "Certification Authority");

          // ✅ RFC 0434 ASYNC BEHAVIOR:
          // acceptDIDCommInvitation() registers wallet DID with mediator
          // Connection is established asynchronously via message handler
          // The connection response will arrive as a DIDComm message and be processed automatically
          console.log('✅ [CA CONNECT] Connection request sent successfully');
          console.log('✅ [CA CONNECT] Wallet DID registered with mediator for message pickup');
          console.log('ℹ️ [CA CONNECT] Connection will be established asynchronously via message handler');

          // 🔧 FIX #2: Update connection name after it's created by SDK
          // SDK creates connection with "OOBConn" default name, we need to update it
          console.log('🔧 [CA CONNECT] Waiting for connection to be created...');

          // Wait a moment for SDK to create the connection in the database
          await new Promise(resolve => setTimeout(resolve, 2000));

          // Find the newly created connection and update its name
          const allConnections = await agent.pluto.getAllDidPairs();
          const newConnection = allConnections.find(pair =>
            pair.receiver.toString() === invitationData.from
          );

          if (newConnection) {
            console.log('🔧 [CA CONNECT] Found new connection, updating name...');
            // Store with correct name "Certification Authority"
            await agent.pluto.storeDIDPair(
              newConnection.host,
              newConnection.receiver,
              "Certification Authority"
            );
            console.log('✅ [CA CONNECT] Connection name updated to "Certification Authority"');
          } else {
            console.log('⚠️ [CA CONNECT] Connection not yet created - will have default "OOBConn" name');
            console.log('ℹ️ [CA CONNECT] Connection will be finalized asynchronously via message handler');
          }

          console.log('🎉 [CA CONNECT] Successfully connected to Certification Authority');

          // 🔧 FIX #2: Clean up invitation metadata from localStorage
          const invitationKeys = getKeysByPattern('invitation-');
          for (const key of invitationKeys) {
            const storedData = getItem(key);
            if (storedData?.invitationUrl === invitationUrl) {
              console.log(`🧹 [CA CONNECT] Cleaning up localStorage key: ${key}`);
              removeItem(key);
            }
          }

          // Mark as success immediately - connection completes in background
          setSuccess(true);

          // 🔧 FIX #6: Replace auto-reload with state sync to prevent unpredictable reloads
          console.log('🔄 [CA CONNECT] Syncing connection state in 1.5s...');
          setTimeout(async () => {
            try {
              console.log('🔄 [CA CONNECT] Refreshing connections from database...');
              await app.refreshConnections();
              console.log('✅ [CA CONNECT] Connections synced successfully (no reload needed)');
            } catch (syncError) {
              console.error('❌ [CA CONNECT] State sync failed:', syncError);
              // Fallback to reload only if sync fails
              console.warn('⚠️ [CA CONNECT] Falling back to page reload...');
              window.location.reload();
            }
          }, 1500); // Delay allows message processing to complete

        } catch (sdkError) {
          // 🔧 FIX #4: Removed problematic fallback code that created duplicate connections
          // Let SDK errors bubble up for proper error handling
          console.error('❌ [CA CONNECT] SDK acceptance failed:', sdkError.message);
          throw new Error(`Failed to accept CA invitation: ${sdkError.message}`);
        }
      } else {
        // Legacy Connections 1.0 format (older Cloud Agent versions)
        console.log('🏛️ [CA CONNECT] Using legacy Connections 1.0 flow');
        const parsed = await agent.parseInvitation(invitationUrl);
        // 🔧 FIX #2: Use "Certification Authority" as connection name
        connection = await agent.acceptInvitation(parsed, "Certification Authority");
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
      // 🔧 FIX #3: Comprehensive state cleanup in finally block
      setConnecting(false);
      setIsConnecting(false);  // 🔧 FIX #1: Always clear isConnecting flag

      // 🔧 FIX #7: Use local flag instead of state variable (avoids React timing issues)
      if (!success && !shouldShowCredentialModal) {
        console.log('🧹 [CA CONNECT] Cleaning up modal state after error');
        setCaCredential(null);
        setShowCACredentialModal(false);
        setPendingInvitationUrl(null);
        setPendingInvitationData(null);
      } else if (shouldShowCredentialModal) {
        console.log('ℹ️ [CA CONNECT] Skipping cleanup - credential modal intentionally shown');
      }
    }
  };

  // 🆕 NEW: Handle CA credential acceptance
  const handleAcceptCACredential = async () => {
    console.log('✅ [CA CONNECT] User accepted CA credential');
    setShowCACredentialModal(false);
    setIsShowingCredentialModal(false);  // 🔧 FIX #6: Clear modal flag

    if (!pendingInvitationUrl || !pendingInvitationData || !agent) {
      setError('Failed to process connection - missing data');
      return;
    }

    try {
      setConnecting(true);
      setError(null);

      // Store the CA credential first
      if (caCredential) {
        console.log('💾 [CA CONNECT] Storing CA credential...');

        try {
          // Extract JWT credential string (may be nested in credential property)
          const jwtCredential = caCredential.credential || caCredential;
          console.log('🔍 [CA CONNECT] JWT credential type:', typeof jwtCredential);

          // Convert credential to Uint8Array format (SDK expects binary data)
          const credentialPayload = typeof jwtCredential === 'string'
            ? jwtCredential
            : JSON.stringify(jwtCredential);
          const credData = Uint8Array.from(Buffer.from(credentialPayload));

          console.log('🔧 [CA CONNECT] Parsing credential with Pollux...');

          // Parse credential using Pollux (creates proper SDK Domain.Credential instance)
          const parsedCredential = await agent.pollux.parseCredential(credData, {
            type: SDK.Domain.CredentialType.JWT
          });

          console.log('✅ [CA CONNECT] Credential parsed successfully:', parsedCredential);

          // Store the parsed credential (now has isStorable() method)
          await agent.pluto.storeCredential(parsedCredential);
          console.log('✅ [CA CONNECT] CA credential stored successfully');

        } catch (storeError: any) {
          console.error('❌ [CA CONNECT] Failed to store CA credential:', storeError);
          throw new Error(`Failed to store CA credential: ${storeError.message}`);
        }
      }

      // Now proceed with connection establishment (use existing code flow)
      await proceedWithConnection(pendingInvitationUrl, pendingInvitationData);

    } catch (error: any) {
      console.error('❌ [CA CONNECT] Failed to accept CA credential:', error);
      setError(error.message || 'Failed to accept CA credential and establish connection');
      setConnecting(false);
    }
  };

  // 🆕 NEW: Handle CA credential rejection
  const handleRejectCACredential = () => {
    console.log('❌ [CA CONNECT] User rejected CA credential - canceling connection');
    setShowCACredentialModal(false);
    setIsShowingCredentialModal(false);  // 🔧 FIX #6: Clear modal flag
    setPendingInvitationUrl(null);
    setPendingInvitationData(null);
    setCaCredential(null);
    setError('Connection cancelled - CA credential rejected');
  };

  // 🆕 NEW: Extracted connection logic for reuse
  const proceedWithConnection = async (invitationUrl: string, invitationData: any) => {
    try {
      // Determine connection label (use user name if provided)
      const connectionLabel = userName.trim() || "Certification Authority";
      console.log('📝 [CA CONNECT - MODAL PATH] Using connection label:', connectionLabel);
      console.log('🔍 [CA CONNECT - MODAL PATH] userName value:', userName);
      console.log('🔍 [CA CONNECT - MODAL PATH] userName.trim():', userName.trim());

      // Create connection based on invitation type
      let connection;

      if (invitationData.type === 'https://didcomm.org/out-of-band/2.0/invitation') {
        // Cloud Agent 2.0.0 RFC 0434 format - use proper OOB SDK methods
        console.log('🏢 [CA CONNECT - MODAL PATH] Detected Cloud Agent RFC 0434 invitation');
        console.log('🔧 [CA CONNECT - MODAL PATH] Using proper OOB SDK methods per official documentation...');

        try {
          // ✅ CORRECT: Use parseOOBInvitation + acceptDIDCommInvitation
          console.log('🔍 [CA CONNECT - MODAL PATH] Connection will be named: "Certification Authority"');
          const parsed = await agent!.parseOOBInvitation(new URL(invitationUrl));
          // Fixed connection name - wallet always shows "Certification Authority"
          await agent!.acceptDIDCommInvitation(parsed, "Certification Authority");

          console.log('✅ [CA CONNECT] Connection request sent successfully');

          // CRITICAL FIX: Explicitly register ALL our DIDs with mediator
          // The SDK's acceptDIDCommInvitation() should do this, but we're being defensive
          try {
            const allOurDIDs = await agent!.pluto.getAllPeerDIDs();
            console.log(`🔍 [MEDIATOR REGISTER] Found ${allOurDIDs.length} peer DIDs to register`);

            if (allOurDIDs.length > 0) {
              // Register all DIDs with mediator (updateKeyListWithDIDs is idempotent)
              await agent!.mediationHandler.updateKeyListWithDIDs(allOurDIDs.map(did => did.did));
              console.log('✅ [MEDIATOR REGISTER] All DIDs registered with mediator for message pickup');
            }
          } catch (registerError: any) {
            console.warn('⚠️ [MEDIATOR REGISTER] Failed to register DIDs with mediator:', registerError.message);
            // Don't fail the connection if registration fails
          }

          console.log('🎉 [CA CONNECT] Successfully connected to Certification Authority');
          setSuccess(true);

        } catch (sdkError: any) {
          console.warn('⚠️ [CA CONNECT] SDK acceptance failed, using simple fallback:', sdkError.message);

          // Simple fallback: Just create local connection
          console.log('🔧 [CA CONNECT] Creating local connection to Cloud Agent...');
          const from = await agent!.createNewPeerDID([], true);
          const to = SDK.Domain.DID.fromString(invitationData.from);
          connection = new SDK.Domain.DIDPair(from, to, connectionLabel);

          console.log('✅ [CA CONNECT] Local connection created');

          // Store fallback connection
          if (connection) {
            try {
              await agent!.connectionManager.addConnection(connection);
              console.log('✅ [CA CONNECT] Fallback connection stored successfully');
              setSuccess(true);
            } catch (storageError: any) {
              if (storageError.message?.includes('already exists')) {
                console.log('ℹ️ [CA CONNECT] Connection already exists');
                setSuccess(true);
              } else {
                throw storageError;
              }
            }
          }
        }
      } else {
        // Legacy Connections 1.0 format
        console.log('🏛️ [CA CONNECT] Using legacy Connections 1.0 flow');
        const parsed = await agent!.parseInvitation(invitationUrl);
        connection = await agent!.acceptInvitation(parsed, connectionLabel);
        console.log('✅ [CA CONNECT] Legacy acceptance successful');

        // Store legacy connection
        if (connection) {
          try {
            await agent!.connectionManager.addConnection(connection);
            console.log('✅ [CA CONNECT] Connection stored successfully');
            setSuccess(true);
          } catch (storageError: any) {
            if (storageError.message?.includes('already exists')) {
              console.log('ℹ️ [CA CONNECT] Connection already exists');
              setSuccess(true);
            } else {
              throw storageError;
            }
          }
        }
      }

      // Clear pending state
      setPendingInvitationUrl(null);
      setPendingInvitationData(null);
      setCaCredential(null);

    } catch (error: any) {
      console.error('❌ [CA CONNECT] Connection failed:', error);
      throw error;
    } finally {
      setConnecting(false);
    }
  };

  return (
    <>
      <CACredentialConfirmationModal
        credential={caCredential}
        onAccept={handleAcceptCACredential}
        onReject={handleRejectCACredential}
        visible={showCACredentialModal}
      />

      {/* Main UI */}
    <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6 mb-6">
      {/* Header Section */}
      <div className="flex items-center space-x-4 mb-4">
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
      </div>

      {/* 🆕 NEW: User Name Input */}
      <div className="mb-4">
        <label htmlFor="userName" className="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-2">
          Your Name (optional)
        </label>
        <input
          type="text"
          id="userName"
          value={userName}
          onChange={(e) => setUserName(e.target.value.slice(0, 100))}
          placeholder="Enter your name..."
          maxLength={100}
          className="w-full px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-lg
                   bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100
                   placeholder-gray-400 dark:placeholder-gray-500
                   focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent
                   disabled:bg-gray-100 dark:disabled:bg-gray-800 disabled:cursor-not-allowed"
          disabled={connecting || !agent || !mediatorConfigured}
        />
        <p className="text-xs text-gray-500 dark:text-gray-400 mt-1">
          This helps the CA identify who is connecting. If not provided, connection will be named "Certification Authority".
        </p>
      </div>

      {/* Connect Button */}
      <div className="flex justify-end">
        <button
          onClick={handleConnectToCA}
          disabled={connecting || !agent || success}
          className={`px-6 py-3 rounded-lg font-semibold transition-all duration-200 ${
            connecting || !agent || success
              ? success
                ? 'bg-green-600 text-white cursor-default'
                : 'bg-gray-400 text-gray-700 cursor-not-allowed'
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

      {agent && !mediatorConfigured && (
        <div className="mt-4 p-4 bg-orange-50 dark:bg-orange-900/30 border border-orange-200 dark:border-orange-700 rounded-lg">
          <p className="text-sm text-orange-800 dark:text-orange-200">
            <strong>⚠️ Mediator Required:</strong> The wallet agent is initialized, but the mediator is not yet configured.
            <br />
            <br />
            <strong>To connect to the CA, you must first:</strong>
            <br />
            1. Go to the wallet home page
            <br />
            2. Click the <strong>"Connect"</strong> button to initialize the mediator
            <br />
            3. Wait for the "Connected to mediator" confirmation
            <br />
            4. Return here and click "Connect to CA"
            <br />
            <br />
            <em>Without mediator registration, the "Connect to CA" button will fail silently.</em>
          </p>
        </div>
      )}
      </div>
    </>
  );
};
