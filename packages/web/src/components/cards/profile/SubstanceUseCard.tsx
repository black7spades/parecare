import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { substanceClassLabel, substanceStatusLabel, type SubstanceUse } from '../../../lib/care';
import { keys } from '../../../lib/queryKeys';
import { CardShell, CardTrouble, CardWaiting } from '../CardShell';
import type { CardProps } from '../types';

/** Drinking, smoking and the rest, when any of it has been recorded. */
export function SubstanceUseCard({ profileId }: CardProps) {
  const { data, isPending, isError } = useQuery({
    queryKey: keys.substanceUse(profileId),
    queryFn: () => api.get<{ substance_use: SubstanceUse[] }>(`/care-profiles/${profileId}/substance-use`),
  });

  if (isPending) return <CardShell><CardWaiting /></CardShell>;
  if (isError) return <CardShell><CardTrouble what="Substance use" /></CardShell>;
  if (data.substance_use.length === 0) return null;

  return (
    <CardShell>
      <SubstanceUseSummary records={data.substance_use} />
    </CardShell>
  );
}

function SubstanceUseSummary({ records }: { records: SubstanceUse[] }) {
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5 text-sm">
        {records.map((r) => {
          const amount = [r.quantity, r.quantity_unit].filter(Boolean).join(' ');
          const detail = [amount, r.frequency].filter(Boolean).join(', ');
          return (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-ink">{r.substance}</span>
              <span className="badge bg-surface-2 text-muted text-xs">{substanceStatusLabel(r.status)}</span>
              <span className="text-xs text-muted">{substanceClassLabel(r.substance_class)}</span>
              {detail ? <span className="text-xs text-muted">· {detail}</span> : null}
            </li>
          );
        })}
      </ul>
      <Link to="substance-use" className="text-xs text-primary hover:underline">
        Manage substance use
      </Link>
    </div>
  );
}
