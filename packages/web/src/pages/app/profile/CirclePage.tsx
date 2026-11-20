import { useEffect, useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { EditableSubheader } from '../../../components/ui/EditableSubheader';
import { PencilIcon, CrossIcon } from '../../../components/ui/icons';
import { Input, Textarea } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { PoaBadge } from '../../../components/PoaBadge';
import {
  CIRCLE_ROLES,
  POA_TYPES,
  circleRoleLabel,
  circleStatusLabel,
  poaLabel,
  providerTypeLabel,
  type CircleMember,
  type Provider,
} from '../../../lib/care';
import { useHiddenIds, useUndoStore } from '../../../stores/undo';
import { RecordPanel } from '../../../components/record/RecordPanel';
import { RECORD_ROW_CLASS, useRecordPanel } from '../../../components/record/useRecordPanel';
import { format } from 'date-fns';
import { RelationshipSelect } from '../../../components/RelationshipSelect';
import { useProfile } from './ProfileLayout';
import { useDataView, type DataSort, type DataFilter } from '../../../components/data/useDataView';
import { DataToolbar } from '../../../components/data/DataToolbar';

const byName = (a: CircleMember, b: CircleMember) => a.display_name.localeCompare(b.display_name);

const CIRCLE_SORTS: DataSort<CircleMember>[] = [
  { key: 'name', label: 'By name (A–Z)', compare: byName },
  { key: 'role', label: 'By role', compare: (a, b) => a.role.localeCompare(b.role) || byName(a, b) },
  { key: 'newest', label: 'Newest first', compare: (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime() },
];

const isAdded = (m: CircleMember) => m.status === 'added';

const PRO_SORTS: DataSort<Provider>[] = [
  { key: 'name', label: 'By name (A–Z)', compare: (a, b) => a.name.localeCompare(b.name) },
  { key: 'type', label: 'By what they do', compare: (a, b) => providerTypeLabel(a.provider_type).localeCompare(providerTypeLabel(b.provider_type)) || a.name.localeCompare(b.name) },
];

export function CirclePage() {
  const { profile, canManageEditors, careName } = useProfile();
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [addOpen, setAddOpen] = useState(false);
  // Inviting someone who was added by name to log in.
  const [invitingAdded, setInvitingAdded] = useState<CircleMember | null>(null);
  const deferDelete = useUndoStore((st) => st.deferDelete);
  const hidden = useHiddenIds();
  const [editing, setEditing] = useState<CircleMember | null>(null);
  // Taking someone out of the circle ends their access, so it still asks
  // first, for one person or several.
  const [removing, setRemoving] = useState<CircleMember[] | null>(null);
  const [bulkEditQueue, setBulkEditQueue] = useState<CircleMember[]>([]);

  const { data, isLoading } = useQuery({
    queryKey: ['circle', profile.id],
    queryFn: () => api.get<{ members: CircleMember[] }>(`/care-profiles/${profile.id}/circle`),
  });
  const members = (data?.members ?? []).filter((m) => !hidden.has(m.id));
  const panel = useRecordPanel(members, (m) => m.id);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['circle', profile.id] });

  // Doctors, psychologists and other professionals live in Contacts, so the
  // same person is linked to appointments. They show here too.
  const { data: providerData } = useQuery({
    queryKey: ['providers', profile.id],
    queryFn: () => api.get<{ providers: Provider[] }>(`/care-profiles/${profile.id}/providers`),
  });
  const professionals = useMemo(
    () => (providerData?.providers ?? []).filter((p) => p.kind !== 'organisation'),
    [providerData]
  );
  const pro = useDataView<Provider>({
    rows: professionals,
    getId: (p) => p.id,
    searchText: (p) => [p.name, providerTypeLabel(p.provider_type), p.organisation, p.phone, p.email].filter(Boolean).join(' '),
    sorts: PRO_SORTS,
  });

  // Someone added by name loses nothing by going, so it is Undo, not a
  // question. Anyone who logs in loses access, so that still asks first.
  const removeOrAsk = (list: CircleMember[]) => {
    if (list.length === 0) return;
    if (list.every(isAdded)) {
      deferDelete({
        message: list.length === 1 ? `Removed ${list[0].display_name} from the circle.` : `Removed ${list.length} people from the circle.`,
        ids: list.map((m) => m.id),
        commit: async () => {
          for (const m of list) await api.delete(`/care-profiles/${profile.id}/circle/${m.id}`);
        },
        onCommitted: invalidate,
      });
      dv.clearSelection();
      return;
    }
    setRemoving(list);
  };

  const removeMutation = useMutation({
    mutationFn: async (ids: string[]) => {
      for (const id of ids) await api.delete(`/care-profiles/${profile.id}/circle/${id}`);
    },
    onSuccess: () => {
      setRemoving(null);
      dv.clearSelection();
      invalidate();
    },
  });

  const roleFilter: DataFilter<CircleMember> = {
    key: 'role',
    label: 'Role',
    options: [...new Set(members.map((m) => m.role))].sort().map((r) => ({ value: r, label: r.charAt(0).toUpperCase() + r.slice(1) })),
    match: (m, v) => m.role === v,
  };
  const permissionFilter: DataFilter<CircleMember> = {
    key: 'permission',
    label: 'Access level',
    options: [
      { value: 'contributor', label: 'Contributor' },
      { value: 'viewer', label: 'Viewer' },
    ],
    // Someone added by name has no access level at all.
    match: (m, v) => !isAdded(m) && m.permission === v,
  };
  const statusFilter: DataFilter<CircleMember> = {
    key: 'status',
    label: 'Status',
    options: [
      { value: 'active', label: 'Active' },
      { value: 'invited', label: 'Invite pending' },
      { value: 'added', label: 'No login' },
    ],
    match: (m, v) => (m.status ?? (m.invite_accepted ? 'active' : 'invited')) === v,
  };

  const dv = useDataView<CircleMember>({
    rows: members,
    getId: (m) => m.id,
    searchText: (m) => [m.display_name, m.role, m.relationship, m.invited_email, m.email, m.phone, m.role_description].filter(Boolean).join(' '),
    sorts: CIRCLE_SORTS,
    filters: [roleFilter, permissionFilter, statusFilter],
  });

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Care circle</h2>
          <EditableSubheader copyKey="profile.circle.subheader" vars={{ name: careName }} />
        </div>
        {canManageEditors ? (
          <div className="flex gap-2 self-start sm:self-auto">
            <Button onClick={() => setAddOpen(true)}>Add someone</Button>
            <Button variant="secondary" onClick={() => setInviteOpen(true)}>Invite someone</Button>
          </div>
        ) : null}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : members.length === 0 && professionals.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm text-muted mb-4">
            No one in the circle yet. Add the people around {careName}: family, friends, a neighbour, their doctor. Nobody needs an account. Invite anyone who should log in too.
          </p>
          {canManageEditors ? <Button onClick={() => setAddOpen(true)}>Add someone</Button> : null}
        </div>
      ) : members.length === 0 ? null : (
        <>
          <DataToolbar
            search={dv.search}
            onSearch={dv.setSearch}
            searchPlaceholder="Search circle members…"
            sorts={CIRCLE_SORTS.map((s) => ({ key: s.key, label: s.label }))}
            sortKey={dv.sortKey}
            onSort={dv.setSortKey}
            filters={[roleFilter, permissionFilter, statusFilter].map((f) => ({ key: f.key, label: f.label, options: f.options }))}
            filterValues={dv.filterValues}
            onFilter={dv.setFilter}
            selectedCount={dv.selectedRows.length}
            bulkActions={
              canManageEditors
                ? [
                    { key: 'edit', label: 'Edit selected', onRun: () => { const q = [...dv.selectedRows]; setBulkEditQueue(q); setEditing(q[0] ?? null); } },
                    { key: 'remove', label: 'Remove selected', destructive: true, onRun: () => removeOrAsk([...dv.selectedRows]) },
                  ]
                : []
            }
            onClearSelection={dv.clearSelection}
            page={dv.page}
            totalPages={dv.totalPages}
            pageSize={dv.pageSize}
            totalFiltered={dv.totalFiltered}
            onPageChange={dv.setPage}
            onPageSizeChange={dv.setPageSize}
          />
          <div className="grid gap-4 sm:grid-cols-2 mt-4">
            {dv.view.length === 0 ? (
              <div className="col-span-full card text-center py-10">
                <p className="text-sm text-muted">No circle members match your search or filters.</p>
              </div>
            ) : dv.view.map((m) => (
              <div key={m.id} {...panel.rowProps(m.id)} className={`card ${RECORD_ROW_CLASS} ${m.poa_activated ? 'border-amber-400' : ''}`}>
                {canManageEditors ? (
                  <div className="mb-2">
                    <input
                      type="checkbox"
                      className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                      checked={dv.selected.has(m.id)}
                      onChange={() => dv.toggle(m.id)}
                      aria-label={`Select ${m.display_name}`}
                    />
                  </div>
                ) : null}
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <div className="flex items-center gap-2 flex-wrap">
                      <h3 className="text-sm font-semibold text-ink">{m.display_name}</h3>
                      <PoaBadge type={m.poa_type} activated={m.poa_activated} />
                    </div>
                    <p className="text-xs text-muted capitalize">
                      {m.role}
                      {m.relationship ? ` · their ${m.relationship}` : ''}
                      {m.permission === 'viewer' && !isAdded(m) ? ' · view only' : ''}
                      {m.can_edit_profile ? ' · can edit profile' : ''}
                    </p>
                  </div>
                  <span
                    className={`badge text-xs ${m.invite_accepted ? 'bg-primary-50 text-primary' : 'bg-surface-2 text-muted'}`}
                  >
                    {circleStatusLabel(m)}
                  </span>
                </div>
                {m.invited_email ? <p className="text-xs text-muted mt-1">{m.invited_email}</p> : null}
                {isAdded(m) && m.email ? <p className="text-xs text-muted mt-1">{m.email}</p> : null}
                {m.phone ? <p className="text-xs text-muted mt-1">{m.phone}</p> : null}
                {m.poa_type ? <p className="text-xs text-amber-700 mt-1">{poaLabel(m.poa_type)}</p> : null}
                {m.role_description ? <p className="text-sm text-ink mt-2">{m.role_description}</p> : null}
                {!m.invite_accepted && !isAdded(m) && canManageEditors ? (
                  <PendingInviteActions profileId={profile.id} member={m} onChanged={invalidate} />
                ) : null}
                {canManageEditors ? (
                  <div className="mt-3 flex gap-2">
                    {isAdded(m) ? (
                      <Button size="xs" variant="secondary" onClick={() => setInvitingAdded(m)}>Invite to log in</Button>
                    ) : null}
                    <Button size="xs" variant="ghost" aria-label={`Edit ${m.display_name}`} title="Edit" onClick={() => setEditing(m)}>
                      <PencilIcon />
                    </Button>
                    <Button size="xs" variant="ghost-danger" aria-label={`Remove ${m.display_name}`} title="Remove" onClick={() => removeOrAsk([m])}>
                      <CrossIcon />
                    </Button>
                  </div>
                ) : null}
              </div>
            ))}
          </div>
        </>
      )}

      {professionals.length > 0 ? (
        <section className="mt-8">
          <h3 className="text-sm font-semibold text-ink">Professionals</h3>
          <p className="text-xs text-muted mb-3">
            From Contacts, so the same person is linked to appointments and referrals. Change their details in{' '}
            <Link to={`/app/${profile.id}/providers`} className="text-primary hover:underline">Contacts</Link>.
          </p>
          {professionals.length > 4 ? (
            <DataToolbar
              search={pro.search}
              onSearch={pro.setSearch}
              searchPlaceholder="Search professionals…"
              sorts={PRO_SORTS.map((x) => ({ key: x.key, label: x.label }))}
              sortKey={pro.sortKey}
              onSort={pro.setSortKey}
              page={pro.page}
              totalPages={pro.totalPages}
              pageSize={pro.pageSize}
              totalFiltered={pro.totalFiltered}
              onPageChange={pro.setPage}
              onPageSizeChange={pro.setPageSize}
            />
          ) : null}
          <div className="grid gap-4 sm:grid-cols-2 mt-3">
            {pro.view.map((p) => (
              <Link key={p.id} to={`/app/${profile.id}/providers?record=${p.id}`} className="card block hover:border-primary">
                <h4 className="text-sm font-semibold text-ink">{p.name}</h4>
                <p className="text-xs text-muted">
                  {providerTypeLabel(p.provider_type)}
                  {p.organisation ? `, ${p.organisation}` : ''}
                </p>
                {p.phone ? <p className="text-xs text-muted mt-1">{p.phone}</p> : null}
                {p.email ? <p className="text-xs text-muted mt-1">{p.email}</p> : null}
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      {addOpen ? (
        <AddPersonModal
          profileId={profile.id}
          careName={careName}
          members={members}
          professionals={professionals}
          onClose={() => setAddOpen(false)}
          onSaved={() => {
            setAddOpen(false);
            invalidate();
            void queryClient.invalidateQueries({ queryKey: ['providers', profile.id] });
          }}
        />
      ) : null}

      {invitingAdded ? (
        <InviteAddedModal
          profileId={profile.id}
          member={invitingAdded}
          onClose={() => setInvitingAdded(null)}
          onDone={() => {
            setInvitingAdded(null);
            invalidate();
          }}
        />
      ) : null}

      <InviteModal
        profileId={profile.id}
        open={inviteOpen}
        onClose={() => setInviteOpen(false)}
        onSaved={() => {
          setInviteOpen(false);
          invalidate();
        }}
      />
      <EditMemberModal
        profileId={profile.id}
        member={editing}
        onClose={() => { setEditing(null); setBulkEditQueue([]); }}
        onSaved={() => {
          invalidate();
          const next = bulkEditQueue.slice(1);
          if (next.length > 0) {
            setBulkEditQueue(next);
            setEditing(next[0]);
          } else {
            setBulkEditQueue([]);
            setEditing(null);
            dv.clearSelection();
          }
        }}
      />
      <Modal open={removing !== null} onClose={() => setRemoving(null)} title="Remove from circle">
        <p className="text-sm text-muted mb-4">
          {removing && removing.length === 1 ? (
            <>
              Remove <span className="font-medium text-ink">{removing[0].display_name}</span> from the care circle? They
              will lose access to this profile.
            </>
          ) : (
            <>
              Remove <span className="font-medium text-ink">{removing?.length ?? 0} people</span> from the care circle?
              They will lose access to this profile.
            </>
          )}
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRemoving(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={removeMutation.isPending}
            onClick={() => removing && removeMutation.mutate(removing.map((m) => m.id))}
          >
            Remove
          </Button>
        </div>
      </Modal>

      {panel.current ? (() => {
        const m = panel.current;
        return (
          <RecordPanel
            key={m.id}
            kindLabel="Care circle member"
            title={m.display_name}
            subtitle={circleRoleLabel(m.role)}
            kind="circle"
            recordId={m.id}
            profileId={profile.id}
            canEdit={canManageEditors}
            fields={[
              { label: 'Role', value: circleRoleLabel(m.role) },
              { label: `${careName} is their`, value: m.relationship },
              {
                label: 'Access level',
                value: isAdded(m)
                  ? 'None. Added by name, so they do not log in'
                  : m.permission === 'viewer' ? 'Viewer: can read and join the conversation' : 'Contributor: can add and edit records',
              },
              { label: 'Can edit the profile', value: isAdded(m) ? null : m.can_edit_profile ? 'Yes' : 'No' },
              { label: 'Status', value: circleStatusLabel(m) },
              { label: 'Phone', value: m.phone ? <a href={`tel:${m.phone}`} className="text-primary hover:underline">{m.phone}</a> : null },
              {
                label: 'Email',
                value: (m.email ?? m.invited_email ?? m.account_email)
                  ? <a href={`mailto:${m.email ?? m.invited_email ?? m.account_email}`} className="text-primary hover:underline">{m.email ?? m.invited_email ?? m.account_email}</a>
                  : null,
              },
              { label: 'What they do', value: m.role_description },
              { label: 'Power of attorney', value: m.poa_type ? poaLabel(m.poa_type) : null },
              { label: 'In effect now', value: m.poa_type ? (m.poa_activated ? 'Yes' : 'No') : null },
              { label: 'Invite expires', value: !m.invite_accepted && m.invite_expires_at ? format(new Date(m.invite_expires_at), 'd MMM yyyy') : null },
              { label: 'Added', value: format(new Date(m.created_at), 'd MMM yyyy') },
            ]}
            onEdit={() => setEditing(m)}
            extra={isAdded(m) ? [{ label: 'Invite to log in', onRun: () => setInvitingAdded(m) }] : []}
            deleteLabel="Remove"
            onDelete={() => {
              removeOrAsk([m]);
              panel.close();
            }}
            onClose={panel.close}
          >
            {!m.invite_accepted && !isAdded(m) && canManageEditors ? (
              <section>
                <h3 className="text-xs font-semibold uppercase tracking-wide text-muted mb-2">Invite</h3>
                <PendingInviteActions profileId={profile.id} member={m} onChanged={invalidate} />
              </section>
            ) : null}
          </RecordPanel>
        );
      })() : null}
    </div>
  );
}

/**
 * Everything the inviter needs to hand the invite over themselves: the
 * link is visible and copyable, so nothing depends on email delivery.
 */
function PendingInviteActions({
  profileId,
  member,
  onChanged,
}: {
  profileId: string;
  member: CircleMember;
  onChanged: () => void;
}) {
  const [copied, setCopied] = useState(false);
  const [resentUrl, setResentUrl] = useState<string | null>(null);
  const [error, setError] = useState('');
  const url = resentUrl ?? member.invite_url ?? null;
  const expired = member.invite_status === 'expired' && !resentUrl;

  const resendMutation = useMutation({
    mutationFn: () =>
      api.post<{ invite_url: string }>(`/care-profiles/${profileId}/circle/${member.id}/resend-invite`),
    onSuccess: (res) => {
      setResentUrl(res.invite_url);
      setCopied(false);
      setError('');
      onChanged();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to resend'),
  });

  async function copy() {
    if (!url) return;
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      setError('Could not copy. Select the link text and copy it manually.');
    }
  }

  return (
    <div className="mt-3 rounded-md border border-border bg-surface-2 p-2.5">
      <p className="text-xs text-muted mb-1.5">
        {expired
          ? 'This invite link has expired. Send a new one.'
          : 'Share this invite link with them directly, or resend the email.'}
      </p>
      {url && !expired ? <p className="text-xs text-ink break-all mb-2 font-mono">{url}</p> : null}
      <div className="flex gap-2">
        {url && !expired ? (
          <Button size="sm" variant="secondary" onClick={copy}>
            {copied ? 'Copied' : 'Copy link'}
          </Button>
        ) : null}
        <Button size="sm" variant="ghost" loading={resendMutation.isPending} onClick={() => resendMutation.mutate()}>
          {expired ? 'Send new link' : 'Resend'}
        </Button>
      </div>
      {error ? <p className="text-xs text-red-600 mt-1">{error}</p> : null}
    </div>
  );
}

function PermissionSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <div>
      <label htmlFor="member-permission" className="block text-sm font-medium text-ink mb-1">
        Access level
      </label>
      <select
        id="member-permission"
        className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
        value={value}
        onChange={(e) => onChange(e.target.value)}
      >
        <option value="contributor">Contributor: can add and edit records</option>
        <option value="viewer">Viewer: can read and join the conversation only</option>
      </select>
    </div>
  );
}

function PoaFields({
  poaType,
  setPoaType,
  poaActivated,
  setPoaActivated,
}: {
  poaType: string;
  setPoaType: (v: string) => void;
  poaActivated: boolean;
  setPoaActivated: (v: boolean) => void;
}) {
  return (
    <div className="rounded-md border border-border p-3 space-y-3">
      <label className="flex items-center gap-2 text-sm font-medium text-ink">
        <input
          type="checkbox"
          className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
          checked={poaType !== ''}
          onChange={(e) => {
            if (e.target.checked) {
              setPoaType('enduring');
            } else {
              setPoaType('');
              setPoaActivated(false);
            }
          }}
        />
        Holds power of attorney
      </label>
      {poaType !== '' ? (
        <>
          <select
            aria-label="Power of attorney type"
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={poaType}
            onChange={(e) => setPoaType(e.target.value)}
          >
            {POA_TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label}
              </option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              checked={poaActivated}
              onChange={(e) => setPoaActivated(e.target.checked)}
            />
            Activated (in effect now)
          </label>
        </>
      ) : null}
    </div>
  );
}

function InviteModal({
  profileId,
  open,
  onClose,
  onSaved,
}: {
  profileId: string;
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [pickedId, setPickedId] = useState('');
  const [email, setEmail] = useState('');
  const [name, setName] = useState('');
  const [role, setRole] = useState('family');
  const [relationship, setRelationship] = useState('');
  const [permission, setPermission] = useState('contributor');
  const [description, setDescription] = useState('');
  const [poaType, setPoaType] = useState('');
  const [poaActivated, setPoaActivated] = useState(false);
  const [error, setError] = useState('');
  const [sentUrl, setSentUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  // People already on PareCare this carer can invite without typing an email.
  const { data: invitable } = useQuery({
    queryKey: ['invitable-users', profileId],
    queryFn: () => api.get<{ users: { id: string; display_name: string; email: string }[] }>(`/care-profiles/${profileId}/circle/invitable-users`),
    enabled: open,
  });
  const existingUsers = invitable?.users ?? [];

  const pickUser = (id: string) => {
    setPickedId(id);
    const u = existingUsers.find((x) => x.id === id);
    if (u) {
      setName(u.display_name);
      setEmail(u.email);
    } else {
      setName('');
      setEmail('');
    }
  };

  const mutation = useMutation({
    mutationFn: () =>
      api.post<{ invite_url: string }>(`/care-profiles/${profileId}/circle`, {
        invited_email: email,
        display_name: name,
        role,
        permission,
        relationship: relationship.trim() || null,
        role_description: description || null,
        poa_type: poaType || null,
      }),
    onSuccess: (res) => {
      setPickedId('');
      setEmail('');
      setName('');
      setDescription('');
      setPoaType('');
      setPoaActivated(false);
      setError('');
      setSentUrl(res.invite_url);
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to send invite'),
  });

  if (!open) return null;

  if (sentUrl) {
    return (
      <Modal
        open
        onClose={() => {
          setSentUrl(null);
          onSaved();
        }}
        title="Invitation created"
      >
        <p className="text-sm text-muted mb-3">
          If email is set up on this server the invitation has been sent. Either way, you can share this link with
          them directly. It creates their account if they don't have one yet.
        </p>
        <p className="text-xs text-ink break-all font-mono rounded-md border border-border bg-surface-2 p-2.5 mb-4">{sentUrl}</p>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(sentUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                /* manual copy still possible */
              }
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          <Button
            onClick={() => {
              setSentUrl(null);
              onSaved();
            }}
          >
            Done
          </Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title="Invite to the care circle">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        {existingUsers.length > 0 ? (
          <div>
            <label htmlFor="invite-existing" className="block text-sm font-medium text-ink mb-1">
              Someone already on PareCare
            </label>
            <select
              id="invite-existing"
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              value={pickedId}
              onChange={(e) => pickUser(e.target.value)}
            >
              <option value="">A new person, invited by email</option>
              {existingUsers.map((u) => (
                <option key={u.id} value={u.id}>
                  {u.display_name} ({u.email})
                </option>
              ))}
            </select>
            <p className="mt-1 text-xs text-muted">Pick someone already registered, or leave this to invite a new person below.</p>
          </div>
        ) : null}
        <Input label="Their name" value={name} onChange={(e) => setName(e.target.value)} required readOnly={!!pickedId} />
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required readOnly={!!pickedId} />
        <div>
          <label htmlFor="invite-role" className="block text-sm font-medium text-ink mb-1">
            Role
          </label>
          <select
            id="invite-role"
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {CIRCLE_ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
          </select>
        </div>
        <RelationshipSelect label="Who is the person in care to them? (optional)" value={relationship} onChange={setRelationship} />
        <PermissionSelect value={permission} onChange={setPermission} />
        <Textarea
          label="What do they do? (optional)"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
          placeholder="e.g. Handles all medical appointments"
        />
        <PoaFields poaType={poaType} setPoaType={setPoaType} poaActivated={poaActivated} setPoaActivated={setPoaActivated} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Send invite
          </Button>
        </div>
      </form>
    </Modal>
  );
}

function EditMemberModal({
  profileId,
  member,
  onClose,
  onSaved,
}: {
  profileId: string;
  member: CircleMember | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [role, setRole] = useState('');
  const [permission, setPermission] = useState('contributor');
  const [description, setDescription] = useState('');
  const [poaType, setPoaType] = useState('');
  const [poaActivated, setPoaActivated] = useState(false);
  const [canEditProfile, setCanEditProfile] = useState(false);
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [relationship, setRelationship] = useState('');
  const [error, setError] = useState('');
  const added = !!member && isAdded(member);

  useEffect(() => {
    if (member) {
      setName(member.display_name);
      setPhone(member.phone ?? '');
      setEmail(member.email ?? '');
      setRelationship(member.relationship ?? '');
      // A role typed by hand before the list existed is shown as its listed
      // twin when there is one, so saving puts it in the listed form.
      setRole(CIRCLE_ROLES.find((r) => r.value === member.role.trim().toLowerCase())?.value ?? member.role);
      setPermission(member.permission ?? 'contributor');
      setDescription(member.role_description ?? '');
      setPoaType(member.poa_type ?? '');
      setPoaActivated(member.poa_activated);
      setCanEditProfile(member.can_edit_profile);
      setError('');
    }
  }, [member]);

  const mutation = useMutation({
    mutationFn: () =>
      api.patch(`/care-profiles/${profileId}/circle/${member!.id}`, {
        role,
        role_description: description || null,
        poa_type: poaType || null,
        poa_activated: poaType ? poaActivated : false,
        phone: phone.trim() || null,
        ...(added
          ? { display_name: name.trim(), email: email.trim() || null, relationship: relationship.trim() || null }
          : { permission, can_edit_profile: canEditProfile }),
      }),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save'),
  });

  if (!member) return null;
  return (
    <Modal open onClose={onClose} title={`Edit ${member.display_name}`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          mutation.mutate();
        }}
      >
        {added ? <Input label="Their name" value={name} onChange={(e) => setName(e.target.value)} required /> : null}
        <div>
          <label htmlFor="edit-role" className="block text-sm font-medium text-ink mb-1">
            Role
          </label>
          {/* A fixed choice, so a document shared with carers reaches every carer. */}
          <select
            id="edit-role"
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={role}
            onChange={(e) => setRole(e.target.value)}
          >
            {CIRCLE_ROLES.map((r) => (
              <option key={r.value} value={r.value}>{r.label}</option>
            ))}
            {role && !CIRCLE_ROLES.some((r) => r.value === role) ? (
              <option value={role}>{circleRoleLabel(role)}</option>
            ) : null}
          </select>
        </div>
        {added ? (
          <RelationshipSelect label={`Who is the person in care to them? Optional`} value={relationship} onChange={setRelationship} />
        ) : (
          <PermissionSelect value={permission} onChange={setPermission} />
        )}
        <Input label="Phone" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
        {added ? <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} /> : null}
        <Textarea
          label="What do they do?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
        <PoaFields poaType={poaType} setPoaType={setPoaType} poaActivated={poaActivated} setPoaActivated={setPoaActivated} />
        {added ? null : (
        <label className="flex items-start gap-2 text-sm text-ink rounded-md border border-border p-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
            checked={canEditProfile}
            onChange={(e) => setCanEditProfile(e.target.checked)}
          />
          <span>
            Can edit this profile
            <span className="block text-xs text-muted">Allows them to change the person's details and photo, and transfer this right onward.</span>
          </span>
        </label>
        )}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={mutation.isPending}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/** The kinds of professional offered when adding someone. They are filed in Contacts. */
const PROFESSIONAL_CHOICES = [
  { value: 'gp', label: 'GP' },
  { value: 'specialist', label: 'Specialist' },
  { value: 'psychologist', label: 'Psychologist' },
  { value: 'allied_health', label: 'Allied health' },
  { value: 'social_worker', label: 'Social worker' },
] as const;

type AddChoice = { kind: 'professional'; value: string } | { kind: 'person'; value: string };

/**
 * Add someone by name. One question, who they are, decides where they go: a
 * professional is filed in Contacts so the same person is linked to
 * appointments; anyone else joins the circle with no invite and no login.
 * Names already on file are offered first so nobody is entered twice.
 */
function AddPersonModal({
  profileId,
  careName,
  members,
  professionals,
  onClose,
  onSaved,
}: {
  profileId: string;
  careName: string;
  members: CircleMember[];
  professionals: Provider[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [name, setName] = useState('');
  const [choice, setChoice] = useState<AddChoice | null>(null);
  const [relationship, setRelationship] = useState('');
  const [description, setDescription] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState('');
  const q = name.trim();

  // Someone already in Contacts: link them rather than filing them twice.
  const { data: found } = useQuery({
    queryKey: ['provider-search', profileId, q],
    queryFn: () => api.get<{ providers: Array<Provider & { linked?: boolean }> }>(`/providers/search?kind=person&profile_id=${profileId}&q=${encodeURIComponent(q)}`),
    enabled: q.length >= 2,
  });
  const lower = q.toLowerCase();
  const inCircle = q.length >= 2 ? members.filter((m) => m.display_name.toLowerCase().includes(lower)) : [];
  const onFile = (found?.providers ?? []).filter((p) => !professionals.some((x) => x.id === p.id)).slice(0, 4);
  const alreadyPro = q.length >= 2 ? professionals.filter((p) => p.name.toLowerCase().includes(lower)) : [];

  const linkExisting = useMutation({
    mutationFn: (providerId: string) => api.post(`/care-profiles/${profileId}/providers`, { provider_id: providerId }),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not add them. Try again in a moment.'),
  });

  const save = useMutation({
    mutationFn: () =>
      choice?.kind === 'professional'
        ? api.post(`/care-profiles/${profileId}/providers`, {
            name: q,
            provider_type: choice.value,
            kind: 'person',
            phone: phone.trim() || null,
            email: email.trim() || null,
          })
        : api.post(`/care-profiles/${profileId}/circle/people`, {
            display_name: q,
            role: choice?.value ?? 'other',
            relationship: relationship.trim() || null,
            role_description: description.trim() || null,
            phone: phone.trim() || null,
            email: email.trim() || null,
          }),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not add them. Check your connection and try again.'),
  });

  const chip = (c: AddChoice, label: string) => {
    const on = choice?.kind === c.kind && choice.value === c.value;
    return (
      <Button
        key={`${c.kind}-${c.value}`}
        type="button"
        size="xs"
        variant="secondary"
        className={on ? 'ring-2 ring-primary ring-offset-1' : ''}
        aria-pressed={on}
        onClick={() => setChoice(c)}
      >
        {label}
      </Button>
    );
  };

  return (
    <Modal open onClose={onClose} title="Add someone">
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          if (q && choice) save.mutate();
        }}
      >
        <p className="text-sm text-muted">
          Anyone around {careName}. They do not need an account and nobody is emailed.
        </p>
        <Input label="Their name" value={name} onChange={(e) => setName(e.target.value)} autoFocus required />

        {inCircle.length > 0 || alreadyPro.length > 0 ? (
          <p className="text-xs text-muted">
            Already here: {[...inCircle.map((m) => m.display_name), ...alreadyPro.map((p) => p.name)].join(', ')}.
          </p>
        ) : null}
        {onFile.length > 0 ? (
          <div className="rounded-md border border-border p-3">
            <p className="text-xs text-muted mb-2">Already in Contacts. Pick them to add them here without typing them in again.</p>
            <ul className="space-y-1">
              {onFile.map((p) => (
                <li key={p.id} className="flex items-center gap-2">
                  <span className="flex-1 text-sm text-ink">
                    {p.name}
                    <span className="text-xs text-muted">, {providerTypeLabel(p.provider_type)}{p.organisation ? `, ${p.organisation}` : ''}</span>
                  </span>
                  <Button type="button" size="xs" variant="secondary" loading={linkExisting.isPending && linkExisting.variables === p.id} onClick={() => linkExisting.mutate(p.id)}>
                    Add
                  </Button>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <div>
          <p className="text-sm font-medium text-ink mb-2">Who are they to {careName}?</p>
          <div className="flex flex-wrap gap-2 mb-2">
            {PROFESSIONAL_CHOICES.map((c) => chip({ kind: 'professional', value: c.value }, c.label))}
          </div>
          <div className="flex flex-wrap gap-2">
            {CIRCLE_ROLES.map((r) => chip({ kind: 'person', value: r.value }, r.label))}
          </div>
          {choice?.kind === 'professional' ? (
            <p className="text-xs text-muted mt-2">Filed in Contacts too, so they can be picked for appointments and referrals.</p>
          ) : null}
        </div>

        {choice?.kind === 'person' ? (
          <>
            <RelationshipSelect label={`Who is ${careName} to them? Optional`} value={relationship} onChange={setRelationship} />
            <Textarea
              label="What do they do? Optional"
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={2}
              placeholder="e.g. Checks in most mornings, has a spare key"
            />
          </>
        ) : null}
        {choice ? (
          <div className="grid sm:grid-cols-2 gap-3">
            <Input label="Phone, optional" type="tel" value={phone} onChange={(e) => setPhone(e.target.value)} />
            <Input label="Email, optional" type="email" value={email} onChange={(e) => setEmail(e.target.value)} />
          </div>
        ) : null}

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={save.isPending} disabled={!q || !choice}>Add</Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * Invite someone who was added by name to log in. Their email is filled in
 * if it is on file; the invite link shows so it can be shared directly.
 */
function InviteAddedModal({
  profileId,
  member,
  onClose,
  onDone,
}: {
  profileId: string;
  member: CircleMember;
  onClose: () => void;
  onDone: () => void;
}) {
  const [email, setEmail] = useState(member.email ?? '');
  const [permission, setPermission] = useState('contributor');
  const [error, setError] = useState('');
  const [sentUrl, setSentUrl] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  const send = useMutation({
    mutationFn: () =>
      api.post<{ invite_url: string }>(`/care-profiles/${profileId}/circle/${member.id}/invite`, { email: email.trim(), permission }),
    onSuccess: (res) => setSentUrl(res.invite_url),
    onError: (err) => setError(err instanceof Error ? err.message : 'The invite did not go. Check your connection and try again.'),
  });

  if (sentUrl) {
    return (
      <Modal open onClose={onDone} title="Invitation created">
        <p className="text-sm text-muted mb-3">
          If email is set up on this server the invitation has been sent. Either way, share this link with {member.display_name} directly.
        </p>
        <p className="text-xs text-ink break-all font-mono rounded-md border border-border bg-surface-2 p-2.5 mb-4">{sentUrl}</p>
        <div className="flex justify-end gap-2">
          <Button
            variant="secondary"
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(sentUrl);
                setCopied(true);
                setTimeout(() => setCopied(false), 2000);
              } catch {
                /* the link can still be selected and copied by hand */
              }
            }}
          >
            {copied ? 'Copied' : 'Copy link'}
          </Button>
          <Button onClick={onDone}>Done</Button>
        </div>
      </Modal>
    );
  }

  return (
    <Modal open onClose={onClose} title={`Invite ${member.display_name} to log in`}>
      <form
        className="space-y-4"
        onSubmit={(e) => {
          e.preventDefault();
          send.mutate();
        }}
      >
        <p className="text-sm text-muted">They stay in the circle as they are, and can log in once they accept.</p>
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
        <PermissionSelect value={permission} onChange={setPermission} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={send.isPending} disabled={!email.trim()}>Send invite</Button>
        </div>
      </form>
    </Modal>
  );
}
