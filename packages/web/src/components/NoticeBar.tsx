import { Link } from 'react-router-dom';
import { useNoticeStore } from '../stores/notice';
import { useUndoStore } from '../stores/undo';
import { Button } from './ui/Button';
import { CONTACT_LINK } from './ContactStrip';

/** A short note about something done out of sight, with a link to see it. */
export function NoticeBar() {
  const notice = useNoticeStore((s) => s.notice);
  const dismiss = useNoticeStore((s) => s.dismiss);
  // Sits above the Undo bar when both are showing.
  const undoShowing = useUndoStore((s) => !!s.pending || !!s.error);
  if (!notice) return null;
  return (
    <div
      className={`fixed left-1/2 z-[60] w-[calc(100%-2rem)] max-w-md -translate-x-1/2 ${undoShowing ? 'bottom-24' : 'bottom-4'}`}
      role="status"
      aria-live="polite"
    >
      <div className="flex flex-wrap items-center gap-3 rounded-lg border border-border bg-card px-4 py-3 shadow-xl">
        <span className="flex-1 text-sm text-ink">{notice.message}</span>
        {notice.link ? (
          <Link to={notice.link.to} className={`${CONTACT_LINK} text-sm font-medium`} onClick={dismiss}>
            {notice.link.label}
          </Link>
        ) : null}
        {notice.action ? (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              const run = notice.action!.run;
              dismiss();
              void run();
            }}
          >
            {notice.action.label}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" onClick={dismiss}>Dismiss</Button>
      </div>
    </div>
  );
}
