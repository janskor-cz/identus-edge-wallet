import { addRxPlugin } from "rxdb";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";

addRxPlugin(RxDBDevModePlugin);

import { AnyAction, ThunkDispatch, createAsyncThunk } from "@reduxjs/toolkit";
import SDK from "@hyperledger/identus-edge-agent-sdk";
import { sha512 } from '@noble/hashes/sha512'
import { RootState, reduxActions } from "@/reducers/app";
import IndexDB from '@pluto-encrypted/indexdb'
import { PresentationClaims } from "../../../../src/domain";


const Agent = SDK.Agent;
const BasicMessage = SDK.BasicMessage;
const OfferCredential = SDK.OfferCredential;
const ListenerKey = SDK.ListenerKey;
const IssueCredential = SDK.IssueCredential;
const RequestPresentation = SDK.RequestPresentation;


export const acceptPresentationRequest = createAsyncThunk<
    any,
    {
        agent: any, // Changed from SDK.Agent to any for lazy loading
        message: any, // Changed from SDK.Domain.Message to any
        credential: any // Changed from SDK.Domain.Credential to any
    }
>("acceptPresentationRequest", async (options, api) => {
    try {
        const { agent, message, credential } = options;
        const requestPresentation = RequestPresentation.fromMessage(message);
        try {
            const presentation = await agent.createPresentationForRequestProof(requestPresentation, credential);
            await agent.sendMessage(presentation.makeMessage());

            // ✅ Delete the proof request message after successful response
            await agent.pluto.deleteMessage(message.id);
            console.log('✅ [acceptPresentationRequest] Proof request message deleted after response');

        } catch (err) {
            console.log("continue after err", err);
        }
        return api.fulfillWithValue(null);
    } catch (err) {
        return api.rejectWithValue(err as Error);
    }
})

export const rejectPresentationRequest = createAsyncThunk<
    any,
    {
        message: SDK.Domain.Message,
        pluto: SDK.Domain.Pluto
    }
>("rejectPresentationRequest", async (options, api) => {
    try {
        const { message, pluto } = options;
        const requestPresentation = RequestPresentation.fromMessage(message);
        await pluto.deleteMessage(message.id)
        return api.fulfillWithValue(requestPresentation);
    } catch (err) {
        return api.rejectWithValue(err as Error);
    }
})

export const rejectCredentialOffer = createAsyncThunk<
    any,
    {
        message: SDK.Domain.Message,
        pluto: SDK.Domain.Pluto
    }
>("rejectCredentialOffer", async (options, api) => {
    try {
        const { message, pluto } = options;
        const credentialOffer = OfferCredential.fromMessage(message);
        await pluto.deleteMessage(message.id)
        return api.fulfillWithValue(credentialOffer);
    } catch (err) {
        return api.rejectWithValue(err as Error);
    }
})

export const acceptCredentialOffer = createAsyncThunk<
    any,
    {
        agent: SDK.Agent,
        message: SDK.Domain.Message
    }
