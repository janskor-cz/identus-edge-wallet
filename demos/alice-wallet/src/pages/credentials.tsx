
import React, { useState, useEffect } from "react";

import '../app/index.css'
import { Box } from "@/app/Box";
import { useMountedApp } from "@/reducers/store";
import { useAppSelector } from "@/reducers/store";
import { DBConnect } from "@/components/DBConnect";
import { PageHeader } from "@/components/PageHeader";
import { Credential } from "@/components/Credential";
import { CredentialCard } from "@/components/CredentialCard";
import { ErrorBoundary } from "@/components/ErrorBoundary";
import { verifyCredentialStatus } from "@/utils/credentialStatus";
import {
    getCredentialType,
    isCredentialExpired,
    sortCredentialsAlphabetically
} from "@/utils/credentialTypeDetector";
import { IdentificationIcon, ShieldCheckIcon, ClockIcon, OfficeBuildingIcon } from '@heroicons/react/solid';
import {
    selectEnterpriseCredentials,
    selectIsEnterpriseConfigured,
    selectIsLoadingCredentials,
    selectActiveConfiguration
} from "@/reducers/enterpriseAgent";

// ====================================================================
// STATUS CHECK CACHE - Prevents WebAssembly memory leak
// ====================================================================
// Cache credential status checks with 30-second TTL to prevent
// continuous WASM memory allocation from repeated verifications
// during auto-refresh cycles.
//
// Memory Impact:
// - WITHOUT cache: 2-5 MB WASM allocated every 30 seconds (unbounded growth)
// - WITH cache: Single verification, then cached results (memory plateaus)
// ====================================================================
interface StatusCacheEntry {
    status: {
        revoked: boolean;
        suspended: boolean;
        verified: boolean;
        statusListUrl?: string;
        error?: string;
    };
    timestamp: number;
}

const statusCheckCache = new Map<string, StatusCacheEntry>();
const CACHE_TTL_MS = 30000; // 30 seconds (matches auto-refresh interval)

/**
 * Get cached status or verify credential if cache miss/expired
 */
async function getCachedCredentialStatus(credential: any): Promise<any> {
    const cacheKey = credential.id;
    const cached = statusCheckCache.get(cacheKey);
    const now = Date.now();

    // Check if cache hit and not expired
    if (cached && (now - cached.timestamp) < CACHE_TTL_MS) {
        console.log(`✅ [Cache] HIT for credential ${cacheKey.substring(0, 20)}... (age: ${Math.round((now - cached.timestamp) / 1000)}s)`);
        return cached.status;
    }

    // Cache miss or expired - verify credential
    if (cached) {
        console.log(`⏰ [Cache] EXPIRED for credential ${cacheKey.substring(0, 20)}... (age: ${Math.round((now - cached.timestamp) / 1000)}s)`);
    } else {
        console.log(`❌ [Cache] MISS for credential ${cacheKey.substring(0, 20)}...`);
    }

    // Perform actual verification (WASM allocation happens here)
    const status = await verifyCredentialStatus(credential);

    // Store in cache
    statusCheckCache.set(cacheKey, {
        status,
        timestamp: now
    });

    console.log(`💾 [Cache] STORED status for credential ${cacheKey.substring(0, 20)}... (revoked: ${status.revoked}, suspended: ${status.suspended})`);

    return status;
}

/**
 * Clear cache entries for deleted credentials
 */
function cleanupStatusCache(validCredentialIds: string[]) {
    const validIdSet = new Set(validCredentialIds);
    let removedCount = 0;

    for (const cacheKey of statusCheckCache.keys()) {
        if (!validIdSet.has(cacheKey)) {
            statusCheckCache.delete(cacheKey);
            removedCount++;
        }
    }

    if (removedCount > 0) {
        console.log(`🧹 [Cache] Cleaned up ${removedCount} stale cache entries`);
    }
}

