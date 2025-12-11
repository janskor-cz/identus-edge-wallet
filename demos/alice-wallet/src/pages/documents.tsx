/**
 * Documents Page
 *
 * Secure document access with Perfect Forward Secrecy (PFS)
 * - Lists available ephemeral documents based on user's clearance level
 * - Handles document access requests with ephemeral key generation
 * - Displays classification-based filtering
 *
 * @version 1.0.0
 * @date 2025-12-07
 */

import React, { useState, useEffect, useCallback } from 'react';
import '../app/index.css';
import { Box } from "@/app/Box";
import { useMountedApp } from "@/reducers/store";
import { DBConnect } from "@/components/DBConnect";
import { PageHeader } from "@/components/PageHeader";
import { DocumentAccess, EphemeralDocument } from "@/components/DocumentAccess";
import { getClassificationLabel } from "@/utils/EphemeralDIDCrypto";
import { LockClosedIcon, DocumentIcon, RefreshIcon, FilterIcon, ShieldCheckIcon } from '@heroicons/react/solid';

/**
 * Classification level badge configuration
 */
const getClassificationBadge = (level: number) => {
  switch (level) {
    case 1:
      return { color: 'bg-green-100 text-green-800 border-green-300', label: 'UNCLASSIFIED' };
    case 2:
      return { color: 'bg-blue-100 text-blue-800 border-blue-300', label: 'CONFIDENTIAL' };
    case 3:
      return { color: 'bg-orange-100 text-orange-800 border-orange-300', label: 'SECRET' };
    case 4:
      return { color: 'bg-red-100 text-red-800 border-red-300', label: 'TOP SECRET' };
    default:
      return { color: 'bg-gray-100 text-gray-800 border-gray-300', label: 'UNKNOWN' };
  }
};

/**
 * Documents Page Component
 */
