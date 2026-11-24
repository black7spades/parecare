import { randomBytes } from 'crypto';

/**
 * An unguessable link token: 32 random bytes as 64 hex characters. The token
 * is the credential for a link that opens without a login, such as a care
 * plan review or a shared emergency sheet.
 */
export const newLinkToken = (): string => randomBytes(32).toString('hex');
