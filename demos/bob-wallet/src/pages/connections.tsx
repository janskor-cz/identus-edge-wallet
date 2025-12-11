import '../app/index.css'

import React, { useEffect, useState } from "react";
import SDK from '@hyperledger/identus-edge-agent-sdk';
import { FooterNavigation } from "@/components/FooterNavigation";

import { Box } from "@/app/Box";
import { useMountedApp } from "@/reducers/store";
import { DBConnect } from "@/components/DBConnect";
import { OOB } from "@/components/OOB";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { copyToClipboardWithLog } from "@/utils/clipboard";
import { PageHeader } from "@/components/PageHeader";
import { refreshConnections, deleteConnection } from "@/actions";
import { ConnectionRequest } from "@/components/ConnectionRequest";
import { filterConnectionMessages } from "@/utils/messageFilters";
import { connectionRequestQueue, ConnectionRequestItem } from "@/utils/connectionRequestQueue";
import { messageRejection } from "@/utils/rejectionManager";
import { ConnectToCA } from "@/components/ConnectToCA";
import { getConnectionNameWithFallback } from "@/utils/connectionNameResolver";
import { getConnectionMetadata } from "@/utils/connectionMetadata";

export default function App() {

    const app = useMountedApp();
    const [connections, setConnections] = React.useState<SDK.Domain.DIDPair[]>([]);
    const [showDetails, setShowDetails] = React.useState<{[key: number]: boolean}>({});

    // Persistent connection request queue state (hidden from UI, but still processed)
    const [persistentRequests, setPersistentRequests] = useState<ConnectionRequestItem[]>([]);
    const [queueLoading, setQueueLoading] = useState(false);
    const [queueError, setQueueError] = useState<string | null>(null);
    const [queueStats, setQueueStats] = useState<any>(null);

    // Rejection tracking state
    const [rejectionStats, setRejectionStats] = useState<any>(null);

    // Processing flag to prevent race conditions
    const [isProcessingMessages, setIsProcessingMessages] = useState(false);

    // Wallet context detection
    const [walletContext, setWalletContext] = useState<'personal' | 'enterprise' | null>(null);
    const [enterpriseConfig, setEnterpriseConfig] = useState<{
        available: boolean;
        enterpriseAgentUrl?: string;
        enterpriseAgentName?: string;
        enterpriseAgentApiKey?: string;
    }>({ available: false });

    // Detect enterprise wallet context from ServiceConfiguration credentials
    useEffect(() => {
        const detectWalletContext = async () => {
            if (!app.db.instance) {
                console.log('ℹ️ [WALLET CONTEXT] Database not initialized yet');
                return;
            }

            try {
                console.log('🏢 [WALLET CONTEXT] Checking for ServiceConfiguration credential...');
                const credentials = await app.db.instance.getAllCredentials();

                // Look for ServiceConfiguration credential
                const serviceConfigVC = credentials.find((cred: any) => {
                    const credentialSubject = cred.credentialSubject;
                    const vcTypes = cred.credentialType || cred.type || [];
                    const typesArray = Array.isArray(vcTypes) ? vcTypes : [vcTypes];

                    // Check EITHER type field OR presence of enterprise fields
                    const hasServiceConfigType = typesArray.includes('ServiceConfiguration');
                    const hasEnterpriseFields = credentialSubject &&
                        credentialSubject.enterpriseAgentUrl &&
                        credentialSubject.enterpriseAgentName &&
                        credentialSubject.enterpriseAgentApiKey;

                    const isServiceConfig = hasServiceConfigType || hasEnterpriseFields;

                    if (isServiceConfig) {
                        console.log('✅ [WALLET CONTEXT] Found ServiceConfiguration credential:', {
                            types: typesArray,
                            hasTypeField: hasServiceConfigType,
                            hasEnterpriseFields: hasEnterpriseFields,
                            credentialSubject
                        });
                    }

                    return isServiceConfig;
                });

                if (serviceConfigVC) {
                    const credentialSubject = serviceConfigVC.credentialSubject;

                    console.log('🏢 [WALLET CONTEXT] Enterprise wallet available:', {
                        url: credentialSubject.enterpriseAgentUrl,
                        name: credentialSubject.enterpriseAgentName
                    });

                    setWalletContext('enterprise');
                    setEnterpriseConfig({
                        available: true,
                        enterpriseAgentUrl: credentialSubject.enterpriseAgentUrl,
                        enterpriseAgentName: credentialSubject.enterpriseAgentName,
                        enterpriseAgentApiKey: credentialSubject.enterpriseAgentApiKey
                    });
                } else {
                    console.log('ℹ️ [WALLET CONTEXT] No ServiceConfiguration credential found');
                    setWalletContext('personal');
                    setEnterpriseConfig({ available: false });
                }
            } catch (error) {
                console.error('❌ [WALLET CONTEXT] Error detecting wallet context:', error);
                setWalletContext('personal');
                setEnterpriseConfig({ available: false });
            }
        };

        detectWalletContext();
    }, [app.db.instance, app.credentials]);

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

            const requests = await connectionRequestQueue.getPendingRequests(walletId);

            setPersistentRequests(requests);

            // Load queue statistics
            const stats = await connectionRequestQueue.getStats(walletId);
            setQueueStats(stats);

            // Load rejection statistics
            try {
                const rejectionStats = await messageRejection.getStats(walletId);
                setRejectionStats(rejectionStats);
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

            // Extract attached credential if any
            const attachedCredential = extractCredentialFromMessage(message);

            const requestId = await connectionRequestQueue.addRequest(
                walletId,
                message,
                attachedCredential,
                24 // expire in 24 hours
            );


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

            await connectionRequestQueue.handleRequest(walletId, requestId, action, verificationResult);

            // Reload the queue to update the UI
            await loadPersistentRequests();


        } catch (error) {
            console.error('❌ [PERSISTENT QUEUE] Failed to handle request action:', error);
        }
    };

    // Enhanced credential extraction from message attachments AND body
    const extractCredentialFromMessage = (message: SDK.Domain.Message): any => {
        try {

            // PRIORITY 1: Check message body for requests_attach field (NEW PATTERN)
            // This pattern survives IndexedDB serialization (body can be string or object)
            try {
                // FIX: Handle both string and object body types
                let messageBody;
                if (typeof message.body === 'string') {
                    messageBody = JSON.parse(message.body);
                } else if (typeof message.body === 'object' && message.body !== null) {
                    messageBody = message.body;
                } else {
                    console.warn('⚠️ [VC-EXTRACTION] Message body has unexpected type:', typeof message.body);
                    throw new Error('Invalid message body type');
                }

                if (messageBody.requests_attach && messageBody.requests_attach.length > 0) {

                    for (const attachment of messageBody.requests_attach) {

                        // Look for vc-proof-response in requests_attach
                        if (attachment["@id"] === "vc-proof-response") {

                            // Extract credential from data.json field (NOT data.base64)
                            if (attachment.data && attachment.data.json) {
                                let credentialData = attachment.data.json;

                                // FALLBACK: Unwrap SDK.Domain.Credential wrapper if present
                                if (credentialData.credentialType === 'prism/jwt' &&
                                    credentialData.recoveryId === 'jwt+credential' &&
                                    !credentialData.credentialSubject) {

                                    // Try multiple extraction methods
                                    if (typeof credentialData.verifiableCredential === 'function') {
                                        credentialData = credentialData.verifiableCredential();
                                    } else if (credentialData.vc) {
                                        credentialData = credentialData.vc;
                                    } else if (credentialData.properties) {
                                        credentialData = credentialData.properties;
                                    } else {
                                        console.warn('⚠️ [VC-EXTRACTION] SDK wrapper detected but unable to unwrap');
                                    }
                                }

                                // Validate credential structure
                                if (credentialData.type || credentialData.credentialType || credentialData.credentialSubject) {
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
                }
            } catch (bodyParseError) {
            }

            // PRIORITY 2: Check SDK attachments array (LEGACY FALLBACK)
            if (message.attachments && message.attachments.length > 0) {
                for (const attachment of message.attachments) {

                    // Priority check for "vc-proof-response" attachment ID
                    if (attachment.id === 'vc-proof-response') {

                        // Handle both base64 and raw data formats
                        let credentialData = null;

                        // Try base64 format first
                        if (attachment.data) {
                            try {
                                // AttachmentDescriptor stores data as base64 string directly
                                const decodedData = atob(attachment.data.toString());
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
                                return credentialData;
                            } else {
                                console.warn('⚠️ [VC-EXTRACTION] Data does not look like a valid credential');
                            }
                        }
                    }

                    // Fallback to legacy extraction for backward compatibility
                    if (attachment.data && attachment.data.base64) {
                        try {
                            const decodedData = atob(attachment.data.base64);
                            const parsedData = JSON.parse(decodedData);

                            // Check for various credential wrapper formats
                            if (parsedData.verifiableCredential) {
                                return parsedData.verifiableCredential;
                            }
                            if (parsedData.credentials) {
                                return parsedData.credentials[0] || parsedData.credentials;
                            }
                            if (parsedData.credential) {
                                return parsedData.credential;
                            }

                            // Check if the decoded data itself is a credential
                            if (parsedData.type || parsedData.credentialType || parsedData.credentialSubject) {
                                return parsedData;
                            }
                        } catch (legacyError) {
                            console.warn('⚠️ [VC-EXTRACTION] Legacy extraction failed:', legacyError.message);
                        }
                    }
                }

            } else {
            }
        } catch (error) {
            console.error('❌ [VC-EXTRACTION] Error extracting credential from message:', error);
        }
        return null;
    };

    // Refresh connections and load persistent requests when page loads
    useEffect(() => {

        if (app.db.instance && app.db.connected) {
            app.dispatch(refreshConnections());

            // Load persistent connection requests
            loadPersistentRequests();
        } else {
        }
    }, [app.db.instance, app.db.connected, app.dispatch])

    // Monitor for new connection requests and save them to persistent queue
    useEffect(() => {
        const processMessages = async () => {
            // Prevent concurrent executions with processing flag
            if (isProcessingMessages) {
                return;
            }

            setIsProcessingMessages(true);

            try {
                // Filter for both Mercury AND DIDExchange protocol connection requests
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

                // Use for...of instead of forEach for proper async/await
                for (const request of nonRejectedRequests) {
                    const existingRequest = persistentRequests.find(pr => pr.message.id === request.id);
                    if (!existingRequest) {
                        await saveRequestToPersistentQueue(request);
                    } else {
                    }
                }

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

    // Helper function to check if a connection request already has an established connection
    const hasAcceptedConnection = (message: SDK.Domain.Message): boolean => {
        try {
            // Check if we have an established connection for this message's sender
            const senderDID = message.from?.toString();
            if (!senderDID) return false;

            // Look for a connection with this DID
            const existingConnection = app.connections.find(conn => {
                const receiverDID = conn.receiver?.toString();
                return receiverDID === senderDID;
            });

            return !!existingConnection;
        } catch (error) {
            console.error('❌ [CONNECTION CHECK] Error checking for existing connection:', error);
            return false;
        }
    };

    // Helper function to filter out rejected messages
    const filterRejectedMessages = async (messages: SDK.Domain.Message[]): Promise<SDK.Domain.Message[]> => {
        try {
            const walletId = app.agent?.walletId || 'alice';
            const nonRejectedMessages: SDK.Domain.Message[] = [];

            for (const message of messages) {
                const isRejected = await messageRejection.isRejected(walletId, message.id);
                if (!isRejected) {
                    nonRejectedMessages.push(message);
                }
            }

            return nonRejectedMessages;
        } catch (error) {
            console.error('❌ [REJECTION FILTER] Error filtering rejected messages:', error);
            return messages; // Return all messages if filtering fails
        }
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

                    {/* Connections Section */}
                    <Box>
                        <div className="flex items-center justify-between mb-4">
                            <h2 className="text-2xl font-bold text-gray-900 dark:text-white">
                                Established Connections
                            </h2>
                        </div>

                        {/* Wallet Type Selector - Clickable Cards */}
                        <div className="mb-6 grid grid-cols-1 md:grid-cols-2 gap-4">
                            {/* Personal Wallet Card */}
                            <div
                                onClick={() => setWalletContext('personal')}
                                className={`cursor-pointer border-2 rounded-xl p-6 transition-all duration-200 ${
                                    walletContext === 'personal'
                                        ? 'border-blue-500 bg-blue-50 dark:bg-blue-900/30 shadow-lg'
                                        : 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-blue-300 dark:hover:border-blue-700'
                                }`}
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div className="text-3xl">🏠</div>
                                    {walletContext === 'personal' && (
                                        <div className="px-3 py-1 bg-blue-600 text-white rounded-full text-xs font-semibold">
                                            ✓ Selected
                                        </div>
                                    )}
                                </div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                                    Personal Wallet
                                </h3>
                                <p className="text-sm text-gray-600 dark:text-gray-400">
                                    Browser-based peer-to-peer wallet using Peer DIDs
                                </p>
                            </div>

                            {/* Enterprise Wallet Card */}
                            <div
                                onClick={() => enterpriseConfig.available && setWalletContext('enterprise')}
                                className={`border-2 rounded-xl p-6 transition-all duration-200 ${
                                    walletContext === 'enterprise'
                                        ? 'border-purple-500 bg-purple-50 dark:bg-purple-900/30 shadow-lg cursor-pointer'
                                        : enterpriseConfig.available
                                        ? 'border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-800 hover:border-purple-300 dark:hover:border-purple-700 cursor-pointer'
                                        : 'border-gray-200 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 opacity-50 cursor-not-allowed'
                                }`}
                            >
                                <div className="flex items-start justify-between mb-3">
                                    <div className="text-3xl">🏢</div>
                                    {walletContext === 'enterprise' && enterpriseConfig.available && (
                                        <div className="px-3 py-1 bg-purple-600 text-white rounded-full text-xs font-semibold">
                                            ✓ Selected
                                        </div>
                                    )}
                                </div>
                                <h3 className="text-lg font-bold text-gray-900 dark:text-white mb-2">
                                    Enterprise Wallet
                                </h3>
                                {enterpriseConfig.available ? (
                                    <>
                                        <p className="text-sm text-gray-600 dark:text-gray-400 mb-2">
                                            Connected to {enterpriseConfig.enterpriseAgentName}
                                        </p>
                                        <div className="text-xs text-gray-500 dark:text-gray-500 font-mono truncate">
                                            {enterpriseConfig.enterpriseAgentUrl}
                                        </div>
                                    </>
                                ) : (
                                    <p className="text-sm text-gray-500 dark:text-gray-500">
                                        Not available - activate ServiceConfiguration credential
                                    </p>
                                )}
                            </div>
                        </div>

                        <OOB
                            agent={app.agent.instance!}
                            pluto={app.db.instance!}
                            onNewConnectionRequest={saveRequestToPersistentQueue}
                            walletContext={walletContext}
                            enterpriseConfig={enterpriseConfig}
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

                                // Get connection metadata to determine wallet type
                                const connectionMetadata = getConnectionMetadata(connection.host.toString());
                                const walletType = connectionMetadata?.walletType || 'local';
                                const isCloudWallet = walletType === 'cloud';

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
                                            <div className="flex items-center justify-center space-x-2 mb-2">
                                                <div className={`w-3 h-3 rounded-full ${isEstablished ? 'bg-green-500' : 'bg-yellow-500'} animate-pulse`}></div>
                                                <span className="text-lg font-semibold">
                                                    {statusText}
                                                </span>
                                            </div>
                                            {/* Wallet Type Indicator */}
                                            <div className="flex items-center justify-center space-x-2 mt-2">
                                                <span className={`px-3 py-1 rounded-full text-xs font-semibold ${
                                                    isCloudWallet
                                                        ? 'bg-purple-100 dark:bg-purple-900/40 text-purple-800 dark:text-purple-200 border border-purple-300 dark:border-purple-700'
                                                        : 'bg-blue-100 dark:bg-blue-900/40 text-blue-800 dark:text-blue-200 border border-blue-300 dark:border-blue-700'
                                                }`}>
                                                    {isCloudWallet ? '☁️ Cloud Wallet' : '🏠 Local Wallet'}
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
                                                            await app.dispatch(deleteConnection({ connectionHostDID: connection.host.toString() }));
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
                                                {/* Cloud Wallet Details (if applicable) */}
                                                {isCloudWallet && connectionMetadata && (
                                                    <div className="glass-card p-4 bg-purple-50 dark:bg-purple-900/20 border border-purple-200 dark:border-purple-700">
                                                        <div className="flex items-center space-x-2 mb-3">
                                                            <span className="text-lg">☁️</span>
                                                            <label className="text-sm font-semibold text-purple-900 dark:text-purple-100">
                                                                Cloud Wallet Configuration
                                                            </label>
                                                        </div>

                                                        {connectionMetadata.prismDid && (
                                                            <div className="mb-3">
                                                                <div className="flex items-center justify-between mb-1">
                                                                    <label className="text-xs font-semibold text-purple-800 dark:text-purple-200">
                                                                        PRISM DID
                                                                    </label>
                                                                    <button
                                                                        onClick={() => copyToClipboard(connectionMetadata.prismDid!, 'PRISM DID')}
                                                                        className="text-xs text-purple-600 dark:text-purple-400 hover:text-purple-800 dark:hover:text-purple-200 transition-colors"
                                                                    >
                                                                        📋 Copy
                                                                    </button>
                                                                </div>
                                                                <p className="text-xs font-mono text-purple-700 dark:text-purple-300 break-all bg-white dark:bg-purple-900/40 p-2 rounded border border-purple-200 dark:border-purple-700">
                                                                    {connectionMetadata.prismDid}
                                                                </p>
                                                            </div>
                                                        )}

                                                        {connectionMetadata.enterpriseAgentUrl && (
                                                            <div className="mb-3">
                                                                <label className="text-xs font-semibold text-purple-800 dark:text-purple-200 block mb-1">
                                                                    Enterprise Agent URL
                                                                </label>
                                                                <p className="text-xs text-purple-700 dark:text-purple-300 break-all bg-white dark:bg-purple-900/40 p-2 rounded border border-purple-200 dark:border-purple-700">
                                                                    {connectionMetadata.enterpriseAgentUrl}
                                                                </p>
                                                            </div>
                                                        )}

                                                        <div className="text-xs text-purple-600 dark:text-purple-400 mt-2">
                                                            ℹ️ This connection uses your company's cloud-managed wallet
                                                        </div>
                                                    </div>
                                                )}

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