export default function App() {
    const app = useMountedApp();
    const [isRefreshing, setIsRefreshing] = useState(false);
    const [deletingCredentialId, setDeletingCredentialId] = useState<string | null>(null);
    const [refreshKey, setRefreshKey] = useState(0);
    const [showRevoked, setShowRevoked] = useState(false);
    const [showExpired, setShowExpired] = useState(false);

    // Grouped credentials (Personal Wallet)
    const [identityCredentials, setIdentityCredentials] = useState<any[]>([]);
    const [clearanceCredentials, setClearanceCredentials] = useState<any[]>([]);
    const [expiredCredentials, setExpiredCredentials] = useState<any[]>([]);
    const [revokedCredentials, setRevokedCredentials] = useState<any[]>([]);
    const [credentialStatuses, setCredentialStatuses] = useState<Map<string, any>>(new Map());

    // Enterprise Wallet State
    const enterpriseCredentials = useAppSelector(selectEnterpriseCredentials);
    const isEnterpriseConfigured = useAppSelector(selectIsEnterpriseConfigured);
    const isLoadingEnterpriseCredentials = useAppSelector(selectIsLoadingCredentials);
    const enterpriseConfig = useAppSelector(selectActiveConfiguration);

    // Group and sort credentials by type
    useEffect(() => {
        const checkAndGroupCredentials = async () => {
            console.log('🔄 [Credentials] Starting credential grouping and status check...');

            const identity: any[] = [];
            const clearance: any[] = [];
            const expired: any[] = [];
            const revoked: any[] = [];
            const statusMap = new Map();

            // Clean up cache for deleted credentials
            const validCredentialIds = app.credentials.map(c => c.id);
            cleanupStatusCache(validCredentialIds);

            for (const credential of app.credentials) {
                try {
                    // Check revocation status WITH CACHING
                    const status = await getCachedCredentialStatus(credential);
                    statusMap.set(credential.id, status);

                    // If revoked/suspended, add to revoked list
                    if (status.revoked || status.suspended) {
                        revoked.push(credential);
                        continue;
                    }

                    // Check if expired
                    const expired_flag = isCredentialExpired(credential);

                    if (expired_flag) {
                        expired.push(credential);
                    } else {
                        // Group by type (only valid, non-expired credentials)
                        const type = getCredentialType(credential);

                        if (type === 'RealPersonIdentity') {
                            identity.push(credential);
                        } else if (type === 'SecurityClearance') {
                            clearance.push(credential);
                        } else {
                            // Unknown types go in identity for now
                            identity.push(credential);
                        }
                    }
                } catch (error) {
                    console.error('Error checking credential status:', error);
                    // On error, treat as valid identity credential
                    identity.push(credential);
                }
            }

            // Sort each group alphabetically
            setIdentityCredentials(sortCredentialsAlphabetically(identity));
            setClearanceCredentials(sortCredentialsAlphabetically(clearance));
            setExpiredCredentials(sortCredentialsAlphabetically(expired));
            setRevokedCredentials(revoked);
            setCredentialStatuses(statusMap);

            console.log('✅ [Credentials] Grouping completed:', {
                identity: identity.length,
                clearance: clearance.length,
                expired: expired.length,
                revoked: revoked.length,
                cacheSize: statusCheckCache.size
            });
        };

        checkAndGroupCredentials();
    }, [app.credentials, refreshKey]);

    // Periodic revocation status check every 30 seconds
    useEffect(() => {
        const interval = setInterval(() => {
            console.log('🔄 [REVOCATION] Checking credential revocation status...');
            console.log(`📊 [Cache] Current cache size: ${statusCheckCache.size} entries`);
            setRefreshKey(prev => prev + 1);
        }, 30000);

        return () => clearInterval(interval);
    }, []);

    // Cleanup cache on component unmount
    useEffect(() => {
        return () => {
            console.log('🧹 [Cache] Component unmounting, clearing cache');
            statusCheckCache.clear();
        };
    }, []);

    const handleRefreshCredentials = async () => {
        if (!app.db.instance) {
            console.error('❌ Database not connected - cannot refresh credentials');
            return;
        }

        console.log('🔄 Starting manual credential refresh...');
        setIsRefreshing(true);

        try {
            await app.refreshCredentials();
            console.log('✅ Manual credential refresh completed');
        } catch (error) {
            console.error('❌ Manual credential refresh failed:', error);
        } finally {
            setIsRefreshing(false);
        }
    };

    const handleDeleteCredential = async (credential: any) => {
        if (!app.db.instance) {
            console.error('❌ Database not connected - cannot delete credential');
            alert('Database not connected. Cannot delete credential.');
            return;
        }

        // Confirmation dialog (enhanced for ServiceConfiguration VCs)
        const issuerInfo = credential.issuer || 'Unknown Issuer';
        const credentialType = credential.credentialType || credential.type || 'Unknown';
        const isServiceConfig = credentialType === 'ServiceConfiguration' ||
            (credential.credentialSubject?.enterpriseAgentUrl);

        let confirmMessage;
        if (isServiceConfig) {
            confirmMessage =
                `⚠️ DELETE SERVICECONFIGURATION CREDENTIAL?\n\n` +
                `Issuer: ${issuerInfo}\n\n` +
                `WARNING: This will permanently disconnect your wallet from the enterprise agent.\n\n` +
                `All enterprise features will be disabled and you will need to re-establish ` +
                `the connection to restore access.\n\n` +
                `This action cannot be undone. Are you sure?`;
        } else {
            confirmMessage =
                `Are you sure you want to delete this credential?\n\n` +
                `Issuer: ${issuerInfo}\n\n` +
                `This action cannot be undone.`;
        }

        if (!confirm(confirmMessage)) {
            return;
        }

        // 🔍 DIAGNOSTIC: Log credential count BEFORE deletion
        const credentialCountBefore = app.credentials.length;
        console.log('═══════════════════════════════════════════════════════');
        console.log('🗑️ [DELETE] Starting credential deletion...');
        console.log('📊 [DELETE] Credential count BEFORE deletion:', credentialCountBefore);
        console.log('🔍 [DELETE] Credential to delete:', {
            id: credential.id,
            uuid: credential.uuid,
            restoreId: credential.restoreId,
            issuer: credential.issuer,
            credentialType: credential.credentialType,
            hasId: !!credential.id,
            hasUuid: !!credential.uuid,
            hasRestoreId: !!credential.restoreId,
        });

        // 🔍 DIAGNOSTIC: Safe JSON stringification to avoid circular reference crashes
        try {
            const safeCredential = JSON.stringify(credential, null, 2);
            console.log('🔍 [DELETE] Full credential structure:', safeCredential);
        } catch (jsonError) {
            console.error('⚠️ [DELETE] Cannot stringify credential (circular reference):', jsonError.message);
            console.log('🔍 [DELETE] Credential keys:', Object.keys(credential));
            console.log('🔍 [DELETE] Credential prototype:', Object.getPrototypeOf(credential)?.constructor?.name);
        }

        setDeletingCredentialId(credential.id);

        try {
            // LAYER 1: Delete from database (Pluto)
            console.log('🗄️ [DELETE] Attempting database deletion...');
            await app.db.instance.deleteCredential(credential);
            console.log('✅ [DELETE] Database deletion call completed');

            // 🔍 DIAGNOSTIC: Check credential count immediately after deletion
            const credentialCountAfterDelete = app.credentials.length;
            console.log('📊 [DELETE] Credential count AFTER database deletion:', credentialCountAfterDelete);
            console.log('📊 [DELETE] Expected change: -1, Actual change:', credentialCountAfterDelete - credentialCountBefore);

            // 🔧 FIX: Wait for IndexedDB transaction to commit
            console.log('⏳ [DELETE] Waiting for IndexedDB transaction to commit...');
            await new Promise(resolve => setTimeout(resolve, 100));
            console.log('✅ [DELETE] Transaction commit delay completed');

            // Clear cache entry for deleted credential
            statusCheckCache.delete(credential.id);
            console.log('🧹 [Cache] Removed cache entry for deleted credential');

            // 🔧 NEW: Check if this is a ServiceConfiguration VC and clean up
            const credentialType = credential.credentialType || credential.type || 'Unknown';
            if (credentialType === 'ServiceConfiguration' ||
                (credential.credentialSubject?.enterpriseAgentUrl)) {
                console.log('🗑️ [DELETE] Detected ServiceConfiguration VC - clearing configuration...');

                try {
                    // Dynamically import configuration utilities
                    const { getAllConfigurations, getActiveConfiguration, clearActiveConfiguration } =
                        await import('@/utils/configurationStorage');
                    const { removeConfiguration } =
                        await import('@/actions/enterpriseAgentActions');

                    // Find configuration matching this VC's ID
                    const allConfigs = getAllConfigurations();
                    const matchingConfig = allConfigs.find(
                        stored => stored.config.vcId === credential.id
                    );

                    if (matchingConfig) {
                        console.log('🗑️ [DELETE] Found matching configuration:', matchingConfig.config.credentialId);

                        // Check if this is the active configuration
                        const activeConfig = getActiveConfiguration();
                        const isActive = activeConfig?.vcId === credential.id;

                        if (isActive) {
                            // Clear active configuration and Redux state
                            console.log('🗑️ [DELETE] Clearing ACTIVE configuration via Redux...');
                            await app.dispatch(removeConfiguration()).unwrap();
                            console.log('✅ [DELETE] Active configuration cleared from Redux and localStorage');
                        } else {
                            // Just remove from localStorage (not active)
                            console.log('🗑️ [DELETE] Removing INACTIVE configuration from storage...');
                            clearActiveConfiguration();
                            console.log('✅ [DELETE] Inactive configuration removed');
                        }

                        console.log('✅ [DELETE] ServiceConfiguration cleanup completed');
                    } else {
                        console.log('ℹ️ [DELETE] No matching configuration found in storage (may have been deactivated)');
                    }
                } catch (configError) {
                    console.error('⚠️ [DELETE] Failed to clean up ServiceConfiguration:', configError);
                    // Don't fail the deletion if config cleanup fails
                }
            }

            // LAYER 2: Refresh credentials in Redux state
            console.log('🔄 [DELETE] Refreshing credential list from database...');
            await app.refreshCredentials();

            // 🔍 DIAGNOSTIC: Check credential count after refresh
            const credentialCountAfterRefresh = app.credentials.length;
            console.log('📊 [DELETE] Credential count AFTER refresh:', credentialCountAfterRefresh);
            console.log('📊 [DELETE] Change from refresh:', credentialCountAfterRefresh - credentialCountAfterDelete);

            // 🔍 DIAGNOSTIC: Log all credential IDs after refresh
            console.log('🔍 [DELETE] All credential IDs after refresh:',
                app.credentials.map(c => ({
                    id: c.id,
                    uuid: c.uuid,
                    issuer: c.issuer,
                    type: c.credentialType
                }))
            );

            if (credentialCountAfterRefresh >= credentialCountBefore) {
                console.error('⚠️ [DELETE] BUG DETECTED: Credential count did NOT decrease!');
                console.error('⚠️ [DELETE] Before:', credentialCountBefore, 'After:', credentialCountAfterRefresh);
                console.error('⚠️ [DELETE] This indicates the deletion failed or refresh created duplicates');
            }

            console.log('═══════════════════════════════════════════════════════');
            alert('Credential deleted successfully!');
        } catch (error) {
            console.error('❌ [DELETE] Failed to delete credential:', error);
            console.error('❌ [DELETE] Error details:', {
                message: error.message,
                stack: error.stack,
                error: error
            });
            alert(`Failed to delete credential: ${error.message || error}`);
        } finally {
            setDeletingCredentialId(null);
        }
    };

    return (
        <>
            <div className="mx-10 mt-5 mb-30">
                <PageHeader>
                    <h1 className="mb-4 text-4xl font-extrabold tracking-tight leading-none text-gray-900 md:text-5xl lg:text-6xl dark:text-white">
                        Credentials
                    </h1>
                </PageHeader>
                <DBConnect>
                    <Box>
                        {/* Refresh Button */}
                        <div className="mb-6">
                            <button
                                onClick={handleRefreshCredentials}
                                disabled={isRefreshing || !app.db.instance}
                                className={`inline-flex items-center px-4 py-2 text-sm font-medium text-white border border-transparent rounded-md shadow-sm focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 ${
                                    isRefreshing || !app.db.instance
                                        ? 'bg-gray-400 cursor-not-allowed'
                                        : 'bg-blue-600 hover:bg-blue-700'
                                }`}
                            >
                                {isRefreshing ? (
                                    <>
                                        <svg className="animate-spin -ml-1 mr-3 h-4 w-4 text-white" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                        </svg>
                                        Refreshing...
                                    </>
                                ) : (
                                    <>
                                        🔄 Refresh Credentials
                                    </>
                                )}
                            </button>
                            <p className="mt-2 text-sm text-gray-500">
                                Click to manually refresh credentials from database
                            </p>
                        </div>

                        {/* Credentials List - Grouped by Type */}
                        {
                            app.credentials.length <= 0 ?
                                <div className="text-center py-8">
                                    <p className="text-lg font-normal text-gray-500 lg:text-xl dark:text-gray-400">
                                        No credentials found.
                                    </p>
                                    <p className="text-sm text-gray-400 mt-2">
                                        If you have accepted credential offers, try clicking "Refresh Credentials" above.
                                    </p>
                                </div>
                                :
                                <>
                                    {/* Identity Credentials Section */}
                                    {identityCredentials.length > 0 && (
                                        <section className="mb-8">
                                            <div className="flex items-center gap-3 mb-4">
                                                <IdentificationIcon className="w-8 h-8 text-blue-600" />
                                                <h2 className="text-2xl font-bold text-gray-900">
                                                    Identity Credentials
                                                </h2>
                                                <span className="px-3 py-1 bg-blue-100 text-blue-800 text-sm font-semibold rounded-full">
                                                    {identityCredentials.length}
                                                </span>
                                            </div>
                                            <div className="space-y-4">
                                                {identityCredentials.map((credential, i) => (
                                                    <ErrorBoundary
                                                        key={`identity-${refreshKey}-${credential.id}-${i}`}
                                                        componentName={`CredentialCard-Identity-${i}`}
                                                    >
                                                        <CredentialCard
                                                            credential={credential}
                                                            onDelete={handleDeleteCredential}
                                                            status={credentialStatuses.get(credential.id)}
                                                        />
                                                    </ErrorBoundary>
                                                ))}
                                            </div>
                                        </section>
                                    )}

                                    {/* Security Clearances Section */}
                                    {clearanceCredentials.length > 0 && (
                                        <section className="mb-8">
                                            <div className="flex items-center gap-3 mb-4">
                                                <ShieldCheckIcon className="w-8 h-8 text-purple-600" />
                                                <h2 className="text-2xl font-bold text-gray-900">
                                                    Security Clearances
                                                </h2>
                                                <span className="px-3 py-1 bg-purple-100 text-purple-800 text-sm font-semibold rounded-full">
                                                    {clearanceCredentials.length}
                                                </span>
                                            </div>
                                            <div className="space-y-4">
                                                {clearanceCredentials.map((credential, i) => (
                                                    <ErrorBoundary
                                                        key={`clearance-${refreshKey}-${credential.id}-${i}`}
                                                        componentName={`CredentialCard-Clearance-${i}`}
                                                    >
                                                        <CredentialCard
                                                            credential={credential}
                                                            onDelete={handleDeleteCredential}
                                                            status={credentialStatuses.get(credential.id)}
                                                        />
                                                    </ErrorBoundary>
                                                ))}
                                            </div>
                                        </section>
                                    )}

                                    {/* Expired Credentials Section */}
                                    {expiredCredentials.length > 0 && (
                                        <section className="mb-8">
                                            <button
                                                onClick={() => setShowExpired(!showExpired)}
                                                className="flex items-center gap-3 mb-4 hover:opacity-80 transition-opacity"
                                            >
                                                <ClockIcon className="w-8 h-8 text-orange-600" />
                                                <h2 className="text-2xl font-bold text-gray-900">
                                                    Expired Credentials
                                                </h2>
                                                <span className="px-3 py-1 bg-orange-100 text-orange-800 text-sm font-semibold rounded-full">
                                                    {expiredCredentials.length}
                                                </span>
                                                <span className="text-2xl text-gray-500">
                                                    {showExpired ? '▼' : '▶'}
                                                </span>
                                            </button>

                                            {showExpired && (
                                                <div className="space-y-4 animate-fadeIn">
                                                    {expiredCredentials.map((credential, i) => (
                                                        <ErrorBoundary
                                                            key={`expired-${refreshKey}-${credential.id}-${i}`}
                                                            componentName={`CredentialCard-Expired-${i}`}
                                                        >
                                                            <CredentialCard
                                                                credential={credential}
                                                                onDelete={handleDeleteCredential}
                                                                status={credentialStatuses.get(credential.id)}
                                                            />
                                                        </ErrorBoundary>
                                                    ))}
                                                </div>
                                            )}
                                        </section>
                                    )}

                                    {/* Revoked Credentials Section */}
                                    {revokedCredentials.length > 0 && (
                                        <section className="mb-8">
                                            <button
                                                onClick={() => setShowRevoked(!showRevoked)}
                                                className="flex items-center gap-3 mb-4 hover:opacity-80 transition-opacity"
                                            >
                                                <div className="w-8 h-8 bg-red-600 rounded-full flex items-center justify-center text-white font-bold">
                                                    ✗
                                                </div>
                                                <h2 className="text-2xl font-bold text-gray-900">
                                                    Revoked Credentials
                                                </h2>
                                                <span className="px-3 py-1 bg-red-100 text-red-800 text-sm font-semibold rounded-full">
                                                    {revokedCredentials.length}
                                                </span>
                                                <span className="text-2xl text-gray-500">
                                                    {showRevoked ? '▼' : '▶'}
                                                </span>
                                            </button>

                                            {showRevoked && (
                                                <div className="space-y-4 animate-fadeIn">
                                                    {revokedCredentials.map((credential, i) => (
                                                        <div
                                                            key={`revoked-${refreshKey}-${credential.id}-${i}`}
                                                            className="border-2 border-red-300 rounded-lg overflow-hidden"
                                                        >
                                                            <div className="bg-red-100 px-4 py-2 border-b-2 border-red-300">
                                                                <div className="text-red-700 font-semibold text-sm">
                                                                    ⚠️ REVOKED OR SUSPENDED
                                                                </div>
                                                            </div>
                                                            <div className="p-4 bg-red-50">
                                                                <Credential credential={credential} />
                                                            </div>
                                                        </div>
                                                    ))}
                                                </div>
                                            )}
                                        </section>
                                    )}

                                    {/* No Valid Credentials Message */}
                                    {identityCredentials.length === 0 &&
                                     clearanceCredentials.length === 0 &&
                                     expiredCredentials.length === 0 &&
                                     revokedCredentials.length > 0 && (
                                        <div className="text-center py-8 text-gray-500">
                                            <p>All your credentials are revoked or suspended.</p>
                                            <p className="text-sm mt-2">Expand the "Revoked Credentials" section above to view them.</p>
                                        </div>
                                    )}

                                    {/* === VISUAL SEPARATOR === */}
                                    {isEnterpriseConfigured && (
                                        <div className="my-12 border-t-4 border-blue-600"></div>
                                    )}

                                    {/* === ENTERPRISE WALLET CREDENTIALS === */}
                                    {isEnterpriseConfigured && (
                                        <section className="mt-8">
                                            {/* Enterprise Header */}
                                            <div className="flex items-center gap-4 mb-6 bg-gradient-to-r from-blue-50 to-blue-100 p-4 rounded-lg border-2 border-blue-200">
                                                <OfficeBuildingIcon className="w-10 h-10 text-blue-600" />
                                                <div className="flex-1">
                                                    <h2 className="text-3xl font-bold text-gray-900">
                                                        🏢 Enterprise Wallet
                                                    </h2>
                                                    <p className="text-sm text-gray-600 mt-1">
                                                        {enterpriseConfig?.agentName || 'Enterprise Cloud Agent'}
                                                    </p>
                                                </div>
                                                {isLoadingEnterpriseCredentials && (
                                                    <div className="flex items-center gap-2 text-blue-600">
                                                        <svg className="animate-spin h-5 w-5" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                                                            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"></circle>
                                                            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"></path>
                                                        </svg>
                                                        <span className="text-sm">Loading...</span>
                                                    </div>
                                                )}
                                            </div>

                                            {/* Enterprise Credentials List */}
                                            {!isLoadingEnterpriseCredentials && enterpriseCredentials.length === 0 && (
                                                <div className="text-center py-8 bg-blue-50 rounded-lg border-2 border-blue-200">
                                                    <p className="text-lg font-normal text-gray-500">
                                                        No enterprise credentials found.
                                                    </p>
                                                    <p className="text-sm text-gray-400 mt-2">
                                                        Enterprise credentials will appear here when issued by your organization.
                                                    </p>
                                                </div>
                                            )}

                                            {!isLoadingEnterpriseCredentials && enterpriseCredentials.length > 0 && (
                                                <div className="space-y-4">
                                                    {enterpriseCredentials.map((credential, i) => (
                                                        <ErrorBoundary
                                                            key={`enterprise-${refreshKey}-${credential.recordId || i}`}
                                                            componentName={`EnterpriseCredential-${i}`}
                                                        >
                                                            <div className="border-2 border-blue-200 rounded-lg overflow-hidden bg-white shadow-sm hover:shadow-md transition-shadow">
                                                                <div className="bg-blue-100 px-4 py-2 border-b-2 border-blue-200">
                                                                    <div className="flex items-center justify-between">
                                                                        <div className="text-blue-700 font-semibold text-sm flex items-center gap-2">
                                                                            <OfficeBuildingIcon className="w-4 h-4" />
                                                                            Enterprise Credential
                                                                        </div>
                                                                        <span className={`px-3 py-1 text-xs font-semibold rounded-full ${
                                                                            credential.protocolState === 'CredentialReceived'
                                                                                ? 'bg-green-100 text-green-800'
                                                                                : credential.protocolState === 'CredentialSent'
                                                                                ? 'bg-blue-100 text-blue-800'
                                                                                : 'bg-gray-100 text-gray-800'
                                                                        }`}>
                                                                            {credential.protocolState || 'Unknown'}
                                                                        </span>
                                                                    </div>
                                                                </div>
                                                                <div className="p-4">
                                                                    <div className="space-y-2 text-sm">
                                                                        <div className="flex justify-between">
                                                                            <span className="font-semibold text-gray-700">Record ID:</span>
                                                                            <span className="text-gray-600 font-mono text-xs">{credential.recordId}</span>
                                                                        </div>
                                                                        {credential.credentialDefinitionId && (
                                                                            <div className="flex justify-between">
                                                                                <span className="font-semibold text-gray-700">Definition ID:</span>
                                                                                <span className="text-gray-600 font-mono text-xs truncate max-w-xs">{credential.credentialDefinitionId}</span>
                                                                            </div>
                                                                        )}
                                                                        {credential.issuedAt && (
                                                                            <div className="flex justify-between">
                                                                                <span className="font-semibold text-gray-700">Issued:</span>
                                                                                <span className="text-gray-600">{new Date(credential.issuedAt).toLocaleDateString()}</span>
                                                                            </div>
                                                                        )}
                                                                        {credential.updatedAt && (
                                                                            <div className="flex justify-between">
                                                                                <span className="font-semibold text-gray-700">Updated:</span>
                                                                                <span className="text-gray-600">{new Date(credential.updatedAt).toLocaleDateString()}</span>
                                                                            </div>
                                                                        )}
                                                                        {/* Full credential details in collapsed format */}
                                                                        <details className="mt-4">
                                                                            <summary className="cursor-pointer text-blue-600 hover:text-blue-800 font-semibold">
                                                                                📋 View Full Details
                                                                            </summary>
                                                                            <pre className="mt-2 p-3 bg-gray-50 rounded text-xs overflow-x-auto border border-gray-200">
                                                                                {JSON.stringify(credential, null, 2)}
                                                                            </pre>
                                                                        </details>
                                                                    </div>
                                                                </div>
                                                            </div>
                                                        </ErrorBoundary>
                                                    ))}
                                                </div>
                                            )}
                                        </section>
                                    )}

                                    {/* Enterprise Not Configured Message */}
                                    {!isEnterpriseConfigured && app.credentials.length > 0 && (
                                        <section className="mt-12">
                                            <div className="border-t-4 border-gray-300 mb-8"></div>
                                            <div className="text-center py-8 bg-gray-50 rounded-lg border-2 border-gray-200">
                                                <OfficeBuildingIcon className="w-16 h-16 text-gray-400 mx-auto mb-4" />
                                                <p className="text-lg font-semibold text-gray-700">
                                                    Enterprise Wallet Not Configured
                                                </p>
                                                <p className="text-sm text-gray-500 mt-2 max-w-md mx-auto">
                                                    To view enterprise credentials, you need to receive a Service Configuration credential from your organization.
                                                </p>
                                            </div>
                                        </section>
                                    )}
                                </>
                        }
                    </Box>
                </DBConnect>
            </div>
        </>
    );
}
