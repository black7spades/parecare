import { JourneysSection } from './JourneysSection';
import { useProfile } from './ProfileLayout';

/**
 * The care journey on its own page: every journey, its phases and its
 * milestones in full. The overview links here and shows only what needs
 * attention, so the journey detail feeds the overview instead of
 * crowding it.
 */
export function JourneyPage() {
  const { profile, careName } = useProfile();
  return (
    <JourneysSection
      profileId={profile.id}
      careName={careName}
      dateOfBirth={profile.date_of_birth}
      dueDate={profile.due_date}
    />
  );
}
