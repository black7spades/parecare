/**
 * Every profile page is one of two things, and says so up front:
 *
 * - a data entry page, where facts are recorded and edited; or
 * - an output page, which assembles facts recorded elsewhere and never
 *   collects anything itself.
 *
 * The badge keeps that boundary visible so nobody hunts for an edit
 * button on an output page or wonders where a fact is mastered.
 */
export function PagePurpose({ kind }: { kind: 'entry' | 'output' }) {
  if (kind === 'entry') {
    return (
      <span
        className="badge bg-primary-50 text-primary text-xs whitespace-nowrap"
        title="Information is recorded and edited on this page."
      >
        Data entry
      </span>
    );
  }
  return (
    <span
      className="badge bg-surface-2 text-muted text-xs whitespace-nowrap"
      title="Everything shown here is recorded on its own data entry page and is read only here."
    >
      Output only
    </span>
  );
}
