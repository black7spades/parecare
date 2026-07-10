/**
 * The browser's IANA time zone (e.g. "Australia/Sydney"). Sent with every
 * message to Pare so the times it records land on the user's own clock:
 * "11am this morning" is stored as 11am where they are, and read back the
 * same way. Returns undefined if the runtime cannot report a zone.
 */
export function browserTimeZone(): string | undefined {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || undefined;
  } catch {
    return undefined;
  }
}
