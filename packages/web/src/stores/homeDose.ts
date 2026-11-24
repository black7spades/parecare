import { create } from 'zustand';

/**
 * A dose recorded at home for someone shown as in hospital: the screen asks
 * whether they are home, so the stay is never left open by mistake. The
 * question comes back from the server with the dose; any screen that records
 * a dose passes the response here.
 */
export interface HomeDoseQuestion {
  profileId: string;
  stay_id: string;
  text: string;
}

interface HomeDoseState {
  question: HomeDoseQuestion | null;
  ask: (q: HomeDoseQuestion) => void;
  clear: () => void;
}

export const useHomeDoseStore = create<HomeDoseState>((set) => ({
  question: null,
  ask: (q) => set({ question: q }),
  clear: () => set({ question: null }),
}));

/** Pass a dose response here: when the server asked, the question shows. */
export function askIfHome(profileId: string, res: unknown): void {
  const q = (res as { in_hospital?: { stay_id: string; text: string } | null } | null)?.in_hospital;
  if (q?.stay_id) useHomeDoseStore.getState().ask({ profileId, ...q });
}
