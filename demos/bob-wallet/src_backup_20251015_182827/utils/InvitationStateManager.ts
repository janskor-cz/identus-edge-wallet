import SDK from '@hyperledger/identus-edge-agent-sdk';
import { ConnectionRequestItem } from './connectionRequestQueue';

/**
 * Extended invitation record supporting both Alice (inviter) and Bob (invitee) sides
 */
export interface InvitationRecord {
  id: string;
  invitationId: string;
  status: InvitationStatus;
  createdAt: number;
  label: string;
  inviterDID?: string;  // Alice's DID (for Bob)
  inviteeDID?: string;  // Bob's DID (for Alice)
  invitationUrl?: string;
  pendingRequests: ConnectionRequestItem[];
  // Additional Bob-side metadata
  inviterLabel?: string;  // Alice's display name
  hasVCProof?: boolean;   // Whether invitation includes VC proof
  vcProofType?: string;   // Type of VC proof (RealPerson, SecurityClearance, etc.)
  previewedAt?: number;   // When Bob previewed the invitation
  acceptedAt?: number;    // When connection was established
  rejectedAt?: number;    // When invitation was rejected
}

/**
 * Unified invitation status supporting both inviter and invitee perspectives
 *
 * Alice (Inviter) Flow:
 * - InvitationGenerated → ConnectionRequested → Connected | Rejected
 *
 * Bob (Invitee) Flow:
 * - InvitationReceived → InvitationPreviewed → ConnectionRequestSent → ConnectionEstablished | InvitationRejected
 */
export type InvitationStatus =
  // Alice (Inviter) states
  | "InvitationGenerated"      // Alice created invitation, waiting for Bob
  | "ConnectionRequested"      // Bob sent connection request to Alice
  | "Connected"                // Alice accepted, connection established
  | "Rejected"                 // Alice rejected Bob's request
  // Bob (Invitee) states
  | "InvitationReceived"       // Bob received invitation (pasted URL)
  | "InvitationPreviewed"      // Bob viewed invitation details in preview modal
  | "ConnectionRequestSent"    // Bob accepted and sent connection request
  | "ConnectionEstablished"    // Connection fully established
  | "InvitationRejected";      // Bob rejected invitation

export interface InvitationStateConfig {
  walletId: string;
  dbName?: string;
}

/**
 * Enhanced Invitation State Manager
 *
 * Manages the complete lifecycle of DIDComm invitations from BOTH perspectives:
 * - Alice (Inviter): Creates invitations, receives requests, accepts/rejects
 * - Bob (Invitee): Receives invitations, previews them, sends requests, establishes connections
 *
 * This unified manager ensures proper state tracking on both sides of the connection flow.
 */
export class InvitationStateManager {
  private dbName: string;
  private dbVersion: number = 2;  // Incremented for new schema
  private db: IDBDatabase | null = null;
  private walletId: string;

  constructor(config: InvitationStateConfig) {
    this.walletId = config.walletId;
    this.dbName = config.dbName || `invitation_states_${config.walletId}`;
  }

  /**
   * Initialize the IndexedDB database for invitation state management
   */
  async initialize(): Promise<void> {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.dbVersion);

      request.onerror = () => {
        console.error('🔴 [INVITATION STATE] Failed to open IndexedDB:', request.error);
        reject(request.error);
      };

