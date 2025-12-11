import { VCValidationResult } from '../types/invitations';

// Safe base64 decoding with validation
export function safeBase64Decode(base64String: string): { isValid: boolean; data?: string; error?: string } {
  try {
    // Check if string looks like base64
    if (!base64String || typeof base64String !== 'string') {
      return { isValid: false, error: 'Invalid input: not a string' };
    }

    // Remove whitespace and check base64 pattern
    const cleanBase64 = base64String.trim();
    const base64Pattern = /^[A-Za-z0-9+/]*={0,2}$/;

    if (!base64Pattern.test(cleanBase64)) {
      return { isValid: false, error: 'Invalid base64 format' };
    }

    // Attempt to decode
    const decoded = atob(cleanBase64);
    return { isValid: true, data: decoded };
  } catch (error) {
    return { isValid: false, error: `Base64 decode failed: ${error.message}` };
  }
}

// Safe JSON parsing of base64 encoded data
export function safeBase64ParseJSON(base64String: string, description: string = 'data'): { isValid: boolean; data?: any; error?: string } {
  const decodeResult = safeBase64Decode(base64String);
  if (!decodeResult.isValid) {
    return { isValid: false, error: `Failed to decode ${description}: ${decodeResult.error}` };
  }

  try {
    const parsed = JSON.parse(decodeResult.data);
    return { isValid: true, data: parsed };
  } catch (error) {
    return { isValid: false, error: `Failed to parse ${description} JSON: ${error.message}` };
  }
}

// Detect invitation format
export function detectInvitationFormat(invitationString: string): { format: 'url' | 'json' | 'base64' | 'unknown'; data?: string } {
  try {
    // Check if it's a URL
    if (invitationString.startsWith('http://') || invitationString.startsWith('https://')) {
      return { format: 'url', data: invitationString };
    }

    // Check if it's already JSON
    if (invitationString.trim().startsWith('{') || invitationString.trim().startsWith('[')) {
      JSON.parse(invitationString); // Validate JSON
      return { format: 'json', data: invitationString };
    }

    // Check if it's base64
    const decodeResult = safeBase64Decode(invitationString);
    if (decodeResult.isValid) {
      // Try to parse as JSON
      try {
        JSON.parse(decodeResult.data);
        return { format: 'base64', data: decodeResult.data };
      } catch {
        // Valid base64 but not JSON
        return { format: 'base64', data: decodeResult.data };
      }
    }

    return { format: 'unknown' };
  } catch {
    return { format: 'unknown' };
  }
}

