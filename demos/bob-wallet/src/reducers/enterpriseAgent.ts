/**
 * Enterprise Agent Redux Slice
 *
 * Extends Redux state to support dual-agent architecture where wallet can
 * simultaneously work with both:
 * - Main CA Cloud Agent (port 8000) - for CA-issued credentials
 * - Enterprise Cloud Agent (port 8300) - for department/company operations
 *
 * This allows employees to:
 * - Maintain CA connection for Security Clearance, RealPerson credentials
 * - Connect to enterprise agent for department-specific operations
 * - Switch contexts based on operation type
 *
 * Architecture:
 * ```
 * Main Agent Context                Enterprise Agent Context
 * ├── CA Connections                ├── Department Connections
 * ├── CA-issued Credentials         ├── Enterprise Credentials
 * └── Main SDK Agent Instance       └── Enterprise HTTP Client
 * ```
 */

import { PayloadAction, createSlice } from "@reduxjs/toolkit";
import { WalletConfiguration } from "@/utils/serviceConfigManager";
import { EnterpriseAgentClient } from "@/utils/EnterpriseAgentClient";

/**
 * Agent context types
 */
export type AgentContext = 'main' | 'enterprise';

/**
 * Connection record from enterprise agent
 */
export interface EnterpriseConnection {
  connectionId: string;
  thid?: string;
  label?: string;
  state: string;
  role: string;
  createdAt: string;
  updatedAt?: string;
  myDid?: string;
  theirDid?: string;
}

/**
 * Credential record from enterprise agent
 */
export interface EnterpriseCredential {
  recordId: string;
  state: string;
  role: string;
  credentialFormat?: string;
  subjectId?: string;
  thid?: string;
  createdAt: string;
  updatedAt?: string;
  credential?: any;
}

/**
 * Enterprise agent state
 */
export interface EnterpriseAgentState {
  // Configuration
  activeConfiguration: WalletConfiguration | null;

  // Agent context
  currentContext: AgentContext;

  // Enterprise HTTP client
  client: EnterpriseAgentClient | null;

  // Enterprise connections (separate from main CA connections)
  connections: EnterpriseConnection[];

  // Enterprise credentials (separate from main CA credentials)
  credentials: EnterpriseCredential[];

  // Loading states
  isLoadingConnections: boolean;
  isLoadingCredentials: boolean;

  // Error tracking
  lastError: string | null;
}

/**
 * Initial state
 */
export const initialEnterpriseAgentState: EnterpriseAgentState = {
  activeConfiguration: null,
  currentContext: 'main',
  client: null,
  connections: [],
  credentials: [],
  isLoadingConnections: false,
  isLoadingCredentials: false,
  lastError: null
};

/**
 * Enterprise agent slice
 */
