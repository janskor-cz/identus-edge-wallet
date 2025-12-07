/**
 * Enterprise Agent Async Actions
 *
 * Redux thunks for enterprise agent operations. These actions use the
 * EnterpriseAgentClient to communicate with the enterprise cloud agent
 * and update Redux state accordingly.
 *
 * Usage:
 * ```typescript
 * import { applyConfiguration, refreshEnterpriseConnections } from '@/actions/enterpriseAgentActions';
 *
 * // Apply configuration
 * dispatch(applyConfiguration(config));
 *
 * // Refresh data
 * dispatch(refreshEnterpriseConnections());
 * dispatch(refreshEnterpriseCredentials());
 * ```
 */

import { createAsyncThunk } from '@reduxjs/toolkit';
import { WalletConfiguration } from '@/utils/serviceConfigManager';
import { setActiveConfiguration } from '@/utils/configurationStorage';
import { EnterpriseAgentClient } from '@/utils/EnterpriseAgentClient';
import {
  setConfiguration,
  clearConfiguration,
  setContext,
  setConnections,
  setCredentials,
  setEnterpriseDIDs,
  setPendingProofRequests,
  startLoadingConnections,
  startLoadingCredentials,
  startLoadingDIDs,
  setError,
  clearError,
  AgentContext,
  EnterpriseConnection,
  EnterpriseCredential,
  EnterpriseDID
} from '@/reducers/enterpriseAgent';

/**
 * Apply ServiceConfiguration VC
 *
 * Applies a ServiceConfiguration credential to the wallet:
 * 1. Stores configuration in localStorage
 * 2. Encrypts and stores API key
 * 3. Creates EnterpriseAgentClient
 * 4. Updates Redux state
 *
 * @param config - Wallet configuration from ServiceConfiguration VC
 */
export const applyConfiguration = createAsyncThunk(
  'enterpriseAgent/applyConfiguration',
  async (config: WalletConfiguration, { dispatch }) => {
    try {
      // Store configuration (includes API key encryption)
      const result = setActiveConfiguration(config);

      if (!result.success) {
        throw new Error(result.message);
      }

      // Update Redux state with configuration
      dispatch(setConfiguration(config));

      // Auto-refresh enterprise data after store is ready
      // Delay ensures Redux store is fully initialized before accessing getState
      setTimeout(() => {
        dispatch(refreshEnterpriseConnections());
        dispatch(refreshEnterpriseCredentials());
        dispatch(refreshEnterpriseDIDs());
      }, 100);

      return config;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to apply configuration';
      console.error('[EnterpriseAgentActions] Error applying configuration:', error);
      dispatch(setError(errorMsg));
      throw error;
    }
  }
);

/**
 * Remove active configuration
 *
 * Clears the active configuration and resets enterprise agent state.
 */
export const removeConfiguration = createAsyncThunk(
  'enterpriseAgent/removeConfiguration',
  async (_, { dispatch, getState }) => {
    try {
      const { clearActiveConfiguration } = await import('@/utils/configurationStorage');

      // Clear configuration from localStorage (includes API key cleanup)
      const success = clearActiveConfiguration();

      if (!success) {
        throw new Error('Failed to clear configuration');
      }

      // Clear Redux state
      dispatch(clearConfiguration());

      // Switch back to main agent context
      dispatch(setContext('main'));

      return true;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to remove configuration';
      console.error('[EnterpriseAgentActions] Error removing configuration:', error);
      dispatch(setError(errorMsg));
      throw error;
    }
  }
);

/**
 * Switch agent context
 *
 * Switches between main CA agent and enterprise agent context.
 *
 * @param context - Target agent context ('main' or 'enterprise')
 */
export const switchAgentContext = createAsyncThunk(
  'enterpriseAgent/switchContext',
  async (context: AgentContext, { dispatch }) => {
    dispatch(setContext(context));
    dispatch(clearError());
    return context;
  }
);

/**
 * Refresh enterprise connections
 *
 * Fetches connections from enterprise agent and updates Redux state.
 */
export const refreshEnterpriseConnections = createAsyncThunk(
  'enterpriseAgent/refreshConnections',
  async (_, { dispatch, getState }) => {
    try {
      dispatch(startLoadingConnections());

      // Validate Redux store is initialized
      if (typeof getState !== 'function') {
        console.error('[EnterpriseAgentActions] getState is not a function - Redux store not initialized');
        throw new Error('Redux store not initialized');
      }

      // Get client from Redux state
      const state: any = getState();
      const client: EnterpriseAgentClient | null = state.enterpriseAgent?.client;

      if (!client) {
        throw new Error('No enterprise agent client available');
      }

      // Fetch connections from enterprise agent
      const response = await client.listConnections();

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to fetch connections');
      }

      // Update Redux state
      const connections: EnterpriseConnection[] = response.data.contents || [];
      dispatch(setConnections(connections));

      return connections;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to refresh connections';
      console.error('[EnterpriseAgentActions] Error refreshing connections:', error);
      dispatch(setError(errorMsg));
      throw error;
    }
  }
);

