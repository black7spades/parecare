import type { ReactNode } from 'react';
import { Button } from './ui/Button';
import { possessiveOf } from '../lib/voice';

/**
 * The empty page is where people give up, so it says what the page is for
 * and offers one first step. Someone helping on a shift who may add here is
 * told that they can, and who else does; someone who may only look is told
 * who adds them, so an empty page never reads as something broken.
 */
export function EmptyState({
  says,
  actionLabel,
  onAction,
  canAdd,
  access,
  name,
  page,
  managerName,
  extra,
}: {
  /** What the page is for, in a sentence or two. */
  says: string;
  /** The one first step. */
  actionLabel?: string;
  onAction?: () => void;
  /** The viewer may take the first step. */
  canAdd: boolean;
  /** How the viewer reaches this person's records. */
  access?: string;
  /** The person's name, for the helper's line. */
  name?: string;
  /** What this page is called: "Medicines page". */
  page?: string;
  /** Who manages the profile. */
  managerName?: string | null;
  /** Anything else to offer beside the first step, such as uploading a list. */
  extra?: ReactNode;
}) {
  const helper = access === 'contributor' || access === 'viewer';
  const who = managerName?.trim() || 'Whoever manages this profile';
  return (
    <div className="card text-center py-10 space-y-3">
      <p className="text-sm text-ink max-w-xl mx-auto">{says}</p>
      {helper && name && page ? (
        <p className="text-xs text-muted max-w-xl mx-auto">
          {canAdd
            ? `${possessiveOf(name)} ${page} is empty. ${who} adds these, and so do you when you are on a shift.`
            : `${possessiveOf(name)} ${page} is empty. ${who} adds these.`}
        </p>
      ) : null}
      {canAdd && actionLabel && onAction ? (
        <div className="flex flex-wrap justify-center gap-2">
          <Button onClick={onAction}>{actionLabel}</Button>
          {extra}
        </div>
      ) : null}
    </div>
  );
}
