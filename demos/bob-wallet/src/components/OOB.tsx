
import { useMountedApp } from "@/reducers/store";
import SDK from "@hyperledger/identus-edge-agent-sdk";
import React, { useCallback, useEffect, useState, useRef } from "react";
import { AgentRequire } from "./AgentRequire";
import { SelectiveDisclosure } from "./SelectiveDisclosure";
import { InviterVerification } from "./InviterVerification";
import { SecurityAlert } from "./SecurityAlert";
import { InvitationPreviewModal } from "./InvitationPreviewModal";
import { DisclosureLevel } from "../types/invitations";
import { identifyCredentialType } from "@/utils/credentialSchemaExtractor";
import { validateVerifiableCredential, parseInviterIdentity, safeBase64ParseJSON, detectInvitationFormat } from "../utils/vcValidation";
import { createVCProofAttachment } from "../utils/selectiveDisclosure";
import { invitationStateManager } from '../utils/InvitationStateManager';
import { getItem, setItem, removeItem, getKeysByPattern } from '@/utils/prefixedStorage';
import { verifyCredentialStatus } from '@/utils/credentialStatus';
import { extractCredentialDisplayName } from '@/utils/credentialNaming';
import { Scanner } from './Scanner';
import { MessageType, ScanResult } from '@/utils/qrMessageParser';
import { parseCACredentialFromInvitation, validateCACredential, ValidatedCAConfig } from '@/utils/caValidation';
import { parseCompanyCredentialFromInvitation, validateCompanyCredential, ValidatedCompanyConfig, verifyCompanyIssuer } from '@/utils/companyValidation';
import { isCAVerified, getPinnedCA, pinCA, verifyPinnedCA, hashCredential, isCompanyVerified, getPinnedCompany, pinCompany, verifyPinnedCompany } from '@/utils/prefixedStorage';
import { getCloudWalletConfig, verifyServiceConfigNotRevoked, CloudWalletConfig, isCloudWalletConfigValid, getCloudWalletErrorMessage } from '@/utils/cloudWalletConfig';
import { saveConnectionMetadata, getConnectionMetadata } from '@/utils/connectionMetadata';
import { EnterpriseAgentClient } from '@/utils/EnterpriseAgentClient';

const ListenerKey = SDK.ListenerKey;

// Helper function to copy text to clipboard with fallback
async function copyToClipboard(text: string): Promise<void> {
    try {
        // Check if navigator.clipboard is available (modern browsers with HTTPS)
        if (navigator.clipboard && navigator.clipboard.writeText) {
            await navigator.clipboard.writeText(text);
            return;
        }

        // Fallback for older browsers or HTTP contexts
        const textArea = document.createElement('textarea');
        textArea.value = text;
        textArea.style.position = 'fixed';
        textArea.style.left = '-999999px';
        textArea.style.top = '-999999px';
        document.body.appendChild(textArea);
        textArea.focus();
        textArea.select();

        try {
            document.execCommand('copy');
        } finally {
            document.body.removeChild(textArea);
        }
    } catch (error) {
        console.error('Failed to copy text to clipboard:', error);
        // Show user feedback that copy failed
        alert('Copy failed. Please copy the text manually.');
        throw error;
    }
}

type WalletContext = 'personal' | 'enterprise';

interface OOBProps {
  agent: SDK.Agent;
  pluto: SDK.Domain.Pluto;
  onNewConnectionRequest?: (message: SDK.Domain.Message) => void;
  walletContext?: WalletContext;
  enterpriseConfig?: any;
}

