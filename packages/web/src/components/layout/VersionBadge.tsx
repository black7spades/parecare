import { Link } from 'react-router-dom';
import { versionLabel } from '../../lib/version';
import { useUpdates, hasUnseenUpdate } from '../../stores/updates';
import { useAuthStore } from '../../stores/auth';

/**
 * The sidebar footer version. For whoever runs the system it opens the release
 * notes, with a quiet mark when this build has changes they have not read; for
 * everyone else it is plain text, since the developer record of changes is not
 * theirs to care about. What is new in their own care circle lives on the
 * What's new screen instead.
 */
export function VersionBadge() {
  const seen = useUpdates((s) => s.seen);
  const notify = useUpdates((s) => s.notify);
  const isSuperAdmin = useAuthStore((s) => s.account?.role) === 'super_admin';

  if (!isSuperAdmin) {
    return <div className="text-[11px] text-muted font-mono">{versionLabel()}</div>;
  }

  const unseen = notify && hasUnseenUpdate(seen);
  return (
    <div className="flex items-center justify-between gap-2 text-[11px] text-muted">
      <Link
        to="/app/updates"
        className="hover:text-ink transition-colors font-mono"
        title="Release notes"
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
