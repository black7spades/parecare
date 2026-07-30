import { CardAiSummary } from '../../../pages/app/profile/CardAiSummary';
import { CurrentHealthSection } from '../../../pages/app/profile/CurrentHealthSection';
import { CardShell } from '../CardShell';
import type { CardProps } from '../types';

/** How somebody is right now, with Pare's summary above it. */
export function HealthCard({ profileId, canEdit, careName }: CardProps) {
  return (
    <CardShell>
      <div className="space-y-3">
        <CardAiSummary profileId={profileId} cardKey="health" canEdit={canEdit} />
        <CurrentHealthSection profileId={profileId} canEdit={canEdit} careName={careName} />
      </div>
    </CardShell>
  );
}
