import { format } from 'date-fns';
import { PLAN_SECTION_ORDER } from '../../../../lib/care';

/** Helpers the care plan screen and its dialogs both need. */
export const SECTION_MANAGE_LINKS: Record<string, { to: string; label: string }> = {
  allergies: { to: '../allergies', label: 'Allergies page' },
  conditions: { to: '../conditions', label: 'Conditions page' },
  medications: { to: '../medications', label: 'Medications page' },
  treatments: { to: '../treatments', label: 'Treatments page' },
  needs: { to: '../care-needs', label: 'Care needs page' },
  directive: { to: '../care-needs', label: 'Care needs page' },
  emergency_contacts: { to: '../care-needs', label: 'Care needs page' },
  providers: { to: '../providers', label: 'Providers page' },
};

export const SECTION_ORDER = PLAN_SECTION_ORDER;

export const fieldLabel = (f: string): string => f.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

export const fieldText = (v: string | number | boolean | null | undefined): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
};

export const entryName = (fields: Record<string, string | number | boolean | null> | null | undefined): string => {
  if (!fields) return '';
  const v = fields['substance'] ?? fields['name'] ?? fields['value'] ?? fields['location'] ?? '';
  return fieldText(v);
};

export const fmtWhen = (d: string) => format(new Date(d), 'd MMM yyyy HH:mm');
