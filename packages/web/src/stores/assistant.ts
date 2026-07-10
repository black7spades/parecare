import { create } from 'zustand';

/**
 * Shared state for Pare's widget, so other screens (the dashboard welcome
 * card, the attention prompt line) can open the panel and hand it a message
 * to send. The open state lives here rather than in the widget so Pare
 * stays open while it navigates the user between screens.
 */
interface AssistantState {
  open: boolean;
  /** A message queued by another screen, sent as soon as the panel opens. */
  pendingMessage: string | null;
  setOpen: (open: boolean) => void;
  openWithMessage: (message: string) => void;
  consumePendingMessage: () => string | null;
}

export const useAssistantStore = create<AssistantState>((set, get) => ({
  open: false,
  pendingMessage: null,
  setOpen: (open) => set({ open }),
  openWithMessage: (message) => set({ open: true, pendingMessage: message }),
  consumePendingMessage: () => {
    const message = get().pendingMessage;
    if (message !== null) set({ pendingMessage: null });
    return message;
  },
}));
