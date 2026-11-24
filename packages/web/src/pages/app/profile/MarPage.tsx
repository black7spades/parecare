import { useNavigate } from 'react-router-dom';
import { EmptyState } from '../../../components/EmptyState';
import { EditableSubheader } from '../../../components/ui/EditableSubheader';
import { useProfile } from './ProfileLayout';
import { MedicationMar } from './MedicationMar';
import { firstName } from '../../../lib/lifeEvents';

/**
 * The Medication Administration Record as its own page under Management:
 * every dose given, refused, omitted or held, logged against the person
 * and reviewable over time. Pinnable so carers who log doses all day can
 * keep it at the top of their navigation.
 */
export function MarPage() {
  const { profile, canEdit, isSelf, voice, access, careName } = useProfile();
  const navigate = useNavigate();
  const mayAdd = access === 'owner' || access === 'admin';
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-ink">Medication record</h2>
        <EditableSubheader copyKey="profile.mar.subheader" voice={voice} />
      </div>
      <MedicationMar
        profileId={profile.id}
        personName={profile.full_name}
        callName={isSelf ? null : firstName(profile)}
        canAdminister={canEdit}
        empty={
          <EmptyState
            says="Each dose given is recorded here. Add a medicine with times first, then doses show up when they are due."
            actionLabel="Add a medicine"
            onAction={() => navigate(`/app/${profile.id}/medications?new=1`)}
            canAdd={mayAdd}
            access={access}
            name={careName}
            page="Medication record"
            managerName={profile.manager_name}
          />
        }
      />
    </div>
  );
}
