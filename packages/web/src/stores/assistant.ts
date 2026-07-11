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
  /**
   * The person the queued message is about, so Pare is handed that profile's
   * full record even when the message is sent from the Homeboard. Lets Pare
   * draw on providers, the care plan and notes instead of guessing.
   */
  pendingContextProfileId: string | null;
  setOpen: (open: boolean) => void;
  openWithMessage: (message: string, contextProfileId?: string | null) => void;
  consumePendingMessage: () => { message: string | null; contextProfileId: string | null };
}

export const useAssistantStore = create<AssistantState>((set, get) => ({
  open: false,
  pendingMessage: null,
  pendingContextProfileId: null,
  setOpen: (open) => set({ open }),
  openWithMessage: (message, contextProfileId = null) => set({ open: true, pendingMessage: message, pendingContextProfileId: contextProfileId }),
  consumePendingMessage: () => {
    const { pendingMessage, pendingContextProfileId } = get();
    if (pendingMessage !== null) set({ pendingMessage: null, pendingContextProfileId: null });
    return { message: pendingMessage, contextProfileId: pendingContextProfileId };
  },
}));
