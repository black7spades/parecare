import { Link } from 'react-router-dom';
import { commitUrl, versionLabel } from '../../lib/version';
import { useUpdates, hasUnseenUpdate } from '../../stores/updates';

/**
 * The sidebar footer: the running version, linked to the exact commit it was
 * built from so updates stay traceable to source. "What's new" is no longer a
 * permanent link; it appears only as a quiet notification when this build has
 * changes the person has not read yet, and clears once they open it.
 */
export function VersionBadge() {
  const seen = useUpdates((s) => s.seen);
  const unseen = hasUnseenUpdate(seen);

  return (
    <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
      <a
        href={commitUrl()}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-ink transition-colors font-mono"
        title="View this build's commit on GitHub"
      >
        {versionLabel()}
      </a>
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
