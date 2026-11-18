import { QueryClient } from '@tanstack/react-query';

/** The app's one query cache, shared so code outside components can refresh it. */
export const queryClient = new QueryClient({
  defaultOptions: {
    queries: { staleTime: 30_000, retry: 1 },
  },
});

/**
 * A dose was recorded, changed or removed, wherever it happened. Refresh
 * everything that counts doses, above all the bell, so an alert to record
 * a dose clears itself the moment the dose is in.
 */
export function refreshAfterDoses(): void {
  for (const key of ['notifications', 'glance-calendar', 'calendar-events', 'calendar-upcoming', 'med-chart', 'med-log', 'pare-attention']) {
    void queryClient.invalidateQueries({ queryKey: [key] });
  }
}
