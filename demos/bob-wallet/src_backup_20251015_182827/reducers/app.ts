import { PayloadAction, createSlice } from "@reduxjs/toolkit";
// Using SDK for initial state - direct import (memory managed elsewhere)
import SDK from "@hyperledger/identus-edge-agent-sdk";
import { v4 as uuidv4 } from "uuid";
import { DBPreload, Message, Credential, Mediator, Connection } from "@/actions/types";
import { acceptCredentialOffer, acceptPresentationRequest, connectDatabase, initAgent, rejectCredentialOffer, sendMessage, startAgent, stopAgent, refreshConnections, refreshCredentials } from "../actions";

// Hardcoded Bob wallet configuration
const getWalletConfig = () => {
    return {
        walletId: 'bob',
        walletName: 'Bob Wallet',
        dbName: 'identus-wallet-bob', // Unique database per wallet
        storagePrefix: 'wallet-bob-' // Unique storage prefix
    };
};

// Updated to single HTTP endpoint only (no WebSocket) - mediator restarted on 2025-10-11
const defaultMediatorDID = "did:peer:2.Ez6LSghwSE437wnDE1pt3X6hVDUQzSjsHzinpX3XFvMjRAm7y.Vz6Mkhh1e5CEYYq6JBUcTZ6Cp2ranCWRrv7Yax3Le4N59R6dd.SeyJ0IjoiZG0iLCJzIjp7InVyaSI6Imh0dHA6Ly85MS45OS40LjU0OjgwODAiLCJhIjpbImRpZGNvbW0vdjIiXX19";

export type ApiCall = {
    title: string,
    description: string,
    method: string,
    endpoint: (store: Store) => string,
    requestBody: (store: Store) => any,
    curlCommand: (url: string, method: string, body?: string | null) => string
}

export type Component = (props: any) => React.JSX.Element;
export type Content = CodeBlock | ApiCall | Component;
export type Store = { [name: string]: any }
export type Step = {
    title: string,
    description: string,
    content: Content[],
    onNext?: (store: Store) => Promise<void>
}
export type CodeBlock = {
    language: string,
    code: string
}


class TraceableError extends Error {

    constructor(...params) {
        super(...params)
    }

    public id = uuidv4();
    static fromError(err: Error) {
        return new TraceableError(err.message);
    }
}

export enum DBStatus {
    "disconnected" = "disconnected",
    "connected" = "connected"
}

// Create defaultSeed with fallback for memory issues
let defaultSeed: SDK.Domain.Seed;
try {
    defaultSeed = new SDK.Apollo().createSeed([
        "repeat",
        "spider",
        "frozen",
        "drama",
        "april",
        "step",
        "engage",
        "pitch",
        "purity",
        "arrest",
        "orchard",
        "grocery",
        "green",
        "chapter",
        "know",
        "disease",
        "attend",
        "notable",
        "usage",
        "add",
        "trash",
        "dry",
        "refuse",
        "jewel"
    ]);
} catch (error) {
    console.warn('⚠️ SDK not available at initialization, using placeholder seed');
    // Create a placeholder seed that will be replaced when SDK loads
    defaultSeed = {
        value: new Uint8Array(64), // Placeholder 64-byte seed
        size: 64
    } as SDK.Domain.Seed;
}

const walletConfig = getWalletConfig();

export const initialState: RootState = {
    errors: [],
    wallet: walletConfig,
    db: {
        instance: null,
        connected: false,
        isConnecting: false,
        hasConnected: false,
    },
    messages: [],
    chatMessages: [],
    protocolMessages: [],
    currentConversation: null,
    messageSendingStatus: {},
    connections: [],
    credentials: [],
    mediatorDID: (() => {
        try {
            return SDK.Domain.DID.fromString(defaultMediatorDID);
        } catch (error) {
            console.warn('⚠️ SDK not available at initialization, using placeholder mediatorDID');
            // Create a placeholder DID that will be replaced when SDK loads
            return {
                method: 'peer',
                methodId: 'placeholder',
                toString: () => defaultMediatorDID
            } as SDK.Domain.DID;
        }
    })(),
    defaultSeed: defaultSeed,
    agent: {
        instance: null,
        hasStarted: false,
        isStarting: false,
        isSendingMessage: false,
        hasSentMessage: false,
        selfDID: null
    }
}

export type ExtendedMessage = SDK.Domain.Message & { isAnswering: boolean; hasAnswered: boolean, error: TraceableError | null }

export type MessageStatus = 'sending' | 'sent' | 'failed' | 'received';

export type ChatMessage = {
    id: string;
    content: string;
    from: string;
    to: string;
    timestamp: Date;
    direction: SDK.Domain.MessageDirection;
    status: MessageStatus;
    connectionId?: string;
};

