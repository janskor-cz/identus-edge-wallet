/**
 * VC Proof Parser Utility
 *
 * Provides comprehensive parsing and extraction of Verifiable Credential data
 * from various VC formats and structures.
 *
 * Key Features:
 * - Non-blocking parsing (never throws errors)
 * - Support for multiple VC formats (JWT, JSON-LD, SD-JWT)
 * - Selective disclosure detection
 * - Credential subject extraction
 * - Metadata extraction (issuer, dates, type)
 * - Human-readable field mapping
 */

export interface ParsedVCProof {
  // Core VC properties
  type: string[];
  issuer: string | null;
  subject: string | null;

  // Temporal properties
  issuedAt: string | null;
  expiresAt: string | null;

  // Credential data
  revealedData: Record<string, any>;

  // Metadata
  format: 'JWT' | 'JSON-LD' | 'SD-JWT' | 'Unknown';
  hasSelectiveDisclosure: boolean;

  // Raw data for technical inspection
  rawVC: any;
}

/**
 * Parse a VC proof object and extract all relevant information
 * @param vcProof Raw VC proof object from invitation attachment
 * @returns Parsed VC data structure
 */
export function parseVCProof(vcProof: any): ParsedVCProof {
  console.log('🔍 [vcProofParser] Parsing VC proof:', vcProof);

  // Initialize default result
  const result: ParsedVCProof = {
    type: [],
    issuer: null,
    subject: null,
    issuedAt: null,
    expiresAt: null,
    revealedData: {},
    format: 'Unknown',
    hasSelectiveDisclosure: false,
    rawVC: vcProof
  };

  try {
    // Determine VC format
    result.format = detectVCFormat(vcProof);
    console.log(`📋 [vcProofParser] Detected format: ${result.format}`);

    // Extract type information
    result.type = extractVCType(vcProof);

    // Extract issuer DID
    result.issuer = extractIssuer(vcProof);

    // Extract subject DID
    result.subject = extractSubject(vcProof);

    // Extract temporal information
    const dates = extractDates(vcProof);
    result.issuedAt = dates.issuedAt;
    result.expiresAt = dates.expiresAt;

    // Extract credential data
    result.revealedData = extractCredentialSubject(vcProof);

    // Check for selective disclosure
    result.hasSelectiveDisclosure = detectSelectiveDisclosure(vcProof);

    console.log('✅ [vcProofParser] Successfully parsed VC proof');
    return result;

  } catch (error) {
    console.error('❌ [vcProofParser] Error parsing VC proof:', error);
    // Return partial result rather than throwing
    return result;
  }
}

/**
 * Detect the format of a VC proof
 */
function detectVCFormat(vcProof: any): 'JWT' | 'JSON-LD' | 'SD-JWT' | 'Unknown' {
  // Check for JWT format (string with three parts separated by dots)
  if (typeof vcProof === 'string' && vcProof.split('.').length === 3) {
    // Check for SD-JWT (has tilde-separated disclosures)
    if (vcProof.includes('~')) {
      return 'SD-JWT';
    }
    return 'JWT';
  }

  // Check for JSON-LD format (object with @context)
  if (typeof vcProof === 'object' && vcProof['@context']) {
    return 'JSON-LD';
  }

  // Check if it's a wrapped JWT
  if (vcProof?.presentation || vcProof?.verifiablePresentation) {
    const wrapped = vcProof.presentation || vcProof.verifiablePresentation;
    if (typeof wrapped === 'string' && wrapped.split('.').length === 3) {
      return 'JWT';
    }
  }

  return 'Unknown';
}

/**
 * Extract VC type(s) from proof
 */
function extractVCType(vcProof: any): string[] {
  // Direct type property
  if (Array.isArray(vcProof.type)) {
    return vcProof.type;
  }
  if (typeof vcProof.type === 'string') {
    return [vcProof.type];
  }

  // Check credential subject for type hints
  if (vcProof.credentialSubject?.type) {
    if (Array.isArray(vcProof.credentialSubject.type)) {
      return vcProof.credentialSubject.type;
    }
    if (typeof vcProof.credentialSubject.type === 'string') {
      return [vcProof.credentialSubject.type];
    }
  }

  // Check for JWT payload
  if (typeof vcProof === 'string' && vcProof.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(vcProof.split('.')[1]));
      if (payload.vc?.type) {
        return Array.isArray(payload.vc.type) ? payload.vc.type : [payload.vc.type];
      }
    } catch (e) {
      // Ignore JWT parsing errors
    }
  }

  return ['VerifiableCredential']; // Default type
}

/**
 * Extract issuer DID from VC proof
 */
