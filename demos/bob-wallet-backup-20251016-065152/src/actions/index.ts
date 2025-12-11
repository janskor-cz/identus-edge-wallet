import { addRxPlugin } from "rxdb";
import { RxDBDevModePlugin } from "rxdb/plugins/dev-mode";

addRxPlugin(RxDBDevModePlugin);

import { AnyAction, ThunkDispatch, createAsyncThunk } from "@reduxjs/toolkit";
import SDK from "@hyperledger/identus-edge-agent-sdk";
import { sha512 } from '@noble/hashes/sha512'
import { RootState, reduxActions } from "@/reducers/app";
import IndexDB from '@pluto-encrypted/indexdb'
import { PresentationClaims } from "../../../../src/domain";

// Phase 2: Message Encryption Imports
import { SecurityLevel, parseSecurityLevel, SECURITY_LEVEL_NAMES } from '../utils/securityLevels';
import { encryptMessage, decryptMessage } from '../utils/messageEncryption';
import { verifyKeyVCBinding, getVCClearanceLevel, getSecurityKeyByFingerprint } from '../utils/keyVCBinding';
import { base64url } from 'jose';


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

        } catch (err) {
            // Continue silently after error
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
    try {
        const { agent, message } = options;
        const credentialOffer = OfferCredential.fromMessage(message);

        let requestCredential;
        try {
            requestCredential = await agent.prepareRequestCredentialWithIssuer(credentialOffer);
        } catch (prepareError) {
            console.error('❌ [ERROR] Failed to prepare credential request:', prepareError);
            console.error('❌ [ERROR] Error type:', prepareError.constructor.name);
            console.error('❌ [ERROR] Error message:', prepareError.message);
            console.error('❌ [ERROR] Error stack:', prepareError.stack);

            throw prepareError; // Re-throw to trigger the outer catch
        }
        try {
            const requestMessage = requestCredential.makeMessage()
            await agent.sendMessage(requestMessage);

        } catch (err) {
            console.error('❌ Failed to send credential request:', err);
            throw err; // Re-throw the error instead of silencing it
        }
        return api.fulfillWithValue(null);
    } catch (err) {
        return api.rejectWithValue(err as Error);
    }
})


/**
 * Enhanced handleMessages with decryption support
 * Processes incoming messages, decrypting encrypted ones if user has clearance
 */
