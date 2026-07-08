import { useCallback, useEffect, useState } from 'react';
import { useAuthStore, type AccountRole } from '../../stores/auth';
import { adminApi, type AdminAccount, type AdminCareProfile, type AdminInvitation, type AdminStats } from '../../api/admin';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';

const ROLE_LABELS: Record<AccountRole, string> = {
  super_admin: 'Super admin',
  admin: 'Admin',
  user: 'User',
};

function RoleBadge({ role }: { role: AccountRole }) {
  const styles: Record<AccountRole, string> = {
    super_admin: 'bg-red-50 text-red-700',
    admin: 'bg-amber-50 text-amber-700',
    user: 'bg-surface-2 text-muted',
  };
  return <span className={`badge ${styles[role]}`}>{ROLE_LABELS[role]}</span>;
}

export function AdminUsers() {
  const me = useAuthStore((s) => s.account);
  const isSuperAdmin = me?.role === 'super_admin';

  const [accounts, setAccounts] = useState<AdminAccount[]>([]);
  const [stats, setStats] = useState<AdminStats | null>(null);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [perPage] = useState(25);
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  const [editing, setEditing] = useState<AdminAccount | null>(null);
  const [deleting, setDeleting] = useState<AdminAccount | null>(null);
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [assigning, setAssigning] = useState<AdminAccount | null>(null);
  const [invitesVersion, setInvitesVersion] = useState(0);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [list, s] = await Promise.all([
        adminApi.listAccounts({ search: query || undefined, page, per_page: perPage }),
        adminApi.stats(),
      ]);
      setAccounts(list.accounts);
      setTotal(list.total);
      setStats(s);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load accounts');
    } finally {
      setLoading(false);
    }
  }, [query, page, perPage]);

  useEffect(() => {
    void load();
  }, [load]);

  const totalPages = Math.max(1, Math.ceil(total / perPage));

  // Admins may only manage regular users; super admins manage everyone but themselves (for delete).
  function canEdit(target: AdminAccount) {
    return isSuperAdmin || target.role === 'user';
  }

  return (
    <div>
      <div className="mb-6 flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold text-ink">User administration</h1>
          <p className="text-sm text-muted">Create accounts, invite carers to the people they look after, and manage roles and tiers.</p>
        </div>
        <div className="flex gap-2">
          <Button variant="secondary" onClick={() => setCreating(true)}>Create user</Button>
          <Button onClick={() => setInviting(true)}>Invite to care</Button>
        </div>
      </div>

      {stats ? (
        <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 mb-6">
          <StatCard label="Total accounts" value={stats.total} />
          <StatCard label="Super admins" value={stats.by_role.super_admin ?? 0} />
          <StatCard label="Admins" value={stats.by_role.admin ?? 0} />
          <StatCard label="Users" value={stats.by_role.user ?? 0} />
        </div>
      ) : null}

      <form
        className="mb-4 flex gap-2"
        onSubmit={(e) => {
          e.preventDefault();
          setPage(1);
          setQuery(search.trim());
        }}
      >
        <div className="flex-1">
          <Input placeholder="Search by email or name…" value={search} onChange={(e) => setSearch(e.target.value)} />
        </div>
        <Button type="submit" variant="secondary">
          Search
        </Button>
      </form>

      {error ? <p className="text-sm text-red-600 mb-4">{error}</p> : null}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border">
              <th className="px-4 py-3 font-medium">Account</th>
              <th className="px-4 py-3 font-medium">Role</th>
              <th className="px-4 py-3 font-medium">Tier</th>
              <th className="px-4 py-3 font-medium">Joined</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  Loading…
                </td>
              </tr>
            ) : accounts.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-8 text-center text-muted">
                  No accounts found.
                </td>
              </tr>
            ) : (
              accounts.map((a) => (
                <tr key={a.id} className={`border-b border-border last:border-0 ${a.disabled_at ? 'opacity-60' : ''}`}>
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">
                      {a.display_name}
                      {a.disabled_at ? <span className="badge bg-surface-2 text-muted ml-2">Disabled</span> : null}
                    </div>
                    <div className="text-xs text-muted">{a.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <RoleBadge role={a.role} />
                  </td>
                  <td className="px-4 py-3 capitalize">{a.subscription_tier}</td>
                  <td className="px-4 py-3 text-muted">{new Date(a.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    {canEdit(a) ? (
                      <>
                        <Button size="sm" variant="secondary" onClick={() => setAssigning(a)}>
                          Assign to care
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>
                          Edit
                        </Button>
                      </>
                    ) : null}
                    {canEdit(a) && a.id !== me?.id ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            try {
                              await adminApi.setDisabled(a.id, !a.disabled_at);
                              void load();
                            } catch (err) {
                              setError(err instanceof Error ? err.message : 'Failed to update account');
                            }
                          }}
                        >
                          {a.disabled_at ? 'Enable' : 'Disable'}
                        </Button>
                        <Button size="sm" variant="danger" onClick={() => setDeleting(a)}>
                          Delete
                        </Button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      {totalPages > 1 ? (
        <div className="mt-4 flex items-center justify-between text-sm text-muted">
          <span>
            Page {page} of {totalPages} · {total} accounts
          </span>
          <div className="space-x-2">
            <Button size="sm" variant="secondary" disabled={page <= 1} onClick={() => setPage((p) => p - 1)}>
              Previous
            </Button>
            <Button size="sm" variant="secondary" disabled={page >= totalPages} onClick={() => setPage((p) => p + 1)}>
              Next
            </Button>
          </div>
        </div>
      ) : null}

      <EditAccountModal
        account={editing}
        isSuperAdmin={isSuperAdmin}
        selfId={me?.id}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          void load();
        }}
      />

      <DeleteAccountModal
        account={deleting}
        onClose={() => setDeleting(null)}
        onDeleted={() => {
          setDeleting(null);
          void load();
        }}
      />

      <CreateUserModal
        open={creating}
        isSuperAdmin={isSuperAdmin}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          void load();
        }}
      />

      <InviteToCareModal
        open={inviting}
        onClose={() => setInviting(false)}
        onSaved={() => {
          setInviting(false);
          setInvitesVersion((v) => v + 1);
        }}
      />

      <AssignToCareModal
        account={assigning}
        onClose={() => setAssigning(null)}
        onSaved={() => setAssigning(null)}
      />

      <InvitationsSection key={invitesVersion} />
    </div>
  );
}