/**
 * Refresh enterprise credentials
 *
 * Fetches credentials from enterprise agent and updates Redux state.
 */
export const refreshEnterpriseCredentials = createAsyncThunk(
  'enterpriseAgent/refreshCredentials',
  async (_, { dispatch, getState }) => {
    try {
      dispatch(startLoadingCredentials());

      // Validate Redux store is initialized
      if (typeof getState !== 'function') {
        console.error('[EnterpriseAgentActions] getState is not a function - Redux store not initialized');
        throw new Error('Redux store not initialized');
      }

      // Get client from Redux state
      const state: any = getState();
      const client: EnterpriseAgentClient | null = state.enterpriseAgent?.client;

      if (!client) {
        throw new Error('No enterprise agent client available');
      }

      // Fetch credentials from enterprise agent
      const response = await client.listCredentials();

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to fetch credentials');
      }

      // Map API response properties to Redux state interface
      // API returns 'protocolState', but our interface expects 'state'
      const credentials: EnterpriseCredential[] = (response.data.contents || []).map((cred: any) => ({
        ...cred,
        state: cred.protocolState || cred.state  // Map protocolState → state (fallback to existing state if present)
      }));
      dispatch(setCredentials(credentials));

      return credentials;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to refresh credentials';
      console.error('[EnterpriseAgentActions] Error refreshing credentials:', error);
      dispatch(setError(errorMsg));
      throw error;
    }
  }
);

/**
 * Refresh enterprise DIDs
 *
 * Fetches DIDs from enterprise agent and updates Redux state.
 */
export const refreshEnterpriseDIDs = createAsyncThunk(
  'enterpriseAgent/refreshDIDs',
  async (_, { dispatch, getState }) => {
    try {
      dispatch(startLoadingDIDs());

      // Validate Redux store is initialized
      if (typeof getState !== 'function') {
        console.error('[EnterpriseAgentActions] getState is not a function - Redux store not initialized');
        throw new Error('Redux store not initialized');
      }

      // Get client from Redux state
      const state: any = getState();
      const client: EnterpriseAgentClient | null = state.enterpriseAgent?.client;

      if (!client) {
        throw new Error('No enterprise agent client available');
      }

      // Fetch DIDs from enterprise agent
      const response = await client.listDIDs();

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to fetch DIDs');
      }

      // Map API response to Redux state format
      const dids: EnterpriseDID[] = (response.data.contents || []).map((did: any) => ({
        did: did.did || did.longFormDid || '',
        status: did.status || 'CREATED',
        method: did.method || 'prism',
        createdAt: did.createdAt,
        updatedAt: did.updatedAt
      }));

      console.log('[EnterpriseAgentActions] Refreshed DIDs:', dids.length);
      dispatch(setEnterpriseDIDs(dids));

      return dids;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to refresh DIDs';
      console.error('[EnterpriseAgentActions] Error refreshing DIDs:', error);
      dispatch(setError(errorMsg));
      throw error;
    }
  }
);

/**
 * Check enterprise agent health
 *
 * Verifies enterprise agent is accessible and responding.
 */
export const checkEnterpriseHealth = createAsyncThunk(
  'enterpriseAgent/checkHealth',
  async (_, { dispatch, getState }) => {
    try {
      // Get client from Redux state
      const state: any = getState();
      const client: EnterpriseAgentClient | null = state.enterpriseAgent?.client;

      if (!client) {
        throw new Error('No enterprise agent client available');
      }

      // Check health
      const response = await client.checkHealth();

      if (!response.success) {
        throw new Error(response.error || 'Health check failed');
      }

      dispatch(clearError());
      return response.data;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Enterprise agent unavailable';
      console.error('[EnterpriseAgentActions] Health check failed:', error);
      dispatch(setError(errorMsg));
      throw error;
    }
  }
);

/**
 * Create credential offer to employee
 *
 * Creates a credential offer through the enterprise agent.
 *
 * @param params - Credential offer parameters
 */