>("acceptCredentialOffer", async (options, api) => {
    console.log('🚀 [DEBUG] acceptCredentialOffer function called with message ID:', options.message.id);
    console.log('🚀 [DEBUG] Message type:', options.message.piuri);
    try {
        const { agent, message } = options;
        console.log('🔍 [DEBUG] Parsing credential offer from message...');
        const credentialOffer = OfferCredential.fromMessage(message);
        console.log('🔍 [DEBUG] Credential offer parsed successfully:', {
            id: credentialOffer.id,
            thid: credentialOffer.thid,
            from: credentialOffer.from?.toString().substring(0, 40) + '...'
        });

        console.log('🔍 [DEBUG] Preparing credential request...');
        let requestCredential;
        try {
            requestCredential = await agent.prepareRequestCredentialWithIssuer(credentialOffer);
            console.log('🔍 [DEBUG] Credential request prepared successfully!');
        } catch (prepareError) {
            console.error('❌ [ERROR] Failed to prepare credential request:', prepareError);
            console.error('❌ [ERROR] Error type:', prepareError.constructor.name);
            console.error('❌ [ERROR] Error message:', prepareError.message);
            console.error('❌ [ERROR] Error stack:', prepareError.stack);

            // Log additional context
            console.log('🔍 [DEBUG] Agent state:', {
                isStarted: agent ? 'available' : 'null',
                agentState: agent?.state || 'unknown'
            });

            // Debug: Check what methods are available on the agent
            const allMethods = Object.getOwnPropertyNames(Object.getPrototypeOf(agent));
            console.log('🔍 [DEBUG] Agent type:', agent.constructor.name);
            console.log('🔍 [DEBUG] Agent methods containing "credential":',
                allMethods.filter(name => name.toLowerCase().includes('credential'))
            );
            console.log('🔍 [DEBUG] Agent methods containing "prepare":',
                allMethods.filter(name => name.toLowerCase().includes('prepare'))
            );
            console.log('🔍 [DEBUG] All available agent methods:', allMethods.slice(0, 20)); // Show first 20 methods

            throw prepareError; // Re-throw to trigger the outer catch
        }
        try {
            const requestMessage = requestCredential.makeMessage()
            console.log('📤 Sending credential request message:', requestMessage.id);
            console.log('📤 Request message from:', requestMessage.from?.toString().substring(0, 60) + '...');
            console.log('📤 Request message to:', requestMessage.to?.toString().substring(0, 60) + '...');
            await agent.sendMessage(requestMessage);
            console.log('✅ Credential request sent successfully');

        // Debug: Check if message was stored in database
        try {
            const allMessages = await agent.pluto.getAllMessages();
            const recentMessages = allMessages.slice(-5); // Get last 5 messages
            console.log('🔍 [DEBUG] Recent messages in database:', recentMessages.map(m => ({
                id: m.id,
                piuri: m.piuri,
                from: m.from?.toString().substring(0, 40) + '...',
                to: m.to?.toString().substring(0, 40) + '...'
            })));
        } catch (debugErr) {
            console.log('🔍 [DEBUG] Could not fetch recent messages:', debugErr);
        }

        } catch (err) {
            console.error('❌ Failed to send credential request:', err);
            throw err; // Re-throw the error instead of silencing it
        }
        return api.fulfillWithValue(null);
    } catch (err) {
        return api.rejectWithValue(err as Error);
    }
})


