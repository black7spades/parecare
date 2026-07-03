import { RELATIONSHIPS } from '../lib/care';
import { Input } from './ui/Input';

const CUSTOM = '__custom__';

/**
 * "Who are they to you?" picker: the common terms plus a free-text option
 * for whatever the family actually says (Oma, Nonna, Pop…). A value of a
 * single space means "custom chosen, not typed yet" so the text box stays
 * open; trim before saving.
 */
export function RelationshipSelect({
  label = 'Who are they to you?',
  value,
  onChange,
}: {
  label?: string;
  value: string;
  onChange: (v: string) => void;
}) {
  const isPreset = value === '' || (RELATIONSHIPS as readonly string[]).includes(value);
  const selectValue = value === '' ? '' : isPreset ? value : CUSTOM;

  return (
    <div className="space-y-2">
      <label htmlFor="relationship-select" className="block text-sm font-medium text-ink mb-1">
        {label}
      </label>
      <select
        id="relationship-select"
        className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        value={selectValue}
        onChange={(e) => onChange(e.target.value === CUSTOM ? ' ' : e.target.value)}
      >
        <option value="">Prefer not to say</option>
        {RELATIONSHIPS.map((r) => (
          <option key={r} value={r}>
            My {r}
          </option>
        ))}
        <option value={CUSTOM}>Something else…</option>
      </select>
      {selectValue === CUSTOM ? (
        <Input
          aria-label="Custom relationship"
          placeholder='What you call them, e.g. "Oma"'
          value={value.trim() === '' ? '' : value}
          onChange={(e) => onChange(e.target.value || ' ')}
          autoFocus
        />
      ) : null}
    </div>
  );
}