export type WalletConfig = {
    walletId: string;
    walletName: string;
    dbName: string;
    storagePrefix: string;
};

export type RootState = {
    errors: TraceableError[];
    wallet: WalletConfig;
    db: {
        instance: SDK.Domain.Pluto | null,
        connected: boolean
        isConnecting: boolean,
        hasConnected: boolean
    },
    messages: ExtendedMessage[],
    chatMessages: ChatMessage[],  // New: separated chat messages
    protocolMessages: SDK.Domain.Message[],  // New: connection/credential messages
    currentConversation: string | null,  // New: selected conversation
    messageSendingStatus: { [messageId: string]: MessageStatus },  // New: track sending status
    connections: SDK.Domain.DIDPair[],
    credentials: SDK.Domain.Credential[],
    mediatorDID: SDK.Domain.DID,
    defaultSeed: SDK.Domain.Seed,
    agent: {
        instance: SDK.Agent | null,
        selfDID: SDK.Domain.DID | null,
        isStarting: boolean,
        hasStarted: boolean,
        isSendingMessage: boolean,
        hasSentMessage: boolean
    }
};

function removeDuplicates(messages: SDK.Domain.Message[] | SDK.Domain.Credential[]) {
    const uniqueMessages = new Map();
    messages.forEach(message => {
        uniqueMessages.set(message.id, message);
    });
    return Array.from(uniqueMessages.values());
}

