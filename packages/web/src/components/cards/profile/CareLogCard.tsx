import { CardAiSummary } from '../../../pages/app/profile/CardAiSummary';
import { CareLogSection } from '../../../pages/app/profile/CareLogSection';
import { CardShell } from '../CardShell';
import type { CardProps } from '../types';

/**
 * What has been happening day to day: Pare's summary, the box to add an
 * entry, and the latest few, with a link to the whole care log page.
 */
export function CareLogCard({ profileId, canEdit }: CardProps) {
  return (
    <CardShell>
      <div className="space-y-3">
        <CardAiSummary profileId={profileId} cardKey="log" canEdit={canEdit} />
        <CareLogSection profileId={profileId} canEdit={canEdit} variant="card" />
      </div>
    </CardShell>
  );
}
