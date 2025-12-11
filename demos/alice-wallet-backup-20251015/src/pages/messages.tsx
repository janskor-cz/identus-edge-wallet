import SDK from "@hyperledger/identus-edge-agent-sdk";
import React, { useEffect, useState } from "react";
import '../app/index.css'
import { FooterNavigation } from "@/components/FooterNavigation";
import { Box } from "@/app/Box";
import { useMountedApp } from "@/reducers/store";
import { DBConnect } from "@/components/DBConnect";
import { Message } from "@/components/Message";
import { PageHeader } from "@/components/PageHeader";
import { AgentRequire } from "@/components/AgentRequire";
import { ConnectionSelect } from "@/components/ConnectionSelect";
import { Chat } from "@/components/Chat";
import { filterChatMessages, filterChatAndCredentialMessages, groupChatMessagesByConnection, MESSAGE_TYPES } from "@/utils/messageFilters";
import { sendMessage } from "@/actions";




export default function App() {
    const app = useMountedApp();

    const [messages, setMessages] = useState(app.messages);
    const [selectedConnection, setSelectedConnection] = useState<SDK.Domain.DIDPair | null>(null);
    const [conversationMessages, setConversationMessages] = useState<SDK.Domain.Message[]>([]);
    const [activeTab, setActiveTab] = useState<'chat' | 'all' | 'debug'>('chat');
    const [showDebug, setShowDebug] = useState(false);

    useEffect(() => {
        setMessages(app.messages)
    }, [app.messages, app.db])

    useEffect(() => {
        // Filter messages for selected conversation
        if (selectedConnection && messages.length > 0) {

            const chatMessages = filterChatAndCredentialMessages(messages);

            const filtered = chatMessages.filter(msg => {
                const from = msg.from?.toString();
                const to = msg.to?.toString();
                const hostStr = selectedConnection.host.toString();
                const receiverStr = selectedConnection.receiver.toString();

                // Primary matching: exact DID match
                const exactMatch = (from === hostStr && to === receiverStr) ||
                                  (from === receiverStr && to === hostStr);

                // Fallback matching: check if either DID appears in the message
                const fallbackMatch = (from === hostStr || from === receiverStr) ||
                                     (to === hostStr || to === receiverStr);

                const matches = exactMatch || fallbackMatch;


                return matches;
            });

            // Sort messages by timestamp for chronological order
            const sortedMessages = filtered.sort((a, b) => {
                const aTime = a.createdTime ? new Date(a.createdTime).getTime() : 0;
                const bTime = b.createdTime ? new Date(b.createdTime).getTime() : 0;
                return aTime - bTime; // Oldest first
            });


            setConversationMessages(sortedMessages);
        } else {
            setConversationMessages([]);
        }
    }, [selectedConnection, messages])

    async function handleSendMessage(content: string, toDID: string) {

        if (!content || content === "") {
            throw new Error("Message content is required");
        }

        if (!selectedConnection) {
            throw new Error("No connection selected");
        }

        const agent = app.agent.instance!;

        // Use the stored connection DIDs instead of creating new ephemeral DIDs
        const fromDID = selectedConnection.host;  // Sender's DID from the connection
        const toDIDObj = selectedConnection.receiver;  // Recipient's DID from the connection


        const message = new SDK.BasicMessage(
            { content },
            fromDID,
            toDIDObj
        );

        const messageObj = message.makeMessage();

        try {
            const result = await app.dispatch(sendMessage({ agent, message: messageObj }));
        } catch (error) {
            console.error('❌ [DEBUG] sendMessage failed:', error);
            throw error;
        }
    }

    return (
        <>
            <div className="w-full px-4 md:px-6 lg:px-8 mt-5 mb-30">
                <PageHeader>
                    <h1 className="mb-4 text-4xl font-extrabold tracking-tight leading-none text-gray-900 md:text-5xl lg:text-6xl dark:text-white">
                        Messages
                    </h1>
                </PageHeader>
                <DBConnect>
                    <AgentRequire>
                        {/* Proof Requests Section - Show ALL presentation requests prominently */}
                        {(() => {
                            const proofRequests = messages.filter(msg =>
                                msg.piuri === MESSAGE_TYPES.PRESENTATION_REQUEST &&
                                msg.direction === SDK.Domain.MessageDirection.RECEIVED
                            );

                            if (proofRequests.length === 0) return null;

                            return (
                                <Box className="mb-4 bg-blue-50 dark:bg-blue-900/30 border-2 border-blue-500">
                                    <div className="flex items-center gap-2 mb-4">
                                        <span className="text-3xl">🔐</span>
                                        <h2 className="text-xl font-bold text-blue-900 dark:text-blue-100">
                                            Pending Proof Requests ({proofRequests.length})
                                        </h2>
                                    </div>
                                    <p className="text-sm text-blue-800 dark:text-blue-200 mb-4">
                                        ⚠️ You have received verification requests. Please select a credential to respond.
                                    </p>
                                    <div className="space-y-3">
                                        {proofRequests.map((message, i) => (
                                            <div key={`proof-request-${message.id}_${i}`} className="bg-white dark:bg-gray-800 rounded-lg shadow-md border-2 border-blue-400 overflow-hidden">
                                                <Message message={message} />
                                            </div>
                                        ))}
                                    </div>
                                </Box>
                            );
                        })()}

                        <div className="flex flex-col lg:flex-row gap-4 w-full">
                            {/* Conversation List */}
                            <Box className="w-full lg:w-80 xl:w-96 flex-shrink-0">
                                <h2 className="text-xl font-bold mb-4 text-gray-900 dark:text-white">
                                    Conversations
                                </h2>
                                {app.connections.length === 0 ? (
                                    <p className="text-gray-500 dark:text-gray-400">
                                        No connections yet
                                    </p>
                                ) : (
                                    <div className="space-y-2">
                                        {app.connections.map((connection, i) => {
                                            const isSelected = selectedConnection?.host.toString() === connection.host.toString();
                                            // Count unread messages for this connection
                                            const chatMessages = filterChatAndCredentialMessages(messages);
                                            const connectionMessages = chatMessages.filter(msg => {
                                                const from = msg.from?.toString();
                                                const to = msg.to?.toString();
                                                const hostStr = connection.host.toString();
                                                const receiverStr = connection.receiver.toString();
                                                return (from === hostStr && to === receiverStr) ||
                                                       (from === receiverStr && to === hostStr);
                                            });
                                            const hasMessages = connectionMessages.length > 0;

                                            return (
                                                <div
                                                    key={`connection-${i}`}
                                                    onClick={() => setSelectedConnection(connection)}
                                                    className={`p-3 rounded-lg cursor-pointer transition-all ${
                                                        isSelected
                                                            ? 'bg-blue-100 dark:bg-blue-900 border-l-4 border-blue-500'
                                                            : 'hover:bg-gray-100 dark:hover:bg-gray-700'
                                                    }`}
                                                >
                                                    <div className="flex items-center justify-between">
                                                        <div className="flex-1">
                                                            <p className="font-semibold text-gray-900 dark:text-white">
                                                                {connection.name || 'Unknown Contact'}
                                                            </p>
                                                            <p className="text-xs text-gray-500 dark:text-gray-400 truncate">
                                                                {connection.receiver.toString().substring(0, 30)}...
                                                            </p>
                                                        </div>
                                                        {hasMessages && (
                                                            <span className="bg-blue-500 text-white text-xs px-2 py-1 rounded-full">
                                                                {connectionMessages.length}
                                                            </span>
                                                        )}
                                                    </div>
                                                </div>
                                            );
                                        })}
                                    </div>
                                )}
                            </Box>

                            {/* Chat Area */}
                            <Box className="flex-1 min-w-0 overflow-hidden">
                                {selectedConnection ? (
                                    <div className="h-full flex flex-col">
                                        {/* Tab Navigation */}
                                        <div className="flex border-b border-gray-200 dark:border-gray-700 mb-4">
                                            <button
                                                onClick={() => setActiveTab('chat')}
                                                className={`px-4 py-2 font-medium text-sm transition-colors ${
                                                    activeTab === 'chat'
                                                        ? 'text-blue-600 border-b-2 border-blue-600'
                                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                                                }`}
                                            >
                                                💬 Chat
                                            </button>
                                            <button
                                                onClick={() => setActiveTab('all')}
                                                className={`px-4 py-2 font-medium text-sm transition-colors ${
                                                    activeTab === 'all'
                                                        ? 'text-blue-600 border-b-2 border-blue-600'
                                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                                                }`}
                                            >
                                                📨 All Messages
                                            </button>
                                            <button
                                                onClick={() => setActiveTab('debug')}
                                                className={`px-4 py-2 font-medium text-sm transition-colors ${
                                                    activeTab === 'debug'
                                                        ? 'text-blue-600 border-b-2 border-blue-600'
                                                        : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
                                                }`}
                                            >
                                                🐛 Debug
                                            </button>
                                        </div>

                                        {/* Tab Content */}
                                        <div className="flex-1 overflow-hidden">
                                            {activeTab === 'chat' && (
                                                <Chat
                                                    messages={conversationMessages}
                                                    connection={selectedConnection}
                                                    onSendMessage={handleSendMessage}
                                                />
                                            )}

                                            {activeTab === 'all' && (
                                                <div className="h-full overflow-y-auto">
                                                    <div className="space-y-3 p-4">
                                                        {conversationMessages.length === 0 ? (
                                                            <p className="text-gray-500 dark:text-gray-400 text-center py-8">
                                                                No messages yet for this connection
                                                            </p>
                                                        ) : (
                                                            conversationMessages.map((message, i) => (
                                                                <div key={`message-${message.id}_${i}`} className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 overflow-hidden">
                                                                    <Message message={message} />
                                                                </div>
                                                            ))
                                                        )}
                                                    </div>
                                                </div>
                                            )}

                                            {activeTab === 'debug' && (
                                                <div className="h-full overflow-y-auto p-4">
                                                    <div className="bg-gray-100 dark:bg-gray-800 rounded-lg p-4">
                                                        <h3 className="text-sm font-bold mb-2 text-red-600">Raw Messages from Database</h3>
                                                        <div className="text-xs font-mono space-y-2 max-h-96 overflow-y-auto">
                                                            {app.messages.length === 0 ? (
                                                                <p className="text-gray-500">No messages in database</p>
                                                            ) : (
                                                                app.messages.map((msg, i) => (
                                                                    <div key={i} className="p-2 bg-white dark:bg-gray-700 rounded border-l-4 border-blue-500">
                                                                        <div className="overflow-x-auto">
                                                                            <div><strong>ID:</strong> {msg.id}</div>
                                                                            <div><strong>Type:</strong> {msg.piuri}</div>
                                                                            <div className="whitespace-pre-wrap break-words"><strong>Body:</strong> {JSON.stringify(msg.body, null, 2)}</div>
                                                                            <div className="truncate"><strong>From:</strong> {msg.from?.toString()}</div>
                                                                            <div className="truncate"><strong>To:</strong> {msg.to?.toString()}</div>
                                                                            <div><strong>Direction:</strong> {msg.direction}</div>
                                                                        </div>
                                                                    </div>
                                                                ))
                                                            )}
                                                        </div>
                                                    </div>
                                                </div>
                                            )}
                                        </div>
                                    </div>
                                ) : (
                                    <div className="h-full flex items-center justify-center text-gray-500 dark:text-gray-400">
                                        <div className="text-center">
                                            <p className="text-2xl mb-2">💬</p>
                                            <p>Select a conversation to start messaging</p>
                                        </div>
                                    </div>
                                )}
                            </Box>
                        </div>
                    </AgentRequire>
                </DBConnect>
            </div>
        </>
    );
}