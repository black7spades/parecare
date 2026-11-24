import type { Request } from 'express';
import { env } from '../config/env';

/**
 * The address people reach PareCare on, for links handed to someone else.
 * Whoever runs it may set it (APP_URL). When they have not, the link uses
 * the address the request came in on, port and all, so a link never reads
 * http://localhost with the port missing and goes nowhere.
 */
const DEFAULT_APP_URL = 'http://localhost';

export function publicBase(req?: Pick<Request, 'get' | 'protocol'>): string {
  const configured = env.APP_URL !== '' && env.APP_URL !== DEFAULT_APP_URL;
  if (configured || !req) return env.APP_URL || DEFAULT_APP_URL;
  const first = (v: string | undefined) => (v ?? '').split(',')[0]!.trim();
  // The Host header only: a forwarded host can be sent by anyone, and these
  // links go out in emails. The proxy in front passes the address as typed.
  const host = first(req.get('host'));
  const proto = first(req.get('x-forwarded-proto')) || req.protocol || 'http';
  // Only a plain host name or address, with an optional port, is trusted.
  if (!/^[a-z0-9.-]+(?::\d{1,5})?$|^\[[0-9a-f:.]+\](?::\d{1,5})?$/i.test(host) || !/^https?$/i.test(proto)) return env.APP_URL || DEFAULT_APP_URL;
  return `${proto.toLowerCase()}://${host}`;
}
