/**
 * Configuration Page
 *
 * Displays all ServiceConfiguration Verifiable Credentials
 * and allows users to apply/manage wallet configurations.
 */

import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useMountedApp } from '../reducers/store';
import { PageHeader } from '../components/PageHeader';
import { DBConnect } from '../components/DBConnect';
import { Box } from '../app/Box';
import ServiceConfigDisplay from '../components/ServiceConfigDisplay';
import {
  extractConfiguration,
  WalletConfiguration
} from '../utils/serviceConfigManager';
import { identifyCredentialType } from '../utils/credentialSchemaExtractor';
import {
  getAllConfigurations,
  getActiveConfiguration,
  storeConfiguration,
  getConfigurationStats
} from '../utils/configurationStorage';
import { StoredConfiguration } from '../types/configuration';

const ConfigurationPage: React.FC = () => {
  const [configurations, setConfigurations] = useState<StoredConfiguration[]>([]);
  const [activeConfig, setActiveConfig] = useState<WalletConfiguration | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshKey, setRefreshKey] = useState(0);
  const [stats, setStats] = useState({ total: 0, applied: 0, pending: 0, expired: 0 });
  const isLoadingRef = useRef(false);

  // Get app and credentials
  const app = useMountedApp();
  const credentials = app.credentials || [];

  /**
   * Load and process ServiceConfiguration credentials
   */
  const loadConfigurations = useCallback(async () => {
    // Prevent concurrent executions
    if (isLoadingRef.current) {
      console.log('[ConfigurationPage] Already loading, skipping...');
      return;
    }

    try {
      isLoadingRef.current = true;
      console.log('[ConfigurationPage] Loading configurations...');
      setLoading(true);

      // Load all stored configurations first
      const storedConfigs = getAllConfigurations();

      // Note: We load from stored configs only, not from Redux credentials
      // to avoid infinite loops. Use the refresh button to manually sync.

      // Reload stored configurations
      setConfigurations(storedConfigs);

      // Load active configuration
      const active = getActiveConfiguration();
      setActiveConfig(active);

      console.log('[ConfigurationPage] ✅ Loaded', storedConfigs.length, 'configurations');

    } catch (error) {
      console.error('[ConfigurationPage] Error loading configurations:', error);
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  }, []); // No dependencies - stable function

  // Sync credentials to storage when refresh is clicked
  const syncCredentialsToStorage = useCallback(() => {
    console.log('[ConfigurationPage] Syncing credentials to storage...');
    console.log('[ConfigurationPage] Total credentials in Redux:', credentials.length);

    const storedConfigs = getAllConfigurations();

    // Filter ServiceConfiguration credentials
    const serviceConfigCreds = credentials.filter((cred: any) => {
      const typeInfo = identifyCredentialType(cred);
      console.log('[ConfigurationPage] Credential type:', typeInfo.type, 'Source:', typeInfo.source, 'Cred:', cred);
      return typeInfo.type === 'ServiceConfiguration';
    });

    console.log('[ConfigurationPage] Found', serviceConfigCreds.length, 'ServiceConfiguration VCs');

    // Extract configurations from VCs and store only if not already stored
    serviceConfigCreds.forEach((cred: any) => {
      const config = extractConfiguration(cred);
      if (config) {
        // Check if this config is already stored
        const alreadyStored = storedConfigs.some(
          stored => stored.config.vcId === config.vcId
        );

        if (!alreadyStored) {
          console.log('[ConfigurationPage] Storing new configuration:', config.credentialId);
          storeConfiguration(config);
        }
      }
    });
  }, [credentials]);

  /**
   * Handle configuration applied
   */
  const handleConfigurationApplied = (config: WalletConfiguration) => {
    console.log('[ConfigurationPage] Configuration applied:', config.credentialId);
    setRefreshKey(prev => prev + 1);
  };

  /**
   * Handle configuration removed
   */
  const handleConfigurationRemoved = (credentialId: string) => {
    console.log('[ConfigurationPage] Configuration removed:', credentialId);
    setRefreshKey(prev => prev + 1);
  };

  /**
   * Handle manual refresh
   */
  const handleRefresh = () => {
    console.log('[ConfigurationPage] Manual refresh triggered');
    // Sync credentials from Redux to storage
    syncCredentialsToStorage();
    // Reload configurations from storage
    loadConfigurations();
  };

  // Sync credentials to storage on mount and when credentials change
  useEffect(() => {
    syncCredentialsToStorage();
  }, [app.credentials]); // Re-run when credentials change

  // Load configurations on mount
  useEffect(() => {
    loadConfigurations();
  }, [loadConfigurations]);

  // Update stats after configurations change (client-side only)
  useEffect(() => {
    // Only run on client side (not during SSR)
    if (typeof window !== 'undefined') {
      const newStats = getConfigurationStats();
      setStats(newStats);
    }
  }, [configurations, activeConfig, refreshKey]);

  // 🔧 REMOVED AUTO-APPLY: User must explicitly click "Apply" button
  // Previously this useEffect automatically applied the first ServiceConfiguration VC
  // This was removed to restore user control over when enterprise mode is activated

  return (
    <div className="mx-10 mt-5 mb-30">
      <PageHeader>
        <h1 className="mb-4 text-4xl font-extrabold tracking-tight leading-none text-gray-900 md:text-5xl lg:text-6xl dark:text-white">
          Configuration
        </h1>
      </PageHeader>
      <DBConnect>
        <Box>
          {/* Statistics */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4 mb-6">
            <div className="bg-white p-4 rounded-lg shadow-sm border border-gray-200">
              <p className="text-sm text-gray-600 mb-1">Total Configurations</p>
              <p className="text-2xl font-bold text-gray-900">{stats.total}</p>
            </div>
            <div className="bg-green-50 p-4 rounded-lg shadow-sm border border-green-200">
              <p className="text-sm text-green-700 mb-1">Active</p>
              <p className="text-2xl font-bold text-green-900">{stats.applied}</p>
            </div>
            <div className="bg-yellow-50 p-4 rounded-lg shadow-sm border border-yellow-200">
              <p className="text-sm text-yellow-700 mb-1">Pending</p>
              <p className="text-2xl font-bold text-yellow-900">{stats.pending}</p>
            </div>
            <div className="bg-red-50 p-4 rounded-lg shadow-sm border border-red-200">
              <p className="text-sm text-red-700 mb-1">Expired</p>
              <p className="text-2xl font-bold text-red-900">{stats.expired}</p>
            </div>
          </div>

          {/* Refresh Button */}
          <div className="mb-4 flex justify-end">
            <button
              onClick={handleRefresh}
              className="px-4 py-2 bg-gray-600 text-white rounded hover:bg-gray-700 transition-colors"
            >
              🔄 Refresh
            </button>
          </div>
        </Box>

        {/* Loading State */}
        {loading && (
          <Box>
            <div className="text-center py-12">
              <div className="inline-block animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600"></div>
              <p className="text-gray-600 mt-4">Loading configurations...</p>
            </div>
          </Box>
        )}

        {/* Empty State */}
        {!loading && configurations.length === 0 && (
          <Box>
            <div className="bg-gray-50 border-2 border-dashed border-gray-300 rounded-lg p-12 text-center">
              <div className="text-6xl mb-4">📋</div>
              <h3 className="text-xl font-semibold text-gray-900 mb-2">
                No Configurations Found
              </h3>
              <p className="text-gray-600 mb-4">
                You haven't received any ServiceConfiguration credentials yet.
              </p>
              <p className="text-sm text-gray-500">
                ServiceConfiguration credentials are issued by enterprise cloud agents
                when you establish a DIDComm connection with your employer.
              </p>
            </div>
          </Box>
        )}

        {/* Configuration List */}
        {!loading && configurations.length > 0 && (
          <Box>
          {/* Active Configuration Section */}
          {activeConfig && (
            <div className="mb-6">
              <h2 className="text-xl font-semibold text-gray-900 mb-3">
                ✅ Active Configuration
              </h2>
              <ServiceConfigDisplay
                config={activeConfig}
                isActive={true}
                onApply={handleConfigurationApplied}
                onRemove={handleConfigurationRemoved}
                onRefresh={handleRefresh}
              />
            </div>
          )}

          {/* Available Configurations Section */}
          {configurations.filter(stored =>
            !activeConfig || stored.config.vcId !== activeConfig.vcId
          ).length > 0 && (
            <div>
              <h2 className="text-xl font-semibold text-gray-900 mb-3">
                📦 Available Configurations
              </h2>
              {configurations
                .filter(stored => !activeConfig || stored.config.vcId !== activeConfig.vcId)
                .map((stored, index) => (
                  <ServiceConfigDisplay
                    key={stored.config.vcId}
                    config={stored.config}
                    isActive={false}
                    onApply={handleConfigurationApplied}
                    onRemove={handleConfigurationRemoved}
                    onRefresh={handleRefresh}
                  />
                ))}
            </div>
          )}
          </Box>
        )}

        {/* Help Section */}
        <Box>
          <div className="mt-8 bg-blue-50 border border-blue-200 rounded-lg p-6">
            <h3 className="text-lg font-semibold text-blue-900 mb-2">
              ℹ️ About ServiceConfiguration
            </h3>
            <div className="text-sm text-blue-800 space-y-2">
              <p>
                ServiceConfiguration credentials contain all the information needed to connect
                your wallet to your employer's enterprise cloud agent.
              </p>
              <p>
                <strong>Configuration includes:</strong>
              </p>
              <ul className="list-disc list-inside ml-4">
                <li>Enterprise Cloud Agent URL and API Key</li>
                <li>Mediator configuration for DIDComm messaging</li>
                <li>Available services (portals, dashboards, tools)</li>
                <li>Employee information (ID, department)</li>
              </ul>
              <p className="mt-3">
                <strong>To use a configuration:</strong>
              </p>
              <ol className="list-decimal list-inside ml-4">
                <li>Review the configuration details</li>
                <li>Click "Apply Configuration" if it looks correct</li>
                <li>Your wallet will automatically connect to the enterprise agent</li>
                <li>You can access company services from the Services tab</li>
              </ol>
            </div>
          </div>
        </Box>
      </DBConnect>
    </div>
  );
};

export default ConfigurationPage;