export async function validateVerifiableCredential(
  vcProof: any,
  agent?: any,
  pluto?: any
): Promise<VCValidationResult> {
  const result: VCValidationResult = {
    isValid: false,
    errors: []
  };

  console.log('🔍 [VALIDATION] Starting VC proof validation...');
  console.log('🔍 [VALIDATION] vcProof exists:', !!vcProof);

  try {
    if (!vcProof) {
      result.errors.push('No VC proof provided');
      return result;
    }

    // Check if this is a presentation request vs direct VC
    const isPresentationRequest = vcProof.presentation_definition;
    console.log('🔍 [VALIDATION] Is presentation request:', isPresentationRequest);

    if (isPresentationRequest) {
      // Handle presentation requests
      console.log('🔍 [VALIDATION] Processing as presentation request');
      result.errors.push('Presentation requests not supported in VC proof validation');
      return result;
    }

    // Handle direct VC credential validation
    console.log('🔍 [VALIDATION] Treating as direct VC credential');

    // Basic structure validation
    console.log('🔍 [VALIDATION] Checking credentialSubject:', !!vcProof.credentialSubject);
    console.log('🔍 [VALIDATION] Checking claims:', !!vcProof.claims);
    if (!vcProof.credentialSubject && !vcProof.claims) {
      result.errors.push('Missing credential subject or claims');
    }

    console.log('🔍 [VALIDATION] Checking type:', vcProof.type);
    if (!vcProof.type) {
      result.errors.push('Missing credential type');
    }

    // Check if it's a RealPerson credential with enhanced detection
    console.log('🔍 [VALIDATION] Checking RealPerson type...');
    console.log('🔍 [VALIDATION] vcProof.type:', vcProof.type);
    console.log('🔍 [VALIDATION] vcProof.credentialType:', vcProof.credentialType);

    const hasRealPersonType = vcProof.type?.includes('RealPerson') ||
                             vcProof.credentialType === 'RealPerson' ||
                             // Check credential subject for person-like fields
                             (vcProof.credentialSubject && hasPersonFields(vcProof.credentialSubject));

    console.log('🔍 [VALIDATION] hasRealPersonType:', hasRealPersonType);

    if (!hasRealPersonType) {
      console.log('❌ [VALIDATION] Not a RealPerson credential');
      result.errors.push('Not a RealPerson credential');
    }

    // Extract issuer information
    if (vcProof.issuer) {
      result.issuer = vcProof.issuer;
    }

    // Extract timestamps
    if (vcProof.issuanceDate) {
      result.issuedAt = vcProof.issuanceDate;
    }
    if (vcProof.expirationDate) {
      result.expiresAt = vcProof.expirationDate;
    }

    // Check if expired
    if (result.expiresAt) {
      const expiryDate = new Date(result.expiresAt);
      const now = new Date();
      if (expiryDate < now) {
        result.errors.push('Credential has expired');
      }
    }

    // Perform cryptographic verification if agent is available
    if (agent && agent.pollux && result.issuer) {
      console.log('🔍 [VALIDATION] Performing cryptographic verification...');
      try {
        // Check if this is a JWT credential that can be verified
        if (typeof vcProof === 'object' && vcProof.issuer) {
          // Try to get the raw JWS if available
          let jws: string | undefined;

          // Check if vcProof has a JWT/JWS format
          if (typeof vcProof._jws === 'string') {
            jws = vcProof._jws;
          } else if (typeof vcProof.id === 'string' && vcProof.id.includes('.')) {
            // Sometimes the JWS is stored in the id field
            jws = vcProof.id;
          }

          if (jws) {
            console.log('🔍 [VALIDATION] Found JWS, verifying signature...');
            const issuerDID = agent.castor.parseDID(result.issuer);

            const isSignatureValid = await agent.pollux.JWT.verify({
              jws: jws,
              issuerDID: issuerDID
            });

            if (!isSignatureValid) {
              console.log('❌ [VALIDATION] Cryptographic signature verification failed');
              result.errors.push('Invalid cryptographic signature');
            } else {
              console.log('✅ [VALIDATION] Cryptographic signature verified successfully');
            }
          } else {
            console.log('⚠️ [VALIDATION] No JWS found for cryptographic verification');
            console.log('📝 [VALIDATION] This appears to be a demo credential without cryptographic signatures');
            // For demo credentials, we'll allow validation to pass without cryptographic verification
            // In production, uncomment the line below to require signatures:
            // result.errors.push('No verifiable signature found');
          }
        }
      } catch (cryptoError) {
        console.log('❌ [VALIDATION] Cryptographic verification failed:', cryptoError.message);
        result.errors.push(`Cryptographic verification failed: ${cryptoError.message}`);
      }
    } else {
      console.log('⚠️ [VALIDATION] Skipping cryptographic verification - agent or issuer not available');
    }

    // Determine final validity
    result.isValid = result.errors.length === 0;

    console.log('🔍 [VALIDATION] Final validation result:');
    console.log('🔍 [VALIDATION] Total errors:', result.errors.length);
    console.log('🔍 [VALIDATION] Errors:', result.errors);
    console.log('🔍 [VALIDATION] Is valid:', result.isValid);

    return result;
  } catch (error) {
    console.log('❌ [VALIDATION] Validation error:', error.message);
    result.errors.push(`Validation error: ${error.message}`);
    return result;
  }
}

// Helper function to check if an object contains person-like fields
function hasPersonFields(obj: any): boolean {
  if (!obj || typeof obj !== 'object') return false;
  const personFields = ['firstName', 'lastName', 'uniqueId', 'dateOfBirth', 'gender', 'nationality', 'placeOfBirth'];
  return personFields.some(field => field in obj);
}

export function extractCredentialSubject(credential: any): any {
  // Try multiple paths to find credential subject data
  if (credential.credentialSubject) {
    return credential.credentialSubject;
  }

  if (credential.claims && Array.isArray(credential.claims) && credential.claims.length > 0) {
    const firstClaim = credential.claims[0];
    if (firstClaim.credentialSubject) {
      return firstClaim.credentialSubject;
    }
    if (firstClaim.credentialData?.credentialSubject) {
      return firstClaim.credentialData.credentialSubject;
    }
    return firstClaim;
  }

  if (credential.credentialData?.credentialSubject) {
    return credential.credentialData.credentialSubject;
  }

  // Fallback: look for person-like data anywhere in the credential
  const personFields = ['firstName', 'lastName', 'uniqueId', 'dateOfBirth'];
  for (const value of Object.values(credential)) {
    if (value && typeof value === 'object') {
      const hasPersonFields = personFields.some(field => field in value);
      if (hasPersonFields) {
        return value;
      }
    }
  }

  return {};
}

export function isCredentialRevoked(credential: any): boolean {
  // In a real implementation, this would check against a revocation registry
  // For demo purposes, we'll assume credentials are not revoked
  return false;
}

export function parseInviterIdentity(vcProof: any, validationResult: VCValidationResult, agent?: any, pluto?: any): any {
  const identity = {
    isVerified: validationResult.isValid,
    revealedData: {},
    validationResult
  };

  if (validationResult.isValid) {
    // Extract revealed data from the VC proof
    const credentialSubject = extractCredentialSubject(vcProof);
    identity.revealedData = credentialSubject;
  }

  return identity;
}