async function handleMessages(
    options: {
        dispatch: ThunkDispatch<unknown, unknown, AnyAction>,
        agent: SDK.Agent,
    },
    newMessages: SDK.Domain.Message[]
) {
    const { agent, dispatch } = options;

    // Process issued credentials
    const issuedCredentials = newMessages.filter((message) => message.piuri === "https://didcomm.org/issue-credential/3.0/issue-credential");
    if (issuedCredentials.length) {
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

    // Phase 2: Decrypt encrypted messages
    const processedMessages = await Promise.all(
        newMessages.map(async (message) => {
            try {
                // Check if message is encrypted by examining body
                const bodyStr = typeof message.body === 'string' ? message.body : JSON.stringify(message.body);
                let bodyObj: any;

                try {
                    bodyObj = JSON.parse(bodyStr);
                } catch (e) {
                    // Not JSON, treat as plaintext
                    return message;
                }

                // Check if body indicates encryption
                if (bodyObj.encrypted !== true) {
                    return message; // Plaintext message
                }

                console.log('🔒 [handleMessages] Encrypted message detected, attempting decryption...');

                // Get classification level from extraHeaders or assume TOP_SECRET
                const extraHeaders = (message as any).extraHeaders || {};
                const securityLevelStr = extraHeaders.securityLevel || 'TOP-SECRET';
                const msgLevel = parseSecurityLevel(securityLevelStr);

                console.log(`🔒 [handleMessages] Message classification: ${SECURITY_LEVEL_NAMES[msgLevel]}`);

                // Get user's Security Clearance VC
                const credentials = await agent.pluto.getAllCredentials();
                const userVC: any = credentials.find((cred: any) => {
                    try {
                        const types = (cred as any).type || [];
                        return types.includes('SecurityClearanceCredential') ||
                               types.includes('SecurityClearance');
                    } catch (e) {
                        return false;
                    }
                });

                if (!userVC) {
                    console.warn('⚠️ [handleMessages] No Security Clearance VC - cannot decrypt');
                    return {
                        ...message,
                        body: bodyObj,
                        decryptionError: 'NO_CLEARANCE',
                        decryptionErrorMessage: 'You do not have a Security Clearance VC'
                    };
                }

                const userClearance = getVCClearanceLevel(userVC);
                console.log(`🔒 [handleMessages] User clearance: ${SECURITY_LEVEL_NAMES[userClearance]}`);

                // Check if user has sufficient clearance
                if (userClearance < msgLevel) {
                    console.warn(`⚠️ [handleMessages] Insufficient clearance: user=${SECURITY_LEVEL_NAMES[userClearance]}, required=${SECURITY_LEVEL_NAMES[msgLevel]}`);
                    return {
                        ...message,
                        body: bodyObj,
                        decryptionError: 'INSUFFICIENT_CLEARANCE',
                        decryptionErrorMessage: `This message requires ${SECURITY_LEVEL_NAMES[msgLevel]} clearance. You have ${SECURITY_LEVEL_NAMES[userClearance]}.`
                    };
                }

                // Get user's private key
                const userSubject = userVC.credentialSubject || userVC.subject;
                const userFingerprint = userSubject?.keyFingerprint;

                if (!userFingerprint) {
                    console.error('❌ [handleMessages] Security Clearance VC missing keyFingerprint');
                    return {
                        ...message,
                        body: bodyObj,
                        decryptionError: 'VC_INVALID',
                        decryptionErrorMessage: 'Security Clearance VC is missing key fingerprint'
                    };
                }

                const userKey = getSecurityKeyByFingerprint(userFingerprint);
                if (!userKey) {
                    console.error('❌ [handleMessages] Decryption key not found in storage');
                    return {
                        ...message,
                        body: bodyObj,
                        decryptionError: 'KEY_NOT_FOUND',
                        decryptionErrorMessage: 'Decryption key not found. It may have been deleted.'
                    };
                }

                // Get sender's public key from their Security Clearance VC
                // In a real implementation, we'd need to retrieve sender's VC
                // For now, we'll try decryption without sender verification
                const senderDID = message.from?.toString();
                const senderVC: any = credentials.find((cred: any) => {
                    try {
                        const subject = (cred as any).credentialSubject || (cred as any).subject;
                        const types = (cred as any).type || [];
                        return subject?.id === senderDID &&
                               (types.includes('SecurityClearanceCredential') ||
                                types.includes('SecurityClearance'));
                    } catch (e) {
                        return false;
                    }
                });

                if (!senderVC) {
                    console.warn('⚠️ [handleMessages] Sender Security Clearance VC not found');
                    return {
                        ...message,
                        body: bodyObj,
                        decryptionError: 'SENDER_VC_NOT_FOUND',
                        decryptionErrorMessage: 'Sender\'s Security Clearance VC not available for verification'
                    };
                }

                const senderPublicKey = getRecipientPublicKey(senderVC);
                const userPrivateKey = base64url.decode(userKey.privateKeyBytes);

                // Decrypt the message
                const decryptedContent = await decryptMessage(
                    bodyObj,
                    userPrivateKey,
                    senderPublicKey
                );

                console.log('✅ [handleMessages] Message decrypted successfully');

                // Return message with decrypted content (cast to any to avoid type errors)
                return {
                    ...message,
                    body: decryptedContent, // Replace encrypted body with plaintext
                    originalEncryptedBody: bodyObj, // Preserve original for debugging
                    decrypted: true,
                    securityLevel: msgLevel
                } as any;
            } catch (error: any) {
                console.error('❌ [handleMessages] Decryption failed:', error);
                return {
                    ...message,
                    decryptionError: 'DECRYPTION_FAILED',
                    decryptionErrorMessage: `Decryption failed: ${error.message}`
                } as any;
            }
        })
    );

    dispatch(
        reduxActions.messageSuccess(
            processedMessages as SDK.Domain.Message[]
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
    try {
        const { agent } = options;

        agent.addListener(ListenerKey.MESSAGE, handleMessages.bind({}, { dispatch: api.dispatch, agent }));

        await agent.start()

        // ✅ CRITICAL: Start continuous message fetching from mediator
        // This enables the wallet to receive connection responses and credentials
        // Per https://hyperledger-identus.github.io/docs/home/quick-start
        await agent.startFetchingMessages(5000); // Poll every 5 seconds

        const selfDID = await agent.createNewPeerDID([], true);

        return api.fulfillWithValue({ agent, selfDID })
    } catch (err) {
        console.error('❌ [startAgent] ACTION FAILED:', err);
        console.error('❌ [startAgent] Error type:', err.constructor.name);
        console.error('❌ [startAgent] Error message:', err.message);
        console.error('❌ [startAgent] Error stack:', err.stack);
        return api.rejectWithValue(err as Error);
    }
})

/**
 * Phase 2: Helper Functions for Message Encryption
 */

/**
 * Get recipient's Security Clearance VC from stored credentials
 * @param recipientDID The recipient's DID
 * @param credentials Array of stored credentials
 * @returns Security Clearance VC or null if not found
 */
function getRecipientSecurityClearanceVC(
    recipientDID: string,
    credentials: SDK.Domain.Credential[]
): any | null {
    // Strategy 1: Check if we have recipient's VC in our credentials
    // This happens when we've verified their credentials before
    const recipientVC = credentials.find(
        (cred: any) => {
            try {
                const subject = cred.credentialSubject || cred.subject;
                const types = cred.type || [];

                return subject?.id === recipientDID &&
                       (types.includes('SecurityClearanceCredential') ||
                        types.includes('SecurityClearance'));
            } catch (e) {
                return false;
            }
        }
    );

    if (recipientVC) {
        console.log('✅ [getRecipientVC] Found Security Clearance VC for recipient');
        return recipientVC;
    }

    console.warn('⚠️ [getRecipientVC] No Security Clearance VC found for recipient:', recipientDID.substring(0, 50) + '...');
    return null;
}

/**
 * Get recipient's Ed25519 public key from their Security Clearance VC
 * @param recipientVC The recipient's Security Clearance VC
 * @returns Public key as Uint8Array
 * @throws Error if public key not found
 */
function getRecipientPublicKey(recipientVC: any): Uint8Array {
    try {
        const subject = recipientVC.credentialSubject || recipientVC.subject;

        if (subject?.publicKey) {
            // Public key stored as base64url in VC
            return base64url.decode(subject.publicKey);
        }

        throw new Error('Public key not found in Security Clearance VC');
    } catch (error) {
        console.error('❌ [getRecipientPublicKey] Failed to extract public key:', error);
        throw new Error('Recipient public key not found in VC');
    }
}

/**
 * Enhanced sendMessage with encryption support
 * @param content - Plaintext message content OR pre-built SDK.Domain.Message
 * @param recipientDID - Recipient's DID (required for encryption)
 * @param securityLevel - Classification level (UNCLASSIFIED by default)
 */
export const sendMessage = createAsyncThunk<
    { message: SDK.Domain.Message },
    {
        agent: SDK.Agent,
        message?: SDK.Domain.Message,  // Legacy support: pre-built message
        content?: string,              // New: plaintext content
        recipientDID?: string,         // Required for encryption
        securityLevel?: SecurityLevel  // Classification level
    },
    { state: { app: RootState } }
>('sendMessage', async (options, api) => {
    try {
        const {
            agent,
            message: prebuiltMessage,
            content,
            recipientDID,
            securityLevel = SecurityLevel.UNCLASSIFIED
        } = options;

        let finalMessage: SDK.Domain.Message;

        // LEGACY MODE: Pre-built message provided (backwards compatibility)
        if (prebuiltMessage) {
            console.log('📤 [sendMessage] Legacy mode: sending pre-built message');
            finalMessage = prebuiltMessage;
        }
        // NEW MODE: Content + security level (encryption support)
        else if (content !== undefined && recipientDID) {
            console.log(`📤 [sendMessage] Sending message with security level: ${SECURITY_LEVEL_NAMES[securityLevel]}`);

            // Get Redux state for credentials
            const state = api.getState().app;
            const credentials = state.credentials || [];

            // CLASSIFIED MESSAGE: Encrypt before sending
            if (securityLevel > SecurityLevel.UNCLASSIFIED) {
                console.log('🔒 [sendMessage] Encrypting classified message...');

                // STEP 1: Get sender's Security Clearance VC
                const senderVC = credentials.find((cred: any) => {
                    try {
                        const types = cred.type || [];
                        return types.includes('SecurityClearanceCredential') ||
                               types.includes('SecurityClearance');
                    } catch (e) {
                        return false;
                    }
                });

                if (!senderVC) {
                    throw new Error(
                        `Cannot send ${SECURITY_LEVEL_NAMES[securityLevel]} message: You do not have a Security Clearance VC`
                    );
                }

                // STEP 2: Validate sender has sufficient clearance
                const senderClearance = getVCClearanceLevel(senderVC);
                if (senderClearance < securityLevel) {
                    throw new Error(
                        `Cannot send ${SECURITY_LEVEL_NAMES[securityLevel]} message: ` +
                        `Your clearance is ${SECURITY_LEVEL_NAMES[senderClearance]}`
                    );
                }

                // STEP 3: PRE-SEND VALIDATION - Check recipient's clearance
                const recipientVC = getRecipientSecurityClearanceVC(recipientDID, credentials);
                if (!recipientVC) {
                    throw new Error(
                        `Cannot send classified message: Recipient has no Security Clearance VC. ` +
                        `They must present their clearance credentials first.`
                    );
                }

                const recipientClearance = getVCClearanceLevel(recipientVC);
                if (recipientClearance < securityLevel) {
                    throw new Error(
                        `Cannot send: Recipient has ${SECURITY_LEVEL_NAMES[recipientClearance]} clearance, ` +
                        `message requires ${SECURITY_LEVEL_NAMES[securityLevel]}`
                    );
                }

                console.log('✅ [sendMessage] Recipient clearance validated:', SECURITY_LEVEL_NAMES[recipientClearance]);

                // STEP 4: Get sender's private key
                const senderSubject = senderVC.credentialSubject || senderVC.subject;
                const senderFingerprint = senderSubject?.keyFingerprint;

                if (!senderFingerprint) {
                    throw new Error('Security Clearance VC missing keyFingerprint');
                }

                const senderKey = getSecurityKeyByFingerprint(senderFingerprint);
                if (!senderKey) {
                    throw new Error('Encryption key not found in storage. Generate a new key.');
                }

                // Verify key-VC binding
                if (!verifyKeyVCBinding(senderKey, senderVC)) {
                    throw new Error('Key fingerprint does not match Security Clearance VC');
                }

                // STEP 5: Get recipient's public key
                const recipientPublicKey = getRecipientPublicKey(recipientVC);

                // STEP 6: Decrypt sender's private key and encrypt message
                const senderPrivateKey = base64url.decode(senderKey.privateKeyBytes);
                const encryptedBody = await encryptMessage(
                    content,
                    senderPrivateKey,
                    recipientPublicKey
                );

                console.log('✅ [sendMessage] Message encrypted successfully');

                // STEP 7: Create DIDComm message with encrypted body
                const recipientDIDObj = SDK.Domain.DID.fromString(recipientDID);
                const senderDIDObj = await agent.createNewPeerDID([], true);

                // Create BasicMessage with proper body structure
                const basicMsgBody = { content: JSON.stringify(encryptedBody) };
                finalMessage = new BasicMessage(
                    basicMsgBody as any,  // SDK expects BasicMessageBody type
                    senderDIDObj,
                    recipientDIDObj
                ).makeMessage();

                // Add metadata to message extraHeaders (if SDK supports it)
                // This allows the recipient to know the classification level
                try {
                    (finalMessage as any).extraHeaders = {
                        securityLevel: SECURITY_LEVEL_NAMES[securityLevel],
                        classificationNumeric: securityLevel,
                        encryptionKeyFingerprint: senderFingerprint,
                        securityClearanceVcId: senderVC.id || 'unknown',
                        encryptedAt: new Date().toISOString()
                    };
                } catch (e) {
                    console.warn('⚠️ [sendMessage] Could not add extraHeaders (SDK may not support)');
                }
            }
            // UNCLASSIFIED MESSAGE: Send as plaintext
            else {
                console.log('📝 [sendMessage] Sending unclassified plaintext message');

                const recipientDIDObj = SDK.Domain.DID.fromString(recipientDID);
                const senderDIDObj = await agent.createNewPeerDID([], true);

                // Create BasicMessage with proper body structure
                const basicMsgBody = { content: content };
                finalMessage = new BasicMessage(
                    basicMsgBody as any,
                    senderDIDObj,
                    recipientDIDObj
                ).makeMessage();
            }
        } else {
            throw new Error('sendMessage requires either "message" or "content + recipientDID"');
        }

        // Send message via agent
        await agent.sendMessage(finalMessage);

        // Try to store the message with retry logic for store insertion errors
        let storeAttempts = 0;
        const maxStoreAttempts = 3;

        while (storeAttempts < maxStoreAttempts) {
            try {
                await agent.pluto.storeMessage(finalMessage);
                break;
            } catch (storeError: any) {
                storeAttempts++;
                console.warn(`⚠️ [Redux] Store attempt ${storeAttempts} failed:`, storeError.message);

                if (storeAttempts >= maxStoreAttempts) {
                    console.error('❌ [Redux] Failed to store message after multiple attempts');
                    console.warn('📤 [Redux] Message was sent but not stored locally');
                } else {
                    await new Promise(resolve => setTimeout(resolve, 100));
                }
            }
        }

        // Always dispatch success to update UI, even if storage failed
        api.dispatch(
            reduxActions.messageSuccess(
                [finalMessage]
            )
        )
        return api.fulfillWithValue({ message: finalMessage });
    } catch (err: any) {
        console.error('❌ [Redux] sendMessage failed:', err);
        return api.rejectWithValue(err);
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

        await agent.initiatePresentationRequest<typeof type>(
            type,
            toDID,
            presentationClaims
        );

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
        const state = api.getState().app;
        const hashedPassword = sha512(options.encryptionKey)

        const apollo = new SDK.Apollo();
        const store = new SDK.Store({
            name: state.wallet.dbName, // Use wallet-specific database name
            storage: IndexDB,
            password: Buffer.from(hashedPassword).toString("hex")
        });

        const db = new SDK.Pluto(store, apollo);
        await db.start();

        // ✅ DEFENSIVE ERROR HANDLING: Gracefully handle corrupted messages
        // If message deserialization fails (e.g., UnsupportedAttachmentType), continue initialization
        let messages: SDK.Domain.Message[] = [];
        try {
            messages = await db.getAllMessages();
        } catch (messageError: any) {
            console.error('⚠️ [connectDatabase] Failed to load messages (possible corruption):', messageError.message);
            // Continue initialization - wallet can still function without messages
        }

        const connections = await db.getAllDidPairs()
        const credentials = await db.getAllCredentials();

        api.dispatch(
            reduxActions.dbPreload(
                { messages, connections, credentials }
            )
        );

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

        if (!db) {
            console.error('❌ Database not connected in refreshConnections');
            throw new Error("Database not connected");
        }

        const connections = await db.getAllDidPairs();

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

            // ✅ STEP 1: Delete DIDLink records using three-tier fallback system
            const {
                deleteConnectionUsingRepository,
                deleteConnectionUsingRxDB,
                deleteConnectionFromIndexedDB
            } = await import('../utils/connectionDeletion');

            let didLinkDeleted = false;

            // Try METHOD 1: Repository Pattern (cleanest, uses SDK's internal API)
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

            // ✅ STEP 2: Delete all messages associated with this connection
            const allMessages = await db.getAllMessages();
            const associatedMessages = allMessages.filter(m =>
                m.from?.toString() === connectionToDelete.host.toString() ||
                m.to?.toString() === connectionToDelete.host.toString() ||
                m.from?.toString() === connectionToDelete.receiver.toString() ||
                m.to?.toString() === connectionToDelete.receiver.toString()
            );

            for (const message of associatedMessages) {
                try {
                    await db.deleteMessage(message.id);
                } catch (msgError) {
                    console.warn(`⚠️ [deleteConnection] Failed to delete message ${message.id}:`, msgError);
                }
            }

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

        if (!db) {
            console.error('❌ Database not connected in refreshCredentials');
            throw new Error("Database not connected");
        }

        const credentials = await db.getAllCredentials();

        return { credentials };
    } catch (err) {
        console.error('❌ RefreshCredentials failed:', err);
        return api.rejectWithValue(err as Error);
    }
});