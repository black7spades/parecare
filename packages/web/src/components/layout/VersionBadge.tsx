import { CHANGELOG_URL, commitUrl, versionLabel } from '../../lib/version';

/**
 * The sidebar footer version badge: the running version linked to the exact
 * commit it was built from, plus a "What's new" link to the maintained
 * changelog. This keeps the app's updates traceable back to the git repo.
 */
export function VersionBadge() {
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
      <a
        href={CHANGELOG_URL}
        target="_blank"
        rel="noopener noreferrer"
        className="hover:text-ink transition-colors"
        title="See what has changed"
      >
        What's new
      </a>
    </div>
  );
}
