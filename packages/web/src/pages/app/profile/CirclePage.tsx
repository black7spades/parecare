import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input, Textarea } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { PoaBadge } from '../../../components/PoaBadge';
import { POA_TYPES, poaLabel, type CircleMember } from '../../../lib/care';
import { RelationshipSelect } from '../../../components/RelationshipSelect';
import { useProfile } from './ProfileLayout';

export function CirclePage() {
  const { profile, canManageEditors, careName } = useProfile();
  const queryClient = useQueryClient();
  const [inviteOpen, setInviteOpen] = useState(false);
  const [editing, setEditing] = useState<CircleMember | null>(null);
  const [removing, setRemoving] = useState<CircleMember | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['circle', profile.id],
    queryFn: () => api.get<{ members: CircleMember[] }>(`/care-profiles/${profile.id}/circle`),
  });
  const members = data?.members ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['circle', profile.id] });

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profile.id}/circle/${id}`),
    onSuccess: () => {
      setRemoving(null);
      invalidate();
    },
  });

  return (
    <div>
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 mb-4">
        <div>
          <h2 className="text-base font-semibold text-ink">Care circle</h2>
          <p className="text-sm text-muted">
            The family members, friends and organisations involved in {careName}'s care.
          </p>
        </div>
        {canManageEditors ? (
          <Button className="self-start sm:self-auto" onClick={() => setInviteOpen(true)}>
            Invite someone
          </Button>
        ) : null}
      </div>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : members.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm text-muted mb-4">
            No one in the circle yet. Invite family, friends, or an organisation: anyone who should stay in the loop.
          </p>
          {canManageEditors ? <Button onClick={() => setInviteOpen(true)}>Send the first invite</Button> : null}
        </div>
      ) : (
        <div className="grid gap-4 sm:grid-cols-2">
          {members.map((m) => (
            <div key={m.id} className={`card ${m.poa_activated ? 'border-amber-400' : ''}`}>
              <div className="flex items-start justify-between gap-2">
                <div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <h3 className="text-sm font-semibold text-ink">{m.display_name}</h3>
                    <PoaBadge type={m.poa_type} activated={m.poa_activated} />
                  </div>
                  <p className="text-xs text-muted capitalize">
                    {m.role}
                    {m.relationship ? ` · their ${m.relationship}` : ''}
                    {m.permission === 'viewer' ? ' · view only' : ''}
                    {m.can_edit_profile ? ' · can edit profile' : ''}
                  </p>
                </div>
                <span
                  className={`badge text-xs ${m.invite_accepted ? 'bg-primary-50 text-primary' : 'bg-surface-2 text-muted'}`}
                >
                  {m.invite_accepted ? 'Active' : 'Invite pending'}
                </span>
              </div>
              {m.invited_email ? <p className="text-xs text-muted mt-1">{m.invited_email}</p> : null}
              {m.poa_type ? <p className="text-xs text-amber-700 mt-1">{poaLabel(m.poa_type)}</p> : null}
              {m.role_description ? <p className="text-sm text-ink mt-2">{m.role_description}</p> : null}
              {!m.invite_accepted && canManageEditors ? (
                <PendingInviteActions profileId={profile.id} member={m} onChanged={invalidate} />
              ) : null}
              {canManageEditors ? (
                <div className="mt-3 flex gap-2">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(m)}>
                    Edit
                  </Button>
                  <Button size="sm" variant="ghost" onClick={() => setRemoving(m)}>
                    Remove
                  </Button>
                </div>
              ) : null}
            </div>
          ))}
        </div>
      )}

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
        onClose={() => setEditing(null)}
        onSaved={() => {
          setEditing(null);
          invalidate();
        }}
      />
      <Modal open={removing !== null} onClose={() => setRemoving(null)} title="Remove from circle">
        <p className="text-sm text-muted mb-4">
          Remove <span className="font-medium text-ink">{removing?.display_name}</span> from the care circle? They
          will lose access to this profile.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setRemoving(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={removeMutation.isPending}
            onClick={() => removing && removeMutation.mutate(removing.id)}
          >
            Remove
          </Button>
        </div>
      </Modal>
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
        <Input label="Their name" value={name} onChange={(e) => setName(e.target.value)} required />
        <Input label="Email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
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
            <option value="family">Family</option>
            <option value="friend">Friend</option>
            <option value="carer">Carer</option>
            <option value="organisation">Organisation</option>
            <option value="legal">Legal representative</option>
            <option value="other">Other</option>
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
  const [error, setError] = useState('');

  useEffect(() => {
    if (member) {
      setRole(member.role);
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
        permission,
        role_description: description || null,
        poa_type: poaType || null,
        poa_activated: poaType ? poaActivated : false,
        can_edit_profile: canEditProfile,
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
        <Input label="Role" value={role} onChange={(e) => setRole(e.target.value)} required />
        <PermissionSelect value={permission} onChange={setPermission} />
        <Textarea
          label="What do they do?"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          rows={2}
        />
        <PoaFields poaType={poaType} setPoaType={setPoaType} poaActivated={poaActivated} setPoaActivated={setPoaActivated} />
        <label className="flex items-start gap-2 text-sm text-ink rounded-md border border-border p-3">
          <input
            type="checkbox"
            className="mt-0.5 h-4 w-4 rounded border-border text-primary focus:ring-primary"
            checked={canEditProfile}
            onChange={(e) => setCanEditProfile(e.target.checked)}
          />
          <span>
            Can edit this profile
            <span className="block text-xs text-muted">Lets them change the person's details and photo, and transfer this right onward.</span>
          </span>
        </label>
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
