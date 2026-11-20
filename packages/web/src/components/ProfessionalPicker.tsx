import { ContactPicker } from './ContactPicker';

export interface PickedProfessional {
  /** Someone already in Contacts, or empty for a new name. */
  providerId: string;
  name: string;
  /** What they do, as stored: a built-in code or plain words. */
  providerType: string;
}

/**
 * The older name for ContactPicker, kept so anything still using it picks
 * people the same way. New code uses ContactPicker.
 */
export function ProfessionalPicker({
  id,
  label,
  value,
  onChange,
  placeholder,
}: {
  id: string;
  label: string;
  value: PickedProfessional;
  onChange: (next: PickedProfessional) => void;
  placeholder?: string;
}) {
  return (
    <ContactPicker
      id={id}
      label={label}
      kind="person"
      placeholder={placeholder}
      value={{ ...value, phone: '' }}
      onChange={(v) => onChange({ providerId: v.providerId, name: v.name, providerType: v.providerType })}
    />
  );
}
