import { create } from 'zustand';

/**
 * Open state for the command bar, shared so the top-bar trigger, the global
 * keyboard shortcut, and anywhere else that wants to send someone to "find or
 * do anything" all drive the one bar.
 */
interface CommandBarState {
  open: boolean;
  setOpen: (open: boolean) => void;
  toggle: () => void;
}

export const useCommandBar = create<CommandBarState>((set) => ({
  open: false,
  setOpen: (open) => set({ open }),
  toggle: () => set((s) => ({ open: !s.open })),
}));
