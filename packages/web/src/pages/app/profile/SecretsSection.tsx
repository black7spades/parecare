import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { PencilIcon, TrashIcon } from '../../../components/ui/icons';
import { SortableTh } from '../../../components/data/SortableTh';
import { useDataView, type DataSort } from '../../../components/data/useDataView';
import { DataToolbar } from '../../../components/data/DataToolbar';

/**
 * The secrets vault: the logins kept for someone's life admin. It sits with
 * the documents because that is where people look for "the important papers",
 * but it answers to a much narrower rule than the rest of the record, which
 * the section states plainly rather than leaving to be discovered.
 */

export interface Secret {
  id: string;
  category: SecretCategory;
  label: string;
  website_url: string | null;
  username: string | null;
  password: string | null;
  account_number: string | null;
  notes: string | null;
}

type SecretCategory = 'social' | 'bank' | 'rental' | 'utility' | 'government' | 'shopping' | 'email' | 'other';

const CATEGORIES: { value: SecretCategory; label: string }[] = [
  { value: 'bank', label: 'Bank' },
  { value: 'social', label: 'Social account' },
  { value: 'rental', label: 'Rental' },
  { value: 'utility', label: 'Utility' },
  { value: 'government', label: 'Government' },
  { value: 'shopping', label: 'Shopping' },
  { value: 'email', label: 'Email' },
  { value: 'other', label: 'Other' },
];

export const secretCategoryLabel = (v: string): string =>
  CATEGORIES.find((c) => c.value === v)?.label ?? 'Other';

const SORTS: DataSort<Secret>[] = [
  { key: 'label', label: 'Name', compare: (a, b) => a.label.localeCompare(b.label) },
  { key: 'category', label: 'Kind', compare: (a, b) => secretCategoryLabel(a.category).localeCompare(secretCategoryLabel(b.category)) },
  { key: 'username', label: 'Sign in as', compare: (a, b) => (a.username ?? '').localeCompare(b.username ?? '') },
];

/** A password shown only when asked for, with a control to copy it. */
function PasswordCell({ value, label }: { value: string | null; label: string }) {
  const [shown, setShown] = useState(false);
  const [copied, setCopied] = useState(false);
  if (!value) return <span className="text-muted">-</span>;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className={shown ? 'font-mono text-xs text-ink' : 'text-muted tracking-widest'}>
        {shown ? value : '••••••••'}
      </span>
      <Button size="xs" variant="ghost" aria-label={shown ? `Hide the password for ${label}` : `Show the password for ${label}`} title={shown ? 'Hide' : 'Show'} onClick={() => setShown((v) => !v)}>
        {shown ? 'Hide' : 'Show'}
      </Button>
      <Button
        size="xs"
        variant="ghost"
        aria-label={`Copy the password for ${label}`}
        title="Copy"
        onClick={() => {
          void navigator.clipboard?.writeText(value);
          setCopied(true);
          window.setTimeout(() => setCopied(false), 1500);
        }}
      >
        {copied ? 'Copied' : 'Copy'}
      </Button>
    </span>
  );
}

