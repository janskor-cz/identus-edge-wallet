import * as Domain from "../../domain";
import type * as Models from "../models";
import type { Pluto } from "../Pluto";
import { MapperRepository } from "./builders/MapperRepository";

export class DIDRepository extends MapperRepository<Models.DID, Domain.DID> {
  constructor(store: Pluto.Store) {
    super(store, "dids");
  }

  override async save(domain: Domain.DID, alias?: string) {
    try {
      const existing = await this.byUUID(domain.uuid);

      if (!existing) {
        const model = this.toModel(domain, alias);
        await this.insert(model);
      } else {
        // DID already exists - this is expected in certain flows (e.g., re-accepting invitations)
        console.log(`ℹ️ [DIDRepository] DID already exists, skipping insert: ${domain.uuid.substring(0, 50)}...`);
      }
    } catch (error: any) {
      // Gracefully handle RxDB CONFLICT errors (status 409) AND StoreInsertError (wrapper from BaseRepository)
      const isConflictError = error.status === 409 ||
                               error.code === 'CONFLICT' ||
                               error.message?.includes('CONFLICT') ||
                               error.constructor?.name === 'StoreInsertError';

      if (isConflictError) {
        // Verify DID actually exists in database
        const existing = await this.byUUID(domain.uuid);
        if (existing) {
          console.log(`✅ [DIDRepository] Conflict handled gracefully - DID exists: ${domain.uuid.substring(0, 50)}...`);
          return; // Idempotent operation - success
        } else {
          // Conflict but DID doesn't exist - unexpected, re-throw
          console.error(`❌ [DIDRepository] CONFLICT error but DID not found: ${domain.uuid.substring(0, 50)}...`);
          throw error;
        }
      }
      // Re-throw non-conflict errors
      throw error;
    }
  }

  toDomain(model: Models.DID): Domain.DID {
    const did = Domain.DID.from(model.uuid);
    return this.withId(did, model.uuid);
  }

  toModel(domain: Domain.DID, alias?: string): Models.DID {
    return {
      method: domain.method,
      schema: domain.schema,
      uuid: domain.uuid,
      alias
    };
  }
}