export const createEnterpriseCredentialOffer = createAsyncThunk(
  'enterpriseAgent/createCredentialOffer',
  async (
    params: {
      connectionId?: string;
      claims: Record<string, any>;
      credentialDefinitionId?: string;
      automaticIssuance?: boolean;
      issuingDID?: string;
    },
    { dispatch, getState }
  ) => {
    try {
      // Get client from Redux state
      const state: any = getState();
      const client: EnterpriseAgentClient | null = state.enterpriseAgent?.client;

      if (!client) {
        throw new Error('No enterprise agent client available');
      }

      // Create credential offer
      const response = await client.createCredentialOffer(params);

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to create credential offer');
      }

      // Refresh credentials to include new offer
      dispatch(refreshEnterpriseCredentials());

      return response.data;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to create credential offer';
      console.error('[EnterpriseAgentActions] Error creating credential offer:', error);
      dispatch(setError(errorMsg));
      throw error;
    }
  }
);

/**
 * Get connection stats from enterprise agent
 *
 * @returns Connection statistics by state
 */
export const getEnterpriseConnectionStats = createAsyncThunk(
  'enterpriseAgent/getConnectionStats',
  async (_, { dispatch, getState }) => {
    try {
      // Get client from Redux state
      const state: any = getState();
      const client: EnterpriseAgentClient | null = state.enterpriseAgent?.client;

      if (!client) {
        throw new Error('No enterprise agent client available');
      }

      // Get stats
      const response = await client.getConnectionStats();

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to get connection stats');
      }

      return response.data;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to get connection stats';
      console.error('[EnterpriseAgentActions] Error getting connection stats:', error);
      dispatch(setError(errorMsg));
      throw error;
    }
  }
);

/**
 * Get credential stats from enterprise agent
 *
 * @returns Credential statistics by state
 */
export const getEnterpriseCredentialStats = createAsyncThunk(
  'enterpriseAgent/getCredentialStats',
  async (_, { dispatch, getState }) => {
    try {
      // Get client from Redux state
      const state: any = getState();
      const client: EnterpriseAgentClient | null = state.enterpriseAgent?.client;

      if (!client) {
        throw new Error('No enterprise agent client available');
      }

      // Get stats
      const response = await client.getCredentialStats();

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to get credential stats');
      }

      return response.data;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to get credential stats';
      console.error('[EnterpriseAgentActions] Error getting credential stats:', error);
      dispatch(setError(errorMsg));
      throw error;
    }
  }
);

/**
 * Poll for pending proof requests
 *
 * Queries enterprise agent for presentations in RequestReceived state
 * that need user approval in the wallet UI.
 *
 * @returns Array of pending presentation requests
 */
export const pollPendingProofRequests = createAsyncThunk(
  'enterpriseAgent/pollPendingProofRequests',
  async (_, { dispatch, getState }) => {
    try {
      // Get client from Redux state
      const state: any = getState();
      const client: EnterpriseAgentClient | null = state.enterpriseAgent?.client;

      if (!client) {
        // Silently skip if no enterprise agent configured
        return [];
      }

      // Fetch all presentations
      const response = await client.listPresentations();

      if (!response.success || !response.data) {
        return [];
      }

      // Filter for pending requests where Alice is the Prover (received a proof request from a Verifier)
      const pendingRequests = response.data.contents
        .filter((presentation: any) => {
          return presentation.status === 'RequestReceived' &&
            presentation.role === 'Prover';
        })
        .map((presentation: any) => {
          // Parse presentationDefinition from requestData field
          if (presentation.requestData && presentation.requestData.length > 0) {
            try {
              const requestDataStr = presentation.requestData[0]; // First element of array
              const requestDataObj = JSON.parse(requestDataStr);

              // Try two formats: DIF Presentation Exchange OR Cloud Agent proofs array
              if (requestDataObj.presentation_definition) {
                // OLD FORMAT: DIF Presentation Exchange with input_descriptors
                presentation.presentationDefinition = requestDataObj.presentation_definition;
              } else if (requestDataObj.proofs && Array.isArray(requestDataObj.proofs)) {
                // NEW FORMAT: Cloud Agent proofs array with schemaId fields
                // Extract schema IDs from proofs array
                const schemaIds = requestDataObj.proofs.map((proof: any) => proof.schemaId);

                // Store schema IDs for credential filtering
                presentation.requestedSchemas = schemaIds;
              }
            } catch (error) {
              // Failed to parse requestData - skip parsing
            }
          }

          return presentation;
        });

      // Update Redux state so modal component can display pending requests
      dispatch(setPendingProofRequests(pendingRequests));

      return pendingRequests;
    } catch (error) {
      // Don't dispatch error for polling failures - they happen frequently
      return [];
    }
  }
);

/**
 * Approve proof request
 *
 * Submits presentation proof to enterprise agent in response to proof request.
 *
 * @param params - Presentation ID and proof data
 * @returns Updated presentation record
 */
