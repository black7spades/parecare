import { useProfile } from './ProfileLayout';
import { TreatmentsSection } from './TreatmentsSection';

export function TreatmentsPage() {
  const { profile, access, canEdit, careName } = useProfile();
  const canManage = access === 'owner' || access === 'admin';
  const canLog = canEdit;

  return (
    <div>
      <TreatmentsSection profileId={profile.id} careName={careName} canManage={canManage} canLog={canLog} />
    </div>
  );
}