async function handleMessages(
    options: {
        dispatch: ThunkDispatch<unknown, unknown, AnyAction>,
        agent: SDK.Agent,
    },
    newMessages: SDK.Domain.Message[]
) {
    const { agent, dispatch } = options;

    console.log(`\n${'='.repeat(80)}`);
    console.log(`📨 [handleMessages] Processing ${newMessages.length} new messages`);
    console.log(`${'='.repeat(80)}`);

    // Log all message types for debugging
    const messageTypeCounts = new Map<string, number>();
    newMessages.forEach(msg => {
        const piuri = msg.piuri || 'unknown';
        messageTypeCounts.set(piuri, (messageTypeCounts.get(piuri) || 0) + 1);
    });

    console.log(`📊 [handleMessages] Message types received:`);
    messageTypeCounts.forEach((count, piuri) => {
        const emoji = piuri.includes('present-proof') ? '🔐' :
                     piuri.includes('credential') ? '💳' :
                     piuri.includes('connection') ? '🔗' : '📧';
        console.log(`   ${emoji} ${piuri}: ${count} message(s)`);
    });

    // ⚠️ CRITICAL: Check for DIDComm Present Proof Request messages
    const presentationRequests = newMessages.filter((message) =>
        message.piuri === "https://didcomm.atalaprism.io/present-proof/3.0/request-presentation" ||
        message.piuri === "https://didcomm.org/present-proof/3.0/request-presentation"
    );

    if (presentationRequests.length > 0) {
        console.log(`\n${'🔐'.repeat(40)}`);
        console.log(`🔐 [PROOF-REQUEST] CRITICAL: Received ${presentationRequests.length} presentation request(s)!`);
        console.log(`${'🔐'.repeat(40)}`);

        presentationRequests.forEach((msg, index) => {
            console.log(`\n   🔐 Proof Request #${index + 1}:`);
            console.log(`      🆔 Message ID: ${msg.id}`);
            console.log(`      📨 PIURI: ${msg.piuri}`);
            console.log(`      📤 From: ${msg.from?.toString().substring(0, 50)}...`);
            console.log(`      📥 To: ${msg.to?.toString().substring(0, 50)}...`);
            console.log(`      🔄 Direction: ${msg.direction === 0 ? 'SENT' : 'RECEIVED'}`);

            try {
                const body = typeof msg.body === 'string' ? JSON.parse(msg.body) : msg.body;
                console.log(`      📋 Request Body:`, JSON.stringify(body, null, 2));
            } catch (e) {
                console.log(`      📋 Body (raw):`, msg.body);
            }

            if (msg.attachments && msg.attachments.length > 0) {
                console.log(`      📎 Attachments: ${msg.attachments.length}`);
                msg.attachments.forEach((att, attIdx) => {
                    console.log(`         📎 Attachment ${attIdx + 1}:`);
                    console.log(`            Format: ${att.format}`);
                    console.log(`            ID: ${att.id || 'N/A'}`);
                });
            }
        });

        console.log(`\n   ⚠️ [PROOF-REQUEST] These messages should appear in the Messages tab!`);
        console.log(`   💡 [PROOF-REQUEST] UI component in Message.tsx will handle display`);
        console.log(`${'🔐'.repeat(40)}\n`);
    }

    // Process issued credentials
    const issuedCredentials = newMessages.filter((message) => message.piuri === "https://didcomm.org/issue-credential/3.0/issue-credential");
    if (issuedCredentials.length) {
        console.log(`💳 [handleMessages] Found ${issuedCredentials.length} issued credentials to process`);
        for (const issuedCredential of issuedCredentials) {
            const issueCredential = IssueCredential.fromMessage(issuedCredential);
            const credential = await agent.processIssuedCredentialMessage(issueCredential);
            dispatch(
                reduxActions.credentialSuccess(
                    credential
                )
            )
        }
    }

    // Detect and log Mercury protocol messages from Cloud Agent
    const mercuryMessages = newMessages.filter((message) =>
        message.piuri?.includes('atalaprism.io/mercury')
    );

    if (mercuryMessages.length) {
        console.log(`🔮 [MERCURY] Received ${mercuryMessages.length} Mercury protocol messages from Cloud Agent`);
        mercuryMessages.forEach(msg => {
            console.log(`   📨 Type: ${msg.piuri}`);
            console.log(`   🆔 ID: ${msg.id}`);
            console.log(`   📤 From: ${msg.from?.toString().substring(0, 50)}...`);
            console.log(`   📥 To: ${msg.to?.toString().substring(0, 50)}...`);
            console.log(`   🔄 Direction: ${msg.direction === 0 ? 'SENT' : 'RECEIVED'}`);

            try {
                const body = typeof msg.body === 'string' ? JSON.parse(msg.body) : msg.body;
                console.log(`   📋 Body:`, body);
            } catch (e) {
                console.log(`   📋 Body (raw):`, msg.body);
            }
        });

        console.log(`✅ [MERCURY] Mercury messages logged - SDK will handle protocol internally`);
        // Let SDK handle Mercury protocol connections internally
        // Do NOT manually construct connection responses - SDK manages this
    }

    // ✅ DIDExchange protocol support - Detect and log standard DIDComm connection requests
    const didExchangeMessages = newMessages.filter((message) =>
        message.piuri === 'https://didcomm.org/didexchange/1.0/request' ||
        message.piuri === 'https://didcomm.org/didexchange/1.0/response' ||
        message.piuri === 'https://didcomm.org/didexchange/1.0/complete'
    );

    if (didExchangeMessages.length) {
        console.log(`\n${'🤝'.repeat(40)}`);
        console.log(`🤝 [DIDEXCHANGE] Received ${didExchangeMessages.length} DIDExchange protocol messages`);
        console.log(`${'🤝'.repeat(40)}`);

        didExchangeMessages.forEach(msg => {
            console.log(`   📨 Type: ${msg.piuri}`);
            console.log(`   🆔 ID: ${msg.id}`);
            console.log(`   📤 From: ${msg.from?.toString().substring(0, 50)}...`);
            console.log(`   📥 To: ${msg.to?.toString().substring(0, 50)}...`);
            console.log(`   🔄 Direction: ${msg.direction === 0 ? 'SENT' : 'RECEIVED'}`);

            try {
                const body = typeof msg.body === 'string' ? JSON.parse(msg.body) : msg.body;
                console.log(`   📋 Body:`, body);
                console.log(`   🏷️ Label: ${body.label || 'N/A'}`);
                console.log(`   📎 DID: ${body.did || 'N/A'}`);
            } catch (e) {
                console.log(`   📋 Body (raw):`, msg.body);
            }

            // Check for thread ID to correlate with invitations
            if (msg.thid) {
                console.log(`   🧵 Thread ID: ${msg.thid}`);
                console.log(`   💡 This should correlate with invitation ID: ${msg.thid}`);
            }
        });

        console.log(`\n   ⚠️ [DIDEXCHANGE] These messages should appear in Connections tab!`);
        console.log(`   💡 [DIDEXCHANGE] UI component in Message.tsx will handle display`);
        console.log(`${'🤝'.repeat(40)}\n`);
    }

    console.log(`\n✅ [handleMessages] Dispatching ${newMessages.length} messages to Redux`);
    console.log(`${'='.repeat(80)}\n`);

    dispatch(
        reduxActions.messageSuccess(
            newMessages
        )
    )
}

