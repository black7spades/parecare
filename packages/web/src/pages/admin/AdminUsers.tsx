import { useCallback, useEffect, useState } from 'react';
import { useAuthStore, type AccountRole } from '../../stores/auth';
import { adminApi, type AdminAccount, type AdminStats } from '../../api/admin';
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
      <div className="mb-6">
        <h1 className="text-xl font-semibold text-ink">User administration</h1>
        <p className="text-sm text-muted">Manage accounts, roles and subscription tiers.</p>
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
                <tr key={a.id} className="border-b border-border last:border-0">
                  <td className="px-4 py-3">
                    <div className="font-medium text-ink">{a.display_name}</div>
                    <div className="text-xs text-muted">{a.email}</div>
                  </td>
                  <td className="px-4 py-3">
                    <RoleBadge role={a.role} />
                  </td>
                  <td className="px-4 py-3 capitalize">{a.subscription_tier}</td>
                  <td className="px-4 py-3 text-muted">{new Date(a.created_at).toLocaleDateString()}</td>
                  <td className="px-4 py-3 text-right space-x-2 whitespace-nowrap">
                    {canEdit(a) ? (
                      <Button size="sm" variant="secondary" onClick={() => setEditing(a)}>
                        Edit
                      </Button>
                    ) : null}
                    {canEdit(a) && a.id !== me?.id ? (
                      <Button size="sm" variant="danger" onClick={() => setDeleting(a)}>
                        Delete
                      </Button>
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
