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
  startLoadingConnections,
  startLoadingCredentials,
  setError,
  clearError,
  AgentContext,
  EnterpriseConnection,
  EnterpriseCredential
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
      console.log('[EnterpriseAgentActions] Applying configuration:', config.credentialId);

      // Store configuration (includes API key encryption)
      const result = setActiveConfiguration(config);

      if (!result.success) {
        throw new Error(result.message);
      }

      // Update Redux state with configuration
      dispatch(setConfiguration(config));

      console.log('[EnterpriseAgentActions] ✅ Configuration applied successfully');

      // Auto-refresh enterprise data
      dispatch(refreshEnterpriseConnections());
      dispatch(refreshEnterpriseCredentials());

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
      console.log('[EnterpriseAgentActions] Removing configuration');

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

      console.log('[EnterpriseAgentActions] ✅ Configuration removed successfully');
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
    console.log('[EnterpriseAgentActions] Switching to', context, 'context');
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
      console.log('[EnterpriseAgentActions] Refreshing enterprise connections...');
      dispatch(startLoadingConnections());

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

      console.log('[EnterpriseAgentActions] ✅ Refreshed', connections.length, 'connections');
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
      console.log('[EnterpriseAgentActions] Refreshing enterprise credentials...');
      dispatch(startLoadingCredentials());

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

      // Update Redux state
      const credentials: EnterpriseCredential[] = response.data.contents || [];
      dispatch(setCredentials(credentials));

      console.log('[EnterpriseAgentActions] ✅ Refreshed', credentials.length, 'credentials');
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
 * Check enterprise agent health
 *
 * Verifies enterprise agent is accessible and responding.
 */
export const checkEnterpriseHealth = createAsyncThunk(
  'enterpriseAgent/checkHealth',
  async (_, { dispatch, getState }) => {
    try {
      console.log('[EnterpriseAgentActions] Checking enterprise agent health...');

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

      console.log('[EnterpriseAgentActions] ✅ Enterprise agent is healthy');
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
      console.log('[EnterpriseAgentActions] Creating credential offer...');

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

      console.log('[EnterpriseAgentActions] ✅ Credential offer created:', response.data.recordId);

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
      console.log('[EnterpriseAgentActions] Getting connection stats...');

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

      console.log('[EnterpriseAgentActions] ✅ Connection stats:', response.data);
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
      console.log('[EnterpriseAgentActions] Getting credential stats...');

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

      console.log('[EnterpriseAgentActions] ✅ Credential stats:', response.data);
      return response.data;
    } catch (error) {
      const errorMsg = error instanceof Error ? error.message : 'Failed to get credential stats';
      console.error('[EnterpriseAgentActions] Error getting credential stats:', error);
      dispatch(setError(errorMsg));
      throw error;
    }
  }
);