export const OOB: React.FC<OOBProps> = (props) => {
    const { walletContext = 'personal', enterpriseConfig } = props;
    const app = useMountedApp();
    const agent = app.agent.instance;

    const CONNECTION_EVENT = ListenerKey.CONNECTION;
    const [connections, setConnections] = React.useState<Array<any>>([]);
    const [oob, setOOB] = React.useState<string>();
    const [alias, setAlias] = React.useState<string>();

    // VC Proof Enhancement State (for creating invitations)
    const [includeVCProof, setIncludeVCProof] = useState<boolean>(false);
    const [availableCredentials, setAvailableCredentials] = useState<any[]>([]);
    const [selectedCredential, setSelectedCredential] = useState<any>(null);
    const [selectedFields, setSelectedFields] = useState<string[]>([]);
    const [disclosureLevel, setDisclosureLevel] = useState<DisclosureLevel>('minimal');

    // ✅ NEW: Response-specific state (for accepting invitations and sending VC back)
    const [selectedVCForResponse, setSelectedVCForResponse] = useState<any>(null);
    const [responseFields, setResponseFields] = useState<string[]>([]);
    const [responseDisclosureLevel, setResponseDisclosureLevel] = useState<DisclosureLevel>('minimal');

    // Simple VC Request State
    const [includeVCRequest, setIncludeVCRequest] = useState<boolean>(false);
    const [hasVCRequest, setHasVCRequest] = useState<boolean>(false);

    // Common UI state
    const [showingInvitation, setShowingInvitation] = useState<boolean>(false);
    const [generatedInvitation, setGeneratedInvitation] = useState<string>('');
    const [inviterIdentity, setInviterIdentity] = useState<any>(null);
    const [inviterLabel, setInviterLabel] = useState<string>('');

    // QR Scanner state
    const [showScanner, setShowScanner] = useState<boolean>(false);
    const [copySuccess, setCopySuccess] = useState<boolean>(false);

    // CA Identity Verification state
    const [caConfig, setCAConfig] = useState<ValidatedCAConfig | null>(null);
    const [isCAInvitation, setIsCAInvitation] = useState<boolean>(false);
    const [caAlreadyPinned, setCAAlreadyPinned] = useState<boolean>(false);

    // Company Identity Verification state
    const [companyConfig, setCompanyConfig] = useState<ValidatedCompanyConfig | null>(null);
    const [isCompanyInvitation, setIsCompanyInvitation] = useState<boolean>(false);
    const [companyAlreadyPinned, setCompanyAlreadyPinned] = useState<boolean>(false);
    const [companyCAVerification, setCompanyCAVerification] = useState<{ verified: boolean; caName?: string; issuerDID?: string } | null>(null);

    // Cloud Wallet Selection state
    const [walletType, setWalletType] = useState<'local' | 'cloud'>('local');
    const [cloudConfig, setCloudConfig] = useState<CloudWalletConfig | null>(null);
    const [cloudConfigLoading, setCloudConfigLoading] = useState<boolean>(false);

    // ✅ PHASE 1: Preview Modal State
    const [showPreviewModal, setShowPreviewModal] = useState<boolean>(false);
    const [parsedInvitationData, setParsedInvitationData] = useState<any>(null);

    // ✅ BUG FIX 2: Parsing state flag to prevent React race condition
    // Prevents else block from clearing identity during render batching
    const [isParsing, setIsParsing] = useState<boolean>(false);

    // ✅ BUG FIX 3: Connection acceptance tracking flag
    // Prevents modal from reopening during connection acceptance process
    const [isAcceptingConnection, setIsAcceptingConnection] = useState<boolean>(false);

    // ✅ BUG FIX 4: Ref to track processed connection identifiers (prevents duplicates from 4x event firing)
    const processedConnectionsRef = useRef<Set<string>>(new Set());

    const handleConnections = useCallback((event: any) => {
        // Generate unique identifier for this connection event
        const connectionId = `${event.host?.toString() || ''}-${event.receiver?.toString() || ''}-${event.name || ''}`;

        // Check if this connection was already processed
        if (processedConnectionsRef.current.has(connectionId)) {
            console.log(`🚫 [OOB] Duplicate connection event ignored: ${event.name || 'unnamed'}`);
            return; // Skip duplicate
        }

        // Mark as processed
        processedConnectionsRef.current.add(connectionId);
        console.log(`✅ [OOB] New connection event processed: ${event.name || 'unnamed'}`);

        // Add to connections state (local component state)
        setConnections(prev => [...prev, event]);

        // LAYER 2: Update Redux state (for global connection list)
        app.dispatch({ type: 'Connection/success', payload: event });
        console.log('✅ [CONNECTION_EVENT] Connection added to Redux state:', event.name);
    }, [app]); // Include app in dependencies for dispatch

    // Handle copy to clipboard with user feedback
    const handleCopyInvitation = async () => {
        try {
            await copyToClipboard(generatedInvitation);
            setCopySuccess(true);
            // Reset success state after 2 seconds
            setTimeout(() => setCopySuccess(false), 2000);
        } catch (error) {
            console.error('Copy failed:', error);
            // Error feedback is handled in copyToClipboard function
        }
    };

    useEffect(() => {
        if (agent) {
            agent.addListener(CONNECTION_EVENT, handleConnections);
            loadAvailableCredentials();
        }
        return () => {
            if (agent) {
                agent.removeListener(CONNECTION_EVENT, handleConnections);
            }
        }
    }, [agent])

    // Update credentials when Redux store changes
    useEffect(() => {
        loadAvailableCredentials();
    }, [app.credentials])

    // Check cloud wallet availability when credentials change
    useEffect(() => {
        const checkCloudWallet = async () => {
            setCloudConfigLoading(true);
            console.log('🔍 [CloudWallet] Checking cloud wallet availability...');

            try {
                const config = await getCloudWalletConfig(app.credentials || []);
                setCloudConfig(config);

                if (config.available && isCloudWalletConfigValid(config)) {
                    console.log('✅ [CloudWallet] Cloud wallet is available');
                    console.log('  → URL:', config.enterpriseAgentUrl);
                    console.log('  → PRISM DID:', config.prismDid?.substring(0, 60) + '...');
                } else {
                    console.log('ℹ️ [CloudWallet] Cloud wallet not available');
                    if (config.error) {
                        console.log('  → Reason:', config.error);
                    }
                    // Reset to local wallet if cloud wallet becomes unavailable
                    if (walletType === 'cloud') {
                        console.log('⚠️ [CloudWallet] Switching back to local wallet');
                        setWalletType('local');
                    }
                }
            } catch (error: any) {
                console.error('❌ [CloudWallet] Error checking cloud wallet:', error);
                setCloudConfig({ available: false, error: error.message });
                // Reset to local wallet on error
                if (walletType === 'cloud') {
                    setWalletType('local');
                }
            } finally {
                setCloudConfigLoading(false);
            }
        };

        checkCloudWallet();
    }, [app.credentials]);

    // Helper function to check if an object contains person-like fields
    const hasPersonFields = (obj: any): boolean => {
        if (!obj || typeof obj !== 'object') return false;
        const personFields = ['firstName', 'lastName', 'uniqueId', 'dateOfBirth', 'gender', 'nationality', 'placeOfBirth'];
        return personFields.some(field => field in obj);
    };

    // Load available RealPerson credentials for VC proof
    const loadAvailableCredentials = async () => {
        try {
            // Get credentials from Redux store
            const allCredentials = app.credentials || [];

            console.log('🔍 [OOB] Loading credentials from Redux store:', allCredentials.length);

            // Filter for RealPerson credentials using schema extractor
            const realPersonCredentials = allCredentials.filter(cred => {
                const { type, source, schemaInfo } = identifyCredentialType(cred);

                if (type === 'RealPerson') {
                    console.log(`✅ [OOB] Found RealPerson credential (source: ${source}):`, schemaInfo?.id || 'no schema');
                    return true;
                }

                return false;
            });

            console.log('✅ Found RealPerson credentials:', realPersonCredentials.length);

            // Check revocation status for each credential
            const statusCheckPromises = realPersonCredentials.map(async (cred) => {
                try {
                    const status = await verifyCredentialStatus(cred);
                    return { cred, status };
                } catch (error) {
                    console.error('[OOB] Status check failed for credential:', error);
                    return {
                        cred,
                        status: { revoked: false, suspended: false, statusPurpose: 'error', checkedAt: new Date().toISOString() }
                    };
                }
            });

            const statusResults = await Promise.all(statusCheckPromises);

            // Filter out revoked/suspended credentials
            const validCredentials = statusResults
                .filter(result => !result.status.revoked && !result.status.suspended)
                .map(result => result.cred);

            const revokedCount = realPersonCredentials.length - validCredentials.length;
            if (revokedCount > 0) {
                console.log(`⚠️ Filtered out ${revokedCount} revoked/suspended credential(s)`);
            }

            setAvailableCredentials(validCredentials);
        } catch (error) {
            console.error('Error loading credentials:', error);
        }
    };

    // Handle field selection from SelectiveDisclosure component
    const handleFieldSelection = (fields: string[], level: DisclosureLevel) => {
        console.log(`🔧 Disclosure level updated: ${level}, Fields: [${fields.join(', ')}]`);
        setSelectedFields(fields);
        setDisclosureLevel(level);
    };

    // Create invitation with optional VC proof and/or VC request
    const createInvitationWithProof = async () => {
        if (!agent) {
            throw new Error("Start the agent first");
        }

        try {
            // 🏢 ENTERPRISE WALLET: Use Cloud Agent API instead of Edge Agent
            if (walletContext === 'enterprise' && enterpriseConfig) {
                console.log('🏢 [ENTERPRISE] Creating invitation via Cloud Agent');

                const client = new EnterpriseAgentClient({
                    vcId: '',
                    credentialId: '',
                    enterpriseAgentUrl: enterpriseConfig.enterpriseAgentUrl,
                    enterpriseAgentName: enterpriseConfig.enterpriseAgentName,
                    enterpriseAgentApiKey: enterpriseConfig.enterpriseAgentApiKey,
                    isActive: true
                });

                const response = await client.createInvitation(
                    alias || 'Enterprise Connection',
                    'Enterprise wallet connection'
                );

                if (response.success && response.data) {
                    // Extract invitation URL from Cloud Agent response
                    const invitationUrl = response.data.invitation?.invitationUrl;

                    if (invitationUrl) {
                        setGeneratedInvitation(invitationUrl);
                        console.log('✅ [ENTERPRISE] Invitation created successfully');
                        console.log(`   Connection ID: ${response.data.connectionId}`);
                        return;
                    } else {
                        throw new Error('No invitation URL in Cloud Agent response');
                    }
                } else {
                    throw new Error(response.error || 'Failed to create enterprise invitation');
                }
            }

            // 👤 PERSONAL WALLET: Use Edge Agent SDK (existing logic)
            // Create peer DID with proper service endpoints for DIDComm
            const peerDID = await agent.createNewPeerDID([], true);

            // Save connection metadata (wallet type + cloud config if applicable)
            if (walletType === 'local') {
                saveConnectionMetadata(peerDID.toString(), {
                    walletType: 'local'
                });
                console.log('✅ [METADATA] Saved local wallet metadata for invitation');
            } else if (walletType === 'cloud' && cloudConfig?.available) {
                saveConnectionMetadata(peerDID.toString(), {
                    walletType: 'cloud',
                    prismDid: cloudConfig.prismDid,
                    enterpriseAgentUrl: cloudConfig.enterpriseAgentUrl,
                    enterpriseAgentApiKey: cloudConfig.enterpriseAgentApiKey
                });
                console.log('✅ [METADATA] Saved cloud wallet metadata for invitation');
                console.log(`  → PRISM DID: ${cloudConfig.prismDid?.substring(0, 40)}...`);
            }

            // Store VC proof data for later use in RFC structure
            let vcProofData = null;
            if (includeVCProof && selectedCredential && selectedFields.length > 0) {
                console.log(`🎫 Creating VC proof with disclosure level: ${disclosureLevel}`);
                console.log(`📋 Selected fields: [${selectedFields.join(', ')}]`);

                const vcProofBase64 = createVCProofAttachment(
                    selectedCredential,
                    selectedFields,
                    disclosureLevel
                );

                // Parse the VC proof to embed in invitation
                vcProofData = JSON.parse(atob(vcProofBase64));
            }

            // Create proper OutOfBandInvitation object with RFC 0434 structure
            const invitationBody = {
                goal_code: includeVCRequest ? "request-proof" : "issue-vc", // RFC uses goal_code not goalCode
                goal: includeVCRequest ? "Verify your credentials" : "To connect and exchange credentials",
                accept: ["didcomm/v2", "didcomm/aip2;env=rfc587"],
                handshake_protocols: ["https://didcomm.org/didexchange/1.0"]
            };

            // Create the proper DIDComm v2.0 invitation
            const oobInvitation = new SDK.OutOfBandInvitation(
                invitationBody,
                peerDID.toString()
            );

            // Store the invitation ID for message correlation
            const invitationId = oobInvitation.id;
            console.log('🎯 [THREAD] Storing invitation ID for correlation:', invitationId);

            // Store invitation metadata for correlation (we'll use this later)
            if (typeof window !== 'undefined') {
                setItem(`invitation-${invitationId}`, JSON.stringify({
                    id: invitationId,
                    from: peerDID.toString(),
                    timestamp: Date.now(),
                    includeVCRequest,
                    includeVCProof
                }));
            }

            // Create a clean JSON object for serialization following RFC 0434
            // Avoid serializing SDK object directly which may have circular references
            const cleanInvitation = {
                type: "https://didcomm.org/out-of-band/2.0/invitation",
                body: invitationBody,
                from: peerDID.toString(),
                id: invitationId
            };

            // Add requests_attach if we have protocol requests (RFC 0434 compliant)
            if (vcProofData || includeVCRequest) {
                const requestsAttach = [];

                // Add VC proof as inline data if present
                if (includeVCProof && vcProofData) {
                    requestsAttach.push({
                        "@id": "vc-proof-0",
                        "mime-type": "application/json",
                        "data": {
                            "json": vcProofData
                        }
                    });
                }

                // Add presentation request following RFC 0037 (with safe field names)
                if (includeVCRequest) {
                    requestsAttach.push({
                        "@id": "request-0",
                        "mime-type": "application/json",
                        "data": {
                            "json": {
                                "@type": "https://didcomm.atalaprism.io/present-proof/3.0/request-presentation",
                                "@id": `presentation-request-${Date.now()}`,
                                "comment": "Please present your RealPerson credential",
                                "formats": [{
                                    "attach_id": "presentation-definition",
                                    "format": "dif/presentation-exchange/definitions@v1.0"
                                }],
                                "request_presentations_attach": [{
                                    "@id": "presentation-definition",
                                    "mime-type": "application/json",
                                    "data": {
                                        "json": {
                                            "id": "simple-realperson-request",
                                            "name": "RealPerson Credential Request",
                                            "purpose": "Verify your identity with a RealPerson credential",
                                            "input_descriptors": [{
                                                "id": "realperson-credential",
                                                "name": "RealPerson Credential",
                                                "purpose": "Verify identity",
                                                "constraints": {
                                                    "fields": [{
                                                        "path": ["$.type"],
                                                        "filter": {
                                                            "type": "array",
                                                            "contains": { "const": "VerifiableCredential" }
                                                        }
                                                    }]
                                                }
                                            }]
                                        }
                                    }
                                }]
                            }
                        }
                    });
                }

                // Use RFC 0434 compliant field name (with safe underscore instead of tilde)
                cleanInvitation.requests_attach = requestsAttach;
            }

            // Serialize the clean object to JSON
            const invitationJson = JSON.stringify(cleanInvitation);

            console.log('🔍 [FIXED] Clean invitation serialization:');
            console.log('   Using clean object structure');
            console.log('   JSON length:', invitationJson.length);
            console.log('   JSON ending:', invitationJson.substring(invitationJson.length - 20));

            // Validate the JSON before encoding
            try {
                JSON.parse(invitationJson);
                console.log('✅ JSON validation successful');
            } catch (e) {
                console.error('❌ JSON validation failed:', e);
                throw new Error('Invalid invitation JSON structure');
            }

            const invitationBase64 = btoa(invitationJson);
            const invitationUrl = `${window.location.origin}/connect?_oob=${invitationBase64}`;

            console.log('🚀 Created RFC 0434 compliant DIDComm invitation:', {
                type: oobInvitation.type,
                id: oobInvitation.id,
                from: oobInvitation.from.substring(0, 50) + '...',
                body: oobInvitation.body,
                attachmentCount: cleanInvitation.requests_attach?.length || 0
            });

            // ✅ CREATE INVITATION STATE RECORD (User's suggested approach)
            try {
                const walletId = app.wallet.walletId;
                const recordId = await invitationStateManager.createInvitation(
                    walletId,
                    invitationId,
                    `Connection invitation: ${Date.now()}`,
                    peerDID.toString(),
                    invitationUrl
                );
                console.log('✅ [INVITATION STATE] Created invitation record with InvitationGenerated status:', recordId);
            } catch (error) {
                console.error('❌ [INVITATION STATE] Failed to create invitation record:', error);
                // Don't throw - invitation creation should still work even if state tracking fails
            }

            setGeneratedInvitation(invitationUrl);
            setShowingInvitation(true);
        } catch (error) {
            console.error('Error creating invitation:', error);
            throw error;
        }
    };

    const handleOnChange = (e: any) => {
        setOOB(e.target.value);
    };

    // Handle QR code scan
    const handleScan = (result: ScanResult) => {
        console.log('✅ [OOB] QR code scanned successfully:', result.messageType);

        if (result.messageType === 'oob-invitation' || result.messageType === 'ca-identity-verification' || result.messageType === 'peer-did') {
            // Extract invitation URL or DID from scan result
            const invitationData = result.rawData;

            console.log('📋 [OOB] Populating invitation input from QR scan');
            setOOB(invitationData);
            setShowScanner(false);

            // The existing automatic invitation parsing will trigger via useEffect
            console.log('✅ [OOB] Invitation populated, auto-parsing will trigger');
        } else {
            console.error(`❌ [OOB] Invalid QR code type. Expected invitation, got: ${result.messageType}`);
            setShowScanner(false);
        }
    };

    // Handle QR scan error
    const handleScanError = (error: Error) => {
        console.error('❌ [OOB] QR scan error:', error);
    };

    // ✅ PHASE 1: Automatic invitation parsing when OOB changes
    // This triggers VC proof verification AUTOMATICALLY when user pastes invitation
    // ✅ PHASE 3: Added Bob-side invitation state tracking
    // ✅ BUG FIX 2: Added isParsing guard to prevent React race condition
    useEffect(() => {
        const parseAndShowPreview = async () => {
            if (oob && oob.trim() !== '') {
                console.log('🔄 [AUTO-PARSE] Invitation pasted, triggering automatic parsing...');

                // ✅ BUG FIX 2: Set parsing flag before starting parse
                setIsParsing(true);

                try {
                    // Parse VC proof and extract invitation data
                    await parseInvitationWithVCProof();

                    // Extract basic invitation data for preview
                    try {
                        const urlObj = new URL(oob);
                        const oobParam = urlObj.searchParams.get('_oob');

                        if (oobParam && !oobParam.startsWith('did:peer:')) {
                            const parseResult = safeBase64ParseJSON(oobParam, 'invitation preview');
                            if (parseResult.isValid) {
                                const invitation = parseResult.data;
                                setParsedInvitationData({
                                    id: invitation.id,
                                    from: invitation.from,
                                    type: invitation.type,
                                    goal: invitation.body?.goal
                                });

                                // ✅ CA IDENTITY VERIFICATION: Check if this is a CA invitation
                                const isCA = invitation.body?.goal_code === 'ca-identity-verification';
                                setIsCAInvitation(isCA);

                                if (isCA) {
                                    console.log('🏛️ [CA INIT] CA identity verification invitation detected');

                                    // Parse and validate CA credential from invitation
                                    try {
                                        const caCredential = parseCACredentialFromInvitation(invitation);

                                        if (caCredential) {
                                            console.log('✅ [CA INIT] CA credential found in invitation');

                                            // Validate CA credential structure and claims
                                            const validatedCA = await validateCACredential(caCredential);
                                            setCAConfig(validatedCA);

                                            console.log('✅ [CA INIT] CA credential validated:', validatedCA.organizationName);

                                            // Check if CA is already pinned (TOFU)
                                            const alreadyPinned = isCAVerified();
                                            setCAAlreadyPinned(alreadyPinned);

                                            if (alreadyPinned) {
                                                // Verify CA DID matches pinned CA
                                                const pinnedCA = getPinnedCA();
                                                const matches = verifyPinnedCA(validatedCA.caDID);

                                                if (!matches) {
                                                    console.error('🚨 [CA INIT] CA DID MISMATCH - Potential MITM attack!');
                                                    console.error('  Expected:', pinnedCA?.caDID);
                                                    console.error('  Received:', validatedCA.caDID);
                                                    alert('⚠️ SECURITY WARNING: CA identity has changed! This may be a man-in-the-middle attack. Connection refused.');
                                                    return; // Stop processing
                                                } else {
                                                    console.log('✅ [CA INIT] CA DID verified against pinned CA');
                                                }
                                            } else {
                                                console.log('ℹ️ [CA INIT] First connection to CA - TOFU will apply on accept');
                                            }
                                        } else {
                                            console.warn('⚠️ [CA INIT] CA invitation but no credential found');
                                        }
                                    } catch (error) {
                                        console.error('❌ [CA INIT] CA credential validation failed:', error);
                                        alert(`CA credential validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                                    }
                                }

                                // ✅ COMPANY IDENTITY VERIFICATION: Check if this is a company invitation
                                const isCompany = invitation.body?.goal_code === 'company-employee-verification';
                                setIsCompanyInvitation(isCompany);

                                if (isCompany) {
                                    console.log('🏢 [COMPANY INIT] Company identity verification invitation detected');

                                    // Parse and validate company credential from invitation
                                    try {
                                        const companyCredential = parseCompanyCredentialFromInvitation(invitation);

                                        if (companyCredential) {
                                            console.log('✅ [COMPANY INIT] Company credential found in invitation');

                                            // Validate company credential structure and claims
                                            const validatedCompany = await validateCompanyCredential(companyCredential);
                                            setCompanyConfig(validatedCompany);

                                            console.log('✅ [COMPANY INIT] Company credential validated:', validatedCompany.companyName);

                                            // ✅ CA VERIFICATION: Check if CompanyIdentity VC was issued by trusted CA
                                            const caVerification = await verifyCompanyIssuer(agent, companyCredential);
                                            setCompanyCAVerification(caVerification);

                                            if (caVerification.verified) {
                                                console.log(`✅ [COMPANY INIT] Company verified by trusted CA: ${caVerification.caName}`);
                                            } else {
                                                console.log('ℹ️ [COMPANY INIT] Company not verified by CA - TOFU applies');
                                            }

                                            // Check if company is already pinned (TOFU)
                                            const alreadyPinned = isCompanyVerified();
                                            setCompanyAlreadyPinned(alreadyPinned);

                                            if (alreadyPinned) {
                                                // Verify company DID matches pinned company
                                                const pinnedCompany = getPinnedCompany();
                                                const matches = verifyPinnedCompany(validatedCompany.companyDID);

                                                if (!matches) {
                                                    console.error('🚨 [COMPANY INIT] Company DID MISMATCH - Potential MITM attack!');
                                                    console.error('  Expected:', pinnedCompany?.companyDID);
                                                    console.error('  Received:', validatedCompany.companyDID);
                                                    alert('⚠️ SECURITY WARNING: Company identity has changed! This may be a man-in-the-middle attack. Connection refused.');
                                                    return; // Stop processing
                                                } else {
                                                    console.log('✅ [COMPANY INIT] Company DID verified against pinned company');
                                                }
                                            } else {
                                                console.log('ℹ️ [COMPANY INIT] First connection to company - TOFU will apply on accept');
                                            }
                                        } else {
                                            console.warn('⚠️ [COMPANY INIT] Company invitation but no credential found');
                                        }
                                    } catch (error) {
                                        console.error('❌ [COMPANY INIT] Company credential validation failed:', error);
                                        alert(`Company credential validation failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
                                    }
                                }

                                // ✅ PHASE 1 FIX: Removed premature invitation state creation
                                // Invitation records will now only be created when user clicks "Accept Invitation"
                                // This prevents unwanted records appearing when user only clicks "Preview"
                                console.log('ℹ️ [INVITATION STATE] Invitation parsed but record NOT created (user must accept first)');

                                // ✅ Show preview modal automatically after parsing
                                console.log('✅ [AUTO-PARSE] Opening preview modal...');
                                setShowPreviewModal(true);
                            }
                        }
                    } catch (error) {
                        console.error('Error extracting invitation data:', error);
                    }
                } finally {
                    // ✅ BUG FIX 2: Clear parsing flag after completion (success or failure)
                    setIsParsing(false);
                }
            } else if (!isParsing) {
                // ✅ BUG FIX 2: Only clear state if NOT currently parsing
                // This prevents clearing correctly-set identity during React render batching
                console.log('🧹 [AUTO-PARSE] Clearing invitation state (not parsing)');
                setInviterIdentity(null);
                setHasVCRequest(false);
                setInviterLabel('');
                setShowPreviewModal(false);
                setParsedInvitationData(null);
            } else {
                console.log('⏸️ [AUTO-PARSE] Skipping state clear - parsing in progress');
            }
        };

        parseAndShowPreview();
    }, [oob, isParsing]);

    // ✅ PHASE 4 FIX: Open preview modal only when inviterIdentity is ready
    // This ensures modal receives fully populated identity state with VC data
    // ✅ BUG FIX 3: Prevent modal reopening during connection acceptance
    useEffect(() => {
        // Only open modal if we have parsed invitation data AND identity state is ready
        // AND we are NOT currently accepting a connection
        if (parsedInvitationData && inviterIdentity !== null && !showPreviewModal && !isAcceptingConnection) {
            console.log('✅ [IDENTITY-READY] Identity state updated, opening preview modal...');
            console.log('👤 [IDENTITY-READY] inviterIdentity:', {
                isVerified: inviterIdentity.isVerified,
                hasVCProof: !!inviterIdentity.vcProof,
                revealedDataKeys: Object.keys(inviterIdentity.revealedData || {}),
                revealedDataLength: Object.keys(inviterIdentity.revealedData || {}).length
            });
            setShowPreviewModal(true);
        }
    }, [inviterIdentity, parsedInvitationData, showPreviewModal, isAcceptingConnection]);

    // Parse proper DIDComm v2.0 invitation format and raw peer DIDs
    const parseProperDIDCommInvitation = (url: string) => {
        try {
            const urlObj = new URL(url);
            const oobParam = urlObj.searchParams.get('_oob');

            if (oobParam) {
                // First check if it's a raw peer DID (most common case from createNewPeerDID)
                if (oobParam.startsWith('did:peer:')) {
                    console.log("✅ Detected raw peer DID invitation format");
                    return { from: oobParam, type: "peer-did" };
                }

                try {
                    // Try to parse as proper DIDComm invitation using safe base64 decoding
                    const parseResult = safeBase64ParseJSON(oobParam, 'DIDComm invitation');
                    if (!parseResult.isValid) {
                        console.warn("⚠️ Not base64 JSON, treating as raw DID:", parseResult.error);
                        return { from: oobParam, type: "raw" };
                    }
                    const invitation = parseResult.data;

                    // Check if this is a Cloud Agent invitation (handle BEFORE RFC 0434)
                    if (invitation.type === "https://didcomm.org/connections/1.0/invitation" ||
                        invitation.type === "https://didcomm.atalaprism.io/connections/1.0/invitation") {
                        console.log("✅ Detected Cloud Agent invitation format");

                        // Extract connection label from Cloud Agent invitation
                        if (invitation.label) {
                            setInviterLabel(invitation.label);
                            console.log("📝 Cloud Agent connection label:", invitation.label);
                        }

                        // Mark as Cloud Agent invitation type for proper routing
                        return { ...invitation, invitationType: "cloud-agent" };
                    }

                    // Check if this is an RFC 0434 format invitation (could be Cloud Agent or Edge Wallet)
                    if (invitation.type === "https://didcomm.org/out-of-band/2.0/invitation") {
                        // Check for Cloud Agent specific goal first
                        if (invitation.body?.goal === "Connection from CA" ||
                            invitation.body?.goal?.toLowerCase().includes("certification authority")) {
                            console.log("✅ Detected Cloud Agent invitation by goal field");

                            // Extract connection label from goal
                            setInviterLabel(invitation.body.goal);
                            console.log("📝 Cloud Agent connection goal:", invitation.body.goal);

                            // Mark as Cloud Agent invitation type for proper routing
                            return { ...invitation, invitationType: "cloud-agent" };
                        }

                        // Otherwise it's an Edge Wallet RFC 0434 invitation
                        console.log("✅ Detected Edge Wallet RFC 0434 format invitation");

                        // Extract connection label/tag from invitation body
                        if (invitation.body?.goal) {
                            setInviterLabel(invitation.body.goal);
                            console.log("📝 Connection goal/tag:", invitation.body.goal);
                        }

                        // Extract connection label from old format
                        if (invitation.label) {
                            setInviterLabel(invitation.label);
                            console.log("📝 Inviter connection label:", invitation.label);
                        }

                        // Mark as Edge Wallet invitation type for proper routing
                        return { ...invitation, invitationType: "edge-wallet" };
                    } else if (invitation["@type"]) {
                        // Check for old format with @type
                        console.log("⚠️ Detected old DIDComm v2.0 format");
                        return invitation;
                    } else {
                        // Unknown format - try as legacy
                        console.warn("⚠️ Unknown invitation format, treating as legacy");
                        return { from: oobParam, type: "legacy" };
                    }
                } catch (e) {
                    // Fallback for old format (raw DID string)
                    console.warn("⚠️ Using fallback parsing for raw invitation format:", e.message);
                    return { from: oobParam, type: "raw" };
                }
            }
            throw new Error("No invitation data found in URL");
        } catch (error) {
            console.error("❌ Failed to parse invitation:", error);
            throw error;
        }
    };

    // ✅ PHASE 1: Separated connection acceptance function
    // This ONLY handles connection creation, verification already done automatically
    // ✅ PHASE 3: Added invitation state tracking for connection acceptance
    async function onConnectionHandleClick() {
        if (!oob) {
            return;
        }

        if (!agent) {
            throw new Error("Start the agent first")
        }

        // ✅ BUG FIX 3: Set flag to prevent modal from reopening during connection acceptance
        setIsAcceptingConnection(true);

        try {
            // 🏢 ENTERPRISE WALLET: Use Cloud Agent API to accept invitation
            if (walletContext === 'enterprise' && enterpriseConfig) {
                console.log('🏢 [ENTERPRISE] Accepting invitation via Cloud Agent');

                const client = new EnterpriseAgentClient({
                    vcId: '',
                    credentialId: '',
                    enterpriseAgentUrl: enterpriseConfig.enterpriseAgentUrl,
                    enterpriseAgentName: enterpriseConfig.enterpriseAgentName,
                    enterpriseAgentApiKey: enterpriseConfig.enterpriseAgentApiKey,
                    isActive: true
                });

                const response = await client.acceptInvitation(
                    oob,
                    alias || 'Enterprise Connection'
                );

                if (response.success && response.data) {
                    console.log('✅ [ENTERPRISE] Invitation accepted successfully');
                    console.log(`   Connection ID: ${response.data.connectionId}`);
                    console.log(`   State: ${response.data.state}`);

                    // Clear invitation state
                    setOOB('');
                    setParsedInvitationData(null);
                    setInviterIdentity(null);
                    setInviterLabel('');
                    setIsAcceptingConnection(false);

                    alert('✅ Enterprise connection created successfully!');
                    return;
                } else {
                    throw new Error(response.error || 'Failed to accept enterprise invitation');
                }
            }

            // 👤 PERSONAL WALLET: Use Edge Agent SDK (existing logic)
            console.log('🔗 [ACCEPT] User clicked Accept Invitation - creating connection...');
            console.log('✅ [ACCEPT] VC verification already completed automatically');

            // ✅ NEW: Check if user selected a credential to attach to response
            let vcProofData = null;
            let vcProofBase64 = null;
            if (selectedVCForResponse && responseFields.length > 0) {
                console.log(`🎫 [RESPONSE] Creating VC proof with disclosure level: ${responseDisclosureLevel}`);
                console.log(`📋 [RESPONSE] Selected fields: [${responseFields.join(', ')}]`);

                vcProofBase64 = createVCProofAttachment(
                    selectedVCForResponse,
                    responseFields,
                    responseDisclosureLevel
                );

                // Parse the VC proof to embed in response
                vcProofData = JSON.parse(atob(vcProofBase64));
                console.log('✅ [RESPONSE] VC proof attachment created for response');
            } else {
                console.log('ℹ️ [RESPONSE] No credential selected for response');
            }

            // Close preview modal if open
            setShowPreviewModal(false);
            // Parse the invitation format (handles both raw peer DIDs and proper invitations)
            const invitation = parseProperDIDCommInvitation(oob);
            console.log("✅ Parsed invitation:", invitation);

            // Extract name from inviter's VC if available
            let vcBasedName = null;
            if (inviterIdentity?.revealedData) {
                const { firstName, lastName } = inviterIdentity.revealedData;
                if (firstName && lastName) {
                    vcBasedName = `${firstName} ${lastName}`;
                    console.log('🏷️ [CONNECTION LABEL] Extracted name from inviter VC:', vcBasedName);
                }
            }

            // Priority: manual alias > VC name > company name > invitation label > fallback
            let connectionLabel = alias || vcBasedName || companyConfig?.companyName || inviterLabel || "Unknown Connection";

            // ✅ PHASE 1: Extract invitation ID for state tracking
            let invitationId = null;
            if (invitation.id) {
                invitationId = invitation.id;
            } else if (parsedInvitationData?.id) {
                invitationId = parsedInvitationData.id;
            }

            // ✅ PHASE 1: Create Bob-side invitation state record WHEN USER ACCEPTS
            // This is the correct place - only when user explicitly clicks "Accept Invitation"
            if (invitationId) {
                try {
                    const walletId = app.wallet.walletId;
                    const inviterDID = invitation.from;
                    const inviterDisplayLabel = inviterLabel || invitation.body?.goal || 'Unknown';

                    // Check if this invitation already has a record
                    const existingRecord = await invitationStateManager.findInvitation(walletId, invitationId);

                    if (!existingRecord) {
                        const recordId = await invitationStateManager.createReceivedInvitation(
                            walletId,
                            invitationId,
                            inviterDID,
                            inviterDisplayLabel,
                            oob,
                            !!inviterIdentity?.vcProof,
                            inviterIdentity?.vcProof?.type?.join(', ')
                        );
                        console.log('✅ [INVITATION STATE] Created received invitation record with InvitationReceived status:', recordId);
                    } else {
                        console.log('ℹ️ [INVITATION STATE] Invitation record already exists:', existingRecord.id);
                    }
                } catch (error) {
                    console.error('❌ [INVITATION STATE] Failed to create received invitation record:', error);
                    // Don't throw - connection should still proceed even if state tracking fails
                }
            }

            // ✅ PHASE 3: Mark connection request as sent
            if (invitationId) {
                try {
                    const from = await agent.createNewPeerDID([], true);
                    const success = await invitationStateManager.markRequestSent(
                        app.wallet.walletId,
                        invitationId,
                        from.toString()
                    );
                    if (success) {
                        console.log('✅ [INVITATION STATE] Marked invitation as ConnectionRequestSent:', invitationId);
                    }
                } catch (error) {
                    console.error('❌ [INVITATION STATE] Failed to mark as ConnectionRequestSent:', error);
                    // Don't throw - connection should still proceed
                }
            }

            // Handle different invitation types
            if (invitation.type === "peer-did" || invitation.type === "raw") {
                console.log("🔧 Handling raw peer DID invitation");

                // For raw peer DIDs, we need to create a manual connection
                const from = await agent.createNewPeerDID([], true);
                const to = SDK.Domain.DID.fromString(invitation.from);
                const didPair = new SDK.Domain.DIDPair(from, to, connectionLabel);

                try {
                    // LAYER 1: Database Write
                    await agent.connectionManager.addConnection(didPair);
                    console.log('✅ [LAYER 1] Connection stored to IndexedDB:', didPair.name);

                    // LAYER 2: State Update
                    app.dispatch({ type: 'Connection/success', payload: didPair });
                    console.log('✅ [LAYER 2] Connection added to Redux state:', didPair.name);

                    // LAYER 3: Save connection metadata
                    if (walletType === 'local') {
                        saveConnectionMetadata(from.toString(), {
                            walletType: 'local'
                        });
                        console.log('✅ [METADATA] Saved local wallet metadata for accepted connection (peer-DID path)');
                    } else if (walletType === 'cloud' && cloudConfig?.available) {
                        saveConnectionMetadata(from.toString(), {
                            walletType: 'cloud',
                            prismDid: cloudConfig.prismDid,
                            enterpriseAgentUrl: cloudConfig.enterpriseAgentUrl,
                            enterpriseAgentApiKey: cloudConfig.enterpriseAgentApiKey
                        });
                        console.log('✅ [METADATA] Saved cloud wallet metadata for accepted connection (peer-DID path)');
                    }

                    // ✅ PHASE 3: Mark connection as established
                    if (invitationId) {
                        try {
                            const success = await invitationStateManager.markEstablished(
                                app.wallet.walletId,
                                invitationId
                            );
                            if (success) {
                                console.log('✅ [INVITATION STATE] Marked invitation as ConnectionEstablished:', invitationId);
                            }
                        } catch (error) {
                            console.error('❌ [INVITATION STATE] Failed to mark as ConnectionEstablished:', error);
                        }
                    }

                    // ✅ BUG FIX 4: Clear invitation state after successful connection to prevent modal reopening
                    console.log('🧹 [SUCCESS] Clearing invitation state after successful connection (peer-DID path)');
                    setOOB('');
                    setParsedInvitationData(null);
                    setInviterIdentity(null);
                    setInviterLabel('');
                } catch (error) {
                    if (error.message?.includes('already exists')) {
                        console.log("ℹ️ Connection already exists, skipping duplicate storage");
                    } else {
                        console.error("❌ Failed to store raw peer DID connection:", error);
                        throw error;
                    }
                }
            } else if (invitation.invitationType === "cloud-agent") {
                // Handle Cloud Agent invitation - use simple working approach from Sept 19 backup
                console.log("🏢 [CLOUD AGENT] Processing Cloud Agent invitation");

                try {
                    // ✅ WORKING APPROACH from backup: parseOOBInvitation + acceptInvitation
                    const parsedInvitation = await agent.parseOOBInvitation(new URL(oob));
                    const connection = await agent.acceptInvitation(parsedInvitation, connectionLabel);

                    console.log("✅ [CLOUD AGENT] SDK acceptance successful:", connection);

                    // Store connection using connectionManager
                    if (connection) {
                        try {
                            // LAYER 1: Database Write
                            await agent.connectionManager.addConnection(connection);
                            console.log('✅ [LAYER 1] Connection stored to IndexedDB:', connection.name);

                            // LAYER 2: State Update
                            app.dispatch({ type: 'Connection/success', payload: connection });
                            console.log('✅ [LAYER 2] Connection added to Redux state:', connection.name);

                            // LAYER 3: Save connection metadata
                            if (walletType === 'local') {
                                saveConnectionMetadata(connection.host.toString(), {
                                    walletType: 'local'
                                });
                                console.log('✅ [METADATA] Saved local wallet metadata for accepted connection (Cloud Agent path)');
                            } else if (walletType === 'cloud' && cloudConfig?.available) {
                                saveConnectionMetadata(connection.host.toString(), {
                                    walletType: 'cloud',
                                    prismDid: cloudConfig.prismDid,
                                    enterpriseAgentUrl: cloudConfig.enterpriseAgentUrl,
                                    enterpriseAgentApiKey: cloudConfig.enterpriseAgentApiKey
                                });
                                console.log('✅ [METADATA] Saved cloud wallet metadata for accepted connection (Cloud Agent path)');
                            }

                            // ✅ CA IDENTITY VERIFICATION: Pin CA on first successful connection (TOFU)
                            if (isCAInvitation && caConfig && !caAlreadyPinned) {
                                console.log('📌 [CA INIT] Pinning CA identity (Trust On First Use)...');

                                try {
                                    // Hash the credential JWT for verification
                                    const credentialHash = await hashCredential(caConfig.credentialJWT);

                                    // Pin the CA with all verified information
                                    pinCA({
                                        caDID: caConfig.caDID,
                                        organizationName: caConfig.organizationName,
                                        website: caConfig.website,
                                        jurisdiction: caConfig.jurisdiction,
                                        registrationNumber: caConfig.registrationNumber,
                                        credentialHash
                                    });

                                    console.log('✅ [CA INIT] CA identity pinned successfully');
                                    alert(`✅ Connected to Certification Authority:\n\n${caConfig.organizationName}\n${caConfig.website}\n\nThis CA's identity has been saved. Future connections will be verified against this identity.`);
                                } catch (error) {
                                    console.error('❌ [CA INIT] Failed to pin CA identity:', error);
                                }
                            } else if (isCAInvitation && caAlreadyPinned) {
                                console.log('✅ [CA INIT] CA identity re-verified successfully');
                                alert(`✅ Reconnected to known Certification Authority:\n\n${caConfig?.organizationName}\n\nCA identity verified against saved pin.`);
                            }

                            // ✅ COMPANY IDENTITY VERIFICATION: Pin company on first successful connection (TOFU)
                            if (isCompanyInvitation && companyConfig && !companyAlreadyPinned) {
                                console.log('📌 [COMPANY INIT] Pinning company identity (Trust On First Use)...');

                                try {
                                    // Hash the credential JWT for verification
                                    const credentialHash = await hashCredential(companyConfig.credentialJWT);

                                    // Pin the company with all verified information
                                    pinCompany({
                                        companyDID: companyConfig.companyDID,
                                        companyName: companyConfig.companyName,
                                        registrationNumber: companyConfig.registrationNumber,
                                        jurisdiction: companyConfig.jurisdiction,
                                        credentialHash
                                    });

                                    console.log('✅ [COMPANY INIT] Company identity pinned successfully');
                                    alert(`✅ Connected to Company:\n\n${companyConfig.companyName}\nRegistration: ${companyConfig.registrationNumber}\n\nThis company's identity has been saved. Future connections will be verified against this identity.`);
                                } catch (error) {
                                    console.error('❌ [COMPANY INIT] Failed to pin company identity:', error);
                                }
                            } else if (isCompanyInvitation && companyAlreadyPinned) {
                                console.log('✅ [COMPANY INIT] Company identity re-verified successfully');
                                alert(`✅ Reconnected to known Company:\n\n${companyConfig?.companyName}\n\nCompany identity verified against saved pin.`);
                            }

                            // ✅ PHASE 3: Mark connection as established
                            if (invitationId) {
                                try {
                                    const success = await invitationStateManager.markEstablished(
                                        app.wallet.walletId,
                                        invitationId
                                    );
                                    if (success) {
                                        console.log('✅ [INVITATION STATE] Marked invitation as ConnectionEstablished:', invitationId);
                                    }
                                } catch (error) {
                                    console.error('❌ [INVITATION STATE] Failed to mark as ConnectionEstablished:', error);
                                }
                            }

                            // ✅ BUG FIX 4: Clear invitation state after successful connection to prevent modal reopening
                            console.log('🧹 [SUCCESS] Clearing invitation state after successful connection (Cloud Agent path)');
                            setOOB('');
                            setParsedInvitationData(null);
                            setInviterIdentity(null);
                            setInviterLabel('');
                        } catch (error) {
                            if (error.message?.includes('already exists')) {
                                console.log("ℹ️ [CLOUD AGENT] Connection already exists");
                            } else {
                                console.error("❌ [CLOUD AGENT] Failed to store connection:", error);
                                throw error;
                            }
                        }
                    }

                    console.log("✅ [CLOUD AGENT] Connection establishment complete");
                    return true;
                } catch (error) {
                    console.error("❌ [CLOUD AGENT] Failed to accept invitation:", error);
                    throw error;
                }
            } else if (invitation.invitationType === "edge-wallet" ||
                       invitation.type === "https://didcomm.org/out-of-band/2.0/invitation") {
                // Handle RFC 0434 compliant DIDComm out-of-band invitations (Edge Wallet to Edge Wallet)
                console.log("🎯 [RFC 0434] Processing RFC compliant out-of-band invitation");

                const rfc0434Invitation = invitation;

                // Log invitation details for debugging
                console.log("📋 [RFC 0434] Invitation ID:", rfc0434Invitation.id);
                console.log("📋 [RFC 0434] From DID:", rfc0434Invitation.from);
                console.log("📋 [RFC 0434] Goal:", rfc0434Invitation.body?.goal);

                // Store invitation metadata for thread correlation
                if (typeof window !== 'undefined') {
                    setItem(`invitation-${rfc0434Invitation.id}`, JSON.stringify({
                        id: rfc0434Invitation.id,
                        from: rfc0434Invitation.from,
                        timestamp: Date.now(),
                        goal: rfc0434Invitation.body?.goal,
                        hasVCRequest: rfc0434Invitation.attachments?.some(att => att["@id"] === "request-0"),
                        hasVCProof: rfc0434Invitation.attachments?.some(att => att["@id"] === "vc-proof-0")
                    }));
                }

                // ✅ FIX: Manual connection request with VC attachment
                try {
                    // Create invitee's peer DID for this connection (true = update mediator keylist for message routing)
                    const inviteePeerDID = await agent.createNewPeerDID([], true);
                    const inviterDID = SDK.Domain.DID.fromString(rfc0434Invitation.from);

                    console.log("🔑 [RFC 0434] Invitee's DID:", inviteePeerDID.toString());
                    console.log("🔑 [RFC 0434] Inviter's DID:", inviterDID.toString());

                    // ✅ NEW: Create connection request with VC proof attachment if selected
                    if (vcProofData) {
                        console.log('📤 [RESPONSE] Creating connection request WITH VC proof attachment...');

                        // Create connection request body with VC proof in requests_attach
                        const connectionRequestBody = {
                            goal_code: "connect-with-credential",
                            goal: "Connect and share my credential",
                            accept: ["didcomm/v2"],
                            requests_attach: [{
                                "@id": "vc-proof-response",
                                "mime-type": "application/json",
                                "data": {
                                    "json": vcProofData
                                }
                            }]
                        };

                        // Create DIDComm connection request message with attachment
                        const connectionRequestMessage = new SDK.Domain.Message(
                            JSON.stringify(connectionRequestBody),
                            undefined, // id - let SDK generate
                            "https://didcomm.org/didexchange/1.0/request",
                            inviteePeerDID, // from (invitee)
                            inviterDID, // to (inviter)
                            [], // attachments (empty - we put them in body)
                            rfc0434Invitation.id // thid - thread ID from invitation
                        );

                        await agent.sendMessage(connectionRequestMessage);
                        console.log('✅ [RESPONSE] Connection request with VC proof sent successfully');
                    } else {
                        console.log('ℹ️ [RESPONSE] No VC selected - using standard SDK acceptance');
                        // No VC proof - use standard SDK method
                        const parsedInvitation = await agent.parseOOBInvitation(new URL(oob));
                        await agent.acceptDIDCommInvitation(parsedInvitation, connectionLabel);
                        console.log("✅ [RFC 0434] Standard connection request sent");
                    }

                    // Store the connection locally
                    const didPair = new SDK.Domain.DIDPair(inviteePeerDID, inviterDID, connectionLabel);

                    // LAYER 1: Database Write
                    await agent.connectionManager.addConnection(didPair);
                    console.log('✅ [LAYER 1] Connection stored to IndexedDB:', didPair.name);

                    // LAYER 2: State Update
                    app.dispatch({ type: 'Connection/success', payload: didPair });
                    console.log('✅ [LAYER 2] Connection added to Redux state:', didPair.name);

                    // ✅ PHASE 3: Mark connection as established
                    if (invitationId) {
                        try {
                            const success = await invitationStateManager.markEstablished(
                                app.wallet.walletId,
                                invitationId
                            );
                            if (success) {
                                console.log('✅ [INVITATION STATE] Marked invitation as ConnectionEstablished:', invitationId);
                            }
                        } catch (error) {
                            console.error('❌ [INVITATION STATE] Failed to mark as ConnectionEstablished:', error);
                        }
                    }

                    // ✅ BUG FIX 4: Clear invitation state after successful connection to prevent modal reopening
                    console.log('🧹 [SUCCESS] Clearing invitation state after successful connection (RFC 0434 SDK path)');
                    setOOB('');
                    setParsedInvitationData(null);
                    setInviterIdentity(null);
                    setInviterLabel('');
                    // ✅ NEW: Also clear response VC selection
                    setSelectedVCForResponse(null);
                    setResponseFields([]);
                    setResponseDisclosureLevel('minimal');

                    return true;
                } catch (sdkError) {
                    console.warn("⚠️ [RFC 0434] SDK approach failed, trying manual connection:", sdkError.message);

                    // Fallback: Create manual connection from RFC invitation
                    const from = await agent.createNewPeerDID([], true);
                    const to = SDK.Domain.DID.fromString(rfc0434Invitation.from);
                    const didPair = new SDK.Domain.DIDPair(from, to, connectionLabel);

                    // LAYER 1: Database Write
                    await agent.connectionManager.addConnection(didPair);
                    console.log('✅ [LAYER 1] Connection stored to IndexedDB:', didPair.name);

                    // LAYER 2: State Update
                    app.dispatch({ type: 'Connection/success', payload: didPair });
                    console.log('✅ [LAYER 2] Connection added to Redux state:', didPair.name);

                    // ✅ PHASE 3: Mark connection as established (fallback path)
                    if (invitationId) {
                        try {
                            const success = await invitationStateManager.markEstablished(
                                app.wallet.walletId,
                                invitationId
                            );
                            if (success) {
                                console.log('✅ [INVITATION STATE] Marked invitation as ConnectionEstablished (fallback):', invitationId);
                            }
                        } catch (error) {
                            console.error('❌ [INVITATION STATE] Failed to mark as ConnectionEstablished:', error);
                        }
                    }

                    // ✅ BUG FIX 4: Clear invitation state after successful connection to prevent modal reopening
                    console.log('🧹 [SUCCESS] Clearing invitation state after successful connection (RFC 0434 manual fallback path)');
                    setOOB('');
                    setParsedInvitationData(null);
                    setInviterIdentity(null);
                    setInviterLabel('');
                }
            } else if (invitation.invitation) {
                // Handle other invitation formats (legacy, manual)
                console.log("🔧 [LEGACY] Processing legacy invitation format");
                const legacyInvitation = invitation.invitation;
            } else {
                console.log("🔧 Handling proper DIDComm invitation");

                // For proper DIDComm invitations, use SDK parsing
                const parsed = await agent.parseInvitation(oob);
                const connection = await agent.acceptInvitation(parsed, connectionLabel);

                // Store the connection using connectionManager API
                if (connection) {
                    try {
                        // LAYER 1: Database Write
                        await agent.connectionManager.addConnection(connection);
                        console.log('✅ [LAYER 1] Connection stored to IndexedDB:', connection.name);

                        // LAYER 2: State Update
                        app.dispatch({ type: 'Connection/success', payload: connection });
                        console.log('✅ [LAYER 2] Connection added to Redux state:', connection.name);

                        // ✅ PHASE 3: Mark connection as established
                        if (invitationId) {
                            try {
                                const success = await invitationStateManager.markEstablished(
                                    app.wallet.walletId,
                                    invitationId
                                );
                                if (success) {
                                    console.log('✅ [INVITATION STATE] Marked invitation as ConnectionEstablished:', invitationId);
                                }
                            } catch (error) {
                                console.error('❌ [INVITATION STATE] Failed to mark as ConnectionEstablished:', error);
                            }
                        }

                        // ✅ BUG FIX 4: Clear invitation state after successful connection to prevent modal reopening
                        console.log('🧹 [SUCCESS] Clearing invitation state after successful connection (standard DIDComm path)');
                        setOOB('');
                        setParsedInvitationData(null);
                        setInviterIdentity(null);
                        setInviterLabel('');
                    } catch (error) {
                        if (error.message?.includes('already exists')) {
                            console.log("ℹ️ Connection already exists, skipping duplicate storage");
                        } else {
                            console.error("❌ Failed to store DIDComm connection:", error);
                            throw error;
                        }
                    }
                }
            }

        } catch (err) {
            console.error("❌ Primary invitation acceptance failed:", err);
            console.log("🔄 Attempting fallback connection approach...");

            if (!alias) {
                console.error("❌ Cannot proceed with fallback - alias required");
                return;
            }

            // Try to parse the invitation manually and establish connection
            try {
                const urlObj = new URL(oob);
                const oobParam = urlObj.searchParams.get('_oob');

                if (oobParam && oobParam.startsWith('did:peer:')) {
                    // Direct peer DID fallback
                    const from = await agent.createNewPeerDID([], true);
                    const to = SDK.Domain.DID.fromString(oobParam);
                    const didPair = new SDK.Domain.DIDPair(from, to, alias);

                    // LAYER 1: Database Write
                    await agent.connectionManager.addConnection(didPair);
                    console.log('✅ [LAYER 1] Fallback peer DID connection stored to IndexedDB:', didPair.name);

                    // LAYER 2: State Update
                    app.dispatch({ type: 'Connection/success', payload: didPair });
                    console.log('✅ [LAYER 2] Connection added to Redux state:', didPair.name);
                } else {
                    // Try SDK parsing fallback
                    const parsed = await agent.parseInvitation(oob);
                    console.log("✅ Fallback parsed invitation:", parsed);

                    const from = await agent.createNewPeerDID([], true);
                    const to = parsed.from;
                    const didPair = new SDK.Domain.DIDPair(from, to, alias);

                    // LAYER 1: Database Write
                    await agent.connectionManager.addConnection(didPair);
                    console.log('✅ [LAYER 1] Fallback connection stored to IndexedDB:', didPair.name);

                    // LAYER 2: State Update
                    app.dispatch({ type: 'Connection/success', payload: didPair });
                    console.log('✅ [LAYER 2] Connection added to Redux state:', didPair.name);
                }

            } catch (manualErr) {
                console.error("❌ All connection approaches failed:", manualErr);
                throw new Error("Could not establish connection through any method");
            }
        } finally {
            // ✅ BUG FIX 3: Always clear flag when connection acceptance completes (success or failure)
            setIsAcceptingConnection(false);
            console.log('✅ [ACCEPT] Connection acceptance process completed, flag cleared');
        }
    }

    // ✅ PHASE 4: Reject invitation handler
    // Marks invitation as rejected in invitation state manager and closes modal
    async function onConnectionReject() {
        console.log('❌ [REJECT] User clicked Reject Invitation');

        // Close preview modal
        setShowPreviewModal(false);

        // Extract invitation ID for state tracking
        let invitationId = null;
        if (parsedInvitationData?.id) {
            invitationId = parsedInvitationData.id;
        }

        // Mark invitation as rejected if we have an ID
        if (invitationId) {
            try {
                const walletId = app.wallet.walletId;
                const success = await invitationStateManager.markRejected(
                    walletId,
                    invitationId
                );
                if (success) {
                    console.log('✅ [INVITATION STATE] Marked invitation as Rejected:', invitationId);
                } else {
                    console.warn('⚠️ [INVITATION STATE] Could not mark as rejected (invitation may not exist):', invitationId);
                }
            } catch (error) {
                console.error('❌ [INVITATION STATE] Failed to mark invitation as rejected:', error);
            }
        }

        // Clear the invitation form
        setOOB('');
        setInviterIdentity(null);
        setInviterLabel('');
        setParsedInvitationData(null);

        console.log('✅ [REJECT] Invitation rejected and cleared');
    }


    // Parse invitation URL to extract and validate VC proof and VC requests
    const parseInvitationWithVCProof = async () => {
        if (!oob) return;

        // ✅ BUG FIX 1: Track if identity has been set by RFC attachment processing
        // This prevents the legacy fallback's else block from overwriting correctly-parsed identity
        let identityAlreadySet = false;

        try {
            // First try to parse the invitation to check for attachments
            const urlObj = new URL(oob);
            const oobParam = urlObj.searchParams.get('_oob');

            if (oobParam) {
                // Skip base64 parsing if this is a raw peer DID
                if (oobParam.startsWith('did:peer:')) {
                    console.log("🔍 Raw peer DID detected, skipping invitation attachment parsing");
                    // Raw peer DIDs don't have attachments, continue to URL parameter parsing
                } else {
                    try {
                        // Decode the invitation using safe base64 parsing
                        const parseResult = safeBase64ParseJSON(oobParam, 'invitation');
                        if (!parseResult.isValid) {
                            console.warn("⚠️ Could not parse invitation:", parseResult.error);
                            throw new Error(parseResult.error);
                        }
                        const invitation = parseResult.data;
                        console.log("🔍 Checking invitation for VC proof attachments:", invitation);

                    // ✅ FIX: Check BOTH requests_attach (RFC 0434) AND attachments (legacy) for maximum compatibility
                    const attachments = invitation.requests_attach || invitation.attachments;
                    if (attachments && attachments.length > 0) {
                        console.log("📎 Found RFC-compliant attachments:", attachments.length);
                        console.log("📎 Attachment field used:", invitation.requests_attach ? 'requests_attach (RFC 0434)' : 'attachments (legacy)');

                        // Process each attachment
                        for (const attachment of attachments) {
                            console.log(`📋 Processing attachment: ${attachment["@id"]}`);

                            if (attachment.data && attachment.data.json) {
                                // Check if this is a VC proof attachment
                                if (attachment["@id"] === "vc-proof-0") {
                                    const vcProof = attachment.data.json;
                                    console.log("✅ Found VC proof in RFC-compliant attachment:", vcProof);

                                    // Validate the VC proof using cryptographic verification
                                    const validationResult = await validateVerifiableCredential(vcProof, app.agent.instance, app.agent.instance?.pluto);
                                    console.log('VC Proof validation result:', validationResult);

                                    // Parse inviter identity from VC proof
                                    const identity = await parseInviterIdentity(vcProof, validationResult, app.agent.instance, app.agent.instance?.pluto);
                                    setInviterIdentity(identity);

                                    // ✅ BUG FIX 1: Mark identity as set to prevent legacy fallback from overwriting
                                    identityAlreadySet = true;

                                    console.log('📊 Validation result:', validationResult);
                                    console.log('👤 Inviter identity:', identity);
                                }

                                // Check if this is a presentation request attachment
                                if (attachment["@id"] === "request-0") {
                                    const presentationRequest = attachment.data.json;
                                    console.log("📋 Found RFC-compliant presentation request:", presentationRequest);

                                    // Store the presentation request for Bob to process
                                    if (presentationRequest["@type"] === "https://didcomm.atalaprism.io/present-proof/3.0/request-presentation") {
                                        console.log('📋 Detected VC presentation request in invitation');
                                        setHasVCRequest(true);

                                        // Store the invitation ID for thread correlation
                                        const invitationId = invitation.id;
                                        console.log('🎯 [THREAD] Storing invitation ID for response correlation:', invitationId);

                                        // Store the presentation request context for response correlation
                                        if (typeof window !== 'undefined') {
                                            setItem(`presentation-request-${invitationId}`, JSON.stringify({
                                                invitationId: invitationId,
                                                requestId: presentationRequest["@id"],
                                                request: presentationRequest,
                                                timestamp: Date.now()
                                            }));
                                        }
                                    }
                                }
                            }
                        }
                    }
                    } catch (e) {
                        console.log("⚠️ Could not parse invitation for attachments:", e);
                    }
                }
            }

            // Fallback: Check for legacy vcproof URL parameter
            const vcProofParam = urlObj.searchParams.get('vcproof');
            if (vcProofParam) {
                // Decode base64 VC proof using safe parsing
                const vcProofResult = safeBase64ParseJSON(decodeURIComponent(vcProofParam), 'VC proof');
                if (!vcProofResult.isValid) {
                    console.warn("⚠️ Could not parse VC proof parameter:", vcProofResult.error);
                    return; // Skip invalid VC proof
                }
                const vcProof = vcProofResult.data;

                // Validate the VC proof using cryptographic verification
                const validationResult = await validateVerifiableCredential(vcProof, app.agent.instance, app.agent.instance?.pluto);

                // Parse inviter identity from VC proof
                const identity = parseInviterIdentity(vcProof, validationResult, app.agent.instance, app.agent.instance?.pluto);
                setInviterIdentity(identity);

                // ✅ BUG FIX 1: Mark identity as set from legacy URL parameter
                identityAlreadySet = true;

                console.log(`🔍 Using disclosure level for identity: ${disclosureLevel}`);
                console.log('VC Proof validated:', validationResult);
                console.log('Inviter identity:', identity);
            } else if (!identityAlreadySet) {
                // ✅ BUG FIX 1: Only clear identity if NOT already set by RFC attachment
                // This prevents overwriting correctly-parsed identity from RFC 0434 attachments
                console.log('ℹ️ No VC proof found (neither RFC attachment nor URL parameter)');
                setInviterIdentity({
                    isVerified: false,
                    revealedData: {},
                    validationResult: {
                        isValid: false,
                        errors: ['No identity verification provided'],
                        issuer: null,
                        issuedAt: null,
                        expiresAt: null
                    }
                });
            } else {
                console.log('✅ Identity already set by RFC attachment, skipping legacy fallback');
            }

            // Check for simple VC request parameter
            const vcRequestParam = urlObj.searchParams.get('vcrequest');
            if (vcRequestParam === 'simple') {
                console.log('📋 Found simple VC request in invitation');
                setHasVCRequest(true);
            }

        } catch (error) {
            console.error('Error parsing VC proof:', error);
            // Set invalid proof identity
            setInviterIdentity({
                isVerified: false,
                revealedData: {},
                validationResult: {
                    isValid: false,
                    errors: ['Invalid or corrupted VC proof'],
                    issuer: null,
                    issuedAt: null,
                    expiresAt: null
                }
            });
        }
    };

    const connection = connections.at(0);

    return (
        <div className="space-y-6">
            {/* Header Section */}
            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                <div className="flex items-center space-x-3 mb-4">
                    <div className="w-10 h-10 bg-blue-100 dark:bg-blue-900 rounded-lg flex items-center justify-center">
                        <span className="text-blue-600 dark:text-blue-400 text-xl">🔗</span>
                    </div>
                    <div>
                        <h1 className="text-2xl font-bold text-gray-900 dark:text-white">
                            Enhanced DIDComm Connections
                        </h1>
                        <p className="text-gray-600 dark:text-gray-400">
                            Create and accept connections with optional identity verification
                        </p>
                    </div>
                </div>

                <div className="bg-blue-50 dark:bg-blue-900/30 border border-blue-200 dark:border-blue-700 rounded-lg p-4">
                    <p className="text-sm text-blue-800 dark:text-blue-200">
                        <strong>New Feature:</strong> Create invitations with RealPerson VC proof or accept invitations with identity verification. Use the tabs below to switch between creating and accepting connections.
                    </p>
                </div>
            </div>

            {/* Tab Navigation */}
            <div className="flex space-x-1 bg-gray-100 dark:bg-gray-700 p-1 rounded-lg">
                <button
                    onClick={() => setShowingInvitation(false)}
                    className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                        !showingInvitation
                            ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                >
                    📨 Accept Invitation
                </button>
                <button
                    onClick={() => setShowingInvitation(true)}
                    className={`flex-1 py-2 px-4 rounded-md text-sm font-medium transition-colors ${
                        showingInvitation
                            ? 'bg-white dark:bg-gray-800 text-gray-900 dark:text-white shadow'
                            : 'text-gray-500 dark:text-gray-400 hover:text-gray-700 dark:hover:text-gray-200'
                    }`}
                >
                    🚀 Create Invitation
                </button>
            </div>

            {/* Main Content */}
            <AgentRequire text="Agent required. You cannot process an OOB invitation while the agent is not running.">
                {!showingInvitation ? (
                    /* Accept Invitation Tab */
                    <div className="space-y-6">
                        {/* Inviter Verification Display */}
                        {inviterIdentity && (
                            <>
                                {inviterIdentity.isVerified ? (
                                    <InviterVerification
                                        inviterIdentity={inviterIdentity}
                                        className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700"
                                    />
                                ) : (
                                    <SecurityAlert
                                        type={inviterIdentity.validationResult.errors.includes('Invalid or corrupted VC proof') ? 'invalid-proof' : 'no-proof'}
                                        onAcceptRisk={() => console.log('User accepted security risk')}
                                        onReject={() => {
                                            setOOB('');
                                            setInviterIdentity(null);
                                        }}
                                        errors={inviterIdentity.validationResult.errors}
                                        className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700"
                                    />
                                )}
                            </>
                        )}

                        {/* Connection Acceptance Form */}
                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                            <div className="space-y-6">
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Accept Invitation</h3>

                                {/* Inviter Label Display */}
                                {inviterLabel && (
                                    <div className="p-4 bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded-lg">
                                        <div className="flex items-center space-x-2">
                                            <span className="text-blue-600 dark:text-blue-400">🏷️</span>
                                            <span className="text-sm font-medium text-blue-800 dark:text-blue-200">
                                                Connection Label:
                                            </span>
                                            <span className="text-sm text-blue-700 dark:text-blue-300 font-semibold">
                                                {inviterLabel}
                                            </span>
                                        </div>
                                    </div>
                                )}

                                {/* Your Connection Alias Input */}
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                        Your Connection Alias (Optional)
                                    </label>
                                    <input
                                        className="w-full p-4 text-sm text-gray-900 bg-gray-50 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500 transition-colors"
                                        placeholder="e.g., Alice's Issuer Wallet, Business Partner, etc."
                                        type="text"
                                        value={alias ?? ""}
                                        onChange={(e) => { setAlias(e.target.value) }}
                                    />
                                    <p className="text-xs text-gray-600 dark:text-gray-400 mt-2">
                                        Add your own label for this connection (will use inviter's label if empty)
                                    </p>
                                </div>

                                {/* OOB Invitation Input */}
                                <div>
                                    <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                        OOB Invitation or DID
                                    </label>

                                    {/* QR Scanner Toggle Button */}
                                    <button
                                        onClick={() => setShowScanner(!showScanner)}
                                        className={`mb-3 w-full py-2 px-4 text-sm font-medium rounded-lg transition-colors ${
                                            showScanner
                                                ? 'bg-red-500 hover:bg-red-600 text-white'
                                                : 'bg-blue-500 hover:bg-blue-600 text-white'
                                        }`}
                                    >
                                        {showScanner ? '❌ Close Scanner' : '📷 Scan Invitation QR Code'}
                                    </button>

                                    {/* Inline QR Scanner */}
                                    {showScanner && (
                                        <div className="mb-3 rounded-lg overflow-hidden border-2 border-blue-500">
                                            <Scanner
                                                allowedTypes={['oob-invitation', 'ca-identity-verification', 'peer-did'] as MessageType[]}
                                                onScan={handleScan}
                                                onError={handleScanError}
                                                preferredCamera="back"
                                                scanMode="single"
                                                pauseAfterScan={true}
                                                showOverlay={true}
                                            />
                                        </div>
                                    )}

                                    {/* Manual Invitation Input */}
                                    <label className="block text-sm text-gray-600 dark:text-gray-400 mb-2">
                                        Or paste invitation manually:
                                    </label>
                                    <textarea
                                        className="w-full p-4 text-sm text-gray-900 bg-gray-50 rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-700 dark:border-gray-600 dark:placeholder-gray-400 dark:text-white dark:focus:ring-blue-500 dark:focus:border-blue-500 transition-colors resize-none"
                                        placeholder="Paste invitation URL or DID..."
                                        rows={4}
                                        value={oob ?? ""}
                                        onChange={handleOnChange}
                                        disabled={showScanner}
                                    />
                                </div>

                                {/* Simple VC Request Display */}
                                {hasVCRequest && (
                                    <div className="border rounded-lg p-4 bg-orange-50 dark:bg-orange-900/30 border-orange-200 dark:border-orange-700">
                                        <div className="flex items-center space-x-2 mb-4">
                                            <div className="text-orange-600 dark:text-orange-400">📋</div>
                                            <h3 className="text-lg font-semibold text-orange-800 dark:text-orange-200">
                                                Credential Request
                                            </h3>
                                        </div>
                                        <p className="text-sm text-orange-700 dark:text-orange-300 mb-4">
                                            The inviter is requesting that you provide any available credential for verification.
                                        </p>
                                        <div className="bg-blue-50 dark:bg-blue-900 border border-blue-200 dark:border-blue-700 rounded-lg p-3">
                                            <p className="text-sm text-blue-700 dark:text-blue-300">
                                                💡 <strong>Simple Request:</strong> You can choose any credential from your wallet to share during this connection.
                                            </p>
                                        </div>

                                        {/* Credential Selection for VC Request Response */}
                                        <div className="mt-4 space-y-4">
                                            <div>
                                                <label className="block text-sm font-semibold text-orange-700 dark:text-orange-300 mb-2">
                                                    Select Credential to Share
                                                </label>
                                                <select
                                                    className="w-full p-3 text-sm text-gray-900 bg-white rounded-lg border border-orange-300 focus:ring-2 focus:ring-orange-500 focus:border-orange-500 dark:bg-gray-600 dark:border-gray-500 dark:text-white"
                                                    value={selectedCredential ? availableCredentials.indexOf(selectedCredential) : ''}
                                                    onChange={(e) => {
                                                        const index = parseInt(e.target.value);
                                                        setSelectedCredential(availableCredentials[index] || null);
                                                    }}
                                                >
                                                    <option value="">Select a credential to share...</option>
                                                    {availableCredentials.length === 0 ? (
                                                        <option disabled>No valid credentials available</option>
                                                    ) : (
                                                        availableCredentials.map((cred, index) => (
                                                            <option key={index} value={index}>
                                                                {extractCredentialDisplayName(cred)}
                                                            </option>
                                                        ))
                                                    )}
                                                </select>
                                                {availableCredentials.length === 0 && (
                                                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                                        All RealPerson credentials are revoked or no credentials available
                                                    </p>
                                                )}
                                            </div>

                                            {/* Selective Disclosure for VC Request Response */}
                                            {selectedCredential && (
                                                <SelectiveDisclosure
                                                    credential={selectedCredential}
                                                    onFieldSelection={handleFieldSelection}
                                                    initialLevel="minimal"
                                                />
                                            )}
                                        </div>
                                    </div>
                                )}

                                {/* Accept Connection Button */}
                                <div className="flex justify-end">
                                    <button
                                        className="px-8 py-3 bg-blue-600 text-white font-semibold rounded-lg hover:bg-blue-700 focus:ring-4 focus:ring-blue-300 dark:focus:ring-blue-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                                        onClick={onConnectionHandleClick}
                                        disabled={!oob || oob.trim() === ""}
                                    >
                                        📨 Accept Invitation
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                ) : (
                    /* Create Invitation Tab */
                    <div className="space-y-6">
                        {/* Invitation Creation Form */}
                        <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                            <div className="space-y-6">
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white">Create Enhanced Invitation</h3>

                                {/* VC Proof Option */}
                                <div className="border rounded-lg p-4 bg-gray-50 dark:bg-gray-700">
                                    <div className="flex items-center space-x-3 mb-4">
                                        <input
                                            type="checkbox"
                                            id="includeVCProof"
                                            checked={includeVCProof}
                                            onChange={(e) => setIncludeVCProof(e.target.checked)}
                                            className="h-4 w-4 text-blue-600 focus:ring-blue-500 border-gray-300 rounded"
                                        />
                                        <label htmlFor="includeVCProof" className="text-sm font-medium text-gray-900 dark:text-white">
                                            🔒 Include RealPerson Identity Verification
                                        </label>
                                    </div>
                                    <p className="text-xs text-gray-600 dark:text-gray-400 mb-4">
                                        Attach your RealPerson credential to prove your identity to the invitee
                                    </p>

                                    {includeVCProof && (
                                        <div className="space-y-4">
                                            {/* Credential Selection */}
                                            <div>
                                                <label className="block text-sm font-semibold text-gray-700 dark:text-gray-300 mb-2">
                                                    Select RealPerson Credential
                                                </label>
                                                <select
                                                    className="w-full p-3 text-sm text-gray-900 bg-white rounded-lg border border-gray-300 focus:ring-2 focus:ring-blue-500 focus:border-blue-500 dark:bg-gray-600 dark:border-gray-500 dark:text-white"
                                                    value={selectedCredential ? availableCredentials.indexOf(selectedCredential) : ''}
                                                    onChange={(e) => {
                                                        const index = parseInt(e.target.value);
                                                        setSelectedCredential(availableCredentials[index] || null);
                                                    }}
                                                >
                                                    <option value="">Select a credential...</option>
                                                    {availableCredentials.length === 0 ? (
                                                        <option disabled>No valid credentials available</option>
                                                    ) : (
                                                        availableCredentials.map((cred, index) => (
                                                            <option key={index} value={index}>
                                                                {extractCredentialDisplayName(cred)}
                                                            </option>
                                                        ))
                                                    )}
                                                </select>
                                                {availableCredentials.length === 0 && (
                                                    <p className="text-xs text-red-600 dark:text-red-400 mt-1">
                                                        All RealPerson credentials are revoked or no credentials available
                                                    </p>
                                                )}
                                            </div>

                                            {/* Selective Disclosure */}
                                            {selectedCredential && (
                                                <SelectiveDisclosure
                                                    credential={selectedCredential}
                                                    onFieldSelection={handleFieldSelection}
                                                    initialLevel="minimal"
                                                />
                                            )}
                                        </div>
                                    )}
                                </div>

                                {/* Simple VC Request Section */}
                                <div className="border rounded-lg p-4 bg-orange-50 dark:bg-orange-900/30">
                                    <div className="flex items-center space-x-3 mb-4">
                                        <input
                                            type="checkbox"
                                            id="includeVCRequest"
                                            checked={includeVCRequest}
                                            onChange={(e) => setIncludeVCRequest(e.target.checked)}
                                            className="h-4 w-4 text-orange-600 focus:ring-orange-500 border-gray-300 rounded"
                                        />
                                        <label htmlFor="includeVCRequest" className="text-sm font-medium text-gray-900 dark:text-white">
                                            📋 Request VC from Invitee
                                        </label>
                                    </div>
                                    <p className="text-xs text-orange-700 dark:text-orange-300">
                                        Ask the invitee to provide any available credential for verification during connection establishment
                                    </p>
                                </div>

                                {/* Create Invitation Button */}
                                <div className="flex justify-end">
                                    <button
                                        className="px-8 py-3 bg-green-600 text-white font-semibold rounded-lg hover:bg-green-700 focus:ring-4 focus:ring-green-300 dark:focus:ring-green-900 disabled:opacity-50 disabled:cursor-not-allowed transition-all duration-200"
                                        onClick={createInvitationWithProof}
                                        disabled={includeVCProof && (!selectedCredential || selectedFields.length === 0)}
                                    >
                                        🚀 Create Invitation
                                    </button>
                                </div>
                            </div>
                        </div>

                        {/* Generated Invitation Display */}
                        {generatedInvitation && (
                            <div className="bg-white dark:bg-gray-800 rounded-xl shadow-lg border border-gray-200 dark:border-gray-700 p-6">
                                <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                                    📨 Your Enhanced Invitation
                                </h3>
                                <div className="bg-gray-50 dark:bg-gray-700 rounded-lg p-4 mb-4">
                                    <p className="text-sm text-gray-700 dark:text-gray-300 break-all">
                                        {generatedInvitation}
                                    </p>
                                </div>
                                <div className="flex space-x-3">
                                    <button
                                        onClick={handleCopyInvitation}
                                        className={`px-4 py-2 rounded-lg transition-colors ${
                                            copySuccess
                                                ? 'bg-green-600 text-white hover:bg-green-700'
                                                : 'bg-blue-600 text-white hover:bg-blue-700'
                                        }`}
                                    >
                                        {copySuccess ? '✅ Copied!' : '📋 Copy URL'}
                                    </button>
                                    <button
                                        onClick={() => {
                                            setGeneratedInvitation('');
                                            setSelectedCredential(null);
                                            setIncludeVCProof(false);
                                        }}
                                        className="px-4 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700 transition-colors"
                                    >
                                        🗑️ Clear
                                    </button>
                                </div>
                            </div>
                        )}
                    </div>
                )}
            </AgentRequire>

            {/* Success Feedback */}
            {!!connection && (
                <div className="bg-green-50 dark:bg-green-900/30 border border-green-200 dark:border-green-700 rounded-xl p-6">
                    <div className="flex items-center space-x-3">
                        <div className="w-8 h-8 bg-green-100 dark:bg-green-800 rounded-full flex items-center justify-center">
                            <span className="text-green-600 dark:text-green-400">✅</span>
                        </div>
                        <div>
                            <h3 className="text-lg font-semibold text-green-800 dark:text-green-200">
                                Connection Established!
                            </h3>
                            <p className="text-green-700 dark:text-green-300">
                                Successfully connected as <strong>"{connection.name || 'Unnamed Connection'}"</strong>
                            </p>
                            <p className="text-sm text-green-600 dark:text-green-400 mt-1">
                                You can now securely exchange messages and credentials with this connection.
                            </p>
                        </div>
                    </div>
                </div>
            )}

            {/* ✅ PHASE 1: Invitation Preview Modal */}
            <InvitationPreviewModal
                isOpen={showPreviewModal}
                onClose={() => {
                    // ✅ MODAL FIX: Clear ALL invitation state to prevent modal from reopening
                    setShowPreviewModal(false);
                    setParsedInvitationData(null);
                    setInviterIdentity(null);
                    setInviterLabel('');
                    setOOB('');
                    // ✅ NEW: Also clear response VC selection
                    setSelectedVCForResponse(null);
                    setResponseFields([]);
                    setResponseDisclosureLevel('minimal');
                    // ✅ CA INIT: Also clear CA state
                    setCAConfig(null);
                    setIsCAInvitation(false);
                    setCAAlreadyPinned(false);
                    // ✅ COMPANY INIT: Also clear company state
                    setCompanyConfig(null);
                    setIsCompanyInvitation(false);
                    setCompanyAlreadyPinned(false);
                    setCompanyCAVerification(null);
                    console.log('🧹 [MODAL] All invitation state cleared after close');
                }}
                onAccept={onConnectionHandleClick}
                onReject={onConnectionReject} // ✅ PHASE 4: Wire up reject handler
                inviterIdentity={inviterIdentity}
                inviterLabel={inviterLabel}
                invitationData={parsedInvitationData}
                // ✅ NEW: Wire up credential selection props for response
                availableCredentials={availableCredentials}
                selectedVCForRequest={selectedVCForResponse}
                onVCSelectionChange={setSelectedVCForResponse}
                onFieldSelection={(fields, level) => {
                    setResponseFields(fields);
                    setResponseDisclosureLevel(level);
                }}
                // ✅ CA IDENTITY VERIFICATION: Wire up CA props
                caConfig={caConfig}
                isCAInvitation={isCAInvitation}
                caAlreadyPinned={caAlreadyPinned}
                // ✅ COMPANY IDENTITY VERIFICATION: Wire up company props
                companyConfig={companyConfig}
                isCompanyInvitation={isCompanyInvitation}
                companyAlreadyPinned={companyAlreadyPinned}
                companyCAVerification={companyCAVerification}
            />
        </div>
    );
};
