import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { EmergencySheetView, type EmergencySheet as Sheet } from '../../components/EmergencySheetView';

/**
 * Emergency sheets for many people at once, one to a printed page, for a
 * wing or a whole home. Chosen from the Homeboard.
 */
export function EmergencySheetsPage() {
  const [params] = useSearchParams();
  const ids = (params.get('ids') ?? '').split(',').filter(Boolean);
  const { data, isLoading, isError } = useQuery({
    queryKey: ['emergency-sheets', ids.join(',')],
    queryFn: () => api.get<{ sheets: Sheet[]; left_out: number }>(`/care-profiles/emergency-sheets?ids=${ids.join(',')}`),
    enabled: ids.length > 0,
  });
  const sheets = data?.sheets ?? [];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div>
          <h1 className="text-2xl font-bold text-ink">Emergency sheets</h1>
          <p className="text-xs text-muted">
            {sheets.length} {sheets.length === 1 ? 'sheet' : 'sheets'}, one to a page when printed.
            {data?.left_out ? ` ${data.left_out} could not be included because you do not have access to them.` : ''}
          </p>
        </div>
        {sheets.length > 0 ? <Button onClick={() => window.print()}>Print</Button> : null}
      </div>
      {ids.length === 0 ? (
        <div className="card text-center py-10 space-y-2">
          <p className="text-sm text-ink">Choose the people whose sheets you need on the Homeboard, then Print emergency sheets.</p>
          <Link to="/app" className="text-sm text-primary hover:underline">Go to the Homeboard</Link>
        </div>
      ) : isLoading ? (
        <p className="text-sm text-muted">Putting the sheets together.</p>
      ) : isError ? (
        <p className="text-sm text-red-600">The sheets could not be loaded just now. Try again in a moment.</p>
      ) : (
        // The same sheet as each person's own, one to a printed page.
        sheets.map((s) => (
          <div key={s.profile.id} className="break-after-page print:break-after-page">
            <EmergencySheetView sheet={s} documentHref={(docId) => `/app/${s.profile.id}/documents?doc=${docId}`} />
          </div>
        ))
      )}
    </div>
  );
}
