import { useEffect, useRef, useState } from 'react';
import { useAuthStore } from '../../stores/auth';
import { useSiteCopyStore } from '../../stores/siteCopy';
import { siteCopyApi } from '../../api/siteCopy';
import { SITE_COPY_DEFAULTS } from '../../lib/siteCopyDefaults';

interface Props {
  copyKey: string;
  fallback?: string;
  vars?: Record<string, string>;
  className?: string;
}

export function EditableSubheader({ copyKey, fallback, vars, className = '' }: Props) {
  const role = useAuthStore((s) => s.account?.role);
  const isSuperAdmin = role === 'super_admin';
  const { copy, loaded, load, setCopy } = useSiteCopyStore();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [saving, setSaving] = useState(false);
  const inputRef = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { void load(); }, [load]);

  const defaultText = fallback ?? SITE_COPY_DEFAULTS[copyKey] ?? '';
  const rawText = copy[copyKey] ?? defaultText;

  const interpolate = (t: string) => {
    if (!vars) return t;
    let out = t;
    for (const [k, v] of Object.entries(vars)) out = out.replace(new RegExp(`\\{${k}\\}`, 'g'), v);
    return out;
  };

  const text = interpolate(rawText);

  if (!isSuperAdmin || !loaded) {
    return <p className={`text-sm text-muted ${className}`}>{text}</p>;
  }

  if (!editing) {
    return (
      <p
        className={`text-sm text-muted group/sub cursor-pointer rounded -mx-1 px-1 hover:bg-surface-2 transition-colors ${className}`}
        onClick={() => { setDraft(rawText); setEditing(true); }}
        title="Edit this text"
      >
        {text}
        <span className="invisible group-hover/sub:visible ml-1.5 text-xs text-primary">Edit</span>
      </p>
    );
  }

  const save = async () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === text) {
      setEditing(false);
      return;
    }
    setSaving(true);
    try {
      const resp = await siteCopyApi.update({ [copyKey]: trimmed });
      setCopy(resp.copy);
    } catch {
      // leave editing open on failure
    } finally {
      setSaving(false);
      setEditing(false);
    }
  };

  return (
    <div className={`space-y-1 ${className}`}>
      <textarea
        ref={inputRef}
        className="block w-full rounded-md border border-border bg-card px-2 py-1.5 text-sm text-ink shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary resize-y"
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void save(); }
          if (e.key === 'Escape') setEditing(false);
        }}
        rows={2}
        maxLength={500}
        autoFocus
        disabled={saving}
      />
      <div className="flex items-center gap-2">
        <button
          type="button"
          className="text-xs text-primary hover:underline disabled:opacity-50"
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? 'Saving…' : 'Save'}
        </button>
        <button
          type="button"
          className="text-xs text-muted hover:text-ink"
          onClick={() => setEditing(false)}
          disabled={saving}
        >
          Cancel
        </button>
        {draft.trim() !== defaultText && (
          <button
            type="button"
            className="text-xs text-muted hover:text-ink"
            onClick={() => setDraft(defaultText)}
            disabled={saving}
          >
            Reset to default
          </button>
        )}
      </div>
    </div>
  );
}
