import { useNavigate } from 'react-router-dom';
import { useAiStatus } from '../../lib/aiStatus';
import { useAuthStore } from '../../stores/auth';

/**
 * Pare's status as a traffic light in the top bar: green when it is online and
 * working well, amber when it is online but under load or still getting ready,
 * red when it is offline and may need attention. Whoever can see the system
 * screens can click through to the monitoring panel; for everyone else it is a
 * quiet indicator with a plain-words tooltip.
 */
const DOT: Record<string, string> = {
  green: 'bg-green-500',
  amber: 'bg-amber-400',
  red: 'bg-red-500',
};

export function PareStatus() {
  const navigate = useNavigate();
  const role = useAuthStore((s) => s.account?.role);
  const isAdmin = role === 'admin' || role === 'super_admin';
  const { data } = useAiStatus();

  // Until the first answer arrives, say nothing rather than flash a colour.
  if (!data) return null;

  const health = data.health;
  const label =
    health === 'green'
      ? 'Pare is online and working well.'
      : health === 'amber'
        ? data.state === 'preparing'
          ? 'Pare is getting ready.'
          : 'Pare is online, under load.'
        : 'Pare is offline and may need attention.';

  const dot = (
    <span className="inline-flex items-center gap-1.5">
      <span className={`h-2.5 w-2.5 rounded-full ${DOT[health]}`} aria-hidden />
      <span className="hidden sm:inline text-xs text-muted">Pare</span>
    </span>
  );

  if (isAdmin) {
    return (
      <button
        type="button"
        onClick={() => navigate('/system/chats')}
        aria-label={`${label} Open the Pare monitor.`}
        title={label}
        className="p-1.5 rounded-md hover:bg-surface-2 transition-colors"
      >
        {dot}
      </button>
    );
  }

  return (
    <span className="p-1.5 inline-flex" aria-label={label} title={label} role="img">
      {dot}
    </span>
  );
}
