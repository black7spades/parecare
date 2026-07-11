import { useState } from 'react';
import { Outlet, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Avatar } from '../../../components/ui/Avatar';
import { EditProfileModal } from './EditProfileModal';
import { SELF_RELATIONSHIP, type AccessLevel, type CareProfile, type PhaseHistoryEntry } from '../../../lib/care';

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

export function ProfileLayout() {
  const { profileId } = useParams<{ profileId: string }>();
  const navigate = useNavigate();
  const [editOpen, setEditOpen] = useState(false);

  const { data, isLoading, error } = useQuery({
    queryKey: ['care-profile', profileId],
    queryFn: () => api.get<ProfileResponse>(`/care-profiles/${profileId}`),
  });

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
  const access: AccessLevel = data.access ?? 'owner';
  const relationship = data.relationship?.trim() || null;
  const isSelf = relationship === SELF_RELATIONSHIP;
  // "Myself" is a flag, not something to call the person by.
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

  return (
    <div className="space-y-6">
      <div className="flex items-start justify-between gap-4 flex-wrap">
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
            <h1 className="text-xl font-semibold text-ink truncate">{profile.full_name}</h1>
            <p className="text-sm text-muted">
              {[
                isSelf ? 'Your own care' : relationship ? `Your ${relationship}` : null,
                profile.preferred_name ? `Known as ${profile.preferred_name}` : null,
              ]
                .filter(Boolean)
                .join(' · ')}
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

      {context.canEditProfile ? <EditProfileModal profile={profile} open={editOpen} onClose={() => setEditOpen(false)} /> : null}

      <Outlet context={context} />
    </div>
  );
}