      request.onsuccess = () => {
        this.db = request.result;
        console.log('✅ [INVITATION STATE] IndexedDB initialized successfully');
        resolve();
      };

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        if (!db.objectStoreNames.contains('invitation_records')) {
          const store = db.createObjectStore('invitation_records', { keyPath: 'id' });
          store.createIndex('invitationId', 'invitationId', { unique: true });
          store.createIndex('status', 'status', { unique: false });
          store.createIndex('createdAt', 'createdAt', { unique: false });
          console.log('🏗️ [INVITATION STATE] Created invitation_records object store');
        }
      };
    });
  }

  /**
   * Create a new invitation record when Alice generates an invitation
   */
  async createInvitationRecord(
    invitationId: string,
    label: string,
    inviterDID: string,
    invitationUrl?: string
  ): Promise<string> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const recordId = `inv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    const invitationRecord: InvitationRecord = {
      id: recordId,
      invitationId,
      status: "InvitationGenerated",
      createdAt: now,
      label,
      inviterDID,
      invitationUrl,
      pendingRequests: []
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['invitation_records'], 'readwrite');
      const store = transaction.objectStore('invitation_records');

      const request = store.add(invitationRecord);

      request.onsuccess = () => {
        console.log(`✅ [INVITATION STATE] Created invitation record: ${recordId} with status: InvitationGenerated`);
        resolve(recordId);
      };

      request.onerror = () => {
        console.error('🔴 [INVITATION STATE] Failed to create invitation record:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Add a connection request to an existing invitation record
   */
  async addConnectionRequestToInvitation(
    invitationId: string,
    connectionRequest: ConnectionRequestItem
  ): Promise<boolean> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['invitation_records'], 'readwrite');
      const store = transaction.objectStore('invitation_records');
      const index = store.index('invitationId');

      const getRequest = index.get(invitationId);

      getRequest.onsuccess = () => {
        const record = getRequest.result;
        if (!record) {
          console.warn(`⚠️ [INVITATION STATE] No invitation record found for ID: ${invitationId}`);
          resolve(false);
          return;
        }

        // Update record status and add the connection request
        record.status = "ConnectionRequested";
        record.pendingRequests.push(connectionRequest);

        const putRequest = store.put(record);

        putRequest.onsuccess = () => {
          console.log(`✅ [INVITATION STATE] Added connection request to invitation ${invitationId}, status now: ConnectionRequested`);
          resolve(true);
        };

        putRequest.onerror = () => {
          console.error('🔴 [INVITATION STATE] Failed to update invitation record:', putRequest.error);
          reject(putRequest.error);
        };
      };

      getRequest.onerror = () => {
        console.error('🔴 [INVITATION STATE] Failed to find invitation record:', getRequest.error);
        reject(getRequest.error);
      };
    });
  }

  /**
   * Mark invitation as connected (when connection request is accepted)
   */
  async markInvitationConnected(
    invitationId: string,
    requestId: string
  ): Promise<boolean> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['invitation_records'], 'readwrite');
      const store = transaction.objectStore('invitation_records');
      const index = store.index('invitationId');

      const getRequest = index.get(invitationId);

      getRequest.onsuccess = () => {
        const record = getRequest.result;
        if (!record) {
          console.warn(`⚠️ [INVITATION STATE] No invitation record found for ID: ${invitationId}`);
          resolve(false);
          return;
        }

        // Update status and mark the specific request as accepted
        record.status = "Connected";
        record.pendingRequests = record.pendingRequests.map(req =>
          req.id === requestId ? { ...req, status: 'accepted' } : req
        );

        const putRequest = store.put(record);

        putRequest.onsuccess = () => {
          console.log(`✅ [INVITATION STATE] Marked invitation ${invitationId} as Connected`);
          resolve(true);
        };

        putRequest.onerror = () => {
          console.error('🔴 [INVITATION STATE] Failed to mark invitation as connected:', putRequest.error);
          reject(putRequest.error);
        };
      };

      getRequest.onerror = () => {
        console.error('🔴 [INVITATION STATE] Failed to find invitation record:', getRequest.error);
        reject(getRequest.error);
      };
    });
  }

  /**
   * Mark invitation as rejected (when connection request is rejected)
   */
  async markInvitationRejected(
    invitationId: string,
    requestId: string
  ): Promise<boolean> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['invitation_records'], 'readwrite');
      const store = transaction.objectStore('invitation_records');
      const index = store.index('invitationId');

      const getRequest = index.get(invitationId);

      getRequest.onsuccess = () => {
        const record = getRequest.result;
        if (!record) {
          console.warn(`⚠️ [INVITATION STATE] No invitation record found for ID: ${invitationId}`);
          resolve(false);
          return;
        }

        // Update status and mark the specific request as rejected
        record.status = "Rejected";
        record.pendingRequests = record.pendingRequests.map(req =>
          req.id === requestId ? { ...req, status: 'rejected' } : req
        );

        const putRequest = store.put(record);

        putRequest.onsuccess = () => {
          console.log(`✅ [INVITATION STATE] Marked invitation ${invitationId} as Rejected`);
          resolve(true);
        };

        putRequest.onerror = () => {
          console.error('🔴 [INVITATION STATE] Failed to mark invitation as rejected:', putRequest.error);
          reject(putRequest.error);
        };
      };

      getRequest.onerror = () => {
        console.error('🔴 [INVITATION STATE] Failed to find invitation record:', getRequest.error);
        reject(getRequest.error);
      };
    });
  }

  // ============================================================
  // BOB (INVITEE) METHODS
  // ============================================================

  /**
   * Create invitation record when Bob receives an invitation (pastes URL)
   */
  async createReceivedInvitationRecord(
    invitationId: string,
    inviterDID: string,
    inviterLabel: string,
    invitationUrl: string,
    hasVCProof: boolean = false,
    vcProofType?: string
  ): Promise<string> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    const recordId = `rcv_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    const now = Date.now();

    const invitationRecord: InvitationRecord = {
      id: recordId,
      invitationId,
      status: "InvitationReceived",
      createdAt: now,
      label: `Invitation from ${inviterLabel}`,
      inviterDID,
      inviterLabel,
      invitationUrl,
      hasVCProof,
      vcProofType,
      pendingRequests: []
    };

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['invitation_records'], 'readwrite');
      const store = transaction.objectStore('invitation_records');

      const request = store.add(invitationRecord);

      request.onsuccess = () => {
        console.log(`✅ [INVITATION STATE] Created received invitation record: ${recordId} with status: InvitationReceived`);
        resolve(recordId);
      };

      request.onerror = () => {
        console.error('🔴 [INVITATION STATE] Failed to create received invitation record:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Mark invitation as previewed when Bob views it in preview modal
   */
  async markInvitationPreviewed(invitationId: string): Promise<boolean> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['invitation_records'], 'readwrite');
      const store = transaction.objectStore('invitation_records');
      const index = store.index('invitationId');

      const getRequest = index.get(invitationId);

      getRequest.onsuccess = () => {
        const record = getRequest.result;
        if (!record) {
          console.warn(`⚠️ [INVITATION STATE] No invitation record found for ID: ${invitationId}`);
          resolve(false);
          return;
        }

        // Only update if currently in InvitationReceived state
        if (record.status === "InvitationReceived") {
          record.status = "InvitationPreviewed";
          record.previewedAt = Date.now();

          const putRequest = store.put(record);

          putRequest.onsuccess = () => {
            console.log(`✅ [INVITATION STATE] Marked invitation ${invitationId} as Previewed`);
            resolve(true);
          };

          putRequest.onerror = () => {
            console.error('🔴 [INVITATION STATE] Failed to mark invitation as previewed:', putRequest.error);
            reject(putRequest.error);
          };
        } else {
          console.log(`ℹ️ [INVITATION STATE] Invitation ${invitationId} already in state: ${record.status}, skipping preview update`);
          resolve(true);
        }
      };

      getRequest.onerror = () => {
        console.error('🔴 [INVITATION STATE] Failed to find invitation record:', getRequest.error);
        reject(getRequest.error);
      };
    });
  }

  /**
   * Mark invitation as connection request sent when Bob accepts invitation
   */
  async markConnectionRequestSent(
    invitationId: string,
    inviteeDID: string
  ): Promise<boolean> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['invitation_records'], 'readwrite');
      const store = transaction.objectStore('invitation_records');
      const index = store.index('invitationId');

      const getRequest = index.get(invitationId);

      getRequest.onsuccess = () => {
        const record = getRequest.result;
        if (!record) {
          console.warn(`⚠️ [INVITATION STATE] No invitation record found for ID: ${invitationId}`);
          resolve(false);
          return;
        }

        record.status = "ConnectionRequestSent";
        record.inviteeDID = inviteeDID;

        const putRequest = store.put(record);

        putRequest.onsuccess = () => {
          console.log(`✅ [INVITATION STATE] Marked invitation ${invitationId} as ConnectionRequestSent`);
          resolve(true);
        };

        putRequest.onerror = () => {
          console.error('🔴 [INVITATION STATE] Failed to mark connection request as sent:', putRequest.error);
          reject(putRequest.error);
        };
      };

      getRequest.onerror = () => {
        console.error('🔴 [INVITATION STATE] Failed to find invitation record:', getRequest.error);
        reject(getRequest.error);
      };
    });
  }

  /**
   * Mark connection as established (Bob's final state)
   */
  async markConnectionEstablished(invitationId: string): Promise<boolean> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['invitation_records'], 'readwrite');
      const store = transaction.objectStore('invitation_records');
      const index = store.index('invitationId');

      const getRequest = index.get(invitationId);

      getRequest.onsuccess = () => {
        const record = getRequest.result;
        if (!record) {
          console.warn(`⚠️ [INVITATION STATE] No invitation record found for ID: ${invitationId}`);
          resolve(false);
          return;
        }

        record.status = "ConnectionEstablished";
        record.acceptedAt = Date.now();

        const putRequest = store.put(record);

        putRequest.onsuccess = () => {
          console.log(`✅ [INVITATION STATE] Marked invitation ${invitationId} as ConnectionEstablished`);
          resolve(true);
        };

        putRequest.onerror = () => {
          console.error('🔴 [INVITATION STATE] Failed to mark connection as established:', putRequest.error);
          reject(putRequest.error);
        };
      };

      getRequest.onerror = () => {
        console.error('🔴 [INVITATION STATE] Failed to find invitation record:', getRequest.error);
        reject(getRequest.error);
      };
    });
  }

  /**
   * Mark invitation as rejected when Bob declines
   */
  async markInvitationRejectedByInvitee(invitationId: string): Promise<boolean> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['invitation_records'], 'readwrite');
      const store = transaction.objectStore('invitation_records');
      const index = store.index('invitationId');

      const getRequest = index.get(invitationId);

      getRequest.onsuccess = () => {
        const record = getRequest.result;
        if (!record) {
          console.warn(`⚠️ [INVITATION STATE] No invitation record found for ID: ${invitationId}`);
          resolve(false);
          return;
        }

        record.status = "InvitationRejected";
        record.rejectedAt = Date.now();

        const putRequest = store.put(record);

        putRequest.onsuccess = () => {
          console.log(`✅ [INVITATION STATE] Marked invitation ${invitationId} as InvitationRejected`);
          resolve(true);
        };

        putRequest.onerror = () => {
          console.error('🔴 [INVITATION STATE] Failed to mark invitation as rejected:', putRequest.error);
          reject(putRequest.error);
        };
      };

      getRequest.onerror = () => {
        console.error('🔴 [INVITATION STATE] Failed to find invitation record:', getRequest.error);
        reject(getRequest.error);
      };
    });
  }

  // ============================================================
  // COMMON QUERY METHODS
  // ============================================================

  /**
   * Get all invitation records with their current status
   */
  async getAllInvitationRecords(): Promise<InvitationRecord[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['invitation_records'], 'readonly');
      const store = transaction.objectStore('invitation_records');

      const request = store.getAll();

      request.onsuccess = () => {
        const records = request.result || [];
        console.log(`📋 [INVITATION STATE] Retrieved ${records.length} invitation records`);
        resolve(records);
      };

      request.onerror = () => {
        console.error('🔴 [INVITATION STATE] Failed to get invitation records:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Get invitation records by status
   */
  async getInvitationRecordsByStatus(status: InvitationRecord['status']): Promise<InvitationRecord[]> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['invitation_records'], 'readonly');
      const store = transaction.objectStore('invitation_records');
      const index = store.index('status');

      const request = index.getAll(status);

      request.onsuccess = () => {
        const records = request.result || [];
        console.log(`📋 [INVITATION STATE] Retrieved ${records.length} invitation records with status: ${status}`);
        resolve(records);
      };

      request.onerror = () => {
        console.error('🔴 [INVITATION STATE] Failed to get invitation records by status:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Find invitation record by invitation ID
   */
  async findByInvitationId(invitationId: string): Promise<InvitationRecord | null> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['invitation_records'], 'readonly');
      const store = transaction.objectStore('invitation_records');
      const index = store.index('invitationId');

      const request = index.get(invitationId);

      request.onsuccess = () => {
        const record = request.result || null;
        resolve(record);
      };

      request.onerror = () => {
        console.error('🔴 [INVITATION STATE] Failed to find invitation record:', request.error);
        reject(request.error);
      };
    });
  }

  /**
   * Get invitation statistics for debugging
   */
  async getInvitationStats(): Promise<{
    total: number;
    // Alice (inviter) states
    generated: number;
    connectionRequested: number;
    connected: number;
    rejected: number;
    // Bob (invitee) states
    received: number;
    previewed: number;
    requestSent: number;
    established: number;
    invitationRejected: number;
  }> {
    const allRecords = await this.getAllInvitationRecords();

    return {
      total: allRecords.length,
      // Alice states
      generated: allRecords.filter(r => r.status === 'InvitationGenerated').length,
      connectionRequested: allRecords.filter(r => r.status === 'ConnectionRequested').length,
      connected: allRecords.filter(r => r.status === 'Connected').length,
      rejected: allRecords.filter(r => r.status === 'Rejected').length,
      // Bob states
      received: allRecords.filter(r => r.status === 'InvitationReceived').length,
      previewed: allRecords.filter(r => r.status === 'InvitationPreviewed').length,
      requestSent: allRecords.filter(r => r.status === 'ConnectionRequestSent').length,
      established: allRecords.filter(r => r.status === 'ConnectionEstablished').length,
      invitationRejected: allRecords.filter(r => r.status === 'InvitationRejected').length,
    };
  }

  /**
   * Clear all invitation records (for testing/reset purposes)
   */
  async clearAllInvitationRecords(): Promise<void> {
    if (!this.db) {
      throw new Error('Database not initialized');
    }

    return new Promise((resolve, reject) => {
      const transaction = this.db!.transaction(['invitation_records'], 'readwrite');
      const store = transaction.objectStore('invitation_records');

      const request = store.clear();

      request.onsuccess = () => {
        console.log('🧹 [INVITATION STATE] Cleared all invitation records');
        resolve();
      };

      request.onerror = () => {
        console.error('🔴 [INVITATION STATE] Failed to clear invitation records:', request.error);
        reject(request.error);
      };
    });
  }
}

