import { poaLabel } from '../lib/care';

/**
 * Visual marker for a power-of-attorney holder. Filled when the POA is
 * activated (in effect now), outlined when appointed but not yet invoked.
 */
export function PoaBadge({ type, activated }: { type: string | null; activated: boolean }) {
  if (!type && !activated) return null;
  return (
    <span
      title={`${poaLabel(type)}${activated ? ', activated' : ', appointed but not activated'}`}
      className={`badge text-xs font-semibold ${
        activated ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 border border-amber-300'
      }`}
    >
      ⚖ POA{activated ? ' · active' : ''}
    </span>
  );
}
