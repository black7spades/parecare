import { useCallback, useEffect, useState } from 'react';
import { useAuthStore, type AccountRole } from '../../stores/auth';
import { adminApi, type AdminAccount, type AdminCareProfile, type AdminGroup, type AdminInvitation, type AdminListParams, type AdminStats, type RightsTemplate } from '../../api/admin';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { DataToolbar } from '../../components/data/DataToolbar';

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
  const [sort, setSort] = useState<NonNullable<AdminListParams['sort']>>('joined');
  const [group, setGroup] = useState<AdminGroup | ''>('');
  const [roleFilter, setRoleFilter] = useState('');
  const [tierFilter, setTierFilter] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  // Type-to-search with a short debounce, like every other list.
  useEffect(() => {
    const t = setTimeout(() => {
      setPage(1);
      setQuery(search.trim());
    }, 300);
    return () => clearTimeout(t);
  }, [search]);

  const [editing, setEditing] = useState<AdminAccount | null>(null);
  const [deleting, setDeleting] = useState<AdminAccount | null>(null);
  const [creating, setCreating] = useState(false);
  const [inviting, setInviting] = useState(false);
  const [assigning, setAssigning] = useState<AdminAccount | null>(null);
  const [invitesVersion, setInvitesVersion] = useState(0);

  // Row selection for bulk actions, and the rights templates they apply.
  const [selected, setSelected] = useState<string[]>([]);
  const [applyingTemplate, setApplyingTemplate] = useState(false);
  const [templates, setTemplates] = useState<RightsTemplate[]>([]);
  const loadTemplates = useCallback(async () => {
    try {
      const res = await adminApi.listRightsTemplates();
      setTemplates(res.templates);
    } catch {
      /* section shows empty; errors surface on save */
    }
  }, []);
  useEffect(() => {
    void loadTemplates();
  }, [loadTemplates]);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [list, s] = await Promise.all([
        adminApi.listAccounts({
          search: query || undefined,
          page,
          per_page: perPage,
          sort,
          group: group || undefined,
          role: (roleFilter || undefined) as AdminListParams['role'],
          tier: (tierFilter || undefined) as AdminListParams['tier'],
          status: (statusFilter || undefined) as AdminListParams['status'],
        }),
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
  }, [query, page, perPage, sort, group, roleFilter, tierFilter, statusFilter]);

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
        <div className="grid grid-cols-2 sm:grid-cols-5 gap-3 mb-6">
          <StatCard label="All accounts" value={stats.total} active={group === ''} onClick={() => { setGroup(''); setPage(1); }} />
          <StatCard label="Super admins" value={stats.groups.super_admin} active={group === 'super_admin'} onClick={() => { setGroup('super_admin'); setPage(1); }} />
          <StatCard label="Admins" value={stats.groups.admin} active={group === 'admin'} onClick={() => { setGroup('admin'); setPage(1); }} />
          <StatCard label="Carers" value={stats.groups.carer} active={group === 'carer'} onClick={() => { setGroup('carer'); setPage(1); }} hint="Own a care profile or contribute to a circle" />
          <StatCard label="Viewers" value={stats.groups.viewer} active={group === 'viewer'} onClick={() => { setGroup('viewer'); setPage(1); }} hint="View-only access everywhere" />
        </div>
      ) : null}

      <div className="mb-4">
        <DataToolbar
          search={search}
          onSearch={setSearch}
          searchPlaceholder="Search by email or name…"
          sorts={[
            { key: 'joined', label: 'Newest first' },
            { key: 'name', label: 'Name' },
            { key: 'email', label: 'Email' },
            { key: 'role', label: 'Role' },
            { key: 'tier', label: 'Tier' },
          ]}
          sortKey={sort}
          onSort={(k) => {
            setSort(k as typeof sort);
            setPage(1);
          }}
          filters={[
            {
              key: 'role',
              label: 'Roles',
              options: [
                { value: 'super_admin', label: 'Super admin' },
                { value: 'admin', label: 'Admin' },
                { value: 'user', label: 'User' },
              ],
            },
            {
              key: 'tier',
              label: 'Tiers',
              options: [
                { value: 'free', label: 'Free' },
                { value: 'family', label: 'Family' },
                { value: 'professional', label: 'Professional' },
              ],
            },
            {
              key: 'status',
              label: 'Statuses',
              options: [
                { value: 'active', label: 'Active' },
                { value: 'disabled', label: 'Disabled' },
              ],
            },
          ]}
          filterValues={{ role: roleFilter, tier: tierFilter, status: statusFilter }}
          onFilter={(key, value) => {
            if (key === 'role') setRoleFilter(value);
            if (key === 'tier') setTierFilter(value);
            if (key === 'status') setStatusFilter(value);
            setPage(1);
          }}
          selectedCount={selected.length}
          bulkActions={[{ key: 'apply-template', label: 'Apply rights template', onRun: () => setApplyingTemplate(true) }]}
          onClearSelection={() => setSelected([])}
        />
      </div>

      {error ? <p className="text-sm text-red-600 mb-4">{error}</p> : null}

      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border">
              <th className="pl-4 pr-1 py-3 w-8">
                <input
                  type="checkbox"
                  aria-label="Select everyone on this page"
                  className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                  checked={accounts.length > 0 && accounts.every((a) => selected.includes(a.id))}
                  onChange={(e) =>
                    setSelected(
                      e.target.checked
                        ? [...new Set([...selected, ...accounts.map((a) => a.id)])]
                        : selected.filter((id) => !accounts.some((a) => a.id === id))
                    )
                  }
                />
              </th>
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
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  Loading…
                </td>
              </tr>
            ) : accounts.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-muted">
                  No accounts found.
                </td>
              </tr>
            ) : (
              accounts.map((a) => (
                <tr key={a.id} className={`border-b border-border last:border-0 ${a.disabled_at ? 'opacity-60' : ''}`}>
                  <td className="pl-4 pr-1 py-3">
                    <input
                      type="checkbox"
                      aria-label={`Select ${a.display_name}`}
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      checked={selected.includes(a.id)}
                      onChange={(e) =>
                        setSelected(e.target.checked ? [...selected, a.id] : selected.filter((id) => id !== a.id))
                      }
                    />
                  </td>
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
        templates={templates}
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
        templates={templates}
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

      <ApplyTemplateModal
        open={applyingTemplate}
        templates={templates}
        accountIds={selected}
        accounts={accounts}
        onClose={() => setApplyingTemplate(false)}
        onApplied={() => {
          setApplyingTemplate(false);
          setSelected([]);
          void load();
        }}
      />

      <TemplatesSection templates={templates} onChanged={() => void loadTemplates()} />

      <InvitationsSection key={invitesVersion} />
    </div>
  );
}

/** A count that IS the filter: click it to see exactly those people. */
function StatCard({
  label,
  value,
  active,
  onClick,
  hint,
}: {
  label: string;
  value: number;
  active: boolean;
  onClick: () => void;
  hint?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={hint}
      aria-pressed={active}
      className={`card py-4 text-left transition-colors cursor-pointer hover:border-primary ${
        active ? 'border-primary ring-1 ring-primary' : ''
      }`}
    >
      <div className="text-2xl font-semibold text-ink">{value}</div>
      <div className={`text-xs ${active ? 'text-primary font-medium' : 'text-muted'}`}>{label}</div>
    </button>
  );
}

const ACCOUNT_RIGHTS = [
  {
    key: 'can_create_care_profiles',
    label: 'Create care profiles',
    description: 'Add their own people to care for. Usually off for invited helpers.',
  },
  {
    key: 'can_invite_members',
    label: 'Invite people to care circles',
    description: 'Send invitations for care profiles they own.',
  },
  {
    key: 'can_use_ai',
    label: 'Use the AI assistant',
    description: 'Chat with the assistant and request AI mediation on questions.',
  },
  {
    key: 'can_export_data',
    label: 'Export data',
    description: 'Download CSV and JSON exports of records.',
  },
] as const;

type RightsState = Record<(typeof ACCOUNT_RIGHTS)[number]['key'], boolean>;

const templateRights = (t: RightsTemplate): RightsState => ({
  can_create_care_profiles: t.can_create_care_profiles,
  can_invite_members: t.can_invite_members,
  can_use_ai: t.can_use_ai,
  can_export_data: t.can_export_data,
});

/** One line summary of a template's rights, e.g. "Use the AI assistant, Export data". */
function rightsSummary(t: RightsTemplate): string {
  const on = ACCOUNT_RIGHTS.filter((r) => t[r.key]).map((r) => r.label);
  return on.length === 0 ? 'Nothing enabled' : on.join(', ');
}

/** Granular per-account rights. Admins and super admins always pass every one. */
function RightsChecklist({
  rights,
  onChange,
  templates = [],
}: {
  rights: RightsState;
  onChange: (r: RightsState) => void;
  templates?: RightsTemplate[];
}) {
  return (
    <fieldset className="rounded-md border border-border p-3 space-y-3">
      <legend className="text-sm font-medium text-ink px-1">What this account can do</legend>
      {templates.length > 0 ? (
        <select
          aria-label="Start from a rights template"
          className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
          value={templates.find((t) => ACCOUNT_RIGHTS.every((r) => t[r.key] === rights[r.key]))?.id ?? ''}
          onChange={(e) => {
            const t = templates.find((x) => x.id === e.target.value);
            if (t) onChange(templateRights(t));
          }}
        >
          <option value="">Start from a template…</option>
          {templates.map((t) => (
            <option key={t.id} value={t.id}>
              {t.name}
            </option>
          ))}
        </select>
      ) : null}
      {ACCOUNT_RIGHTS.map((r) => (
        <label key={r.key} className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
            checked={rights[r.key]}
            onChange={(e) => onChange({ ...rights, [r.key]: e.target.checked })}
          />
          <span>
            {r.label}
            <span className="block text-xs text-muted">{r.description}</span>
          </span>
        </label>
      ))}
    </fieldset>
  );
}

function EditAccountModal({
  account,
  isSuperAdmin,
  selfId,
  templates,
  onClose,
  onSaved,
}: {
  account: AdminAccount | null;
  isSuperAdmin: boolean;
  selfId?: string;
  templates: RightsTemplate[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [email, setEmail] = useState('');
  const [tier, setTier] = useState<AdminAccount['subscription_tier']>('free');
  const [role, setRole] = useState<AccountRole>('user');
  const [rights, setRights] = useState<RightsState>({
    can_create_care_profiles: true,
    can_invite_members: true,
    can_use_ai: true,
    can_export_data: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (account) {
      setFirstName(account.first_name ?? account.display_name.split(' ')[0] ?? '');
      setMiddleName(account.middle_name ?? '');
      setLastName(account.last_name ?? '');
      setEmail(account.email);
      setTier(account.subscription_tier);
      setRole(account.role);
      setRights({
        can_create_care_profiles: account.can_create_care_profiles,
        can_invite_members: account.can_invite_members,
        can_use_ai: account.can_use_ai,
        can_export_data: account.can_export_data,
      });
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
      if (firstName.trim() !== (account.first_name ?? '')) updates.first_name = firstName.trim();
      if (middleName.trim() !== (account.middle_name ?? '')) updates.middle_name = middleName.trim() || null;
      if (lastName.trim() !== (account.last_name ?? '')) updates.last_name = lastName.trim() || null;
      if (email !== account.email) updates.email = email;
      if (tier !== account.subscription_tier) updates.subscription_tier = tier;
      for (const r of ACCOUNT_RIGHTS) {
        if (rights[r.key] !== account[r.key]) updates[r.key] = rights[r.key];
      }
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          <Input label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <Input label="Middle name" value={middleName} onChange={(e) => setMiddleName(e.target.value)} />
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <RightsChecklist rights={rights} onChange={setRights} templates={templates} />
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
  templates,
  onClose,
  onSaved,
}: {
  open: boolean;
  isSuperAdmin: boolean;
  templates: RightsTemplate[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<AccountRole>('user');
  const [rights, setRights] = useState<RightsState>({
    can_create_care_profiles: false,
    can_invite_members: true,
    can_use_ai: true,
    can_export_data: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setEmail('');
      setFirstName('');
      setMiddleName('');
      setLastName('');
      setPassword('');
      setRole('user');
      setRights({ can_create_care_profiles: false, can_invite_members: true, can_use_ai: true, can_export_data: true });
      setError('');
    }
  }, [open]);

  if (!open) return null;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      await adminApi.createAccount({
        email,
        first_name: firstName.trim(),
        middle_name: middleName.trim() || null,
        last_name: lastName.trim() || null,
        password,
        role,
        ...rights,
      });
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
        <div className="grid gap-4 sm:grid-cols-2">
          <Input label="First name" value={firstName} onChange={(e) => setFirstName(e.target.value)} required />
          <Input label="Last name" value={lastName} onChange={(e) => setLastName(e.target.value)} />
        </div>
        <Input label="Middle name" value={middleName} onChange={(e) => setMiddleName(e.target.value)} />
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <Input
          label="Temporary password"
          type="text"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          required
          hint="At least 8 characters"
        />
        <RightsChecklist rights={rights} onChange={setRights} templates={templates} />
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

/** Stamp a template's rights onto every selected account. */
function ApplyTemplateModal({
  open,
  templates,
  accountIds,
  accounts,
  onClose,
  onApplied,
}: {
  open: boolean;
  templates: RightsTemplate[];
  accountIds: string[];
  accounts: AdminAccount[];
  onClose: () => void;
  onApplied: () => void;
}) {
  const [templateId, setTemplateId] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<{ applied: number; skipped: Array<{ reason: string }>; name: string } | null>(null);

  useEffect(() => {
    if (open) {
      setTemplateId('');
      setError('');
      setResult(null);
    }
  }, [open]);

  if (!open) return null;

  const names = accountIds
    .map((id) => accounts.find((a) => a.id === id)?.display_name)
    .filter(Boolean)
    .slice(0, 6);

  async function handleApply() {
    if (!templateId) {
      setError('Pick a template.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      const res = await adminApi.applyRightsTemplate(templateId, accountIds);
      setResult({ applied: res.applied.length, skipped: res.skipped, name: res.template.name });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to apply the template');
    } finally {
      setSaving(false);
    }
  }

  if (result) {
    return (
      <Modal open onClose={onApplied} title="Template applied">
        <p className="text-sm text-ink mb-2">
          {result.name} now applies to {result.applied} {result.applied === 1 ? 'account' : 'accounts'}.
        </p>
        {result.skipped.length > 0 ? (
          <ul className="text-xs text-amber-700 mb-2 list-disc pl-4">
            {result.skipped.map((s, i) => (
              <li key={i}>{s.reason}</li>
            ))}
          </ul>
        ) : null}
        <div className="flex justify-end">
          <Button onClick={onApplied}>Done</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={`Apply a rights template to ${accountIds.length} ${accountIds.length === 1 ? 'account' : 'accounts'}`}>
      <p className="text-sm text-muted mb-3">
        {names.join(', ')}
        {accountIds.length > names.length ? ` and ${accountIds.length - names.length} more` : ''}
      </p>
      <div className="space-y-2 mb-4">
        {templates.length === 0 ? (
          <p className="text-sm text-muted">No templates yet. Create one in the Rights templates section below.</p>
        ) : (
          templates.map((t) => (
            <label
              key={t.id}
              className={`flex items-start gap-2 rounded-md border p-3 cursor-pointer transition-colors ${
                templateId === t.id ? 'border-primary ring-1 ring-primary' : 'border-border hover:border-primary'
              }`}
            >
              <input
                type="radio"
                name="apply-template"
                className="mt-0.5 h-4 w-4 border-border text-primary focus:ring-primary"
                checked={templateId === t.id}
                onChange={() => setTemplateId(t.id)}
              />
              <span className="text-sm text-ink">
                <span className="font-medium">{t.name}</span>
                {t.description ? <span className="block text-xs text-muted">{t.description}</span> : null}
                <span className="block text-xs text-muted mt-0.5">Allows: {rightsSummary(t)}</span>
              </span>
            </label>
          ))
        )}
      </div>
      {error ? <p className="text-sm text-red-600 mb-3">{error}</p> : null}
      <div className="flex justify-end gap-2">
        <Button variant="ghost" onClick={onClose}>
          Cancel
        </Button>
        <Button loading={saving} disabled={!templateId} onClick={handleApply}>
          Apply template
        </Button>
      </div>
    </Modal>
  );
}

function TemplatesSection({ templates, onChanged }: { templates: RightsTemplate[]; onChanged: () => void }) {
  const [editing, setEditing] = useState<RightsTemplate | null>(null);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState('');

  return (
    <div className="mt-8">
      <div className="flex items-start justify-between gap-3 mb-3">
        <div>
          <h2 className="text-base font-semibold text-ink mb-1">Rights templates</h2>
          <p className="text-sm text-muted">
            Named bundles of account rights. Select people in the table above and apply a template to set them all at
            once.
          </p>
        </div>
        <Button variant="secondary" onClick={() => setCreating(true)}>
          New template
        </Button>
      </div>
      {error ? <p className="text-sm text-red-600 mb-2">{error}</p> : null}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead>
            <tr className="text-left text-xs text-muted border-b border-border">
              <th className="px-4 py-3 font-medium">Template</th>
              <th className="px-4 py-3 font-medium">Allows</th>
              <th className="px-4 py-3 font-medium text-right">Actions</th>
            </tr>
          </thead>
          <tbody>
            {templates.length === 0 ? (
              <tr>
                <td colSpan={3} className="px-4 py-6 text-center text-muted">
                  No templates yet.
                </td>
              </tr>
            ) : (
              templates.map((t) => (
                <tr key={t.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{t.name}</div>
                    {t.description ? <div className="text-xs text-muted">{t.description}</div> : null}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">{rightsSummary(t)}</td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    <Button size="sm" variant="secondary" onClick={() => setEditing(t)}>
                      Edit
                    </Button>
                    <Button
                      size="sm"
                      variant="danger"
                      onClick={async () => {
                        try {
                          await adminApi.deleteRightsTemplate(t.id);
                          setError('');
                          onChanged();
                        } catch (err) {
                          setError(err instanceof Error ? err.message : 'Failed to delete');
                        }
                      }}
                    >
                      Delete
                    </Button>
                  </td>
                </tr>
              ))
            )}
          </tbody>
        </table>
      </div>

      <TemplateModal
        open={creating}
        template={null}
        onClose={() => setCreating(false)}
        onSaved={() => {
          setCreating(false);
          onChanged();
        }}
      />
      <TemplateModal
        open={editing !== null}
        template={editing}
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          onChanged();
        }}
      />
    </div>
  );
}

function TemplateModal({
  open,
  template,
  onClose,
  onSaved,
}: {
  open: boolean;
  template: RightsTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [rights, setRights] = useState<RightsState>({
    can_create_care_profiles: false,
    can_invite_members: true,
    can_use_ai: true,
    can_export_data: true,
  });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (open) {
      setName(template?.name ?? '');
      setDescription(template?.description ?? '');
      setRights(
        template
          ? templateRights(template)
          : { can_create_care_profiles: false, can_invite_members: true, can_use_ai: true, can_export_data: true }
      );
      setError('');
    }
  }, [open, template]);

  if (!open) return null;

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError('');
    try {
      const body = { name: name.trim(), description: description.trim() || null, ...rights };
      if (template) await adminApi.updateRightsTemplate(template.id, body);
      else await adminApi.createRightsTemplate(body);
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save the template');
    } finally {
      setSaving(false);
    }
  }

  return (
    <Modal open onClose={onClose} title={template ? `Edit ${template.name}` : 'New rights template'}>
      <form onSubmit={handleSave} className="space-y-4">
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} required placeholder='e.g. "Night carer"' />
        <Input
          label="Description"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          placeholder="Who this template is for"
        />
        <RightsChecklist rights={rights} onChange={setRights} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            {template ? 'Save changes' : 'Create template'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
