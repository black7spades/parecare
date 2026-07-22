import { format } from 'date-fns';
import { RELEASES } from '../../lib/releaseNotes';
import { APP_VERSION, REPO_URL, commitUrl, versionLabel } from '../../lib/version';

/**
 * What's new: the on-site record of updates, drawn from the release notes and
 * tied back to the git build. Linked from the sidebar version badge.
 */
export function UpdatesPage() {
  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-ink">What's new</h1>
        <p className="mt-1 text-sm text-muted">
          The updates to PareCare, newest first. You are on{' '}
          <a href={commitUrl()} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline font-mono">
            {versionLabel()}
          </a>
          .
        </p>
      </div>

      {RELEASES.map((release) => {
        const current = release.version === APP_VERSION;
        return (
          <section key={release.version} className="card p-5">
            <div className="flex items-baseline justify-between gap-3 border-b border-border pb-3 mb-3">
              <h2 className="text-sm font-semibold text-ink">
                Version {release.version}
                {current ? <span className="ml-2 badge bg-primary-50 text-primary text-xs">You are here</span> : null}
              </h2>
              {release.date ? (
                <span className="text-xs text-muted">{format(new Date(release.date), 'd MMM yyyy')}</span>
              ) : null}
            </div>
            <p className="text-sm text-ink mb-4">{release.summary}</p>
            <div className="space-y-4">
              {release.groups.map((group) => (
                <div key={group.heading}>
                  <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-1.5">{group.heading}</h3>
                  <ul className="list-disc pl-5 space-y-1 text-sm text-ink">
                    {group.items.map((item, i) => (
                      <li key={i}>{item}</li>
                    ))}
                  </ul>
                </div>
              ))}
            </div>
          </section>
        );
      })}

      <p className="text-xs text-muted">
        The full history and the source live in the{' '}
        <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className="text-primary hover:underline">
          git repository
        </a>
        .
      </p>
    </div>
  );
}