export const stopAgent = createAsyncThunk<
    { agent: SDK.Agent },
    { agent: SDK.Agent }
>("stopAgent", async (options, api) => {
    try {
        const { agent } = options
        agent.removeListener(ListenerKey.MESSAGE, handleMessages.bind({}, { dispatch: api.dispatch, agent }));
        await agent.stop()
        return api.fulfillWithValue({ agent })
    } catch (err) {
        return api.rejectWithValue(err as Error);
    }
})


export const startAgent = createAsyncThunk<
    { agent: SDK.Agent, selfDID: SDK.Domain.DID },
    { agent: SDK.Agent }
>("startAgent", async (options, api) => {
    console.log('🚀 [startAgent] ACTION STARTED - Beginning agent startup process');
    try {
        const { agent } = options;
        console.log('🔍 [startAgent] Agent instance received:', !!agent);
        console.log('🔍 [startAgent] Agent state before start:', agent.state);

        console.log('🔧 [startAgent] Adding message listener...');
        agent.addListener(ListenerKey.MESSAGE, handleMessages.bind({}, { dispatch: api.dispatch, agent }));
        console.log('✅ [startAgent] Message listener added');

        console.log('🚀 [startAgent] Calling agent.start()...');
        await agent.start()
        console.log('✅ [startAgent] agent.start() completed, state:', agent.state);

        // ✅ CRITICAL: Start continuous message fetching from mediator
        // This enables the wallet to receive connection responses and credentials
        // Per https://hyperledger-identus.github.io/docs/home/quick-start
        console.log('🔄 [startAgent] Starting message pickup polling from mediator...');
        await agent.startFetchingMessages(5000); // Poll every 5 seconds
        console.log('✅ [startAgent] Message fetching started - wallet will now receive DIDComm messages');

        console.log('🔧 [startAgent] Creating new peer DID...');
        const selfDID = await agent.createNewPeerDID([], true);
        console.log('✅ [startAgent] Peer DID created:', selfDID.toString().substring(0, 60) + '...');

        console.log('🎉 [startAgent] Returning fulfilled value to Redux');
        return api.fulfillWithValue({ agent, selfDID })
    } catch (err) {
        console.error('❌ [startAgent] ACTION FAILED:', err);
        console.error('❌ [startAgent] Error type:', err.constructor.name);
        console.error('❌ [startAgent] Error message:', err.message);
        console.error('❌ [startAgent] Error stack:', err.stack);
        return api.rejectWithValue(err as Error);
    }
})

export const sendMessage = createAsyncThunk<
    { message: SDK.Domain.Message },
    {
        agent: SDK.Agent,
        message: SDK.Domain.Message
    }