/**
 * Singleton instance manager for invitation state
 */
class InvitationStateManagerSingleton {
  private static instances: Map<string, InvitationStateManager> = new Map();

  static async getInstance(walletId: string): Promise<InvitationStateManager> {
    if (!this.instances.has(walletId)) {
      const manager = new InvitationStateManager({ walletId });
      await manager.initialize();
      this.instances.set(walletId, manager);
    }
    return this.instances.get(walletId)!;
  }

  static clearInstances(): void {
    this.instances.clear();
  }
}

export { InvitationStateManagerSingleton };

/**
 * Utility functions for managing invitation state
 */
export const invitationStateManager = {
  /**
   * Create new invitation record when Alice creates an invitation
   */
  async createInvitation(
    walletId: string,
    invitationId: string,
    label: string,
    inviterDID: string,
    invitationUrl?: string
  ): Promise<string> {
    const manager = await InvitationStateManagerSingleton.getInstance(walletId);
    return manager.createInvitationRecord(invitationId, label, inviterDID, invitationUrl);
  },

  /**
   * Add connection request to invitation when Bob connects
   */
  async addConnectionRequest(
    walletId: string,
    invitationId: string,
    connectionRequest: ConnectionRequestItem
  ): Promise<boolean> {
    const manager = await InvitationStateManagerSingleton.getInstance(walletId);
    return manager.addConnectionRequestToInvitation(invitationId, connectionRequest);
  },

  /**
   * Mark invitation as connected when Alice accepts the request
   */
  async acceptConnection(
    walletId: string,
    invitationId: string,
    requestId: string
  ): Promise<boolean> {
    const manager = await InvitationStateManagerSingleton.getInstance(walletId);
    return manager.markInvitationConnected(invitationId, requestId);
  },

  /**
   * Mark invitation as rejected when Alice rejects the request
   */
  async rejectConnection(
    walletId: string,
    invitationId: string,
    requestId: string
  ): Promise<boolean> {
    const manager = await InvitationStateManagerSingleton.getInstance(walletId);
    return manager.markInvitationRejected(invitationId, requestId);
  },

  /**
   * Get all invitation records for display
   */
  async getAllInvitations(walletId: string): Promise<InvitationRecord[]> {
    const manager = await InvitationStateManagerSingleton.getInstance(walletId);
    return manager.getAllInvitationRecords();
  },

  /**
   * Find invitation by ID for correlation
   */
  async findInvitation(walletId: string, invitationId: string): Promise<InvitationRecord | null> {
    const manager = await InvitationStateManagerSingleton.getInstance(walletId);
    return manager.findByInvitationId(invitationId);
  },

  /**
   * Get invitation statistics for debugging
   */
  async getStats(walletId: string): Promise<any> {
    const manager = await InvitationStateManagerSingleton.getInstance(walletId);
    return manager.getInvitationStats();
  },

  // ============================================================
  // BOB (INVITEE) UTILITY METHODS
  // ============================================================

  /**
   * Create received invitation record when Bob pastes invitation URL
   */
  async createReceivedInvitation(
    walletId: string,
    invitationId: string,
    inviterDID: string,
    inviterLabel: string,
    invitationUrl: string,
    hasVCProof: boolean = false,
    vcProofType?: string
  ): Promise<string> {
    const manager = await InvitationStateManagerSingleton.getInstance(walletId);
    return manager.createReceivedInvitationRecord(
      invitationId,
      inviterDID,
      inviterLabel,
      invitationUrl,
      hasVCProof,
      vcProofType
    );
  },

  /**
   * Mark invitation as previewed when Bob views preview modal
   */
  async markPreviewed(walletId: string, invitationId: string): Promise<boolean> {
    const manager = await InvitationStateManagerSingleton.getInstance(walletId);
    return manager.markInvitationPreviewed(invitationId);
  },

  /**
   * Mark connection request as sent when Bob accepts invitation
   */
  async markRequestSent(
    walletId: string,
    invitationId: string,
    inviteeDID: string
  ): Promise<boolean> {
    const manager = await InvitationStateManagerSingleton.getInstance(walletId);
    return manager.markConnectionRequestSent(invitationId, inviteeDID);
  },

  /**
   * Mark connection as established (Bob's final state)
   */
  async markEstablished(walletId: string, invitationId: string): Promise<boolean> {
    const manager = await InvitationStateManagerSingleton.getInstance(walletId);
    return manager.markConnectionEstablished(invitationId);
  },

  /**
   * Mark invitation as rejected when Bob declines
   */
  async markRejectedByInvitee(walletId: string, invitationId: string): Promise<boolean> {
    const manager = await InvitationStateManagerSingleton.getInstance(walletId);
    return manager.markInvitationRejectedByInvitee(invitationId);
  }
};