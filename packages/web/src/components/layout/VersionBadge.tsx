import { Link } from 'react-router-dom';
import { versionLabel } from '../../lib/version';
import { useUpdates, hasUnseenUpdate } from '../../stores/updates';

/**
 * The sidebar footer: the running version, which opens the What's new record so
 * the changes are always one tap away, whatever the person reads there linking
 * on to the exact commit this build came from. A quiet mark appears beside it
 * only when this build has changes the person has not read yet and they have
 * left update notices on; it clears once they open What's new.
 */
export function VersionBadge() {
  const seen = useUpdates((s) => s.seen);
  const notify = useUpdates((s) => s.notify);
  const unseen = notify && hasUnseenUpdate(seen);

  return (
    <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
      <Link
        to="/app/updates"
        className="hover:text-ink transition-colors font-mono"
        title="See what's new"
      >
        {versionLabel()}
      </Link>
      {unseen ? (
        <Link
          to="/app/updates"
          className="inline-flex items-center gap-1.5 text-primary hover:underline"
          title="See what has changed"
        >
          <span className="h-1.5 w-1.5 rounded-full bg-primary" aria-hidden />
          What's new
        </Link>
      ) : null}
    </div>
  );
}
