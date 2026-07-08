/** Care journeys: the library (life stages, templates) and per-person instances. */

export interface LifeStage {
  id: string;
  name: string;
  description: string | null;
  min_age_years: number | null;
  max_age_years: number | null;
  applies_before_birth: boolean;
  sort_order: number;
  retired: boolean;
  is_system: boolean;
  template_count: number;
}

export interface JourneyTemplateSummary {
  id: string;
  slug: string | null;
  name: string;
  description: string | null;
  kind: 'life_stage' | 'condition' | 'event' | 'end_of_life';
  is_system: boolean;
  status: 'draft' | 'published' | 'archived';
  life_stage_ids: string[];
  phase_count: number;
  task_count: number;
}

export interface JourneyTemplateTask {
  id?: string;
  title: string;
  description: string | null;
  is_milestone: boolean;
}

export interface JourneyTemplatePhase {
  id?: string;
  name: string;
  description: string | null;
  tasks: JourneyTemplateTask[];
}

export interface JourneyTemplateHandover {
  id?: string;
  to_template_id: string;
  to_template_name?: string;
  label: string;
}

export interface JourneyTemplateFull extends JourneyTemplateSummary {
  phases: JourneyTemplatePhase[];
  handovers: JourneyTemplateHandover[];
}

export type JourneyPhaseState = 'upcoming' | 'current' | 'locked';

export interface CareJourneyPhase {
  id: string;
  name: string;
  description: string | null;
  sort_order: number;
  state: JourneyPhaseState;
  entered_at: string | null;
  locked_at: string | null;
  task_count: number;
  tasks_done: number;
}

export interface CareJourney {
  id: string;
  template_id: string | null;
  name: string;
  status: 'active' | 'paused' | 'completed' | 'handed_over';
  started_at: string;
  ended_at: string | null;
  handed_over_to_journey_id: string | null;
  phases: CareJourneyPhase[];
  handovers: { id: string; to_template_id: string; to_template_name: string; label: string }[];
}

export interface Achievement {
  id: string;
  title: string;
  description: string | null;
  achieved_on: string | null;
  completed_at: string;
  is_milestone: boolean;
  journey_id: string | null;
  journey_name: string | null;
  journey_phase_id: string | null;
  phase_name: string | null;
  legacy_phase: string | null;
  recorded_by_name: string | null;
  note_count: number;
  photo_count: number;
  story_entry_id: string | null;
}

/** Age in whole years at today, from an ISO date of birth. */
export function ageInYears(dateOfBirth: string): number {
  const dob = new Date(dateOfBirth);
  const now = new Date();
  let years = now.getFullYear() - dob.getFullYear();
  const anniversary = new Date(dob);
  anniversary.setFullYear(now.getFullYear());
  if (now < anniversary) years -= 1;
  return Math.max(0, years);
}

/**
 * The life stages that match a person right now. A profile with a due
 * date and no date of birth is not yet born and matches before-birth
 * stages; otherwise the age range decides. Overlaps are allowed and the
 * suggestions merge. No date at all matches nothing, so the full
 * library is shown ungrouped.
 */
export function matchingLifeStages(
  stages: LifeStage[],
  profile: { date_of_birth: string | null; due_date?: string | null }
): LifeStage[] {
  const live = stages.filter((s) => !s.retired);
  if (!profile.date_of_birth) {
    if (profile.due_date) return live.filter((s) => s.applies_before_birth);
    return [];
  }
  const age = ageInYears(profile.date_of_birth);
  return live.filter(
    (s) =>
      !s.applies_before_birth &&
      (s.min_age_years === null || age >= s.min_age_years) &&
      (s.max_age_years === null || age <= s.max_age_years)
  );
}

export const JOURNEY_KINDS = [
  { value: 'life_stage', label: 'Life stage' },
  { value: 'condition', label: 'Condition' },
  { value: 'event', label: 'Life event' },
  { value: 'end_of_life', label: 'End of life' },
] as const;

export const journeyKindLabel = (kind: string) => JOURNEY_KINDS.find((k) => k.value === kind)?.label ?? kind;

/** Age range as UI copy, e.g. "5 to 12 years", "60 years and over". */
export function stageAgeLabel(stage: LifeStage): string {
  if (stage.applies_before_birth) return 'Before birth';
  if (stage.min_age_years === null && stage.max_age_years === null) return 'Any age';
  if (stage.max_age_years === null) return `${stage.min_age_years} years and over`;
  if (stage.min_age_years === null) return `Up to ${stage.max_age_years} years`;
  return `${stage.min_age_years} to ${stage.max_age_years} years`;
}
