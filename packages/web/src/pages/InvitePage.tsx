import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button } from '../components/ui/Button';
import { useAuthStore } from '../stores/auth';
import { RelationshipSelect } from '../components/RelationshipSelect';

interface InviteInfo {
  display_name: string;
  role: string;
  profile_name: string;
}

export function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const isAuthed = useAuthStore((s) => !!s.token);
  const [error, setError] = useState('');
  const [relationship, setRelationship] = useState('');

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<{ invite: InviteInfo }>(`/care-circle/invite/${token}`),
    retry: false,
  });

  const acceptMutation = useMutation({
    mutationFn: () =>
      api.post<{ care_profile_id: string }>(`/care-circle/accept-invite/${token}`, {
        relationship: relationship.trim() || undefined,
      }),
    onSuccess: (res) => navigate(`/app/${res.care_profile_id}`),
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to accept invite'),
  });

  const next = encodeURIComponent(`/invite/${token}`);

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-primary text-2xl font-semibold mb-1">PareCare</h1>
          <p className="text-muted text-sm">Care circle invitation</p>
        </div>
        <div className="card text-center">
          {isLoading ? (
            <p className="text-sm text-muted py-6">Checking your invite…</p>
          ) : loadError || !data ? (
            <div className="py-4">
              <p className="text-sm text-ink mb-2 font-medium">This invite link isn't valid.</p>
              <p className="text-sm text-muted mb-4">It may have already been accepted, or been revoked.</p>
              <Link to="/login" className="text-primary text-sm hover:underline">
                Go to sign in
              </Link>
            </div>
          ) : (
            <div className="py-2">
              <p className="text-sm text-ink mb-1">
                You've been invited to join the care circle for{' '}
                <span className="font-semibold">{data.invite.profile_name}</span>
              </p>
              <p className="text-xs text-muted mb-6 capitalize">
                as {data.invite.display_name} · {data.invite.role}
              </p>
              {isAuthed ? (
                <>
                  <div className="text-left mb-4">
                    <RelationshipSelect
                      label={`Who is ${data.invite.profile_name.split(' ')[0]} to you? (optional)`}
                      value={relationship}
                      onChange={setRelationship}
                    />
                  </div>
                  <Button className="w-full" loading={acceptMutation.isPending} onClick={() => acceptMutation.mutate()}>
                    Accept invitation
                  </Button>
                  {error ? <p className="text-sm text-red-600 mt-3">{error}</p> : null}
                </>
              ) : (
                <div className="space-y-3">
                  <p className="text-sm text-muted">Sign in or create a free account to accept.</p>
                  <Link to={`/login?next=${next}`}>
                    <Button className="w-full">Sign in</Button>
                  </Link>
                  <Link to={`/register?next=${next}`}>
                    <Button variant="secondary" className="w-full">
                      Create an account
                    </Button>
                  </Link>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
