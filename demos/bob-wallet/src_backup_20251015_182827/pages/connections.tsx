import '../app/index.css'

import React, { useEffect, useState } from "react";
import SDK from '@hyperledger/identus-edge-agent-sdk';
import { FooterNavigation } from "@/components/FooterNavigation";

import { Box } from "@/app/Box";
import { useMountedApp } from "@/reducers/store";
import { DBConnect } from "@/components/DBConnect";
import { OOB } from "@/components/OOB";
import { copyToClipboardWithLog } from "@/utils/clipboard";
import { PageHeader } from "@/components/PageHeader";
import { refreshConnections, deleteConnection } from "@/actions";
import { ConnectionRequest } from "@/components/ConnectionRequest";
import { filterConnectionMessages } from "@/utils/messageFilters";
import { connectionRequestQueue, ConnectionRequestItem } from "@/utils/connectionRequestQueue";
import { messageRejection } from "@/utils/rejectionManager";
import { ConnectToCA } from "@/components/ConnectToCA";
import { getConnectionName } from "@/utils/connectionNameResolver";

export default function App() {

    const app = useMountedApp();
    const [connections, setConnections] = React.useState<SDK.Domain.DIDPair[]>([]);
    const [showDetails, setShowDetails] = React.useState<{[key: number]: boolean}>({});

    // Persistent connection request queue state
    const [persistentRequests, setPersistentRequests] = useState<ConnectionRequestItem[]>([]);
    const [queueLoading, setQueueLoading] = useState(false);
    const [queueError, setQueueError] = useState<string | null>(null);
    const [queueStats, setQueueStats] = useState<any>(null);

    // Rejection tracking state
    const [rejectionStats, setRejectionStats] = useState<any>(null);


    // ✅ FIX 2: Processing flag to prevent race conditions
    const [isProcessingMessages, setIsProcessingMessages] = useState(false);

    useEffect(() => {
        setConnections(app.connections)
    }, [app.connections])

    // Load persistent connection requests from IndexedDB
    const loadPersistentRequests = async () => {
        try {
            setQueueLoading(true);
            setQueueError(null);

            // Get wallet ID from app configuration
            const walletId = app.agent?.walletId || 'alice'; // fallback to alice
            console.log('📋 [PERSISTENT QUEUE] Loading requests for wallet:', walletId);

            const requests = await connectionRequestQueue.getPendingRequests(walletId);
            console.log(`✅ [PERSISTENT QUEUE] Loaded ${requests.length} persistent requests`);

            setPersistentRequests(requests);

            // Load queue statistics
            const stats = await connectionRequestQueue.getStats(walletId);
            setQueueStats(stats);
            console.log('📊 [PERSISTENT QUEUE] Queue stats:', stats);

            // Load rejection statistics
            try {
                const rejectionStats = await messageRejection.getStats(walletId);
                setRejectionStats(rejectionStats);
                console.log('📊 [REJECTION MANAGER] Rejection stats:', rejectionStats);
            } catch (rejectionError) {
                console.warn('⚠️ [REJECTION MANAGER] Failed to load rejection stats:', rejectionError);
            }

        } catch (error) {
            console.error('❌ [PERSISTENT QUEUE] Failed to load requests:', error);
            setQueueError(error.message || 'Failed to load connection requests');
        } finally {
            setQueueLoading(false);
        }
    };


    // Save new connection requests to persistent queue
    const saveRequestToPersistentQueue = async (message: SDK.Domain.Message) => {
        try {
            const walletId = app.agent?.walletId || 'alice';
            console.log('💾 [PERSISTENT QUEUE] Saving new request to queue:', message.id);

            // Extract attached credential if any
            const attachedCredential = extractCredentialFromMessage(message);

            const requestId = await connectionRequestQueue.addRequest(
                walletId,
                message,
                attachedCredential,
                24 // expire in 24 hours
            );

            console.log(`✅ [PERSISTENT QUEUE] Saved request with ID: ${requestId}`);

            // Reload the queue to show the new request
            await loadPersistentRequests();

        } catch (error) {
            console.error('❌ [PERSISTENT QUEUE] Failed to save request:', error);
        }
    };

    // Handle connection request acceptance/rejection
    const handlePersistentRequestAction = async (
        requestId: string,
        action: 'accepted' | 'rejected',
        verificationResult?: any
    ) => {
        try {
            const walletId = app.agent?.walletId || 'alice';
            console.log(`📝 [PERSISTENT QUEUE] Handling request ${requestId} with action: ${action}`);

            await connectionRequestQueue.handleRequest(walletId, requestId, action, verificationResult);

            // Reload the queue to update the UI
            await loadPersistentRequests();

            console.log(`✅ [PERSISTENT QUEUE] Request ${requestId} marked as ${action}`);

        } catch (error) {
            console.error('❌ [PERSISTENT QUEUE] Failed to handle request action:', error);
        }
    };

    // ✅ TASK 3: Enhanced credential extraction from message attachments AND body
    const extractCredentialFromMessage = (message: SDK.Domain.Message): any => {
        try {
            console.log('🔍 [VC-EXTRACTION] Extracting credential from message...');
            console.log('📎 [VC-EXTRACTION] Message has', message.attachments?.length || 0, 'attachments');

            // ✅ PRIORITY 1: Check message body for requests_attach field (NEW PATTERN)
            // This pattern survives IndexedDB serialization (body can be string or object)
            try {
                // ✅ FIX: Handle both string and object body types
                let messageBody;
                if (typeof message.body === 'string') {
                    console.log('🔧 [VC-EXTRACTION] Message body is string, parsing...');
                    messageBody = JSON.parse(message.body);
                } else if (typeof message.body === 'object' && message.body !== null) {
                    console.log('🔧 [VC-EXTRACTION] Message body is already object, using directly');
                    messageBody = message.body;
                } else {
                    console.warn('⚠️ [VC-EXTRACTION] Message body has unexpected type:', typeof message.body);
                    throw new Error('Invalid message body type');
                }
                console.log('📋 [VC-EXTRACTION] Message body ready for extraction');

                if (messageBody.requests_attach && messageBody.requests_attach.length > 0) {
                    console.log('✅ [VC-EXTRACTION] Found requests_attach in message body!');
                    console.log('📎 [VC-EXTRACTION] requests_attach count:', messageBody.requests_attach.length);

                    for (const attachment of messageBody.requests_attach) {
                        console.log('📋 [VC-EXTRACTION] Processing body attachment ID:', attachment["@id"]);

                        // Look for vc-proof-response in requests_attach
                        if (attachment["@id"] === "vc-proof-response") {
                            console.log('✅ [VC-EXTRACTION] Found vc-proof-response in requests_attach!');

                            // Extract credential from data.json field (NOT data.base64)
                            if (attachment.data && attachment.data.json) {
                                let credentialData = attachment.data.json;
                                console.log('✅ [VC-EXTRACTION] Extracted credential from data.json field');

                                // ✅ FALLBACK: Unwrap SDK.Domain.Credential wrapper if present
                                if (credentialData.credentialType === 'prism/jwt' &&
                                    credentialData.recoveryId === 'jwt+credential' &&
                                    !credentialData.credentialSubject) {
                                    console.log('🔧 [VC-EXTRACTION] Detected SDK wrapper, attempting to unwrap...');

                                    // Try multiple extraction methods
                                    if (typeof credentialData.verifiableCredential === 'function') {
                                        credentialData = credentialData.verifiableCredential();
                                        console.log('✅ [VC-EXTRACTION] Unwrapped using verifiableCredential() method');
                                    } else if (credentialData.vc) {
                                        credentialData = credentialData.vc;
                                        console.log('✅ [VC-EXTRACTION] Unwrapped using .vc property');
                                    } else if (credentialData.properties) {
                                        credentialData = credentialData.properties;
                                        console.log('✅ [VC-EXTRACTION] Unwrapped from .properties');
                                    } else {
                                        console.warn('⚠️ [VC-EXTRACTION] SDK wrapper detected but unable to unwrap');
                                    }
                                }

                                // Validate credential structure
                                if (credentialData.type || credentialData.credentialType || credentialData.credentialSubject) {
                                    console.log('✅ [VC-EXTRACTION] Valid credential found in message body!');
                                    console.log('📋 [VC-EXTRACTION] Credential type:', credentialData.type || credentialData.credentialType);
                                    return credentialData;
                                } else {
                                    console.warn('⚠️ [VC-EXTRACTION] Data does not look like a valid credential');
                                }
                            } else {
                                console.warn('⚠️ [VC-EXTRACTION] Attachment missing data.json field');
                            }
                        }
                    }
                } else {
                    console.log('ℹ️ [VC-EXTRACTION] No requests_attach field in message body');
                }
            } catch (bodyParseError) {
                console.log('ℹ️ [VC-EXTRACTION] Could not parse message body as JSON:', bodyParseError.message);
            }

            // ✅ PRIORITY 2: Check SDK attachments array (LEGACY FALLBACK)
            if (message.attachments && message.attachments.length > 0) {
                for (const attachment of message.attachments) {
                    console.log('📋 [VC-EXTRACTION] Processing attachment ID:', attachment.id || 'no-id');

                    // ✅ TASK 3: Priority check for "vc-proof-response" attachment ID from Bob
                    if (attachment.id === 'vc-proof-response') {
                        console.log('✅ [VC-EXTRACTION] Found vc-proof-response attachment!');

                        // Handle both base64 and raw data formats
                        let credentialData = null;

                        // Try base64 format first (Bob's format)
                        if (attachment.data) {
                            try {
                                // AttachmentDescriptor stores data as base64 string directly
                                const decodedData = Buffer.from(attachment.data.toString(), 'base64').toString('utf-8');
                                console.log('🔓 [VC-EXTRACTION] Decoded base64 data:', decodedData.substring(0, 100) + '...');
                                credentialData = JSON.parse(decodedData);
                            } catch (base64Error) {
                                console.warn('⚠️ [VC-EXTRACTION] Failed to decode as base64, trying as direct data:', base64Error.message);
                                // Try direct data access
                                credentialData = attachment.data;
                            }
                        }

                        // Validate credential structure
                        if (credentialData) {
                            // Check if it's a valid VC (has type, credentialSubject, etc.)
                            if (credentialData.type || credentialData.credentialType || credentialData.credentialSubject) {
                                console.log('✅ [VC-EXTRACTION] Valid credential found!');
                                console.log('📋 [VC-EXTRACTION] Credential type:', credentialData.type || credentialData.credentialType);
                                return credentialData;
                            } else {
                                console.warn('⚠️ [VC-EXTRACTION] Data does not look like a valid credential');
                            }
                        }
                    }

                    // ✅ TASK 3: Fallback to legacy extraction for backward compatibility
                    if (attachment.data && attachment.data.base64) {
                        try {
                            const decodedData = Buffer.from(attachment.data.base64, 'base64').toString();
                            const parsedData = JSON.parse(decodedData);

                            // Check for various credential wrapper formats
                            if (parsedData.verifiableCredential) {
                                console.log('✅ [VC-EXTRACTION] Found verifiableCredential wrapper');
                                return parsedData.verifiableCredential;
                            }
                            if (parsedData.credentials) {
                                console.log('✅ [VC-EXTRACTION] Found credentials array wrapper');
                                return parsedData.credentials[0] || parsedData.credentials;
                            }
                            if (parsedData.credential) {
                                console.log('✅ [VC-EXTRACTION] Found credential wrapper');
                                return parsedData.credential;
                            }

                            // ✅ TASK 3: Check if the decoded data itself is a credential
                            if (parsedData.type || parsedData.credentialType || parsedData.credentialSubject) {
                                console.log('✅ [VC-EXTRACTION] Decoded data is directly a credential');
                                return parsedData;
                            }
                        } catch (legacyError) {
                            console.warn('⚠️ [VC-EXTRACTION] Legacy extraction failed:', legacyError.message);
                        }
                    }
                }

                console.log('⚠️ [VC-EXTRACTION] No valid credential found in any attachment');
            } else {
                console.log('ℹ️ [VC-EXTRACTION] Message has no attachments');
            }
        } catch (error) {
            console.error('❌ [VC-EXTRACTION] Error extracting credential from message:', error);
        }
        return null;
    };

    // Refresh connections and load persistent requests when page loads
    useEffect(() => {
        console.log('🔄 Connections page mounted - checking if should refresh connections...');
        console.log('🔍 Database connected:', app.db.connected);
        console.log('🔍 Database instance available:', !!app.db.instance);

        if (app.db.instance && app.db.connected) {
            console.log('✅ Refreshing connections from database on page load...');
            app.dispatch(refreshConnections());

            // Load persistent connection requests
            loadPersistentRequests();
        } else {
            console.log('⏳ Database not ready yet, will refresh when database connects');
        }
    }, [app.db.instance, app.db.connected, app.dispatch])

    // Monitor for new connection requests and save them to persistent queue
    useEffect(() => {
        const processMessages = async () => {
            // ✅ FIX 2: Prevent concurrent executions with processing flag
            if (isProcessingMessages) {
                console.log('⏸️ [MESSAGE PROCESSING] Already processing messages, skipping...');
                return;
            }

            setIsProcessingMessages(true);
            console.log('🔄 [MESSAGE PROCESSING] Starting message processing...');

            try {
                // ✅ Filter for both Mercury AND DIDExchange protocol connection requests
                const connectionRequests = filterConnectionMessages(app.messages).filter(
                    msg => (
                        msg.piuri === 'https://atalaprism.io/mercury/connections/1.0/request' ||
                        msg.piuri === 'https://didcomm.org/didexchange/1.0/request'
                    ) &&
                    msg.direction === SDK.Domain.MessageDirection.RECEIVED &&
                    !hasAcceptedConnection(msg)
                );

                // Filter out rejected messages
                const nonRejectedRequests = await filterRejectedMessages(connectionRequests);
                console.log(`📨 [MESSAGE PROCESSING] Found ${nonRejectedRequests.length} non-rejected connection requests`);

                // ✅ FIX 2: Use for...of instead of forEach for proper async/await
                for (const request of nonRejectedRequests) {
                    const existingRequest = persistentRequests.find(pr => pr.message.id === request.id);
                    if (!existingRequest) {
                        console.log('🆕 [PERSISTENT QUEUE] New connection request detected, saving to queue:', request.id);
                        await saveRequestToPersistentQueue(request);
                    } else {
                        console.log('⏭️ [PERSISTENT QUEUE] Request already in queue, skipping:', request.id);
                    }
                }

                console.log('✅ [MESSAGE PROCESSING] Message processing complete');
            } catch (error) {
                console.error('❌ [MESSAGE PROCESSING] Error processing messages:', error);
            } finally {
                setIsProcessingMessages(false);
            }
        };

        processMessages();
    }, [app.messages, persistentRequests])

    const toggleDetails = (index: number) => {
        setShowDetails(prev => ({
            ...prev,
            [index]: !prev[index]
        }));
    };

    // Check if a connection request has been accepted by looking for established connections
    const hasAcceptedConnection = (requestMessage: SDK.Domain.Message): boolean => {
        const requestFromDID = requestMessage.from?.toString();
        return app.connections.some(connection =>
            connection.host.toString() === requestFromDID ||
            connection.receiver.toString() === requestFromDID
        );
    };

    // Filter out rejected messages
    const filterRejectedMessages = async (messages: SDK.Domain.Message[]): Promise<SDK.Domain.Message[]> => {
        const walletId = app.agent?.walletId || 'alice';
        const filteredMessages: SDK.Domain.Message[] = [];

        for (const message of messages) {
            try {
                const isRejected = await messageRejection.isRejected(walletId, message.id);
                if (!isRejected) {
                    filteredMessages.push(message);
                } else {
                    console.log(`🚫 [MESSAGE FILTER] Filtered out rejected message: ${message.id}`);
                }
            } catch (error) {
                console.warn(`⚠️ [MESSAGE FILTER] Error checking rejection status for ${message.id}:`, error);
                // Include message if rejection check fails (fail-safe approach)
                filteredMessages.push(message);
            }
        }

        return filteredMessages;
    };


    return (
        <>
            <div className="mx-10 mt-5 mb-30">
                <PageHeader>
                    <h1 className="mb-4 text-4xl font-extrabold tracking-tight leading-none text-gray-900 md:text-5xl lg:text-6xl dark:text-white">
                        Connections
                    </h1>
                </PageHeader>
                <DBConnect>
                    {/* Certification Authority Connection */}
                    <ConnectToCA />

                    {/* Connection Requests Section */}
                    <Box>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                                Connection Requests
                            </h2>
                            <div className="flex items-center space-x-4">
                                <div className="flex flex-col space-y-1">
                                    {queueStats && (
                                        <div className="text-sm text-gray-600 dark:text-gray-400">
                                            <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 px-2 py-1 rounded-full">
                                                {queueStats.pending} pending
                                            </span>
                                            {queueStats.total > queueStats.pending && (
                                                <span className="ml-2 text-xs">
                                                    {queueStats.total - queueStats.pending} handled
                                                </span>
                                            )}
                                        </div>
                                    )}
                                    {rejectionStats && rejectionStats.total > 0 && (
                                        <div className="text-xs text-gray-500 dark:text-gray-400">
                                            <span className="bg-red-100 dark:bg-red-900 text-red-700 dark:text-red-300 px-2 py-1 rounded-full">
                                                {rejectionStats.total} rejected
                                            </span>
                                            {rejectionStats.recentCount > 0 && (
                                                <span className="ml-2">
                                                    ({rejectionStats.recentCount} recent)
                                                </span>
                                            )}
                                        </div>
                                    )}
                                </div>
                                <button
                                    onClick={loadPersistentRequests}
                                    disabled={queueLoading}
                                    className="text-blue-600 dark:text-blue-400 hover:text-blue-800 dark:hover:text-blue-200 text-sm font-medium disabled:opacity-50"
                                >
                                    {queueLoading ? '🔄 Loading...' : '🔄 Refresh'}
                                </button>
                            </div>
                        </div>

                        {/* Admin Tools Section - Duplicate Cleanup */}
                        {queueStats && queueStats.total > queueStats.pending && (
                            <div className="mb-4 p-4 bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 rounded-lg">
                                <div className="flex items-center justify-between">
                                    <div>
                                        <h3 className="text-sm font-semibold text-gray-900 dark:text-white mb-1">
                                            🛠️ Admin Tools
                                        </h3>
                                        <p className="text-xs text-gray-600 dark:text-gray-400">
                                            Clean up duplicate connection requests with the same message ID
                                        </p>
                                    </div>
                                    <button
                                        onClick={async () => {
                                            try {
                                                const walletId = app.agent?.walletId || 'alice';
                                                console.log('🧹 [CLEANUP] Starting deduplication...');

                                                const removedCount = await connectionRequestQueue.deduplicate(walletId);

                                                console.log(`✅ [CLEANUP] Removed ${removedCount} duplicate(s)`);

                                                // Show user feedback
                                                if (removedCount > 0) {
                                                    alert(`✅ Successfully removed ${removedCount} duplicate request(s)`);
                                                } else {
                                                    alert('✅ No duplicates found - queue is clean!');
                                                }

                                                // Reload the queue to update UI
                                                await loadPersistentRequests();
                                            } catch (error) {
                                                console.error('❌ [CLEANUP] Deduplication failed:', error);
                                                alert('❌ Failed to clean duplicates. Check console for details.');
                                            }
                                        }}
                                        disabled={queueLoading}
                                        className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-400 text-white text-sm font-medium rounded-lg transition-colors disabled:cursor-not-allowed"
                                    >
                                        🧹 Clean Duplicates
                                    </button>
                                </div>
                            </div>
                        )}


                        {queueError && (
                            <div className="bg-red-50 dark:bg-red-900 border border-red-200 dark:border-red-700 rounded-lg p-4 mb-4">
                                <div className="flex items-center space-x-2">
                                    <span className="text-red-600 dark:text-red-400">❌</span>
                                    <p className="text-red-800 dark:text-red-200 text-sm">
                                        Error loading connection requests: {queueError}
                                    </p>
                                </div>
                            </div>
                        )}

                        {queueLoading ? (
                            <div className="flex items-center justify-center py-8">
                                <div className="flex items-center space-x-2 text-gray-600 dark:text-gray-400">
                                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                                        <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
                                        <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z" />
                                    </svg>
                                    <span className="text-sm">Loading connection requests...</span>
                                </div>
                            </div>
                        ) : persistentRequests.length === 0 ? (
                            <div className="text-center py-8">
                                <div className="text-gray-400 dark:text-gray-500 mb-2">
                                    <span className="text-4xl">🤝</span>
                                </div>
                                <p className="text-gray-500 dark:text-gray-400 mb-2">
                                    No pending connection requests.
                                </p>
                                <p className="text-xs text-gray-400 dark:text-gray-500">
                                    Connection requests with credential presentations will appear here.
                                </p>
                            </div>
                        ) : (
                            <div className="space-y-4 mb-6">
                                {persistentRequests.map((requestItem, i) => {
                                    // Reconstruct the SDK.Domain.Message from stored data
                                    const reconstructedMessage = {
                                        ...requestItem.message,
                                        from: requestItem.message.from ? {
                                            toString: () => requestItem.message.from
                                        } : null,
                                        to: requestItem.message.to ? {
                                            toString: () => requestItem.message.to
                                        } : null
                                    } as SDK.Domain.Message;

                                    return (
                                        <div key={`persistent-request-${requestItem.id}-${i}`} className="relative">
                                            {/* Request Age Indicator */}
                                            <div className="absolute top-2 right-2 z-10">
                                                <span className="bg-blue-100 dark:bg-blue-900 text-blue-800 dark:text-blue-200 text-xs px-2 py-1 rounded-full">
                                                    {(() => {
                                                        const ageHours = Math.floor((Date.now() - requestItem.timestamp) / (1000 * 60 * 60));
                                                        return ageHours < 1 ? 'New' : `${ageHours}h ago`;
                                                    })()}
                                                </span>
                                            </div>

                                            <ConnectionRequest
                                                message={reconstructedMessage}
                                                attachedCredential={requestItem.attachedCredential}
                                                onRequestHandled={async () => {
                                                    console.log('🔄 Persistent connection request handled:', requestItem.id);
                                                    try {
                                                        // Mark as handled in persistent queue
                                                        await handlePersistentRequestAction(requestItem.id, 'accepted');

                                                        // Also delete from message database if exists
                                                        if (app.db.instance) {
                                                            await app.db.instance.deleteMessage(requestItem.message.id);
                                                            console.log('✅ Message deleted from database');
                                                        }

                                                        // Force refresh connections to update the UI
                                                        await app.dispatch(refreshConnections());
                                                        console.log('✅ Connections refreshed');
                                                    } catch (error) {
                                                        console.error('❌ Failed to handle persistent request:', error);
                                                    }
                                                }}
                                            />
                                        </div>
                                    );
                                })}
                            </div>
                        )}
                    </Box>

                    {/* Connections Section */}
                    <Box>
                        <h2 className="text-2xl font-bold mb-4 text-gray-900 dark:text-white">
                            Established Connections
                        </h2>
                        <OOB
                            agent={app.agent.instance!}
                            pluto={app.db.instance!}
                            onNewConnectionRequest={saveRequestToPersistentQueue}
                        />
                        {
                            connections.length <= 0 ?
                                <p className=" text-lg font-normal text-gray-500 lg:text-xl  dark:text-gray-400">
                                    No established connections.
                                </p>
                                :
                                null
                        }
                        {
                            connections.map((connection, i) => {
                                // Determine connection status - for now we assume all stored connections are established
                                const isEstablished = true; // connection exists in storage = established
                                const statusText = isEstablished ? 'Connected' : 'Pending';
                                const statusBgColor = isEstablished ? 'bg-green-100' : 'bg-yellow-100';
                                const statusTextColor = isEstablished ? 'text-green-800' : 'text-yellow-800';
                                const isDetailsShown = showDetails[i] || false;

                                // Get connection name - prefer connection.name, fallback to VC lookup, then "Unknown Connection"
                                const displayName = connection.name || getConnectionName(
                                    connection.receiver.toString(),
                                    app.credentials
                                );

                                const copyToClipboard = async (text: string, label: string) => {
                                    try {
                                        await copyToClipboardWithLog(text, label);
                                    } catch (error) {
                                        console.error(`Failed to copy ${label}:`, error);
                                    }
                                };

                                return (
                                    <div key={`connection${i}`} className={`glass-card p-6 mb-4 ${isEstablished ? 'border-l-4 border-green-500' : 'border-l-4 border-yellow-500'} hover:transform hover:scale-105 transition-all duration-300`}>
                                        {/* Simplified Connection Display */}
                                        <div className={`${statusBgColor} ${statusTextColor} rounded-lg p-4 text-center`}>
                                            <h2 className="text-2xl font-bold mb-2 gradient-text">
                                                {displayName}
                                            </h2>
                                            <div className="flex items-center justify-center space-x-2">
                                                <div className={`w-3 h-3 rounded-full ${isEstablished ? 'bg-green-500' : 'bg-yellow-500'} animate-pulse`}></div>
                                                <span className="text-lg font-semibold">
                                                    {statusText}
                                                </span>
                                            </div>
                                        </div>

                                        {/* Action Buttons */}
                                        <div className="flex space-x-3 mt-4">
                                            <button className="btn-primary flex-1">
                                                💬 Send Message
                                            </button>
                                            <button
                                                onClick={() => toggleDetails(i)}
                                                className="px-4 py-2 glass-card border-2 border-white/20 hover:border-white/40 transition-all duration-300 rounded-lg"
                                            >
                                                {isDetailsShown ? '🔼 Hide' : '🔽 Details'}
                                            </button>
                                            <button
                                                onClick={async () => {
                                                    if (confirm(`Are you sure you want to delete the connection with "${displayName}"?\n\nThis will remove all associated messages and cannot be undone.`)) {
                                                        try {
                                                            console.log('🗑️ [UI] Deleting connection:', connection.host.toString());
                                                            await app.dispatch(deleteConnection({ connectionHostDID: connection.host.toString() }));
                                                            console.log('✅ [UI] Connection deleted successfully');
                                                        } catch (error) {
                                                            console.error('❌ [UI] Failed to delete connection:', error);
                                                            alert('Failed to delete connection. Please try again.');
                                                        }
                                                    }
                                                }}
                                                className="px-4 py-2 bg-red-500 hover:bg-red-600 text-white rounded-lg transition-all duration-300"
                                                title="Delete connection and all associated messages"
                                            >
                                                🗑️ Delete
                                            </button>
                                        </div>

                                        {/* Collapsible Technical Details */}
                                        {isDetailsShown && (
                                            <div className="mt-6 space-y-4 animate-fadeIn">
                                                <div className="glass-card p-4">
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

                                                <div className="glass-card p-4">
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
                                        )}
                                    </div>
                                );
                            })
                        }
                    </Box>
                </DBConnect>
            </div>
        </>
    );
}