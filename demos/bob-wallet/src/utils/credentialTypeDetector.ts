/**
 * Credential Type Detection and Classification Utility
 *
 * Provides reliable credential type detection, clearance level color mapping,
 * and expiration checking for enhanced credential display.
 *
 * Created: November 2, 2025
 * Purpose: Support grouped credential display with type-specific layouts
 */

export type CredentialType = 'RealPersonIdentity' | 'SecurityClearance' | 'Unknown';
export type ClearanceLevel = 'INTERNAL' | 'CONFIDENTIAL' | 'RESTRICTED' | 'TOP-SECRET';
export type ClearanceColor = 'green' | 'blue' | 'orange' | 'red' | 'gray';

/**
 * Detect credential type from credential object
 *
 * Checks multiple locations for credentialType field:
 * 1. credential.credentialSubject.credentialType
 * 2. credential.claims[0].credentialType (if claims array exists)
 * 3. credential.vc.credentialSubject.credentialType (JWT format)
 *
 * @param credential - Credential object to analyze
 * @returns Detected credential type or 'Unknown'
 */
export function getCredentialType(credential: any): CredentialType {
  if (!credential) {
    return 'Unknown';
  }

  // Check credentialSubject.credentialType (standard location)
  const subjectType = credential.credentialSubject?.credentialType;
  if (subjectType === 'RealPersonIdentity') return 'RealPersonIdentity';
  if (subjectType === 'SecurityClearance') return 'SecurityClearance';

  // Check claims[0].credentialType (alternative location)
  const claimsType = credential.claims?.[0]?.credentialType;
  if (claimsType === 'RealPersonIdentity') return 'RealPersonIdentity';
  if (claimsType === 'SecurityClearance') return 'SecurityClearance';

  // Check vc.credentialSubject.credentialType (JWT format)
  const vcType = credential.vc?.credentialSubject?.credentialType;
  if (vcType === 'RealPersonIdentity') return 'RealPersonIdentity';
  if (vcType === 'SecurityClearance') return 'SecurityClearance';

  console.warn('[credentialTypeDetector] Could not determine credential type:', credential);
  return 'Unknown';
}

/**
 * Get Tailwind color class for clearance level badge
 *
 * Color mapping:
 * - INTERNAL: Green (bg-green-500, text-green-800, border-green-600)
 * - CONFIDENTIAL: Blue (bg-blue-500, text-blue-800, border-blue-600)
 * - RESTRICTED: Orange (bg-orange-500, text-orange-800, border-orange-600)
 * - TOP-SECRET: Red (bg-red-500, text-red-800, border-red-600)
 *
 * @param level - Clearance level string (case-insensitive)
 * @returns Tailwind color name
 */
export function getClearanceLevelColor(level: string | undefined): ClearanceColor {
  if (!level) return 'gray';

  const normalizedLevel = level.toUpperCase().trim();

  switch (normalizedLevel) {
    case 'INTERNAL':
      return 'green';
    case 'CONFIDENTIAL':
      return 'blue';
    case 'RESTRICTED':
      return 'orange';
    case 'TOP-SECRET':
    case 'TOP SECRET':
    case 'TOPSECRET':
      return 'red';
    default:
      console.warn('[credentialTypeDetector] Unknown clearance level:', level);
      return 'gray';
  }
}

/**
 * Get full Tailwind CSS classes for clearance level badge
 *
 * @param level - Clearance level string
 * @returns Object with className strings for different badge elements
 */
export function getClearanceBadgeClasses(level: string | undefined) {
  const color = getClearanceLevelColor(level);

  const colorMap = {
    green: {
      background: 'bg-green-100',
      text: 'text-green-800',
      border: 'border-green-600',
      badgeBg: 'bg-green-500'
    },
    blue: {
      background: 'bg-blue-100',
      text: 'text-blue-800',
      border: 'border-blue-600',
      badgeBg: 'bg-blue-500'
    },
    orange: {
      background: 'bg-orange-100',
      text: 'text-orange-800',
      border: 'border-orange-600',
      badgeBg: 'bg-orange-500'
    },
    red: {
      background: 'bg-red-100',
      text: 'text-red-800',
      border: 'border-red-600',
      badgeBg: 'bg-red-500'
    },
    gray: {
      background: 'bg-gray-100',
      text: 'text-gray-800',
      border: 'border-gray-600',
      badgeBg: 'bg-gray-500'
    }
  };

  return colorMap[color];
}

/**
 * Check if credential is expired based on expiryDate field
 *
 * Checks multiple locations for expiryDate:
 * 1. credential.credentialSubject.expiryDate
 * 2. credential.claims[0].expiryDate
 * 3. credential.vc.credentialSubject.expiryDate
 * 4. credential.expirationDate (W3C standard field name)
 *
 * @param credential - Credential object to check
 * @returns True if credential is expired, false otherwise
 */
export function isCredentialExpired(credential: any): boolean {
  if (!credential) {
    return false;
  }

  // Try multiple locations for expiry date
  const expiryDate =
    credential.credentialSubject?.expiryDate ||
    credential.claims?.[0]?.expiryDate ||
    credential.vc?.credentialSubject?.expiryDate ||
    credential.expirationDate;

  if (!expiryDate) {
    // No expiry date = never expires
    return false;
  }

  try {
    const expiryTimestamp = new Date(expiryDate).getTime();
    const nowTimestamp = Date.now();
    return nowTimestamp > expiryTimestamp;
  } catch (error) {
    console.warn('[credentialTypeDetector] Invalid expiry date format:', expiryDate);
    return false;
  }
}

/**
 * Get credential holder name from credential
 *
 * Checks multiple locations:
 * - RealPersonIdentity: firstName + lastName
 * - SecurityClearance: holderName
 * - Fallback: "Unknown"
 *
 * @param credential - Credential object
 * @returns Full name of credential holder
 */
export function getCredentialHolderName(credential: any): string {
  if (!credential) {
    return 'Unknown';
  }

  const subject = credential.credentialSubject || credential.claims?.[0] || credential.vc?.credentialSubject;

  if (!subject) {
    return 'Unknown';
  }

  // RealPersonIdentity: firstName + lastName
  if (subject.firstName && subject.lastName) {
    return `${subject.firstName} ${subject.lastName}`;
  }

  // SecurityClearance: holderName
  if (subject.holderName) {
    return subject.holderName;
  }

  // Fallback
  return 'Unknown';
}

/**
 * Sort credentials alphabetically by holder name
 *
 * @param credentials - Array of credential objects
 * @returns Sorted array (A-Z by name)
 */
export function sortCredentialsAlphabetically(credentials: any[]): any[] {
  return [...credentials].sort((a, b) => {
    const nameA = getCredentialHolderName(a).toLowerCase();
    const nameB = getCredentialHolderName(b).toLowerCase();
    return nameA.localeCompare(nameB);
  });
}
