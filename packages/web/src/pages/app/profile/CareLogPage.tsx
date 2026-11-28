import { EditableSubheader } from '../../../components/ui/EditableSubheader';
import { CareLogSection } from './CareLogSection';
import { useProfile } from './ProfileLayout';

/**
 * The whole care log on its own page: everything written about the person,
 * with search, dates, kinds, grouping and bulk changes. The overview keeps
 * only the latest few and links here.
 */
export function CareLogPage() {
  const { profile, canEdit, voice } = useProfile();
  return (
    <div className="max-w-3xl">
      <CareLogSection
        profileId={profile.id}
        canEdit={canEdit}
        intro={<EditableSubheader copyKey="profile.care-log.subheader" voice={voice} />}
      />
    </div>
  );
}