export default function DocumentsPage() {
  const app = useMountedApp();

  // State
  const [documents, setDocuments] = useState<EphemeralDocument[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [selectedDocument, setSelectedDocument] = useState<EphemeralDocument | null>(null);
  const [filterLevel, setFilterLevel] = useState<number | null>(null);

  // User's security clearance (from credentials)
  const [userClearanceLevel, setUserClearanceLevel] = useState<number>(1);
  const [userPrismDID, setUserPrismDID] = useState<string | null>(null);
  const [issuerDID, setIssuerDID] = useState<string | null>(null);
  const [ed25519PrivateKey, setEd25519PrivateKey] = useState<Uint8Array | null>(null);

  // API configuration
  const apiBaseUrl = 'https://identuslabel.cz/company-admin/api';

  /**
   * Extract user's security clearance from credentials
   */
  useEffect(() => {
    const extractUserInfo = async () => {
      if (!app.credentials || app.credentials.length === 0) {
        console.log('[Documents] No credentials found');
        return;
      }

      // Find Security Clearance credential
      const clearanceVC = app.credentials.find(cred => {
        const type = cred.credentialType || '';
        return type.toLowerCase().includes('securityclearance') ||
               type.toLowerCase().includes('security-clearance');
      });

      if (clearanceVC) {
        console.log('[Documents] Found Security Clearance VC');

        // Extract clearance level
        const subject = clearanceVC.credentialSubject || {};
        const level = subject.clearanceLevel || subject.securityLevel || 'UNCLASSIFIED';

        // Convert label to number
        const levelMap: { [key: string]: number } = {
          'UNCLASSIFIED': 1,
          'CONFIDENTIAL': 2,
          'SECRET': 3,
          'TOP_SECRET': 4
        };
        const numLevel = levelMap[level.toUpperCase()] || 1;
        setUserClearanceLevel(numLevel);

        // Extract holder DID
        if (subject.id) {
          setUserPrismDID(subject.id);
        }

        // Extract issuer DID
        if (clearanceVC.issuer) {
          setIssuerDID(typeof clearanceVC.issuer === 'string'
            ? clearanceVC.issuer
            : clearanceVC.issuer.id || clearanceVC.issuer);
        }

        console.log('[Documents] User clearance level:', numLevel, '/', level);
      } else {
        console.log('[Documents] No Security Clearance VC found, defaulting to UNCLASSIFIED');
        setUserClearanceLevel(1);
      }

      // Try to find PRISM DID from any credential if not found
      if (!userPrismDID) {
        for (const cred of app.credentials) {
          const subject = cred.credentialSubject || {};
          if (subject.id && subject.id.startsWith('did:prism:')) {
            setUserPrismDID(subject.id);
            break;
          }
        }
      }
    };

    extractUserInfo();
  }, [app.credentials]);

  /**
   * Fetch available documents from server
   */
  const fetchDocuments = useCallback(async () => {
    setIsLoading(true);
    setError(null);

    try {
      const params = new URLSearchParams();
      if (filterLevel) {
        params.set('maxLevel', filterLevel.toString());
      } else {
        params.set('maxLevel', userClearanceLevel.toString());
      }

      const response = await fetch(`${apiBaseUrl}/ephemeral-documents?${params}`);

      if (!response.ok) {
        throw new Error(`Failed to fetch documents: ${response.statusText}`);
      }

      const data = await response.json();
      setDocuments(data.documents || []);

      console.log('[Documents] Fetched', data.documents?.length || 0, 'documents');
    } catch (err: any) {
      console.error('[Documents] Fetch error:', err);
      setError(err.message || 'Failed to fetch documents');
    } finally {
      setIsLoading(false);
    }
  }, [apiBaseUrl, filterLevel, userClearanceLevel]);

  /**
   * Fetch documents on mount and when filter changes
   */
  useEffect(() => {
    fetchDocuments();
  }, [fetchDocuments]);

  /**
   * Handle document access request
   */
  const handleRequestAccess = (document: EphemeralDocument) => {
    setSelectedDocument(document);
  };

  /**
   * Handle access modal close
   */
  const handleCloseAccess = () => {
    setSelectedDocument(null);
  };

  /**
   * Handle access complete
   */
  const handleAccessComplete = (success: boolean, copyId?: string) => {
    if (success) {
      console.log('[Documents] Access granted, copy ID:', copyId);
    } else {
      console.log('[Documents] Access denied or failed');
    }
  };

  /**
   * Filter documents by classification level
   */
  const filteredDocuments = filterLevel
    ? documents.filter(doc => doc.classificationLevel === filterLevel)
    : documents;

  return (
    <>
      <div className="mx-10 mt-5 mb-30">
        <PageHeader>
          <h1 className="mb-4 text-4xl font-extrabold tracking-tight leading-none text-gray-900 md:text-5xl lg:text-6xl dark:text-white flex items-center gap-3">
            <LockClosedIcon className="w-12 h-12 text-blue-600" />
            Secure Documents
          </h1>
        </PageHeader>

        <DBConnect>
          <Box>
            {/* User Clearance Info */}
            <div className="mb-6 p-4 bg-gray-50 rounded-lg border border-gray-200">
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <ShieldCheckIcon className="w-6 h-6 text-purple-600" />
                  <div>
                    <div className="text-sm text-gray-500">Your Security Clearance</div>
                    <div className={`inline-flex px-3 py-1 rounded-full text-sm font-bold border ${getClassificationBadge(userClearanceLevel).color}`}>
                      {getClassificationBadge(userClearanceLevel).label}
                    </div>
                  </div>
                </div>
                {userPrismDID && (
                  <div className="text-right">
                    <div className="text-sm text-gray-500">Your DID</div>
                    <div className="text-xs font-mono text-gray-600 truncate max-w-xs">
                      {userPrismDID.substring(0, 40)}...
                    </div>
                  </div>
                )}
              </div>
            </div>

            {/* Controls */}
            <div className="mb-6 flex items-center gap-4">
              {/* Refresh Button */}
              <button
                onClick={fetchDocuments}
                disabled={isLoading}
                className={`inline-flex items-center gap-2 px-4 py-2 text-sm font-medium text-white rounded-lg ${
                  isLoading
                    ? 'bg-gray-400 cursor-not-allowed'
                    : 'bg-blue-600 hover:bg-blue-700'
                }`}
              >
                <RefreshIcon className={`w-4 h-4 ${isLoading ? 'animate-spin' : ''}`} />
                {isLoading ? 'Loading...' : 'Refresh'}
              </button>

              {/* Classification Filter */}
              <div className="flex items-center gap-2">
                <FilterIcon className="w-5 h-5 text-gray-500" />
                <select
                  value={filterLevel || ''}
                  onChange={(e) => setFilterLevel(e.target.value ? Number(e.target.value) : null)}
                  className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                >
                  <option value="">All Classifications</option>
                  <option value="1">UNCLASSIFIED</option>
                  <option value="2">CONFIDENTIAL</option>
                  {userClearanceLevel >= 3 && <option value="3">SECRET</option>}
                  {userClearanceLevel >= 4 && <option value="4">TOP SECRET</option>}
                </select>
              </div>
            </div>

            {/* Error Message */}
            {error && (
              <div className="mb-6 p-4 bg-red-50 border border-red-200 rounded-lg text-red-700">
                <strong>Error:</strong> {error}
              </div>
            )}

            {/* Documents List */}
            {!isLoading && filteredDocuments.length === 0 && (
              <div className="text-center py-12">
                <DocumentIcon className="w-16 h-16 mx-auto text-gray-300 mb-4" />
                <p className="text-lg text-gray-500">No documents available</p>
                <p className="text-sm text-gray-400 mt-2">
                  Documents matching your clearance level will appear here.
                </p>
              </div>
            )}

            {filteredDocuments.length > 0 && (
              <div className="space-y-4">
                {filteredDocuments.map((doc) => {
                  const badge = getClassificationBadge(doc.classificationLevel);
                  return (
                    <div
                      key={doc.id}
                      className="border-2 border-gray-200 rounded-lg overflow-hidden hover:shadow-lg transition-shadow"
                    >
                      {/* Classification Banner */}
                      <div className={`px-4 py-2 ${badge.color} border-b-2`}>
                        <span className="font-bold text-sm">{badge.label}</span>
                      </div>

                      {/* Document Content */}
                      <div className="p-4 bg-white">
                        <div className="flex items-start justify-between">
                          <div className="flex-1">
                            <h3 className="text-lg font-bold text-gray-900">{doc.title}</h3>
                            {doc.description && (
                              <p className="text-gray-600 mt-1 text-sm">{doc.description}</p>
                            )}
                            <div className="flex items-center gap-4 mt-3 text-sm text-gray-500">
                              <span className="flex items-center gap-1">
                                <DocumentIcon className="w-4 h-4" />
                                {doc.filename}
                              </span>
                              <span>{(doc.fileSize / 1024).toFixed(1)} KB</span>
                              <span>{new Date(doc.createdAt).toLocaleDateString()}</span>
                            </div>
                          </div>

                          <button
                            onClick={() => handleRequestAccess(doc)}
                            className="px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 flex items-center gap-2"
                          >
                            <LockClosedIcon className="w-4 h-4" />
                            Request Access
                          </button>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}

            {/* Document Count */}
            {filteredDocuments.length > 0 && (
              <div className="mt-6 text-sm text-gray-500 text-center">
                Showing {filteredDocuments.length} of {documents.length} documents
              </div>
            )}

            {/* Security Notice */}
            <div className="mt-8 p-4 bg-yellow-50 border border-yellow-200 rounded-lg">
              <div className="flex items-start gap-3">
                <ShieldCheckIcon className="w-6 h-6 text-yellow-600 flex-shrink-0 mt-0.5" />
                <div>
                  <div className="font-bold text-yellow-800">Perfect Forward Secrecy</div>
                  <p className="text-sm text-yellow-700 mt-1">
                    Each document access generates a unique ephemeral key that is destroyed immediately after decryption.
                    This ensures that even if the server is compromised in the future, your past sessions remain secure.
                    All access is logged with watermarked copies for accountability.
                  </p>
                </div>
              </div>
            </div>
          </Box>
        </DBConnect>
      </div>

      {/* Document Access Modal */}
      {selectedDocument && userPrismDID && issuerDID && ed25519PrivateKey && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <DocumentAccess
            document={selectedDocument}
            requestorDID={userPrismDID}
            issuerDID={issuerDID}
            clearanceLevel={userClearanceLevel}
            ed25519PrivateKey={ed25519PrivateKey}
            apiBaseUrl={apiBaseUrl}
            onAccessComplete={handleAccessComplete}
            onClose={handleCloseAccess}
          />
        </div>
      )}

      {/* Access Modal (Missing Keys Warning) */}
      {selectedDocument && (!userPrismDID || !issuerDID || !ed25519PrivateKey) && (
        <div className="fixed inset-0 bg-black bg-opacity-50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-lg shadow-xl max-w-md w-full p-6">
            <div className="text-center">
              <div className="w-16 h-16 mx-auto mb-4 bg-yellow-100 rounded-full flex items-center justify-center">
                <ShieldCheckIcon className="w-10 h-10 text-yellow-600" />
              </div>
              <h3 className="text-xl font-bold text-gray-900 mb-2">Security Clearance Required</h3>
              <p className="text-gray-600 mb-4">
                To access classified documents, you need a valid Security Clearance credential
                with associated cryptographic keys.
              </p>
              <ul className="text-left text-sm text-gray-500 mb-6 space-y-2">
                {!userPrismDID && (
                  <li className="flex items-center gap-2">
                    <span className="text-red-500">*</span> PRISM DID not found
                  </li>
                )}
                {!issuerDID && (
                  <li className="flex items-center gap-2">
                    <span className="text-red-500">*</span> Issuer DID not found
                  </li>
                )}
                {!ed25519PrivateKey && (
                  <li className="flex items-center gap-2">
                    <span className="text-red-500">*</span> Ed25519 signing key not available
                  </li>
                )}
              </ul>
              <button
                onClick={handleCloseAccess}
                className="px-6 py-2 bg-gray-600 text-white rounded-lg hover:bg-gray-700"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
