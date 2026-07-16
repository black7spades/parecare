import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { CatalogueCombo, OptionChips } from '../../../components/CatalogueCombo';
import { PagePurpose } from '../../../components/PagePurpose';
import { useProfile } from './ProfileLayout';
import {
  RELATIONSHIPS,
  providerTypeLabel,
  type CareDocument,
  type CarePlan,
  type CircleMember,
  type EmergencyContact,
  type Provider,
} from '../../../lib/care';

/**
 * The data entry home for the facts the care plan owns itself:
 * day-to-day needs, the advance care directive, and emergency contacts.
 * The Care plan page only displays these; they are recorded here.
 */

const EMPTY_PLAN: CarePlan = {
  dietary_requirements: [],
  mobility_aids: [],
  communication_needs: [],
  advance_care_directive: false,
  advance_care_directive_location: null,
  emergency_contacts: [],
};

const selectClass =
  'rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export function CareNeedsPage() {
  const { profile, careName, canEdit } = useProfile();
  const queryClient = useQueryClient();
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['care-plan', profile.id],
    queryFn: () => api.get<{ plan: CarePlan | null }>(`/care-profiles/${profile.id}/plan`),
  });

  const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const plan: CarePlan = useMemo(() => {
    const p = { ...EMPTY_PLAN, ...(data?.plan ?? {}) };
    return {
      ...p,
      dietary_requirements: asArray<string>(p.dietary_requirements),
      mobility_aids: asArray<string>(p.mobility_aids),
      communication_needs: asArray<string>(p.communication_needs),
      emergency_contacts: asArray<EmergencyContact>(p.emergency_contacts),
    };
  }, [data]);

  // Every change saves straight away; there is no page-wide form to submit.
  const saveMutation = useMutation({
    mutationFn: (next: CarePlan) => api.put(`/care-profiles/${profile.id}/plan`, next),
    onSuccess: () => {
      setError('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
      void queryClient.invalidateQueries({ queryKey: ['care-plan', profile.id] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save'),
  });
  const savePlan = (patch: Partial<CarePlan>) => saveMutation.mutate({ ...plan, ...patch });

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-ink">Care needs</h2>
            <PagePurpose kind="entry" />
          </div>
          <p className="text-sm text-muted">
            Day-to-day needs, the advance care directive, and who to call for {careName}. Changes save
            straight away and flow into the{' '}
            <Link to="../plan" className="text-primary hover:underline">
              care plan
            </Link>
            .
          </p>
        </div>
        {saved ? <span className="text-sm text-primary">Saved ✓</span> : null}
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      <div className="card">
        <h3 className="text-sm font-semibold text-ink">Day-to-day needs</h3>
        <p className="text-sm text-muted mb-3">
          Each need is picked from a shared list; anything not listed joins it when you add it.
        </p>
        <div className="space-y-4">
          <OptionChips
            label="Dietary requirements"
            category="dietary_requirement"
            values={plan.dietary_requirements}
            onChange={(v) => savePlan({ dietary_requirements: v })}
            canEdit={canEdit}
            addLabel="Add, e.g. Low salt"
          />
          <OptionChips
            label="Mobility aids"
            category="mobility_aid"
            values={plan.mobility_aids}
            onChange={(v) => savePlan({ mobility_aids: v })}
            canEdit={canEdit}
            addLabel="Add, e.g. Walking frame"
          />
          <OptionChips
            label="Communication needs"
            category="communication_need"
            values={plan.communication_needs}
            onChange={(v) => savePlan({ communication_needs: v })}
            canEdit={canEdit}
            addLabel="Add, e.g. Wears hearing aids"
          />
        </div>
      </div>

      <div className="card">
        <h3 className="text-sm font-semibold text-ink">Advance care directive</h3>
        <p className="text-sm text-muted mb-3">
          The document itself lives in{' '}
          <Link to="../documents" className="text-primary hover:underline">
            Documents
          </Link>
          .
        </p>
        <DirectiveSection profileId={profile.id} plan={plan} savePlan={savePlan} canEdit={canEdit} />
      </div>

      <div className="card">
        <h3 className="text-sm font-semibold text-ink">Emergency contacts</h3>
        <p className="text-sm text-muted mb-3">Who to call first, picked from the care circle and providers.</p>
        <EmergencyContactsTable
          profileId={profile.id}
          contacts={plan.emergency_contacts}
          onChange={(v) => savePlan({ emergency_contacts: v })}
          canEdit={canEdit}
        />
      </div>
    </div>
  );
}

/**
 * Whether a directive is in place, where it is kept (picked from a shared
 * list of places), and any directive documents surfaced from Documents.
 */
function DirectiveSection({
  profileId,
  plan,
  savePlan,
  canEdit,
}: {
  profileId: string;
  plan: CarePlan;
  savePlan: (patch: Partial<CarePlan>) => void;
  canEdit: boolean;
}) {
  const { data } = useQuery({
    queryKey: ['documents', profileId],
    queryFn: () => api.get<{ documents: CareDocument[] }>(`/care-profiles/${profileId}/documents`),
  });
  const directiveDocs = (data?.documents ?? []).filter((d) => d.category === 'advance_care_directive');

  return (
    <div className="space-y-3">
      <label className="flex items-center gap-2 text-sm text-ink">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          checked={plan.advance_care_directive}
          disabled={!canEdit}
          onChange={(e) => savePlan({ advance_care_directive: e.target.checked })}
        />
        An advance care directive is in place
      </label>
      {plan.advance_care_directive ? (
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-muted">Where it is kept:</span>
          {canEdit ? (
            <CatalogueCombo
              endpoint="/option-catalogue?category=directive_location"
              ariaLabel="Where the directive is kept"
              placeholder="e.g. With the GP"
              initial={plan.advance_care_directive_location ?? ''}
              keepValue
              onPick={(name) => savePlan({ advance_care_directive_location: name })}
              widthClass="w-56"
            />
          ) : (
            <span className="text-ink">{plan.advance_care_directive_location ?? 'Not recorded'}</span>
          )}
        </div>
      ) : null}
      {directiveDocs.length > 0 ? (
        <ul className="space-y-1">
          {directiveDocs.map((d) => (
            <li key={d.id} className="text-sm">
              <Link to="../documents" className="text-primary hover:underline">
                {d.label}
              </Link>{' '}
              <span className="text-muted">added {format(new Date(d.created_at), 'd MMM yyyy')}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-muted">No directive document on file.</p>
      )}
      {canEdit ? <DirectiveUpload profileId={profileId} /> : null}
    </div>
  );
}

/**
 * Upload the directive right here. The file lands in Documents under the
 * advance care directive category, exactly as if it were uploaded there.
 */
function DirectiveUpload({ profileId }: { profileId: string }) {
  const queryClient = useQueryClient();
  const [file, setFile] = useState<File | null>(null);
  const [error, setError] = useState('');

  const uploadMutation = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('file', file!);
      form.append('category', 'advance_care_directive');
      form.append('label', file!.name);
      return api.upload(`/care-profiles/${profileId}/documents`, form);
    },
    onSuccess: () => {
      setFile(null);
      setError('');
      void queryClient.invalidateQueries({ queryKey: ['documents', profileId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Upload failed'),
  });

  return (
    <div className="flex flex-wrap items-center gap-2">
      <input
        type="file"
        aria-label="Upload the advance care directive"
        className="text-sm text-muted file:mr-2 file:rounded-md file:border file:border-border file:bg-card file:px-3 file:py-1.5 file:text-sm file:text-ink file:cursor-pointer"
        onChange={(e) => setFile(e.target.files?.[0] ?? null)}
      />
      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={!file}
        loading={uploadMutation.isPending}
        onClick={() => uploadMutation.mutate()}
      >
        Upload directive
      </Button>
      {error ? <p className="text-sm text-red-600 w-full">{error}</p> : null}
    </div>
  );
}

/**
 * Emergency contacts as an editable table. Who to call is picked from the
 * people already in the system, the care circle and the providers, so the
 * name is never typed. The phone completes automatically for providers and
 * can be filled in for circle members.
 */
export function EmergencyContactsTable({
  profileId,
  contacts,
  onChange,
  canEdit,
}: {
  profileId: string;
  contacts: EmergencyContact[];
  onChange: (v: EmergencyContact[]) => void;
  canEdit: boolean;
}) {
  const [who, setWho] = useState('');
  const [customName, setCustomName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [phone, setPhone] = useState('');
  const [editingIndex, setEditingIndex] = useState<number | null>(null);
  const [editRelationship, setEditRelationship] = useState('');
  const [editPhone, setEditPhone] = useState('');

  const { data: circleData } = useQuery({
    queryKey: ['circle', profileId],
    queryFn: () => api.get<{ members: CircleMember[] }>(`/care-profiles/${profileId}/circle`),
    enabled: canEdit,
  });
  const { data: providerData } = useQuery({
    queryKey: ['providers', profileId],
    queryFn: () => api.get<{ providers: Provider[] }>(`/care-profiles/${profileId}/providers`),
    enabled: canEdit,
  });
  const members = circleData?.members ?? [];
  const providers = providerData?.providers ?? [];

  const pickWho = (value: string) => {
    setWho(value);
    if (value === 'other') {
      setCustomName('');
      setRelationship('');
      setPhone('');
      return;
    }
    const [source, id] = value.split(':');
    if (source === 'member') {
      const m = members.find((x) => x.id === id);
      setRelationship(m?.relationship ?? '');
      setPhone('');
    } else if (source === 'provider') {
      const p = providers.find((x) => x.id === id);
      setRelationship('');
      setPhone(p?.phone ?? '');
    }
  };

  const nameOf = (value: string): string => {
    if (value === 'other') return customName.trim();
    const [source, id] = value.split(':');
    if (source === 'member') return members.find((x) => x.id === id)?.display_name ?? '';
    if (source === 'provider') return providers.find((x) => x.id === id)?.name ?? '';
    return '';
  };

  const add = () => {
    const name = nameOf(who);
    if (!name || !phone.trim()) return;
    onChange([...contacts, { name, relationship: relationship || undefined, phone: phone.trim() }]);
    setWho('');
    setCustomName('');
    setRelationship('');
    setPhone('');
  };

  return (
    <div className="space-y-3">
      {contacts.length === 0 ? (
        <p className="text-sm text-muted">No emergency contacts recorded.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border">
                <th className="py-1.5 pr-3 text-left font-medium text-muted">Name</th>
                <th className="py-1.5 pr-3 text-left font-medium text-muted">Relationship</th>
                <th className="py-1.5 pr-3 text-left font-medium text-muted">Phone</th>
                {canEdit ? <th className="py-1.5 w-24" /> : null}
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {contacts.map((c, i) => (
                <tr key={`${c.name}-${i}`}>
                  <td className="py-2 pr-3 font-medium text-ink">{c.name}</td>
                  <td className="py-2 pr-3 text-ink">
                    {editingIndex === i ? (
                      <select
                        aria-label={`Relationship of ${c.name}`}
                        className={selectClass}
                        value={editRelationship}
                        onChange={(e) => setEditRelationship(e.target.value)}
                      >
                        <option value="">Prefer not to say</option>
                        {RELATIONSHIPS.filter((r) => r !== 'Myself').map((r) => (
                          <option key={r} value={r}>
                            {r}
                          </option>
                        ))}
                      </select>
                    ) : (
                      c.relationship ?? ''
                    )}
                  </td>
                  <td className="py-2 pr-3 text-ink whitespace-nowrap">
                    {editingIndex === i ? (
                      <Input
                        aria-label={`Phone for ${c.name}`}
                        type="tel"
                        value={editPhone}
                        onChange={(e) => setEditPhone(e.target.value)}
                        className="w-40"
                      />
                    ) : (
                      c.phone
                    )}
                  </td>
                  {canEdit ? (
                    <td className="py-2 text-right whitespace-nowrap">
                      {editingIndex === i ? (
                        <>
                          <Button
                            size="xs"
                            variant="secondary"
                            className="mr-1"
                            onClick={() => {
                              onChange(
                                contacts.map((x, idx) =>
                                  idx === i ? { ...x, relationship: editRelationship || undefined, phone: editPhone.trim() } : x
                                )
                              );
                              setEditingIndex(null);
                            }}
                          >
                            Save
                          </Button>
                          <Button size="xs" variant="ghost" onClick={() => setEditingIndex(null)}>
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button
                            size="xs"
                            variant="ghost"
                            className="mr-1"
                            onClick={() => {
                              setEditingIndex(i);
                              setEditRelationship(c.relationship ?? '');
                              setEditPhone(c.phone);
                            }}
                          >
                            Edit
                          </Button>
                          <Button
                            size="xs"
                            variant="ghost-danger"
                            onClick={() => onChange(contacts.filter((_, idx) => idx !== i))}
                          >
                            Delete
                          </Button>
                        </>
                      )}
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {canEdit ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Who</span>
            <select aria-label="Who to contact in an emergency" className={selectClass} value={who} onChange={(e) => pickWho(e.target.value)}>
              <option value="">Choose who to call</option>
              {members.length > 0 ? (
                <optgroup label="People in the care circle">
                  {members.map((m) => (
                    <option key={m.id} value={`member:${m.id}`}>
                      {m.display_name}
                      {m.relationship ? `, ${m.relationship}` : ''}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              {providers.length > 0 ? (
                <optgroup label="Providers">
                  {providers.map((p) => (
                    <option key={p.id} value={`provider:${p.id}`}>
                      {p.name}, {providerTypeLabel(p.provider_type)}
                    </option>
                  ))}
                </optgroup>
              ) : null}
              <option value="other">Someone not in PareCare</option>
            </select>
          </label>
          {who === 'other' ? (
            <label className="flex flex-col gap-1">
              <span className="text-xs text-muted">Name</span>
              <Input aria-label="Emergency contact name" value={customName} onChange={(e) => setCustomName(e.target.value)} className="w-40" />
            </label>
          ) : null}
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Relationship</span>
            <select aria-label="Relationship to this person" className={selectClass} value={relationship} onChange={(e) => setRelationship(e.target.value)}>
              <option value="">Prefer not to say</option>
              {RELATIONSHIPS.filter((r) => r !== 'Myself').map((r) => (
                <option key={r} value={r}>
                  {r}
                </option>
              ))}
            </select>
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs text-muted">Phone</span>
            <Input aria-label="Emergency contact phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-40" />
          </label>
          <Button type="button" variant="secondary" size="sm" disabled={!nameOf(who) || !phone.trim()} onClick={add}>
            Add
          </Button>
        </div>
      ) : null}
    </div>
  );
}
