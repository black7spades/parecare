import { useProfile } from './ProfileLayout';
import { MedicationMar } from './MedicationMar';

/**
 * The Medication Administration Record as its own page under Management:
 * every dose given, refused, omitted or held, logged against the person
 * and reviewable over time. Pinnable so carers who log doses all day can
 * keep it at the top of their navigation.
 */
export function MarPage() {
  const { profile, careName, canEdit } = useProfile();
  return (
    <div className="space-y-4">
      <div>
        <h2 className="text-base font-semibold text-ink">Medication record</h2>
        <p className="text-sm text-muted">
          Log each dose against {careName} and review the history. Doses colour instantly as you record them.
        </p>
      </div>
      <MedicationMar profileId={profile.id} personName={profile.full_name} canAdminister={canEdit} />
    </div>
  );
}
