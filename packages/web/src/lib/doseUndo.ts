import { api } from '../api/client';
import { useNoticeStore } from '../stores/notice';

/**
 * One tap records a dose, so one tap takes it back: after a dose is logged
 * straight from a chip or a "log all" button, a note says what was recorded
 * and offers Undo. Undo removes those records and puts the supply back.
 */
export function offerDoseUndo(opts: { profileId: string; ids: string[] | undefined; message: string; onChanged: () => void }): void {
  const ids = opts.ids ?? [];
  if (ids.length === 0) return;
  const notice = useNoticeStore.getState();
  notice.show({
    message: opts.message,
    action: {
      label: 'Undo',
      run: async () => {
        const results = await Promise.allSettled(
          ids.map((id) => api.delete(`/care-profiles/${opts.profileId}/medications/administrations/${id}`))
        );
        opts.onChanged();
        const failed = results.filter((r) => r.status === 'rejected').length;
        useNoticeStore.getState().show({
          message: failed
            ? `${failed === ids.length ? 'That' : `${failed} of them`} could not be taken back, so ${failed === 1 ? 'it is' : 'they are'} still recorded. Try again from the medication record.`
            : ids.length === 1
              ? 'Taken back. The dose is no longer recorded.'
              : `Taken back. Those ${ids.length} doses are no longer recorded.`,
        });
      },
    },
  });
}
