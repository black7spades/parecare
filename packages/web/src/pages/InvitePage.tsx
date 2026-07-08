import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button } from '../components/ui/Button';
import { Input } from '../components/ui/Input';
import { useAuthStore } from '../stores/auth';
import { RelationshipSelect } from '../components/RelationshipSelect';

interface InviteInfo {
  display_name: string;
  email: string;
  status: 'pending' | 'accepted' | 'revoked' | 'expired';
  expires_at: string;
  has_account: boolean;
  profiles: Array<{ name: string; role: string; permission: string }>;
}

interface SessionAccount {
  id: string;
  email: string;
  display_name: string;
  subscription_tier: 'free' | 'family' | 'professional';
  subscription_status: string | null;
}

/**
 * The receiving end of an invitation. Three paths:
 * - No account yet: create one right here (email locked to the invitation)
 *   and accept in the same step.
 * - Account exists, not signed in: sign in, come straight back.
 * - Signed in: accept, as long as the session email matches the invite.
 */
export function InvitePage() {
  const { token } = useParams<{ token: string }>();
  const navigate = useNavigate();
  const authAccount = useAuthStore((s) => s.account);
  const setAuth = useAuthStore((s) => s.setAuth);
  const clearAuth = useAuthStore((s) => s.clearAuth);
  const isAuthed = useAuthStore((s) => !!s.token);
  const [error, setError] = useState('');
  const [relationship, setRelationship] = useState('');
  const [firstName, setFirstName] = useState('');
  const [middleName, setMiddleName] = useState('');
  const [lastName, setLastName] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');

  const { data, isLoading, error: loadError } = useQuery({
    queryKey: ['invite', token],
    queryFn: () => api.get<{ invite: InviteInfo }>(`/invitations/${token}`),
    retry: false,
  });
  const invite = data?.invite;

  const goToProfiles = (ids: string[]) => navigate(ids.length === 1 ? `/app/${ids[0]}` : '/app');

  const acceptMutation = useMutation({
    mutationFn: () =>
      api.post<{ care_profile_ids: string[] }>(`/invitations/${token}/accept`, {
        relationship: relationship.trim() || undefined,
      }),
    onSuccess: (res) => goToProfiles(res.care_profile_ids),
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to accept the invitation'),
  });

  const registerMutation = useMutation({
    mutationFn: () =>
      api.post<{ token: string; account: SessionAccount; care_profile_ids: string[] }>(
        `/invitations/${token}/register`,
        {
          first_name: firstName.trim() || undefined,
          middle_name: middleName.trim() || undefined,
          last_name: lastName.trim() || undefined,
          password,
          relationship: relationship.trim() || undefined,
        }
      ),
    onSuccess: (res) => {
      setAuth(res.token, res.account);
      goToProfiles(res.care_profile_ids);
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to create your account'),
  });

  const next = encodeURIComponent(`/invite/${token}`);
  const emailMatches = !!invite && !!authAccount && authAccount.email.toLowerCase() === invite.email.toLowerCase();

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4 py-8">
      <div className="w-full max-w-md">
        <div className="mb-8 text-center">
          <h1 className="text-primary text-2xl font-semibold mb-1">PareCare</h1>
          <p className="text-muted text-sm">Care circle invitation</p>
        </div>
        <div className="card">
          {isLoading ? (
            <p className="text-sm text-muted py-6 text-center">Checking your invite…</p>
          ) : loadError || !invite ? (
            <StatusMessage title="This invite link isn't valid." detail="It may have been revoked, or the link was copied incompletely." />
          ) : invite.status === 'accepted' ? (
            <StatusMessage
              title="This invitation has already been accepted."
              detail="Sign in to see the care profiles you have access to."
              action={<Link to="/login" className="text-primary text-sm hover:underline">Go to sign in</Link>}
            />
          ) : invite.status === 'expired' ? (
            <StatusMessage
              title="This invitation has expired."
              detail={`Ask the person who invited you to send a new link to ${invite.email}.`}
            />
          ) : invite.status === 'revoked' ? (
            <StatusMessage title="This invitation has been withdrawn." detail="Contact the person who invited you if you think that's a mistake." />
          ) : (
            <div>
              <p className="text-sm text-ink mb-1 text-center">
                <span className="font-semibold">{invite.display_name}</span>, you've been invited to help care for
              </p>
              <ul className="my-3 space-y-1">
                {invite.profiles.map((p, i) => (
                  <li key={i} className="text-sm text-ink text-center">
                    <span className="font-semibold">{p.name}</span>{' '}
                    <span className="text-xs text-muted">
                      as {p.role}, {p.permission === 'viewer' ? 'view only' : 'can add and edit records'}
                    </span>
                  </li>
                ))}
              </ul>
              <p className="text-xs text-muted text-center mb-5">
                Invitation for <span className="font-medium">{invite.email}</span>
              </p>

              {isAuthed && emailMatches ? (
                <>
                  {invite.profiles.length === 1 ? (
                    <div className="text-left mb-4">
                      <RelationshipSelect
                        label={`Who is ${invite.profiles[0].name.split(' ')[0]} to you? (optional)`}
                        value={relationship}
                        onChange={setRelationship}
                      />
                    </div>
                  ) : null}
                  <Button className="w-full" loading={acceptMutation.isPending} onClick={() => acceptMutation.mutate()}>
                    Accept invitation
                  </Button>
                  {error ? <p className="text-sm text-red-600 mt-3 text-center">{error}</p> : null}
                </>
              ) : isAuthed && !emailMatches ? (
                <StatusMessage
                  title={`You're signed in as ${authAccount?.email ?? 'another account'}.`}
                  detail={`This invitation was sent to ${invite.email}. Sign out, then sign in or create an account with that address.`}
                  action={
                    <Button variant="secondary" onClick={() => clearAuth()}>
                      Sign out and continue
                    </Button>
                  }
                />
              ) : invite.has_account ? (
                <div className="space-y-3">
                  <p className="text-sm text-muted text-center">
                    You already have a PareCare account with this email. Sign in to accept.
                  </p>
                  <Link to={`/login?next=${next}`}>
                    <Button className="w-full">Sign in as {invite.email}</Button>
                  </Link>
                </div>
              ) : (
                <form
                  className="space-y-4"
                  onSubmit={(e) => {
                    e.preventDefault();
                    setError('');
                    if (password !== confirmPassword) {
                      setError('The passwords do not match.');
                      return;
                    }
                    registerMutation.mutate();
                  }}
                >
                  <p className="text-sm text-muted text-center">Create your account to accept. Your email is set by the invitation.</p>
                  <Input label="Email" type="email" value={invite.email} disabled readOnly />
                  <div className="grid gap-4 sm:grid-cols-2">
                    <Input
                      label="First name"
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                      placeholder={invite.display_name.split(' ')[0]}
                      autoComplete="given-name"
                      required
                    />
                    <Input
                      label="Last name"
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                      autoComplete="family-name"
                    />
                  </div>
                  <Input
                    label="Middle name"
                    value={middleName}
                    onChange={(e) => setMiddleName(e.target.value)}
                    autoComplete="additional-name"
                  />
                  <Input
                    label="Password"
                    type="password"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                    hint="At least 8 characters"
                  />
                  <Input
                    label="Confirm password"
                    type="password"
                    value={confirmPassword}
                    onChange={(e) => setConfirmPassword(e.target.value)}
                    autoComplete="new-password"
                    required
                  />
                  {invite.profiles.length === 1 ? (
                    <RelationshipSelect
                      label={`Who is ${invite.profiles[0].name.split(' ')[0]} to you? (optional)`}
                      value={relationship}
                      onChange={setRelationship}
                    />
                  ) : null}
                  {error ? <p className="text-sm text-red-600">{error}</p> : null}
                  <Button type="submit" className="w-full" loading={registerMutation.isPending}>
                    Create account and accept
                  </Button>
                  <p className="text-xs text-muted text-center">
                    Already use PareCare with a different email?{' '}
                    <Link to={`/login?next=${next}`} className="text-primary hover:underline">
                      Sign in instead
                    </Link>
                  </p>
                </form>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function StatusMessage({ title, detail, action }: { title: string; detail: string; action?: React.ReactNode }) {
  return (
    <div className="py-4 text-center">
      <p className="text-sm text-ink mb-2 font-medium">{title}</p>
      <p className="text-sm text-muted mb-4">{detail}</p>
      {action ?? null}
    </div>
  );
}
