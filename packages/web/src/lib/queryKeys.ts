/**
 * The names the app files its fetched records under.
 *
 * Written down in one place because cards fetch their own data. Nine cards
 * each inventing a name for the same thing is how you end up fetching a
 * person's conditions twice and showing two different answers.
 *
 * New code uses these. Existing screens are left alone until they are next
 * opened for another reason.
 */
export const keys = {
  profile: (profileId: string) => ['care-profile', profileId] as const,
  circle: (profileId: string) => ['circle', profileId] as const,
  conditions: (profileId: string) => ['conditions', profileId] as const,
  providers: (profileId: string) => ['providers', profileId] as const,
  documents: (profileId: string) => ['documents', profileId] as const,
  substanceUse: (profileId: string) => ['substance-use', profileId] as const,
  upcoming: (profileId: string) => ['calendar-upcoming', profileId] as const,
  healthSpend: (profileId: string, range: string) => ['health-spend', profileId, range] as const,
  overviewSummaries: (profileId: string) => ['overview-summaries', profileId] as const,
};