export const approveProofRequest = createAsyncThunk(
  'enterpriseAgent/approveProofRequest',
  async (
    params: {
      presentationId: string;
      proofId: string[];
    },
    { dispatch, getState }
  ) => {
    try {
      // Get client from Redux state
      const state: any = getState();
      const client: EnterpriseAgentClient | null = state.enterpriseAgent?.client;

      if (!client) {
        throw new Error('No enterprise agent client available');
      }

      // Update presentation with credential record IDs
      const response = await client.updatePresentation(
        params.presentationId,
        'request-accept',
        params.proofId
      );

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to approve proof request');
      }

      // Refresh proof requests to remove approved one from list
      setTimeout(() => {
        dispatch(pollPendingProofRequests());
      }, 1000);

      return response.data;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to approve proof request';
      console.error('[EnterpriseAgentActions] Error approving proof request:', error);
      dispatch(setError(errorMsg));
      throw error;
    }
  }
);

/**
 * Reject proof request
 *
 * Rejects presentation request from enterprise agent.
 *
 * @param presentationId - Presentation ID to reject
 * @returns Updated presentation record
 */
export const rejectProofRequest = createAsyncThunk(
  'enterpriseAgent/rejectProofRequest',
  async (presentationId: string, { dispatch, getState }) => {
    try {
      // Get client from Redux state
      const state: any = getState();
      const client: EnterpriseAgentClient | null = state.enterpriseAgent?.client;

      if (!client) {
        throw new Error('No enterprise agent client available');
      }

      // Update presentation with reject action
      const response = await client.updatePresentation(
        presentationId,
        'request-reject'
      );

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to reject proof request');
      }

      // Refresh proof requests to remove rejected one from list
      setTimeout(() => {
        dispatch(pollPendingProofRequests());
      }, 1000);

      return response.data;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to reject proof request';
      console.error('[EnterpriseAgentActions] Error rejecting proof request:', error);
      dispatch(setError(errorMsg));
      throw error;
    }
  }
);

/**
 * Accept credential offer
 *
 * Accepts a credential offer from the enterprise agent when the wallet
 * receives a credential in "OfferReceived" state.
 *
 * @param params - Object containing recordId and subjectId
 * @param params.recordId - Credential record ID
 * @param params.subjectId - Holder's DID (required by Cloud Agent)
 * @returns Updated credential record
 */
export const acceptCredentialOffer = createAsyncThunk(
  'enterpriseAgent/acceptCredentialOffer',
  async ({ recordId, subjectId }: { recordId: string; subjectId: string }, { dispatch, getState }) => {
    try {
      // Get client from Redux state
      const state: any = getState();
      const client: EnterpriseAgentClient | null = state.enterpriseAgent?.client;

      if (!client) {
        throw new Error('No enterprise agent client available');
      }

      // Accept credential offer with subjectId
      const response = await client.acceptCredentialOffer(recordId, subjectId);

      if (!response.success || !response.data) {
        throw new Error(response.error || 'Failed to accept credential offer');
      }

      // Refresh credentials to show updated state
      setTimeout(() => {
        dispatch(refreshEnterpriseCredentials());
      }, 1000);

      return response.data;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to accept credential offer';
      console.error('[EnterpriseAgentActions] Error accepting credential offer:', error);
      dispatch(setError(errorMsg));
      throw error;
    }
  }
);

/**
 * Poll for pending credential offers
 *
 * Queries enterprise agent for credentials in "OfferReceived" state
 * that can be automatically accepted by the wallet.
 *
 * @returns Array of pending credential offers
 */
export const pollPendingCredentialOffers = createAsyncThunk(
  'enterpriseAgent/pollPendingCredentialOffers',
  async (_, { dispatch, getState }) => {
    try {
      // Get client from Redux state
      const state: any = getState();
      const client: EnterpriseAgentClient | null = state.enterpriseAgent?.client;

      if (!client) {
        // Silently skip if no enterprise agent configured
        return [];
      }

      // Fetch all credentials
      const response = await client.listCredentials();

      if (!response.success || !response.data) {
        return [];
      }

      // Filter for pending offers from the employee wallet's perspective (OfferReceived/Holder)
      // We're querying the employee's wallet on Enterprise Cloud Agent, so records have role=Holder and state=OfferReceived
      const pendingOffers = response.data.contents.filter(
        (credential: any) =>
          credential.protocolState === 'OfferReceived' &&
          credential.role === 'Holder'
      );

      return pendingOffers;
    } catch (error) {
      // Don't dispatch error for polling failures - they happen frequently
      return [];
    }
  }
);