function extractIssuer(vcProof: any): string | null {
  // Direct issuer property
  if (typeof vcProof.issuer === 'string') {
    return vcProof.issuer;
  }
  if (vcProof.issuer?.id) {
    return vcProof.issuer.id;
  }

  // Check for JWT payload
  if (typeof vcProof === 'string' && vcProof.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(vcProof.split('.')[1]));
      if (payload.iss) return payload.iss;
      if (payload.vc?.issuer) {
        return typeof payload.vc.issuer === 'string'
          ? payload.vc.issuer
          : payload.vc.issuer.id;
      }
    } catch (e) {
      // Ignore JWT parsing errors
    }
  }

  return null;
}

/**
 * Extract subject DID from VC proof
 */
function extractSubject(vcProof: any): string | null {
  // Check credentialSubject
  if (vcProof.credentialSubject?.id) {
    return vcProof.credentialSubject.id;
  }

  // Check for JWT payload
  if (typeof vcProof === 'string' && vcProof.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(vcProof.split('.')[1]));
      if (payload.sub) return payload.sub;
      if (payload.vc?.credentialSubject?.id) {
        return payload.vc.credentialSubject.id;
      }
    } catch (e) {
      // Ignore JWT parsing errors
    }
  }

  return null;
}

/**
 * Extract issuance and expiration dates
 */
function extractDates(vcProof: any): { issuedAt: string | null; expiresAt: string | null } {
  const result = { issuedAt: null as string | null, expiresAt: null as string | null };

  // Check direct properties
  if (vcProof.issuanceDate) result.issuedAt = vcProof.issuanceDate;
  if (vcProof.expirationDate) result.expiresAt = vcProof.expirationDate;

  // Check for JWT payload
  if (typeof vcProof === 'string' && vcProof.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(vcProof.split('.')[1]));

      // JWT standard claims
      if (payload.iat) {
        result.issuedAt = new Date(payload.iat * 1000).toISOString();
      }
      if (payload.exp) {
        result.expiresAt = new Date(payload.exp * 1000).toISOString();
      }

      // VC-specific claims
      if (payload.vc?.issuanceDate) result.issuedAt = payload.vc.issuanceDate;
      if (payload.vc?.expirationDate) result.expiresAt = payload.vc.expirationDate;
    } catch (e) {
      // Ignore JWT parsing errors
    }
  }

  return result;
}

/**
 * Extract credential subject data (revealed claims)
 */
function extractCredentialSubject(vcProof: any): Record<string, any> {
  let credentialSubject: any = null;

  // Direct credentialSubject property
  if (vcProof.credentialSubject) {
    credentialSubject = vcProof.credentialSubject;
  }

  // Check for JWT payload
  if (!credentialSubject && typeof vcProof === 'string' && vcProof.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(vcProof.split('.')[1]));
      if (payload.vc?.credentialSubject) {
        credentialSubject = payload.vc.credentialSubject;
      }
    } catch (e) {
      // Ignore JWT parsing errors
    }
  }

  if (!credentialSubject) {
    return {};
  }

  // Extract revealed data (exclude metadata fields)
  const revealedData: Record<string, any> = {};
  const excludeFields = ['id', 'type', '@context'];

  for (const [key, value] of Object.entries(credentialSubject)) {
    if (!excludeFields.includes(key) && value !== null && value !== undefined) {
      revealedData[key] = value;
    }
  }

  return revealedData;
}

/**
 * Detect if VC uses selective disclosure
 */
function detectSelectiveDisclosure(vcProof: any): boolean {
  // SD-JWT format detection
  if (typeof vcProof === 'string' && vcProof.includes('~')) {
    return true;
  }

  // Check for SD-JWT claims in JWT payload
  if (typeof vcProof === 'string' && vcProof.split('.').length === 3) {
    try {
      const payload = JSON.parse(atob(vcProof.split('.')[1]));
      if (payload._sd || payload._sd_alg) {
        return true;
      }
    } catch (e) {
      // Ignore JWT parsing errors
    }
  }

  // Check for BBS+ signatures (JSON-LD with proof type)
  if (vcProof.proof?.type === 'BbsBlsSignature2020') {
    return true;
  }

  return false;
}

/**
 * Parse JWT VC and return payload
 * @param jwtVC JWT-formatted VC string
 * @returns Decoded payload or null if parsing fails
 */
export function parseJWTVC(jwtVC: string): any | null {
  try {
    const parts = jwtVC.split('.');
    if (parts.length !== 3) {
      return null;
    }
    const payload = JSON.parse(atob(parts[1]));
    return payload;
  } catch (error) {
    console.error('Failed to parse JWT VC:', error);
    return null;
  }
}

/**
 * Extract human-readable summary from parsed VC
 */
export function getVCSummary(parsedVC: ParsedVCProof): string {
  const typeStr = parsedVC.type.filter(t => t !== 'VerifiableCredential').join(', ') || 'Credential';
  const dataCount = Object.keys(parsedVC.revealedData).length;
  const sdNote = parsedVC.hasSelectiveDisclosure ? ' (Selective Disclosure)' : '';

  return `${typeStr}${sdNote} with ${dataCount} field${dataCount !== 1 ? 's' : ''}`;
}