export function SecretsSection({ profileId, careName }: { profileId: string; careName: string }) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Secret | null>(null);
  const [adding, setAdding] = useState(false);
  const [deleting, setDeleting] = useState<Secret | null>(null);

  // Ask first whether this viewer may see the vault at all, so a carer is
  // never shown a section that only refuses them.
  const { data: accessData, isLoading: accessLoading } = useQuery({
    queryKey: ['secrets-access', profileId],
    queryFn: () => api.get<{ access: 'owner' | 'poa' | null; can_view: boolean }>(`/care-profiles/${profileId}/secrets/access`),
  });
  const canView = accessData?.can_view ?? false;

  const { data, isLoading } = useQuery({
    queryKey: ['secrets', profileId],
    queryFn: () => api.get<{ secrets: Secret[] }>(`/care-profiles/${profileId}/secrets`),
    enabled: canView,
  });
  const secrets = data?.secrets ?? [];

  const dv = useDataView({
    rows: secrets,
    getId: (s) => s.id,
    sorts: SORTS,
    searchText: (s) => `${s.label} ${s.username ?? ''} ${s.website_url ?? ''} ${secretCategoryLabel(s.category)}`,
  });

  const refresh = () => {
    void queryClient.invalidateQueries({ queryKey: ['secrets', profileId] });
  };

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profileId}/secrets/${id}`),
    onSuccess: () => { refresh(); setDeleting(null); },
  });

  if (accessLoading) return null;
  // Not the owner, and no power of attorney after a death: the section is not
  // shown at all.
  if (!canView) return null;

  return (
    <div className="card">
      <div className="flex items-center gap-2 mb-1">
        <h2 className="text-base font-semibold text-ink">Secrets</h2>
        <Button size="sm" variant="secondary" className="ml-auto" onClick={() => setAdding(true)}>Add a login</Button>
      </div>
      <p className="text-sm text-muted mb-4">
        The logins kept for {careName}: social accounts, the rental, the bank.{' '}
        {accessData?.access === 'poa'
          ? 'You are seeing these as a power of attorney, now that a date of death has been recorded.'
          : 'Only you, as the account owner, sees these. Carers, editors and viewers in the care circle never do, and neither do platform administrators. A power of attorney in the care circle gains access once a date of death is recorded.'}{' '}
        Passwords are stored encrypted.
      </p>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : secrets.length === 0 ? (
        <p className="text-sm text-muted">No logins kept yet.</p>
      ) : (
        <>
          <DataToolbar
            search={dv.search}
            onSearch={dv.setSearch}
            searchPlaceholder="Search logins…"
            sorts={SORTS}
            sortKey={dv.sortKey}
            onSort={dv.setSortKey}
            page={dv.page}
            totalPages={dv.totalPages}
            pageSize={dv.pageSize}
            totalFiltered={dv.totalFiltered}
            onPageChange={dv.setPage}
            onPageSizeChange={dv.setPageSize}
          />
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left">
                  <SortableTh label="Name" sortKey="label" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  <SortableTh label="Kind" sortKey="category" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  <SortableTh label="Sign in as" sortKey="username" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  <th className="px-3 py-2 font-medium text-muted">Password</th>
                  <th className="px-3 py-2 font-medium text-muted">Account number</th>
                  <th className="px-3 py-2 font-medium text-muted">Website</th>
                  <th className="px-3 py-2 font-medium text-muted">Actions</th>
                </tr>
              </thead>
              <tbody>
                {dv.view.map((s) => (
                  <tr key={s.id} className="border-b border-border last:border-0 align-top">
                    <td className="px-3 py-2 text-ink font-medium">{s.label}</td>
                    <td className="px-3 py-2 text-muted">{secretCategoryLabel(s.category)}</td>
                    <td className="px-3 py-2 text-muted">{s.username || '-'}</td>
                    <td className="px-3 py-2"><PasswordCell value={s.password} label={s.label} /></td>
                    <td className="px-3 py-2 text-muted">{s.account_number || '-'}</td>
                    <td className="px-3 py-2 text-muted max-w-48 truncate">
                      {s.website_url ? (
                        <a href={s.website_url} target="_blank" rel="noreferrer noopener" className="text-primary hover:underline">
                          {s.website_url}
                        </a>
                      ) : '-'}
                    </td>
                    <td className="px-3 py-2">
                      <div className="flex gap-1">
                        <Button size="xs" variant="ghost" aria-label={`Edit ${s.label}`} title="Edit" onClick={() => setEditing(s)}><PencilIcon /></Button>
                        <Button size="xs" variant="ghost-danger" aria-label={`Delete ${s.label}`} title="Delete" onClick={() => setDeleting(s)}><TrashIcon /></Button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}

      {adding || editing ? (
        <SecretEditor
          profileId={profileId}
          secret={editing}
          onClose={() => { setAdding(false); setEditing(null); }}
          onSaved={() => { refresh(); setAdding(false); setEditing(null); }}
        />
      ) : null}

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title="Delete login">
        <p className="text-sm text-muted mb-4">
          Delete <span className="font-medium text-ink">{deleting?.label}</span>? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleting(null)}>Cancel</Button>
          <Button variant="danger" loading={deleteMutation.isPending} onClick={() => deleting && deleteMutation.mutate(deleting.id)}>Delete</Button>
        </div>
      </Modal>
    </div>
  );
}

/** Add or edit one login. Every fact its own input. */
function SecretEditor({
  profileId,
  secret,
  onClose,
  onSaved,
}: {
  profileId: string;
  secret: Secret | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [category, setCategory] = useState<SecretCategory>('other');
  const [label, setLabel] = useState('');
  const [websiteUrl, setWebsiteUrl] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [accountNumber, setAccountNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [error, setError] = useState('');

  useEffect(() => {
    setCategory(secret?.category ?? 'other');
    setLabel(secret?.label ?? '');
    setWebsiteUrl(secret?.website_url ?? '');
    setUsername(secret?.username ?? '');
    setPassword(secret?.password ?? '');
    setShowPassword(false);
    setAccountNumber(secret?.account_number ?? '');
    setNotes(secret?.notes ?? '');
    setError('');
  }, [secret]);

  const mutation = useMutation({
    mutationFn: () => {
      const body = {
        category,
        label: label.trim(),
        website_url: websiteUrl.trim() || null,
        username: username.trim() || null,
        password: password.trim() || null,
        account_number: accountNumber.trim() || null,
        notes: notes.trim() || null,
      };
      return secret
        ? api.patch(`/care-profiles/${profileId}/secrets/${secret.id}`, body)
        : api.post(`/care-profiles/${profileId}/secrets`, body);
    },
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save'),
  });

  return (
    <Modal open onClose={onClose} title={secret ? 'Edit login' : 'Add a login'}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (label.trim()) mutation.mutate(); }}>
        <Input label="Name" value={label} onChange={(e) => setLabel(e.target.value)} hint="What this login is for, e.g. Commonwealth Bank" required />
        <label className="block">
          <span className="block text-sm font-medium text-ink mb-1">Kind</span>
          <select
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={category}
            onChange={(e) => setCategory(e.target.value as SecretCategory)}
          >
            {CATEGORIES.map((c) => <option key={c.value} value={c.value}>{c.label}</option>)}
          </select>
        </label>
        <Input label="Website" value={websiteUrl} onChange={(e) => setWebsiteUrl(e.target.value)} hint="Where you sign in, e.g. https://netbank.com.au" />
        <Input label="Sign in as" value={username} onChange={(e) => setUsername(e.target.value)} hint="The username, member number or email used to sign in" />
        <div>
          <Input label="Password" type={showPassword ? 'text' : 'password'} value={password} onChange={(e) => setPassword(e.target.value)} hint="Stored encrypted" />
          <Button type="button" size="xs" variant="ghost" className="mt-1" onClick={() => setShowPassword((v) => !v)}>
            {showPassword ? 'Hide password' : 'Show password'}
          </Button>
        </div>
        <Input label="Account number" value={accountNumber} onChange={(e) => setAccountNumber(e.target.value)} hint="The account, membership or reference number, when there is one" />
        <label className="block">
          <span className="block text-sm font-medium text-ink mb-1">Notes</span>
          <textarea
            className="w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            rows={3}
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            placeholder="Anything else worth keeping, such as the security question answer"
          />
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending} disabled={!label.trim()}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}
