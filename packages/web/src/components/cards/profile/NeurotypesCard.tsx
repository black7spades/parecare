import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { CardAiSummary } from '../../../pages/app/profile/CardAiSummary';
import { diagnosisStatusLabel, neurotypeLabelText, type CareDocument, type MedicalCondition } from '../../../lib/care';
import { keys } from '../../../lib/queryKeys';
import { CardShell, CardTrouble, CardWaiting } from '../CardShell';
import type { CardProps } from '../types';

/**
 * How somebody's mind works, when that has been recorded.
 *
 * Draws nothing at all when there is nothing recorded, which is the ordinary
 * case, but only once it actually knows. Appearing late shifts the page under
 * a thumb, and disappearing on a failed request would mean nobody ever learns
 * the records were there.
 */
export function NeurotypesCard({ profileId, canEdit, careName }: CardProps) {
  const { data, isPending, isError } = useQuery({
    queryKey: keys.conditions(profileId),
    queryFn: () => api.get<{ conditions: MedicalCondition[] }>(`/care-profiles/${profileId}/conditions`),
  });

  if (isPending) return <CardShell><CardWaiting /></CardShell>;
  if (isError) return <CardShell><CardTrouble what="Neurotypes" /></CardShell>;

  const neurotypes = data.conditions.filter((c) => c.category === 'neurotype');
  if (neurotypes.length === 0) return null;

  return (
    <CardShell>
      <NeurotypesOverview profileId={profileId} careName={careName} canEdit={canEdit} neurotypes={neurotypes} />
    </CardShell>
  );
}

function NeurotypesOverview({
  profileId,
  careName,
  canEdit,
  neurotypes,
}: {
  profileId: string;
  careName: string;
  canEdit: boolean;
  neurotypes: MedicalCondition[];
}) {
  // Labels for the linked diagnosis documents. Only documents the viewer
  // is allowed to see come back, so a restricted document simply shows no
  // link for that viewer.
  const { data: docsData } = useQuery({
    queryKey: ['documents', profileId],
    queryFn: () => api.get<{ documents: CareDocument[] }>(`/care-profiles/${profileId}/documents`),
  });
  const docs = docsData?.documents ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink">{careName} is neurodivergent.</p>
        <Link to="neurotypes" className="text-xs text-primary hover:underline">
          Manage neurotypes
        </Link>
      </div>
      <CardAiSummary profileId={profileId} cardKey="neurotypes" canEdit={canEdit} autoGenerate />
      <div className="space-y-2">
        {neurotypes.map((n) => {
          const doc =
            n.diagnosis_status === 'formal' && n.diagnosis_document_id
              ? docs.find((d) => d.id === n.diagnosis_document_id)
              : undefined;
          return (
            <div key={n.id} className="flex items-start gap-3 text-sm flex-wrap">
              <span className="font-medium text-ink">{n.name}</span>
              {n.neurotype ? <span className="text-xs text-muted">{neurotypeLabelText(n.neurotype)}</span> : null}
              {n.diagnosis_status ? (
                <span className="text-xs text-muted">{diagnosisStatusLabel(n.diagnosis_status)}</span>
              ) : null}
              {doc ? (
                <Link
                  to={`documents?doc=${doc.id}`}
                  className="text-xs text-primary hover:underline"
                  title="Open the diagnosis document in Documents"
                >
                  Diagnosis document: {doc.label}
                </Link>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}
