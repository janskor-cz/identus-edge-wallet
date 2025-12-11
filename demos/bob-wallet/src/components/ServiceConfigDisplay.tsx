/**
 * ServiceConfigDisplay Component
 *
 * Displays ServiceConfiguration Verifiable Credentials and allows
 * users to apply or remove wallet configurations.
 */

import React, { useState } from 'react';
import { useDispatch } from 'react-redux';
import type { AppDispatch } from '@/reducers/store';
import {
  WalletConfiguration,
  ValidationResult,
  validateConfiguration,
  formatConfigurationSummary
} from '../utils/serviceConfigManager';
import {
  removeConfiguration as removeConfigFromStorage,
  ConfigurationApplicationResult
} from '../utils/configurationStorage';
import {
  applyConfiguration,
  removeConfiguration as removeConfigRedux
} from '../actions/enterpriseAgentActions';

interface ServiceConfigDisplayProps {
  config: WalletConfiguration;
  isActive: boolean;
  onApply?: (config: WalletConfiguration) => void;
  onRemove?: (credentialId: string) => void;
  onRefresh?: () => void;
}

export const ServiceConfigDisplay: React.FC<ServiceConfigDisplayProps> = ({
  config,
  isActive,
  onApply,
  onRemove,
  onRefresh
}) => {
  const dispatch = useDispatch<AppDispatch>();
  const [showDetails, setShowDetails] = useState(false);
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Validate configuration
  const validation: ValidationResult = validateConfiguration(config);

  /**
   * Handle apply configuration (using Redux)
   */
  const handleApply = async () => {
    try {
      setApplying(true);
      setError(null);

      console.log('[ServiceConfigDisplay] Applying configuration via Redux:', config.credentialId);

      // Dispatch Redux action to apply configuration
      // This will:
      // 1. Store configuration in localStorage
      // 2. Encrypt and store API key
      // 3. Create EnterpriseAgentClient
      // 4. Update Redux state
      // 5. Auto-refresh enterprise data
      await dispatch(applyConfiguration(config)).unwrap();

      console.log('[ServiceConfigDisplay] ✅ Configuration applied successfully via Redux');

      // Notify parent component
      if (onApply) {
        onApply(config);
      }

      // Refresh to show updated state
      if (onRefresh) {
        onRefresh();
      }

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to apply configuration: ${errorMsg}`);
      console.error('[ServiceConfigDisplay] Error applying configuration:', err);
    } finally {
      setApplying(false);
    }
  };

  /**
   * Handle remove configuration
   */
  const handleRemove = async () => {
    if (!confirm(`Remove configuration for ${config.employeeName}?`)) {
      return;
    }

    try {
      console.log('[ServiceConfigDisplay] Removing configuration:', config.credentialId);

      // If this is the active configuration, use Redux to remove it
      // Otherwise, just remove from storage
      if (isActive) {
        await dispatch(removeConfigRedux()).unwrap();
      } else {
        const success = removeConfigFromStorage(config.credentialId);
        if (!success) {
          setError('Failed to remove configuration');
          return;
        }
      }

      console.log('[ServiceConfigDisplay] ✅ Configuration removed successfully');

      // Notify parent component
      if (onRemove) {
        onRemove(config.credentialId);
      }

      // Refresh to show updated state
      if (onRefresh) {
        onRefresh();
      }

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to remove configuration: ${errorMsg}`);
      console.error('[ServiceConfigDisplay] Error removing configuration:', err);
    }
  };

  /**
   * Handle deactivate configuration (using Redux)
   */
  const handleDeactivate = async () => {
    if (!confirm('Deactivate this configuration?')) {
      return;
    }

    try {
      console.log('[ServiceConfigDisplay] Deactivating configuration via Redux');

      // Dispatch Redux action to remove configuration
      // This will:
      // 1. Clear configuration from localStorage
      // 2. Clear encrypted API key
      // 3. Clear Redux state
      // 4. Switch back to main agent context
      await dispatch(removeConfigRedux()).unwrap();

      console.log('[ServiceConfigDisplay] ✅ Configuration deactivated successfully via Redux');

      // Refresh to show updated state
      if (onRefresh) {
        onRefresh();
      }

    } catch (err) {
      const errorMsg = err instanceof Error ? err.message : 'Unknown error';
      setError(`Failed to deactivate configuration: ${errorMsg}`);
      console.error('[ServiceConfigDisplay] Error deactivating configuration:', err);
    }
  };

  // Status badge styling
  const getStatusBadgeClass = () => {
    if (isActive) return 'bg-green-500';
    if (!validation.isValid) return 'bg-red-500';
    return 'bg-gray-500';
  };

  const getStatusText = () => {
    if (isActive) return 'Active';
    if (!validation.isValid) return 'Invalid';
    return 'Available';
  };

  return (
    <div className={`border rounded-lg p-4 mb-4 ${isActive ? 'border-green-500 bg-green-50' : 'border-gray-300'}`}>
      {/* Header */}
      <div className="flex justify-between items-start mb-3">
        <div className="flex-1">
          <h3 className="text-lg font-semibold text-gray-900">
            {config.enterpriseAgentName}
          </h3>
          <p className="text-sm text-gray-600">
            Service Configuration
          </p>
        </div>
        <span className={`px-3 py-1 rounded-full text-white text-sm ${getStatusBadgeClass()}`}>
          {getStatusText()}
        </span>
      </div>

      {/* Enterprise Agent Configuration */}
      <div className="mb-3 p-3 bg-blue-50 border border-blue-200 rounded-lg">
        <p className="text-sm font-medium text-blue-900 mb-2">📡 Enterprise Cloud Agent</p>

        <div className="mb-2">
          <p className="text-xs font-medium text-blue-800">URL</p>
          <p className="text-sm text-blue-900 font-mono break-all">{config.enterpriseAgentUrl}</p>
        </div>

        <div className="mb-2">
          <p className="text-xs font-medium text-blue-800">Name</p>
          <p className="text-sm text-blue-900">{config.enterpriseAgentName}</p>
        </div>

        <div>
          <p className="text-xs font-medium text-blue-800">API Key</p>
          <p className="text-sm text-blue-900 font-mono">
            {config.enterpriseAgentApiKey.substring(0, 16)}...{config.enterpriseAgentApiKey.substring(config.enterpriseAgentApiKey.length - 4)}
          </p>
        </div>
      </div>

      {/* Info Note */}
      <div className="mb-3 p-2 bg-gray-50 border border-gray-200 rounded">
        <p className="text-xs text-gray-600">
          ℹ️ Additional information (DID, wallet ID, mediator) can be queried dynamically from the Enterprise Agent after applying this configuration.
        </p>
      </div>

      {/* Error Message */}
      {error && (
        <div className="mb-3 p-2 bg-red-100 border border-red-400 rounded text-red-700 text-sm">
          {error}
        </div>
      )}

      {/* Validation Errors */}
      {!validation.isValid && (
        <div className="mb-3 p-2 bg-yellow-100 border border-yellow-400 rounded">
          <p className="text-sm font-medium text-yellow-800">Configuration Issues:</p>
          <ul className="list-disc list-inside text-sm text-yellow-700">
            {validation.errors.map((err, index) => (
              <li key={index}>{err}</li>
            ))}
          </ul>
        </div>
      )}

      {/* Action Buttons */}
      <div className="flex gap-2">
        {!isActive && validation.isValid && (
          <button
            onClick={handleApply}
            disabled={applying}
            className="px-4 py-2 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:bg-gray-400 disabled:cursor-not-allowed transition-colors"
          >
            {applying ? 'Applying...' : '✅ Apply Configuration'}
          </button>
        )}

        {isActive && (
          <button
            onClick={handleDeactivate}
            className="px-4 py-2 bg-yellow-600 text-white rounded hover:bg-yellow-700 transition-colors"
          >
            ⏸️ Deactivate
          </button>
        )}

        <button
          onClick={() => setShowDetails(!showDetails)}
          className="px-4 py-2 bg-gray-200 text-gray-800 rounded hover:bg-gray-300 transition-colors"
        >
          {showDetails ? '▲ Hide Details' : '▼ Show Details'}
        </button>

        {!isActive && (
          <button
            onClick={handleRemove}
            className="px-4 py-2 bg-red-600 text-white rounded hover:bg-red-700 transition-colors ml-auto"
          >
            🗑️ Remove
          </button>
        )}
      </div>

      {/* Detailed View */}
      {showDetails && (
        <div className="mt-4 pt-4 border-t border-gray-300">
          <h4 className="text-sm font-semibold text-gray-900 mb-2">Configuration Details</h4>

          {/* Full API Key */}
          <div className="mb-3">
            <p className="text-sm font-medium text-gray-700">Full API Key</p>
            <p className="text-xs text-gray-600 font-mono break-all">
              {config.enterpriseAgentApiKey}
            </p>
          </div>

          {/* Full URL */}
          <div className="mb-3">
            <p className="text-sm font-medium text-gray-700">Enterprise Agent URL</p>
            <p className="text-xs text-gray-600 font-mono break-all">
              {config.enterpriseAgentUrl}
            </p>
          </div>

          {/* Validation Warnings */}
          {validation.warnings.length > 0 && (
            <div className="mb-3">
              <p className="text-sm font-medium text-gray-700 mb-1">Warnings</p>
              <ul className="list-disc list-inside text-sm text-gray-600">
                {validation.warnings.map((warning, index) => (
                  <li key={index}>{warning}</li>
                ))}
              </ul>
            </div>
          )}

          {/* VC Metadata */}
          <div className="text-xs text-gray-500">
            <p>VC ID: {config.vcId}</p>
            <p>Credential ID: {config.credentialId}</p>
            {config.appliedAt && (
              <p>Applied: {new Date(config.appliedAt).toLocaleString()}</p>
            )}
          </div>
        </div>
      )}
    </div>
  );
};

export default ServiceConfigDisplay;