>('sendMessage', async (options, api) => {
    try {
        const { agent, message } = options;

        console.log('🔄 [Redux] Sending message via agent...');
        await agent.sendMessage(message);
        console.log('✅ [Redux] Message sent successfully');

        console.log('💾 [Redux] Storing message in local database...');
        // Try to store the message with retry logic for store insertion errors
        let storeAttempts = 0;
        const maxStoreAttempts = 3;

        while (storeAttempts < maxStoreAttempts) {
            try {
                await agent.pluto.storeMessage(message);
                console.log('✅ [Redux] Message stored successfully');
                break;
            } catch (storeError: any) {
                storeAttempts++;
                console.warn(`⚠️ [Redux] Store attempt ${storeAttempts} failed:`, storeError.message);

                if (storeAttempts >= maxStoreAttempts) {
                    console.error('❌ [Redux] Failed to store message after multiple attempts');
                    // Don't fail the entire action if message was sent successfully
                    // Just log the storage failure
                    console.warn('📤 [Redux] Message was sent but not stored locally');
                } else {
                    // Wait a bit before retrying
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
        }

        // Always dispatch success to update UI, even if storage failed
        api.dispatch(
            reduxActions.messageSuccess(
                [message]
            )
        )
        return api.fulfillWithValue({ message });
    } catch (err) {
        console.error('❌ [Redux] sendMessage failed:', err);
        return api.rejectWithValue(err as Error);
    }
})

export const initiatePresentationRequest = createAsyncThunk<
    any,
    {
        agent: SDK.Agent,
        toDID: SDK.Domain.DID,
        presentationClaims: PresentationClaims<SDK.Domain.CredentialType>,
        type: SDK.Domain.CredentialType
    }
>("initiatePresentationRequest", async (options, api) => {
    try {
        const {
            agent,
            presentationClaims,
            toDID,
            type
        } = options;

        console.log('🚀 [VC REQUEST] Starting presentation request:', {
            targetDID: toDID.toString(),
            credentialType: type,
            claims: presentationClaims,
            agentReady: !!agent
        });

        await agent.initiatePresentationRequest<typeof type>(
            type,
            toDID,
            presentationClaims
        );

        console.log('✅ [VC REQUEST] Presentation request sent successfully to:', toDID.toString());

        return api.fulfillWithValue(null)
    } catch (err) {
        return api.rejectWithValue(err as Error);
    }
})

//This is for demonstration purposes and assumes that
//The Cloud agent is running on port ::::::
//Resolver at some point will be configurable to run on specific universal resolver endpoints
//for testnet, mainnet switching, etc
class ShortFormDIDResolverSample implements SDK.Domain.DIDResolver {
    method: string = "prism"

    private async parseResponse(response: Response) {
        const data = await response.text();
        try {
            return JSON.parse(data);
        }
        catch {
            return data;
        }
    }

    async resolve(didString: string): Promise<SDK.Domain.DIDDocument> {
        const url = "http://localhost:8000/cloud-agent/dids/" + didString;
        const response = await fetch(url, {
            "headers": {
                "accept": "*/*",
                "accept-language": "en",
                "cache-control": "no-cache",
                "pragma": "no-cache",
                "sec-gpc": "1"
            },
            "method": "GET",
            "mode": "cors",
            "credentials": "omit"
        })
        if (!response.ok) {
            throw new Error('Failed to fetch data');
        }
        const data = await response.json();
        const didDocument = data.didDocument;

        const servicesProperty = new SDK.Domain.Services(
            didDocument.service
        )
        const verificationMethodsProperty = new SDK.Domain.VerificationMethods(
            didDocument.verificationMethod
        )
        const coreProperties: SDK.Domain.DIDDocumentCoreProperty[] = [];
        const authenticate: SDK.Domain.Authentication[] = [];
        const assertion: SDK.Domain.AssertionMethod[] = [];

        for (const verificationMethod of didDocument.verificationMethod) {
            const isAssertion = didDocument.assertionMethod.find((method) => method === verificationMethod.id)
            if (isAssertion) {
                assertion.push(new SDK.Domain.AssertionMethod([isAssertion], [verificationMethod]))
            }
            const isAuthentication = didDocument.authentication.find((method) => method === verificationMethod.id)
            if (isAuthentication) {
                authenticate.push(new SDK.Domain.Authentication([isAuthentication], [verificationMethod]));
            }
        }

        coreProperties.push(...authenticate);
        coreProperties.push(servicesProperty);
        coreProperties.push(verificationMethodsProperty);

        const resolved = new SDK.Domain.DIDDocument(
            SDK.Domain.DID.fromString(didString),
            coreProperties
        );

        return resolved;
    }
}

export const initAgent = createAsyncThunk<
    { agent: SDK.Agent },
    {
        mediatorDID: SDK.Domain.DID,
        pluto: SDK.Domain.Pluto,
        defaultSeed: SDK.Domain.Seed
    }
>("initAgent", async (options, api) => {
    try {
        const { mediatorDID, pluto, defaultSeed } = options;

        const apollo = new SDK.Apollo();
        const extraResolvers = [
            ShortFormDIDResolverSample
        ];
        const castor = new SDK.Castor(apollo, extraResolvers)
        const agent = await Agent.initialize({
            apollo,
            castor,
            mediatorDID,
            pluto,
            seed: defaultSeed
        });
        return api.fulfillWithValue({
            agent,
        })
    } catch (err) {
        return api.rejectWithValue(err as Error);
    }
})

export const connectDatabase = createAsyncThunk<
    {
        db: any // Changed from SDK.Domain.Pluto to any for lazy loading compatibility
    },
    {
        encryptionKey: Uint8Array,
    },
    { state: { app: RootState } }
>("connectDatabase", async (options, api) => {
    try {
        console.log('🔄 [connectDatabase] Starting database connection...');

        const state = api.getState().app;
        const hashedPassword = sha512(options.encryptionKey)

        console.log('🔧 [connectDatabase] Creating Apollo and Store instances...');
        const apollo = new SDK.Apollo();
        const store = new SDK.Store({
            name: state.wallet.dbName, // Use wallet-specific database name
            storage: IndexDB,
            password: Buffer.from(hashedPassword).toString("hex")
        });

        console.log('🔧 [connectDatabase] Creating Pluto instance and starting...');
        const db = new SDK.Pluto(store, apollo);
        await db.start();

        console.log('🔧 [connectDatabase] Loading existing data from database...');

        // ✅ DEFENSIVE ERROR HANDLING: Gracefully handle corrupted messages
        // If message deserialization fails (e.g., UnsupportedAttachmentType), continue initialization
        let messages: SDK.Domain.Message[] = [];
        try {
            messages = await db.getAllMessages();
            console.log('✅ [connectDatabase] Loaded messages:', messages.length);
        } catch (messageError: any) {
            console.error('⚠️ [connectDatabase] Failed to load messages (possible corruption):', messageError.message);
            console.log('ℹ️ [connectDatabase] Continuing initialization without messages...');
            console.log('💡 [connectDatabase] Tip: Clear corrupted data via browser DevTools → Application → IndexedDB');
            // Continue initialization - wallet can still function without messages
        }

        const connections = await db.getAllDidPairs()
        const credentials = await db.getAllCredentials();

        console.log('🔧 [connectDatabase] Dispatching preload data to Redux...');
        api.dispatch(
            reduxActions.dbPreload(
                { messages, connections, credentials }
            )
        );

        console.log('✅ [connectDatabase] Database connection completed successfully');
        return api.fulfillWithValue({ db });
    } catch (err) {
        console.error('❌ [connectDatabase] Database connection failed:', err);
        return api.rejectWithValue(err as Error);
    }
});

export const refreshConnections = createAsyncThunk(
    'connections/refresh',
    async (_: void, api) => {
    try {
        const state = api.getState() as { app: { db: { instance: SDK.Domain.Pluto | null } } };
        const db = state.app.db.instance;

        console.log('🔄 RefreshConnections called');
        console.log('🔍 Database instance:', db ? 'available' : 'null');

        if (!db) {
            console.error('❌ Database not connected in refreshConnections');
            throw new Error("Database not connected");
        }

        console.log('📊 Fetching connections from database...');
        const connections = await db.getAllDidPairs();
        console.log(`✅ Found ${connections.length} connections in database:`, connections.map(c => ({
            alias: c.name || 'unnamed',
            host: c.host.toString().substring(0, 50) + '...',
            receiver: c.receiver.toString().substring(0, 50) + '...'
        })));

        console.log('🚀 Returning connections to Redux state');
        return { connections };
    } catch (err) {
        console.error('❌ RefreshConnections failed:', err);
        return api.rejectWithValue(err as Error);
    }
});

export const deleteConnection = createAsyncThunk<
    { success: boolean },
    { connectionHostDID: string },
    { state: { app: { db: { instance: SDK.Domain.Pluto | null } } } }
>(
    'connections/delete',
    async (options, api) => {
        try {
            const { connectionHostDID } = options;
            const state = api.getState() as { app: { db: { instance: SDK.Domain.Pluto | null } } };
            const db = state.app.db.instance;

            console.log('🗑️ [deleteConnection] Deleting connection:', connectionHostDID.substring(0, 50) + '...');

            if (!db) {
                console.error('❌ [deleteConnection] Database not connected');
                throw new Error("Database not connected");
            }

            const allConnections = await db.getAllDidPairs();
            const connectionToDelete = allConnections.find(c => c.host.toString() === connectionHostDID);

            if (!connectionToDelete) {
                console.warn('⚠️ [deleteConnection] Connection not found:', connectionHostDID.substring(0, 50) + '...');
                throw new Error('Connection not found');
            }

            console.log('🔍 [deleteConnection] Found connection to delete:', {
                name: connectionToDelete.name,
                host: connectionToDelete.host.toString().substring(0, 50) + '...',
                receiver: connectionToDelete.receiver.toString().substring(0, 50) + '...'
            });

            // ✅ STEP 1: Delete DIDLink records using three-tier fallback system
            console.log('🔧 [deleteConnection] Importing connection deletion utilities...');
            const {
                deleteConnectionUsingRepository,
                deleteConnectionUsingRxDB,
                deleteConnectionFromIndexedDB
            } = await import('../utils/connectionDeletion');

            let didLinkDeleted = false;

            // Try METHOD 1: Repository Pattern (cleanest, uses SDK's internal API)
            console.log('🗑️ [deleteConnection] Method 1: Attempting Repository-based deletion...');
            didLinkDeleted = await deleteConnectionUsingRepository(db, connectionHostDID);

            // Try METHOD 2: RxDB Collection Access (if Repository fails)
            if (!didLinkDeleted) {
                console.warn('⚠️ [deleteConnection] Repository method failed, trying Method 2: RxDB...');
                didLinkDeleted = await deleteConnectionUsingRxDB(db, connectionHostDID);
            }

            // Try METHOD 3: Direct IndexedDB (if RxDB fails)
            if (!didLinkDeleted) {
                console.warn('⚠️ [deleteConnection] RxDB method failed, trying Method 3: Direct IndexedDB...');
                didLinkDeleted = await deleteConnectionFromIndexedDB(db, connectionHostDID);
            }

            // All three methods failed
            if (!didLinkDeleted) {
                console.error('❌ [deleteConnection] All three deletion methods failed');
                throw new Error('Failed to delete DIDLink records after trying all methods');
            }

            console.log('✅ [deleteConnection] DIDLink records deleted successfully');

            // ✅ STEP 2: Delete all messages associated with this connection
            const allMessages = await db.getAllMessages();
            const associatedMessages = allMessages.filter(m =>
                m.from?.toString() === connectionToDelete.host.toString() ||
                m.to?.toString() === connectionToDelete.host.toString() ||
                m.from?.toString() === connectionToDelete.receiver.toString() ||
                m.to?.toString() === connectionToDelete.receiver.toString()
            );

            console.log(`📨 [deleteConnection] Found ${associatedMessages.length} messages to delete`);

            for (const message of associatedMessages) {
                try {
                    await db.deleteMessage(message.id);
                    console.log(`✅ [deleteConnection] Deleted message: ${message.id}`);
                } catch (msgError) {
                    console.warn(`⚠️ [deleteConnection] Failed to delete message ${message.id}:`, msgError);
                }
            }

            console.log('✅ [deleteConnection] Complete deletion finished (DIDLinks + messages)');
            console.log('🔄 [deleteConnection] Refreshing connections list...');

            // Refresh connections to update UI
            api.dispatch(refreshConnections());

            return api.fulfillWithValue({ success: true });
        } catch (err) {
            console.error('❌ [deleteConnection] Failed to delete connection:', err);
            return api.rejectWithValue(err as Error);
        }
    }
);

export const refreshCredentials = createAsyncThunk(
    'credentials/refresh',
    async (_: void, api) => {
    try {
        const state = api.getState() as { app: { db: { instance: SDK.Domain.Pluto | null } } };
        const db = state.app.db.instance;

        console.log('🔄 RefreshCredentials called');
        console.log('🔍 Database instance:', db ? 'available' : 'null');

        if (!db) {
            console.error('❌ Database not connected in refreshCredentials');
            throw new Error("Database not connected");
        }

        console.log('📊 Fetching credentials from database...');
        const credentials = await db.getAllCredentials();
        console.log(`✅ Found ${credentials.length} credentials in database:`);

        // Log each credential for debugging
        credentials.forEach((credential, index) => {
            console.log(`   ${index + 1}. Credential ID: ${credential.id}`);
            console.log(`      Type: ${credential.credentialType}`);
            console.log(`      Subject: ${credential.subject?.toString().substring(0, 40)}...`);
            if (credential.claims && credential.claims.length > 0) {
                console.log(`      Claims: ${credential.claims.length} claim(s)`);
                credential.claims.forEach((claim, claimIndex) => {
                    console.log(`         Claim ${claimIndex + 1}: ${JSON.stringify(claim).substring(0, 100)}...`);
                });
            }
        });

        console.log('🚀 Returning credentials to Redux state');
        return { credentials };
    } catch (err) {
        console.error('❌ RefreshCredentials failed:', err);
        return api.rejectWithValue(err as Error);
    }
});