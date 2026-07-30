import { CardAiSummary } from '../../../pages/app/profile/CardAiSummary';
import { CareLogSection } from '../../../pages/app/profile/CareLogSection';
import { CardShell } from '../CardShell';
import type { CardProps } from '../types';

/** What has been happening day to day, with Pare's summary above it. */
export function CareLogCard({ profileId, canEdit }: CardProps) {
  return (
    <CardShell>
      <div className="space-y-3">
        <CardAiSummary profileId={profileId} cardKey="log" canEdit={canEdit} />
        <CareLogSection profileId={profileId} canEdit={canEdit} />
      </div>
    </CardShell>
  );
}
