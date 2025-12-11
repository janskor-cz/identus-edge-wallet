/**
 * Security Clearance Level Management
 *
 * Defines the security classification hierarchy and access control logic
 * for encrypted DIDComm messaging.
 */

/**
 * Security classification levels (hierarchical)
 * Higher numeric values indicate higher clearance requirements
 *
 * Matches CA clearance levels exactly:
 * - UNCLASSIFIED: No credential required
 * - INTERNAL: Requires "internal" clearance credential
 * - CONFIDENTIAL: Requires "confidential" clearance credential
 * - RESTRICTED: Requires "restricted" clearance credential
 * - TOP_SECRET: Requires "top-secret" clearance credential
 */
export enum SecurityLevel {
  UNCLASSIFIED = 0,
  INTERNAL = 1,
  CONFIDENTIAL = 2,
  RESTRICTED = 3,
  TOP_SECRET = 4
}

/**
 * Human-readable names for security levels
 */
export const SECURITY_LEVEL_NAMES: Record<SecurityLevel, string> = {
  [SecurityLevel.UNCLASSIFIED]: 'UNCLASSIFIED',
  [SecurityLevel.INTERNAL]: 'INTERNAL',
  [SecurityLevel.CONFIDENTIAL]: 'CONFIDENTIAL',
  [SecurityLevel.RESTRICTED]: 'RESTRICTED',
  [SecurityLevel.TOP_SECRET]: 'TOP-SECRET'
} as const;

/**
 * Parse a security level string into the SecurityLevel enum
 * Handles various formats (hyphenated, underscored, lowercase, uppercase)
 *
 * @param level - Security level string (e.g., "restricted", "TOP-SECRET", "top_secret", "internal")
 * @returns SecurityLevel enum value
 *
 * @example
 * parseSecurityLevel("restricted") // SecurityLevel.RESTRICTED
 * parseSecurityLevel("TOP-SECRET") // SecurityLevel.TOP_SECRET
 * parseSecurityLevel("confidential") // SecurityLevel.CONFIDENTIAL
 * parseSecurityLevel("internal") // SecurityLevel.INTERNAL
 */
export function parseSecurityLevel(level: string): SecurityLevel {
  // Normalize: uppercase and replace hyphens with underscores
  const normalized = level.toUpperCase().replace(/-/g, '_');

  switch (normalized) {
    case 'TOP_SECRET':
    case 'TOPSECRET':
      return SecurityLevel.TOP_SECRET;
    case 'RESTRICTED':
      return SecurityLevel.RESTRICTED;
    case 'CONFIDENTIAL':
      return SecurityLevel.CONFIDENTIAL;
    case 'INTERNAL':
      return SecurityLevel.INTERNAL;
    case 'UNCLASSIFIED':
    default:
      return SecurityLevel.UNCLASSIFIED;
  }
}

/**
 * Check if a user with a given clearance level can decrypt a message
 * at a specific classification level.
 *
 * Access Rule: userClearance >= messageClearance
 * - TOP-SECRET clearance can decrypt: top-secret, restricted, confidential, internal, unclassified
 * - RESTRICTED clearance can decrypt: restricted, confidential, internal, unclassified
 * - CONFIDENTIAL clearance can decrypt: confidential, internal, unclassified
 * - INTERNAL clearance can decrypt: internal, unclassified
 * - No clearance can decrypt: unclassified only
 *
 * @param userLevel - User's clearance level
 * @param messageLevel - Message classification level
 * @returns true if user can decrypt, false otherwise
 *
 * @example
 * canDecrypt(SecurityLevel.RESTRICTED, SecurityLevel.CONFIDENTIAL) // true
 * canDecrypt(SecurityLevel.CONFIDENTIAL, SecurityLevel.RESTRICTED) // false
 */
export function canDecrypt(userLevel: SecurityLevel, messageLevel: SecurityLevel): boolean {
  return userLevel >= messageLevel;
}

/**
 * Get UI color for a security level badge
 *
 * @param level - Security level
 * @returns CSS color class or color code
 */
export function getLevelColor(level: SecurityLevel): string {
  switch (level) {
    case SecurityLevel.TOP_SECRET:
      return 'red';
    case SecurityLevel.RESTRICTED:
      return 'orange';
    case SecurityLevel.CONFIDENTIAL:
      return 'yellow';
    case SecurityLevel.INTERNAL:
      return 'cyan';
    case SecurityLevel.UNCLASSIFIED:
    default:
      return 'green';
  }
}

/**
 * Get icon for a security level
 *
 * @param level - Security level
 * @returns Emoji icon (unlocked for unclassified, locked for classified)
 */
export function getLevelIcon(level: SecurityLevel): string {
  return level === SecurityLevel.UNCLASSIFIED ? '🔓' : '🔒';
}

/**
 * Get all security levels that a user with a given clearance can access
 *
 * @param userLevel - User's clearance level
 * @returns Array of accessible security levels (from highest to lowest)
 *
 * @example
 * getAccessibleLevels(SecurityLevel.RESTRICTED)
 * // [SecurityLevel.RESTRICTED, SecurityLevel.CONFIDENTIAL, SecurityLevel.INTERNAL, SecurityLevel.UNCLASSIFIED]
 */
export function getAccessibleLevels(userLevel: SecurityLevel): SecurityLevel[] {
  const levels: SecurityLevel[] = [];

  for (let level = userLevel; level >= SecurityLevel.UNCLASSIFIED; level--) {
    levels.push(level);
  }

  return levels;
}

/**
 * Check if a security level is valid
 *
 * @param level - Security level to validate
 * @returns true if valid, false otherwise
 */
export function isValidSecurityLevel(level: number): boolean {
  return level >= SecurityLevel.UNCLASSIFIED && level <= SecurityLevel.TOP_SECRET;
}
