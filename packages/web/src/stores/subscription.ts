import { create } from 'zustand';

interface UpgradePrompt {
  visible: boolean;
  feature?: string;
  message?: string;
}

interface SubscriptionState {
  tier: 'free' | 'family' | 'professional' | null;
  status: string | null;
  current_period_end: string | null;
  ai_tokens_used: number;
  ai_tokens_reset_at: string | null;
  upgradePrompt: UpgradePrompt;
  setSubscription: (data: {
    tier: 'free' | 'family' | 'professional';
    status: string | null;
    current_period_end: string | null;
    ai_tokens_used: number;
    ai_tokens_reset_at: string | null;
  }) => void;
  showUpgradePrompt: (feature?: string, message?: string) => void;
  dismissUpgradePrompt: () => void;
}

export const useSubscriptionStore = create<SubscriptionState>((set) => ({
  tier: null,
  status: null,
  current_period_end: null,
  ai_tokens_used: 0,
  ai_tokens_reset_at: null,
  upgradePrompt: { visible: false },
  setSubscription: (data) => set(data),
  showUpgradePrompt: (feature, message) =>
    set({ upgradePrompt: { visible: true, feature, message } }),
  dismissUpgradePrompt: () => set({ upgradePrompt: { visible: false } }),
}));