const enterpriseAgentSlice = createSlice({
  name: 'enterpriseAgent',
  initialState: initialEnterpriseAgentState,
  reducers: {
    /**
     * Set active configuration
     */
    setConfiguration: (state, action: PayloadAction<WalletConfiguration>) => {
      console.log('[EnterpriseAgent] Setting active configuration:', action.payload.credentialId);
      state.activeConfiguration = action.payload;

      // Create new client with configuration
      state.client = new EnterpriseAgentClient(action.payload);

      console.log('[EnterpriseAgent] ✅ Enterprise agent client created');
    },

    /**
     * Clear active configuration
     */
    clearConfiguration: (state) => {
      console.log('[EnterpriseAgent] Clearing active configuration');
      state.activeConfiguration = null;
      state.client = null;
      state.connections = [];
      state.credentials = [];
      state.lastError = null;
      console.log('[EnterpriseAgent] ✅ Configuration cleared');
    },

    /**
     * Switch agent context
     */
    setContext: (state, action: PayloadAction<AgentContext>) => {
      console.log('[EnterpriseAgent] Switching context:', state.currentContext, '→', action.payload);
      state.currentContext = action.payload;
    },

    /**
     * Set enterprise connections
     */
    setConnections: (state, action: PayloadAction<EnterpriseConnection[]>) => {
      console.log('[EnterpriseAgent] Setting', action.payload.length, 'enterprise connections');
      state.connections = action.payload;
      state.isLoadingConnections = false;
    },

    /**
     * Set enterprise credentials
     */
    setCredentials: (state, action: PayloadAction<EnterpriseCredential[]>) => {
      console.log('[EnterpriseAgent] Setting', action.payload.length, 'enterprise credentials');
      state.credentials = action.payload;
      state.isLoadingCredentials = false;
    },

    /**
     * Start loading connections
     */
    startLoadingConnections: (state) => {
      state.isLoadingConnections = true;
      state.lastError = null;
    },

    /**
     * Start loading credentials
     */
    startLoadingCredentials: (state) => {
      state.isLoadingCredentials = true;
      state.lastError = null;
    },

    /**
     * Set error
     */
    setError: (state, action: PayloadAction<string>) => {
      console.error('[EnterpriseAgent] Error:', action.payload);
      state.lastError = action.payload;
      state.isLoadingConnections = false;
      state.isLoadingCredentials = false;
    },

    /**
     * Clear error
     */
    clearError: (state) => {
      state.lastError = null;
    },

    /**
     * Add enterprise connection
     */
    addConnection: (state, action: PayloadAction<EnterpriseConnection>) => {
      console.log('[EnterpriseAgent] Adding connection:', action.payload.connectionId);

      // Check if already exists
      const exists = state.connections.some(
        conn => conn.connectionId === action.payload.connectionId
      );

      if (!exists) {
        state.connections.push(action.payload);
        console.log('[EnterpriseAgent] ✅ Connection added');
      } else {
        console.log('[EnterpriseAgent] Connection already exists, updating...');
        state.connections = state.connections.map(conn =>
          conn.connectionId === action.payload.connectionId ? action.payload : conn
        );
      }
    },

    /**
     * Update connection
     */
    updateConnection: (state, action: PayloadAction<EnterpriseConnection>) => {
      console.log('[EnterpriseAgent] Updating connection:', action.payload.connectionId);

      state.connections = state.connections.map(conn =>
        conn.connectionId === action.payload.connectionId ? action.payload : conn
      );

      console.log('[EnterpriseAgent] ✅ Connection updated');
    },

    /**
     * Remove connection
     */
    removeConnection: (state, action: PayloadAction<string>) => {
      console.log('[EnterpriseAgent] Removing connection:', action.payload);

      state.connections = state.connections.filter(
        conn => conn.connectionId !== action.payload
      );

      console.log('[EnterpriseAgent] ✅ Connection removed');
    },

    /**
     * Add enterprise credential
     */
    addCredential: (state, action: PayloadAction<EnterpriseCredential>) => {
      console.log('[EnterpriseAgent] Adding credential:', action.payload.recordId);

      // Check if already exists
      const exists = state.credentials.some(
        cred => cred.recordId === action.payload.recordId
      );

      if (!exists) {
        state.credentials.push(action.payload);
        console.log('[EnterpriseAgent] ✅ Credential added');
      } else {
        console.log('[EnterpriseAgent] Credential already exists, updating...');
        state.credentials = state.credentials.map(cred =>
          cred.recordId === action.payload.recordId ? action.payload : cred
        );
      }
    },

    /**
     * Update credential
     */
    updateCredential: (state, action: PayloadAction<EnterpriseCredential>) => {
      console.log('[EnterpriseAgent] Updating credential:', action.payload.recordId);

      state.credentials = state.credentials.map(cred =>
        cred.recordId === action.payload.recordId ? action.payload : cred
      );

      console.log('[EnterpriseAgent] ✅ Credential updated');
    },

    /**
     * Remove credential
     */
    removeCredential: (state, action: PayloadAction<string>) => {
      console.log('[EnterpriseAgent] Removing credential:', action.payload);

      state.credentials = state.credentials.filter(
        cred => cred.recordId !== action.payload
      );

      console.log('[EnterpriseAgent] ✅ Credential removed');
    }
  }
});

/**
 * Export actions
 */
export const {
  setConfiguration,
  clearConfiguration,
  setContext,
  setConnections,
  setCredentials,
  startLoadingConnections,
  startLoadingCredentials,
  setError,
  clearError,
  addConnection,
  updateConnection,
  removeConnection,
  addCredential,
  updateCredential,
  removeCredential
} = enterpriseAgentSlice.actions;

/**
 * Export reducer
 */
export default enterpriseAgentSlice.reducer;

/**
 * Selectors
 */

/**
 * Get current agent context
 */
export const selectAgentContext = (state: { enterpriseAgent: EnterpriseAgentState }) =>
  state.enterpriseAgent.currentContext;

/**
 * Get active configuration
 */
export const selectActiveConfiguration = (state: { enterpriseAgent: EnterpriseAgentState }) =>
  state.enterpriseAgent.activeConfiguration;

/**
 * Get enterprise client
 */
export const selectEnterpriseClient = (state: { enterpriseAgent: EnterpriseAgentState }) =>
  state.enterpriseAgent.client;

/**
 * Check if enterprise agent configured
 */
export const selectIsEnterpriseConfigured = (state: { enterpriseAgent: EnterpriseAgentState }) =>
  !!state.enterpriseAgent.activeConfiguration && !!state.enterpriseAgent.client;

/**
 * Get enterprise connections
 */
export const selectEnterpriseConnections = (state: { enterpriseAgent: EnterpriseAgentState }) =>
  state.enterpriseAgent.connections;

/**
 * Get enterprise credentials
 */
export const selectEnterpriseCredentials = (state: { enterpriseAgent: EnterpriseAgentState }) =>
  state.enterpriseAgent.credentials;

/**
 * Check if loading connections
 */
export const selectIsLoadingConnections = (state: { enterpriseAgent: EnterpriseAgentState }) =>
  state.enterpriseAgent.isLoadingConnections;

/**
 * Check if loading credentials
 */
export const selectIsLoadingCredentials = (state: { enterpriseAgent: EnterpriseAgentState }) =>
  state.enterpriseAgent.isLoadingCredentials;

/**
 * Get last error
 */
export const selectLastError = (state: { enterpriseAgent: EnterpriseAgentState }) =>
  state.enterpriseAgent.lastError;
