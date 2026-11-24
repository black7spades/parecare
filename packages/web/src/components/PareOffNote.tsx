import { Link } from 'react-router-dom';
import { useAuthStore } from '../stores/auth';
import { useAiStatus } from '../lib/aiStatus';
import { CONTACT_LINK } from './ContactStrip';

/**
 * With no assistant attached, the one person who can attach one (whoever
 * runs this PareCare) sees one plain line on where to do it. Nobody else is
 * told anything: everything they need works without Pare.
 */
export function PareOffNote({ className = '' }: { className?: string }) {
  const role = useAuthStore((s) => s.account?.role);
  const { data } = useAiStatus();
  if (role !== 'super_admin' || data?.state !== 'unavailable') return null;
  return (
    <p className={`text-xs text-muted ${className}`}>
      Pare, the assistant, is switched off here. Everything else works without it. To switch it on, open{' '}
      <Link to="/system/settings" className={CONTACT_LINK}>System settings</Link>.
    </p>
  );
}
