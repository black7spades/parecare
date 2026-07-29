import { useEffect, useState } from 'react';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';

/**
 * A walkthrough for something that has to be done on someone else's website.
 *
 * Connecting Google Drive or Dropbox means leaving PareCare, finding the
 * right page in a console built for developers, and bringing two values
 * back. Written as a list it is a wall of steps that is easy to lose your
 * place in. One step at a time, with the link that opens exactly the right
 * page and the exact text to paste, is the version that asks least of
 * someone who did not want to be doing this in the first place.
 *
 * Nothing is done in order behind the scenes, so moving back and forth is
 * always safe, and closing part way through loses nothing.
 */

export interface GuideStep {
  /** Short, plain, and about what they are doing rather than what it is called. */
  title: string;
  /** One or two sentences. Never more. */
  body: string;
  /** Opens the exact page, so no menu has to be navigated. */
  link?: { label: string; url: string };
  /** Something to paste over there, with a Copy button so it is never retyped. */
  copy?: { label: string; value: string };
  /** Something to bring back here, saved before moving on. */
  fields?: { key: string; label: string; secret?: boolean; placeholder?: string }[];
  /** What to call the button that finishes this step, when it saves something. */
  saveLabel?: string;
  /** Reassurance for the step people are most likely to get stuck on. */
  note?: string;
}

function CopyRow({ label, value }: { label: string; value: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="rounded-md border border-border bg-surface p-3">
      <p className="mb-1 text-xs font-medium text-ink">{label}</p>
      <div className="flex flex-wrap items-center gap-2">
        <code className="flex-1 break-all text-xs text-muted">{value}</code>
        <Button
          variant="secondary"
          size="xs"
          onClick={() => {
            void navigator.clipboard?.writeText(value);
            setCopied(true);
            window.setTimeout(() => setCopied(false), 2000);
          }}
        >
          {copied ? 'Copied' : 'Copy'}
        </Button>
      </div>
    </div>
  );
}

export function SetupGuide({
  open,
  title,
  steps,
  onClose,
  onSave,
  onFinish,
  finishLabel = 'Connect',
  busy = false,
}: {
  open: boolean;
  title: string;
  steps: GuideStep[];
  onClose: () => void;
  /** Save whatever this step collected. Returns an error to show, or null. */
  onSave?: (values: Record<string, string>) => Promise<string | null>;
  /** The last step's action, usually connecting. */
  onFinish: () => void;
  finishLabel?: string;
  busy?: boolean;
}) {
  const [index, setIndex] = useState(0);
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  // Start at the beginning each time it is opened, so a half-finished
  // attempt from before never leaves someone in the middle of nowhere.
  useEffect(() => {
    if (open) {
      setIndex(0);
      setError(null);
    }
  }, [open]);

  if (!open) return null;
  const step = steps[index];
  const first = index === 0;
  const last = index === steps.length - 1;

  async function next() {
    setError(null);
    if (step.fields && onSave) {
      const missing = step.fields.some((f) => !values[f.key]?.trim());
      if (missing) {
        setError('Fill in both boxes before carrying on.');
        return;
      }
      setSaving(true);
      const problem = await onSave(values);
      setSaving(false);
      if (problem) {
        setError(problem);
        return;
      }
    }
    if (last) onFinish();
    else setIndex((i) => i + 1);
  }

  return (
    <Modal open={open} onClose={onClose} title={title} wide>
      <div className="space-y-4">
        {/* Where they are, so the end is always in sight. */}
        <div className="flex items-center gap-2">
          {steps.map((s, i) => (
            <span
              key={s.title}
              className={`h-1.5 flex-1 rounded-full ${i <= index ? 'bg-primary' : 'bg-border'}`}
              aria-hidden="true"
            />
          ))}
        </div>
        <p className="text-xs text-muted">
          Step {index + 1} of {steps.length}
        </p>

        <div className="min-h-[11rem] space-y-3">
          <h3 className="text-base font-semibold text-ink">{step.title}</h3>
          <p className="text-sm text-muted">{step.body}</p>

          {step.link ? (
            <a
              href={step.link.url}
              target="_blank"
              rel="noreferrer"
              className="inline-block text-sm text-primary hover:underline"
            >
              {step.link.label}
            </a>
          ) : null}

          {step.copy ? <CopyRow label={step.copy.label} value={step.copy.value} /> : null}

          {step.fields ? (
            <div className="space-y-2">
              {step.fields.map((f) => (
                <label key={f.key} className="block">
                  <span className="mb-1 block text-sm font-medium text-ink">{f.label}</span>
                  <input
                    type={f.secret ? 'password' : 'text'}
                    className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                    placeholder={f.placeholder}
                    value={values[f.key] ?? ''}
                    onChange={(e) => setValues({ ...values, [f.key]: e.target.value })}
                  />
                </label>
              ))}
            </div>
          ) : null}

          {step.note ? <p className="text-xs text-muted">{step.note}</p> : null}
          {error ? <p className="text-sm text-red-600 dark:text-red-400">{error}</p> : null}
        </div>

        <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
          <Button variant="ghost" size="sm" onClick={() => setIndex((i) => i - 1)} disabled={first || saving}>
            Back
          </Button>
          <div className="flex gap-2">
            <Button variant="secondary" size="sm" onClick={onClose} disabled={saving}>
              Finish later
            </Button>
            <Button variant="primary" size="sm" onClick={() => void next()} loading={saving || (last && busy)}>
              {last ? finishLabel : step.saveLabel ?? 'Next'}
            </Button>
          </div>
        </div>

        <p className="text-xs text-muted">
          Nothing here is saved until you press the button, and stopping part way through breaks nothing. Come back to
          this whenever suits.
        </p>
      </div>
    </Modal>
  );
}