function StatCard({ label, value }: { label: string; value: number }) {
  return (
    <div className="card py-4">
      <div className="text-2xl font-semibold text-ink">{value}</div>
      <div className="text-xs text-muted">{label}</div>
    </div>
  );
}

function EditAccountModal({
  account,
  isSuperAdmin,
  selfId,
  onClose,
  onSaved,
}: {
  account: AdminAccount | null;
  isSuperAdmin: boolean;
  selfId?: string;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [displayName, setDisplayName] = useState('');
  const [email, setEmail] = useState('');
  const [tier, setTier] = useState<AdminAccount['subscription_tier']>('free');
  const [role, setRole] = useState<AccountRole>('user');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (account) {
      setDisplayName(account.display_name);
      setEmail(account.email);
      setTier(account.subscription_tier);
      setRole(account.role);
      setError('');
    }
  }, [account]);

  if (!account) return null;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!account) return;
    setSaving(true);
    setError('');
    try {
      const updates: Parameters<typeof adminApi.updateAccount>[1] = {};
      if (displayName !== account.display_name) updates.display_name = displayName;
      if (email !== account.email) updates.email = email;
      if (tier !== account.subscription_tier) updates.subscription_tier = tier;
      if (Object.keys(updates).length > 0) {
        await adminApi.updateAccount(account.id, updates);
      }
      if (isSuperAdmin && role !== account.role) {
        await adminApi.updateRole(account.id, role);
      }
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={`Edit ${account.display_name}`}>
      <form onSubmit={handleSave} className="space-y-4">
        <Input label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <div>
          <label htmlFor="edit-tier" className="block text-sm font-medium text-ink mb-1">
            Subscription tier
          </label>
          <select
            id="edit-tier"
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={tier}
            onChange={(e) => setTier(e.target.value as AdminAccount['subscription_tier'])}
          >
            <option value="free">Free</option>
            <option value="family">Family</option>
            <option value="professional">Professional</option>
          </select>
        </div>
        {isSuperAdmin ? (
          <div>
            <label htmlFor="edit-role" className="block text-sm font-medium text-ink mb-1">
              Role
            </label>
            <select
              id="edit-role"
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              value={role}
              onChange={(e) => setRole(e.target.value as AccountRole)}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
              <option value="super_admin">Super admin</option>
            </select>
            {account.id === selfId ? (
              <p className="mt-1 text-xs text-muted">Demoting yourself will remove your access to this page.</p>
            ) : null}
          </div>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Save changes
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function DeleteAccountModal({
  account,
  onClose,
  onDeleted,
}: {
  account: AdminAccount | null;
  onClose: () => void;
  onDeleted: () => void;
}) {
  const [deleting, setDeleting] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setError('');
  }, [account]);

  if (!account) return null;

  async function handleDelete() {
    if (!account) return;
    setDeleting(true);
    setError('');
    try {
      await adminApi.deleteAccount(account.id);
      onDeleted();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to delete account');
    } finally {
      setDeleting(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Delete account">
      <p className="text-sm text-ink mb-2">
        Delete <span className="font-medium">{account.display_name}</span> ({account.email})?
      </p>
      <p className="text-sm text-muted mb-4">
        This permanently removes the account and all care profiles it owns. This cannot be undone.
      </p>
      {error ? <p className="text-sm text-red-600 mb-4">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button variant="danger" loading={deleting} onClick={handleDelete}>
          Delete account
        </Button>
      </div>
    </Modal>
  );
}

function CreateUserModal({
  open,
  isSuperAdmin,
  onClose,
  onSaved,
}: {
  open: boolean;
  isSuperAdmin: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AccountRole>('user');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setEmail('');
      setDisplayName('');
      setPassword('');
      setRole('user');
      setError('');
    }
  }, [open]);

  if (!open) return null;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await adminApi.createAccount({ email, display_name: displayName, password, role });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create the account');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title="Create user">
      <form onSubmit={handleSave} className="space-y-4">
        <p className="text-sm text-muted">
          The account works immediately with the password you set here; hand it to them securely and ask them to
          change it. To let them choose their own password instead, use Invite to care.
        </p>
        <Input label="Name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input
          label="Temporary password"
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          hint="At least 8 characters"
        />
        {isSuperAdmin ? (
          <div>
            <label htmlFor="create-role" className="block text-sm font-medium text-ink mb-1">
              Platform role
            </label>
            <select
              id="create-role"
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              value={role}
              onChange={(e) => setRole(e.target.value as AccountRole)}
            >
              <option value="user">User</option>
              <option value="admin">Admin</option>
              <option value="super_admin">Super admin</option>
            </select>
            <p className="mt-1 text-xs text-muted">Admins can manage users and see every care profile. Most people should be users.</p>
          </div>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Create user
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Checkbox list of every care profile, searchable, for bulk invites and assignments. */
function ProfileMultiPicker({
  selected,
  onChange,
}: {
  selected: string[];
  onChange: (ids: string[]) => void;
}) {
  const [profiles, setProfiles] = useState<AdminCareProfile[]>([]);
  const [search, setSearch] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    adminApi
      .listCareProfiles(search.trim() || undefined)
      .then((res) => {
        if (!cancelled) setProfiles(res.profiles);
      })
      .catch(() => {})
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [search]);

  function toggle(id: string) {
    onChange(selected.includes(id) ? selected.filter((s) => s !== id) : [...selected, id]);
  }

  return (
    <div>
      <label className="block text-sm font-medium text-ink mb-1">People they will help care for</label>
      <Input placeholder="Search people…" value={search} onChange={(e) => setSearch(e.target.value)} />
      <div className="mt-2 max-h-48 overflow-y-auto rounded-md border border-border divide-y divide-border">
        {loading ? (
          <p className="text-xs text-muted p-3">Loading…</p>
        ) : profiles.length === 0 ? (
          <p className="text-xs text-muted p-3">No care profiles found.</p>
        ) : (
          profiles.map((p) => (
            <label key={p.id} className="flex items-center gap-2 px-3 py-2 text-sm cursor-pointer hover:bg-surface-2">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                checked={selected.includes(p.id)}
                onChange={() => toggle(p.id)}
              />
              <span className="text-ink">{p.full_name}</span>
              <span className="text-xs text-muted ml-auto">{p.owner_name}</span>
            </label>
          ))
        )}
      </div>
      <p className="mt-1 text-xs text-muted">{selected.length} selected</p>
    </div>
  );
}

function CirclePermissionSelect({ value, onChange }: { value: 'viewer' | 'contributor'; onChange: (v: 'viewer' | 'contributor') => void }) {
  return (
    <div>
      <label htmlFor="bulk-permission" className="block text-sm font-medium text-ink mb-1">
        Access level in each care circle
      </label>
      <select
        id="bulk-permission"
        className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        value={value}
        onChange={(e) => onChange(e.target.value as 'viewer' | 'contributor')}
      >
        <option value="contributor">Contributor: can add and edit records</option>
        <option value="viewer">Viewer: can read and join the conversation only</option>
      </select>
    </div>
  );
}

/**
 * One invitation covering a set of people. The Serenity Place flow: a carer
 * covering a wing accepts once and lands in every resident's circle. If the
 * carer has no account yet, the link creates it.
 */
function InviteToCareModal({ open, onClose, onSaved }: { open: boolean; onClose: () => void; onSaved: () => void }) {
  const [email, setEmail] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [role, setRole] = useState('carer');
  const [permission, setPermission] = useState<'viewer' | 'contributor'>('contributor');
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ invite_url: string; member_count: number; skipped: Array<{ reason: string }> } | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (open) {
      setEmail('');
      setDisplayName('');
      setRole('carer');
      setPermission('contributor');
      setSelected([]);
      setError('');
      setResult(null);
    }
  }, [open]);

  if (!open) return null;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (selected.length === 0) {
      setError('Select at least one person.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await adminApi.createInvitation({
        email,
        display_name: displayName,
        role,
        permission,
        care_profile_ids: selected,
      });
      setResult({ invite_url: res.invite_url, member_count: res.member_count, skipped: res.skipped });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create the invitation');
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    return (
      <Modal open onClose={onSaved} title="Invitation created">
        <p className="text-sm text-muted mb-2">
          One invitation covering {result.member_count} {result.member_count === 1 ? 'person' : 'people'}. If email is
          configured it has been sent; either way you can hand over the link directly. It creates their account if
          they don't have one yet.
        </p>
        {result.skipped.length > 0 ? (
          <ul className="text-xs text-amber-700 mb-2 list-disc pl-4">
            {result.skipped.map((s, i) => (
              <li key={i}>{s.reason}</li>
            ))}
          </ul>
        ) : null}
        <p className="text-xs text-ink break-all font-mono rounded-md border border-border bg-surface-2 p-2.5 mb-4">{result.invite_url}</p>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(result.invite_url);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                /* manual copy still possible */
              }
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          <Button onClick={onSaved}>Done</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Invite someone to care for people">
      <form onSubmit={handleSave} className="space-y-4">
        <Input label="Their name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input label="Role in the circles" value={role} onChange={(e) => setRole(e.target.value)} required hint='e.g. "carer", "nurse", "case manager"' />
        <CirclePermissionSelect value={permission} onChange={setPermission} />
        <ProfileMultiPicker selected={selected} onChange={setSelected} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Create invitation
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** Place an EXISTING account into a set of care circles, no invite needed. */
function AssignToCareModal({ account, onClose, onSaved }: { account: AdminAccount | null; onClose: () => void; onSaved: () => void }) {
  const [role, setRole] = useState('carer');
  const [permission, setPermission] = useState<'viewer' | 'contributor'>('contributor');
  const [selected, setSelected] = useState<string[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ assigned: number; skipped: Array<{ reason: string }> } | null>(null);

  useEffect(() => {
    if (account) {
      setRole('carer');
      setPermission('contributor');
      setSelected([]);
      setError('');
      setDone(null);
    }
  }, [account]);

  if (!account) return null;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    if (!account) return;
    if (selected.length === 0) {
      setError('Select at least one person.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await adminApi.createAssignments({
        account_id: account.id,
        role,
        permission,
        care_profile_ids: selected,
      });
      setDone({ assigned: res.assigned.length, skipped: res.skipped });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to assign');
    } finally {
      setSaving(false);
    }
  }

  if (done) {
    return (
      <Modal open onClose={onSaved} title="Assignment complete">
        <p className="text-sm text-ink mb-2">
          {account.display_name} now has access to {done.assigned} {done.assigned === 1 ? 'person' : 'people'}.
        </p>
        {done.skipped.length > 0 ? (
          <ul className="text-xs text-amber-700 mb-2 list-disc pl-4">
            {done.skipped.map((s, i) => (
              <li key={i}>{s.reason}</li>
            ))}
          </ul>
        ) : null}
        <div className="flex justify-end">
          <Button onClick={onSaved}>Done</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={`Assign ${account.display_name} to care`}>
      <form onSubmit={handleSave} className="space-y-4">
        <p className="text-sm text-muted">
          Places {account.display_name} ({account.email}) straight into the care circle of each selected person, with
          no invitation step.
        </p>
        <Input label="Role in the circles" value={role} onChange={(e) => setRole(e.target.value)} required hint='e.g. "carer", "nurse", "case manager"' />
        <CirclePermissionSelect value={permission} onChange={setPermission} />
        <ProfileMultiPicker selected={selected} onChange={setSelected} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Assign
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function InvitationsSection() {
  const [invitations, setInvitations] = useState<AdminInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const res = await adminApi.listInvitations();
      setInvitations(res.invitations);
      setError('');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load invitations');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const statusStyle: Record<AdminInvitation['status'], string> = {
    pending: 'bg-primary-50 text-primary',
    accepted: 'bg-surface-2 text-muted',
    revoked: 'bg-surface-2 text-muted',
    expired: 'bg-amber-50 text-amber-700',
  };

  return (
    <div className="mt-8">
      <h2 className="text-base font-semibold text-ink mb-1">Invitations</h2>
      <p className="text-sm text-muted mb-3">Every invitation sent from anywhere in the system, with its link while it is pending.</p>
      {error ? <p className="text-sm text-red-600 mb-2">{error}</p> : null}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border">
              <th className="px-4 py-3 font-medium">Invitee</th>
              <th className="px-4 py-3 font-medium">People covered</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Expires</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {loading ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted">Loading…</td>
              </tr>
            ) : invitations.length === 0 ? (
              <tr>
                <td colSpan={5} className="px-4 py-6 text-center text-muted">No invitations yet.</td>
              </tr>
            ) : (
              invitations.map((inv) => (
                <tr key={inv.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{inv.display_name}</div>
                    <div className="text-xs text-muted">{inv.email}</div>
                  </td>
                  <td className="px-4 py-3 text-xs text-muted max-w-[16rem]">
                    {inv.profile_names.length > 0 ? inv.profile_names.join(', ') : '—'}
                  </td>
                  <td className="px-4 py-3">
                    <span className={`badge capitalize ${statusStyle[inv.status]}`}>{inv.status}</span>
                  </td>
                  <td className="px-4 py-3 text-muted">{new Date(inv.expires_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    {inv.status === 'pending' && inv.invite_url ? (
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={async () => {
                          try {
                            await navigator.clipboard.writeText(inv.invite_url!);
                            setCopiedId(inv.id);
                            setTimeout(() => setCopiedId(null), 2000);
                          } catch {
                            /* manual copy still possible */
                          }
                        }}
                      >
                        {copiedId === inv.id ? 'Copied' : 'Copy link'}
                      </Button>
                    ) : null}
                    {inv.status === 'pending' || inv.status === 'expired' ? (
                      <>
                        <Button
                          size="sm"
                          variant="ghost"
                          onClick={async () => {
                            try {
                              await adminApi.resendInvitation(inv.id);
                              void load();
                            } catch (err) {
                              setError(err instanceof Error ? err.message : 'Failed to resend');
                            }
                          }}
                        >
                          Resend
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={async () => {
                            try {
                              await adminApi.revokeInvitation(inv.id);
                              void load();
                            } catch (err) {
                              setError(err instanceof Error ? err.message : 'Failed to revoke');
                            }
                          }}
                        >
                          Revoke
                        </Button>
                      </>
                    ) : null}
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