const appSlice = createSlice({
    name: "app",
    initialState: initialState,
    reducers: {
        [Mediator.update]: (
            state,
            action: PayloadAction<{
                mediator: string
            }>
        ) => {
            state.mediatorDID = SDK.Domain.DID.fromString(action.payload.mediator)
        },
        [DBPreload.complete]: (
            state,
            action: PayloadAction<{
                messages: SDK.Domain.Message[],
                connections: SDK.Domain.DIDPair[],
                credentials: SDK.Domain.Credential[]
            }>
        ) => {
            state.messages = action.payload.messages as any;
            state.connections = action.payload.connections;
            state.credentials = action.payload.credentials;
        },
        [Credential.success]: (
            state,
            action: PayloadAction<SDK.Domain.Credential>
        ) => {
            state.credentials = removeDuplicates([
                ...state.credentials,
                action.payload,
            ]);
        },
        [Message.success]: (
            state,
            action: PayloadAction<SDK.Domain.Message[]>
        ) => {
            const nonExisting = action.payload.filter((m) => !state.messages.find((d) => d.id === m.id))
            state.messages = removeDuplicates([
                ...action.payload,
                ...state.messages.map((oldMessage) => {
                    if (action.payload.find((m) => m.thid === oldMessage.thid)) {
                        return {
                            ...oldMessage,
                            isAnswering: false,
                            hasAnswered: true
                        }
                    }
                    return oldMessage
                }),
                ...nonExisting
            ]);
        },
        "updateAgent": (
            state,
            action: PayloadAction<{ agent: SDK.Agent, selfDID: SDK.Domain.DID, pluto: SDK.Domain.Pluto }>
        ) => {
            state.agent.isStarting = false;
            state.agent.hasStarted = true;
            state.agent.instance = action.payload.agent;
            state.agent.selfDID = action.payload.selfDID;
            state.db.hasConnected = true;
            state.db.isConnecting = false;
            state.db.instance = action.payload.pluto;
            state.db.connected = true;
        },
    },
    extraReducers: (builder) => {

        builder.addCase(sendMessage.fulfilled, (state, action) => {
            state.agent.isSendingMessage = false;
            state.agent.hasSentMessage = true;
        })

        builder.addCase(sendMessage.pending, (state, action) => {
            state.agent.isSendingMessage = true;
            state.agent.hasSentMessage = false;
            let credentialFormat = SDK.Domain.CredentialType.Unknown;
            try {
                credentialFormat = action.meta.arg.message.credentialFormat;
            }
            catch { }

            state.messages.push({
                ...action.meta.arg.message,
                isAnswering: true,
                hasAnswered: false,
                error: null,
                body: action.meta.arg.message.body,
                credentialFormat
            })
        })

        builder.addCase(sendMessage.rejected, (state, action) => {
            state.agent.isSendingMessage = false;
            state.agent.hasSentMessage = false;
            state.errors.push(TraceableError.fromError(action.payload as Error));
        })

        builder.addCase(stopAgent.fulfilled, (state, action) => {
            state.agent.isStarting = false;
            state.agent.hasStarted = false;
        });

        builder.addCase(stopAgent.rejected, (state, action) => {
            state.agent.isStarting = false;
            state.agent.hasStarted = false;
            state.errors.push(TraceableError.fromError(action.payload as Error));
        });

        builder.addCase(startAgent.pending, (state, action) => {
            state.agent.isStarting = true;
            state.agent.hasStarted = false;
        });

        builder.addCase(startAgent.fulfilled, (state, action) => {
            state.agent.isStarting = false;
            state.agent.hasStarted = true;
            state.agent.instance = action.payload.agent;
            state.agent.selfDID = action.payload.selfDID;
        });

        builder.addCase(startAgent.rejected, (state, action) => {
            state.agent.isStarting = false;
            state.agent.hasStarted = false;
            state.errors.push(TraceableError.fromError(action.payload as Error));
        });

        builder.addCase(initAgent.pending, (state, action) => {
            state.agent.instance = null;
        });

        builder.addCase(refreshConnections.fulfilled, (state, action) => {
            state.connections = action.payload.connections;
        });

        builder.addCase(refreshConnections.rejected, (state, action) => {
            state.errors.push(TraceableError.fromError(action.payload as Error));
        });

        builder.addCase(refreshCredentials.fulfilled, (state, action) => {
            state.credentials = action.payload.credentials;
        });

        builder.addCase(refreshCredentials.rejected, (state, action) => {
            state.errors.push(TraceableError.fromError(action.payload as Error));
        });

        builder.addCase(initAgent.rejected, (state, action) => {
            state.agent.instance = null;
            state.errors.push(TraceableError.fromError(action.payload as Error));
        });

        builder.addCase(initAgent.fulfilled, (state, action) => {
            state.agent.instance = action.payload.agent;
        });

        builder.addCase(connectDatabase.fulfilled, (state, action) => {
            state.db.hasConnected = true;
            state.db.isConnecting = false;
            state.db.instance = action.payload.db;
            state.db.connected = true;
        });

        builder.addCase(connectDatabase.rejected, (state, action) => {
            state.errors.push(TraceableError.fromError(action.payload as Error));
            state.db.hasConnected = false;
            state.db.isConnecting = false;
            state.db.instance = null;
            state.db.connected = false;
        });

        builder.addCase(connectDatabase.pending, (state) => {
            state.db.hasConnected = false;
            state.db.isConnecting = true;
            state.db.instance = null;
            state.db.connected = false;
        });

        builder.addCase(acceptPresentationRequest.pending, (state, action) => {
            const message = action.meta.arg.message;
            state.messages = state.messages.map((currentMessage) => {
                if (currentMessage.id === message.id) {
                    return {
                        ...currentMessage,
                        isAnswering: true,
                        hasAnswered: false,
                        error: null
                    }
                }
                return currentMessage
            })
        })

        builder.addCase(acceptPresentationRequest.rejected, (state, action) => {
            const message = action.meta.arg.message;
            state.messages = state.messages.map((currentMessage) => {
                if (currentMessage.id === message.id) {
                    return {
                        ...currentMessage,
                        isAnswering: false,
                        hasAnswered: false,
                        error: TraceableError.fromError(action.payload as Error)
                    }
                }
                return currentMessage
            })
        })

        builder.addCase(acceptPresentationRequest.fulfilled, (state, action) => {
            const message = action.meta.arg.message;
            // ✅ Remove message from state after successful acceptance (message already deleted from IndexedDB in action)
            state.messages = state.messages.filter((currentMessage) => currentMessage.id !== message.id)
        })

        builder.addCase(acceptCredentialOffer.pending, (state, action) => {
            const message = action.meta.arg.message;
            state.messages = state.messages.map((currentMessage) => {
                if (currentMessage.id === message.id) {
                    return {
                        ...currentMessage,
                        isAnswering: true,
                        hasAnswered: false,
                        error: null
                    }
                }
                return currentMessage
            })
        })

        builder.addCase(acceptCredentialOffer.rejected, (state, action) => {
            const message = action.meta.arg.message;
            state.messages = state.messages.map((currentMessage) => {
                if (currentMessage.id === message.id) {
                    return {
                        ...currentMessage,
                        isAnswering: false,
                        hasAnswered: false,
                        error: TraceableError.fromError(action.payload as Error)
                    }
                }
                return currentMessage
            })
        })

        builder.addCase(rejectCredentialOffer.rejected, (state, action) => {
            const message = action.meta.arg.message;
            state.messages = state.messages.map((currentMessage) => {
                if (currentMessage.id === message.id) {
                    return {
                        ...currentMessage,
                        isAnswering: false,
                        hasAnswered: false,
                        error: TraceableError.fromError(action.payload as Error)
                    }
                }
                return currentMessage
            })
        })

        builder.addCase(rejectCredentialOffer.fulfilled, (state, action) => {
            const message = action.meta.arg.message;
            state.messages = state.messages.filter((currentMessage) => currentMessage.id !== message.id)
        })
    }
});

export default appSlice.reducer;
export const reduxActions = appSlice.actions;
