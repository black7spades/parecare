import { useState } from 'react';
import { Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Modal } from '../../../components/ui/Modal';
import { Avatar } from '../../../components/ui/Avatar';
import { RelationshipSelect } from '../../../components/RelationshipSelect';
import { EditProfileModal } from './EditProfileModal';
import { format } from 'date-fns';
import {
  SELF_RELATIONSHIP,
  ageFrom,
  healthStatusStatusLabel,
  type AccessLevel,
  type CareProfile,
  type HealthStatus,
  type PhaseHistoryEntry,
} from '../../../lib/care';
import { useAuthStore } from '../../../stores/auth';

export interface ProfileContext {
  profile: CareProfile;
  access: AccessLevel;
  isOwner: boolean;
  canEdit: boolean;
  /** Can edit the care profile itself (details + photo): admin, owner, or granted. */
  canEditProfile: boolean;
  /** Can grant others the edit-profile right: admin or owner. */
  canManageEditors: boolean;
  /** What THIS viewer calls the person: "Mum", "Oma", else preferred/first name */
  relationship: string | null;
  careName: string;
  phaseHistory: PhaseHistoryEntry[];
}

export function useProfile(): ProfileContext {
  return useOutletContext<ProfileContext>();
}

interface ProfileResponse {
  profile: CareProfile;
  access?: AccessLevel;
  relationship?: string | null;
  phase_history?: PhaseHistoryEntry[];
  can_edit_profile?: boolean;
  can_manage_editors?: boolean;
}

type AlertLevel = 'red' | 'yellow' | 'green' | null;

function healthAlertLevel(statuses: HealthStatus[]): AlertLevel {
  const active = statuses.filter((s) => s.status !== 'resolved');
  if (active.length === 0) return null;
  for (const s of active) {
    if (s.is_contagious || s.isolation_required) return 'red';
  }
  for (const s of active) {
    if (s.status === 'active') return 'yellow';
  }
  return 'green';
}

const ALERT_HEADER_BORDER: Record<string, string> = {
  red: 'border-l-4 border-l-red-500',
  yellow: 'border-l-4 border-l-amber-400',
  green: 'border-l-4 border-l-green-500',
};

export function ProfileLayout() {
  const { profileId } = useParams<{ profileId: string }>();
  const navigate = useNavigate();
  const { account } = useAuthStore();
  const [editOpen, setEditOpen] = useState(false);
  const [relOpen, setRelOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['care-profile', profileId],
    queryFn: () => api.get<ProfileResponse>(`/care-profiles/${profileId}`),
  });

  const { data: healthData } = useQuery({
    queryKey: ['health-statuses', profileId],
    queryFn: () => api.get<{ health_statuses: HealthStatus[] }>(`/care-profiles/${profileId}/health-statuses`),
    enabled: !!profileId,
  });
  const healthStatuses = healthData?.health_statuses ?? [];
  const activeHealth = healthStatuses.filter((s) => s.status !== 'resolved');
  const alertLevel = healthAlertLevel(healthStatuses);

  if (isLoading) return <p className="text-sm text-muted">Loading…</p>;
  if (error || !data?.profile) {
    return (
      <div className="card text-center py-12">
        <p className="text-muted mb-4">This care profile could not be found.</p>
        <Button onClick={() => navigate('/app')}>Back to homeboard</Button>
      </div>
    );
  }
  const profile = data.profile;
  const age = ageFrom(profile.date_of_birth);
  const access: AccessLevel = data.access ?? 'owner';
  const relationship = data.relationship?.trim() || null;
  const isSelf = relationship === SELF_RELATIONSHIP;
  const careName =
    (isSelf ? null : relationship) ?? profile.preferred_name ?? profile.first_name ?? profile.full_name.split(' ')[0];
  const context: ProfileContext = {
    profile,
    access,
    isOwner: access === 'owner',
    canEdit: access !== 'viewer',
    canEditProfile: !!data.can_edit_profile,
    canManageEditors: !!data.can_manage_editors,
    relationship,
    careName,
    phaseHistory: data.phase_history ?? [],
  };

  const canDismissAlert =
    account?.role === 'super_admin' || account?.role === 'admin' || access === 'owner';

  return (
    <div className="space-y-6">
      <div className={`flex items-start justify-between gap-4 flex-wrap ${alertLevel ? `${ALERT_HEADER_BORDER[alertLevel]} pl-3 rounded-sm` : ''}`}>
        <div className="flex items-center gap-3 min-w-0">
          <Avatar
            accountId={profile.id}
            name={profile.full_name}
            avatarUrl={profile.photo_url}
            color={profile.photo_color}
            fetchPath={`/care-profiles/${profile.id}/photo`}
            size={52}
          />
          <div className="min-w-0">
            <h1 className="text-xl font-semibold text-ink truncate">
              {profile.full_name}
              {age !== null ? (
                <span
                  className="text-muted font-normal"
                  title={profile.date_of_birth ? `Born ${format(new Date(profile.date_of_birth), 'd MMM yyyy')}` : undefined}
                >
                  {' · '}
                  {age}
                </span>
              ) : null}
            </h1>
            <p className="text-sm text-muted">
              {[
                profile.preferred_name ? `Known as ${profile.preferred_name}` : null,
                profile.kind === 'pet' ? profile.breed : null,
                profile.pronouns,
                profile.date_of_birth ? `Born ${format(new Date(profile.date_of_birth), 'd MMM yyyy')}` : null,
                profile.kind === 'pet' ? null : profile.primary_language,
                isSelf ? null : relationship ?? null,
              ]
                .filter(Boolean)
                .join(' · ')}
              {!isSelf ? (
                <button
                  type="button"
                  className="ml-1.5 text-xs text-primary hover:underline"
                  onClick={() => setRelOpen(true)}
                >
                  change
                </button>
              ) : null}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {access === 'viewer' ? (
            <span className="badge bg-surface-2 text-muted" title="You can read everything and join the conversation, but not change records.">
              View-only access
            </span>
          ) : null}
          {access === 'admin' ? (
            <span className="badge bg-amber-50 text-amber-700" title="You have admin access to this profile.">Admin access</span>
          ) : null}
          {context.canEditProfile ? (
            <Button size="sm" variant="secondary" onClick={() => setEditOpen(true)}>Edit profile</Button>
          ) : null}
        </div>
      </div>

      {activeHealth.length > 0 ? (
        <HealthAlertBar
          statuses={activeHealth}
          profileId={profile.id}
          canDismiss={canDismissAlert}
        />
      ) : null}

      {context.canEditProfile ? <EditProfileModal profile={profile} open={editOpen} onClose={() => setEditOpen(false)} /> : null}

      <RelationshipModal
        profileId={profile.id}
        relationship={relationship}
        isOwner={access === 'owner'}
        open={relOpen}
        onClose={() => setRelOpen(false)}
      />

      <Outlet context={context} />
    </div>
  );
}

function HealthAlertBar({
  statuses,
  profileId,
  canDismiss,
}: {
  statuses: HealthStatus[];
  profileId: string;
  canDismiss: boolean;
}) {
  const queryClient = useQueryClient();
  const [confirmId, setConfirmId] = useState<string | null>(null);

  const dismiss = useMutation({
    mutationFn: (statusId: string) =>
      api.patch(`/care-profiles/${profileId}/health-statuses/${statusId}`, { status: 'resolved', actual_resolution_date: new Date().toISOString().slice(0, 10) }),
    onSuccess: () => {
      setConfirmId(null);
      void queryClient.invalidateQueries({ queryKey: ['health-statuses', profileId] });
      void queryClient.invalidateQueries({ queryKey: ['care-profiles-summary'] });
    },
  });

  const toConfirm = statuses.find((s) => s.id === confirmId);

  return (
    <>
      <div className="space-y-1.5">
        {statuses.map((hs) => {
          const isRed = hs.is_contagious || hs.isolation_required;
          const badgeCls = isRed
            ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-300'
            : hs.status === 'active'
              ? 'bg-amber-100 text-amber-700 dark:bg-amber-900/30 dark:text-amber-300'
              : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300';

          return (
            <div
              key={hs.id}
              className={`flex items-center gap-2 rounded-md px-3 py-2 text-sm ${badgeCls}`}
            >
              <span className="font-medium">{hs.name}</span>
              <span>{healthStatusStatusLabel(hs.status)}</span>
              {hs.is_contagious ? <span className="font-medium">Contagious</span> : null}
              {hs.isolation_required ? <span className="font-medium">Isolating</span> : null}
              {canDismiss ? (
                <button
                  type="button"
                  className="ml-auto text-xs font-medium hover:underline opacity-70 hover:opacity-100"
                  onClick={() => setConfirmId(hs.id)}
                >
                  Dismiss
                </button>
              ) : null}
            </div>
          );
        })}
      </div>

      <Modal open={confirmId !== null} onClose={() => setConfirmId(null)} title="Dismiss health status">
        <p className="text-sm text-muted mb-4">
          Mark <span className="font-medium text-ink">{toConfirm?.name}</span> as resolved? This removes the alert from the profile header and homeboard.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmId(null)}>Cancel</Button>
          <Button loading={dismiss.isPending} onClick={() => confirmId && dismiss.mutate(confirmId)}>
            Mark resolved
          </Button>
        </div>
      </Modal>
    </>
  );
}

function RelationshipModal({
  profileId,
  relationship,
  isOwner,
  open,
  onClose,
}: {
  profileId: string;
  relationship: string | null;
  isOwner: boolean;
  open: boolean;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [draft, setDraft] = useState(relationship ?? '');
  const [error, setError] = useState('');

  const mutation = useMutation({
    mutationFn: () => {
      const value = draft.trim() || null;
      return isOwner
        ? api.patch(`/care-profiles/${profileId}`, { owner_relationship: value })
        : api.patch(`/care-profiles/${profileId}/circle/me/relationship`, { relationship: value });
    },
    onSuccess: () => {
      onClose();
      void queryClient.invalidateQueries({ queryKey: ['care-profile', profileId] });
      void queryClient.invalidateQueries({ queryKey: ['care-profiles'] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save'),
  });

  return (
    <Modal open={open} onClose={onClose} title="Who are they to you?">
      <div className="space-y-4">
        <p className="text-sm text-muted">
          The app will use this everywhere it talks about them, so it reads the way your family speaks.
        </p>
        <RelationshipSelect value={draft} onChange={setDraft} />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>Cancel</Button>
          <Button loading={mutation.isPending} onClick={() => mutation.mutate()}>Save</Button>
        </div>
      </div>
    </Modal>
  );
}
