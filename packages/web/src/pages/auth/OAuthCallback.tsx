import { useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuthStore } from '../../stores/auth';
import { api } from '../../api/client';
import { MfaCodeInput } from '../../components/MfaCodeInput';

const ERROR_MESSAGES: Record<string, string> = {
  super_admin_password_only: 'The super admin account must sign in with email and password.',
  no_email: "Your social account didn't share a verified email address, which PareCare needs.",
  cancelled: 'Sign-in was cancelled.',
  invalid_state: 'The sign-in link expired — please try again.',
  provider_error: "Something went wrong talking to the sign-in provider — please try again.",
  provider_not_configured: 'That sign-in provider is not set up on this server.',
  linked_to_google: 'This email is already linked to Google sign-in — use the Google button.',
  linked_to_facebook: 'This email is already linked to Facebook sign-in — use the Facebook button.',
};

/**
 * Landing page for Google/Facebook sign-in. The API redirects here with the
 * result in the URL fragment (#token=… / #mfa_token=… / #error=…) — the
 * fragment never reaches server logs.
 */
export function OAuthCallback() {
  const navigate = useNavigate();
  const setAuth = useAuthStore((s) => s.setAuth);
  const [error, setError] = useState('');
  const [mfaError, setMfaError] = useState('');
  const [loading, setLoading] = useState(false);

  const fragment = useMemo(() => new URLSearchParams(window.location.hash.slice(1)), []);
  const mfaToken = fragment.get('mfa_token');

  useEffect(() => {
    const token = fragment.get('token');
    const errCode = fragment.get('error');
    if (errCode) {
      setError(ERROR_MESSAGES[errCode] ?? 'Sign-in failed — please try again.');
      return;
    }
    if (!token) return;
    // Store the token, then load the account profile it belongs to
    useAuthStore.setState({ token });
    void api
      .get<{
        id: string;
        email: string;
        display_name: string;
        role: 'super_admin' | 'admin' | 'user';
        subscription_tier: 'free' | 'family' | 'professional';
        subscription_status: string | null;
      }>('/auth/me')
      .then((me) => {
        setAuth(token, me);
        navigate('/app', { replace: true });
      })
      .catch(() => setError('Signed in, but loading your account failed — try refreshing.'));
  }, [fragment, navigate, setAuth]);

  async function handleMfa(code: string) {
    setMfaError('');
    setLoading(true);
    try {
      const data = await api.post<{ token: string; account: Parameters<typeof setAuth>[1] }>('/auth/mfa/challenge', {
        mfa_token: mfaToken,
        code,
      });
      setAuth(data.token, data.account);
      navigate('/app', { replace: true });
    } catch (err) {
      setMfaError(err instanceof Error ? err.message : 'Verification failed');
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-surface flex items-center justify-center px-4">
      <div className="w-full max-w-sm">
        <div className="mb-8 text-center">
          <h1 className="text-primary text-2xl font-semibold mb-1">PareCare</h1>
          <p className="text-muted text-sm">Signing you in…</p>
        </div>
        <div className="card">
          {mfaToken ? (
            <MfaCodeInput onSubmit={handleMfa} loading={loading} error={mfaError} />
          ) : error ? (
            <div className="text-center py-2">
              <p className="text-sm text-red-600 mb-4">{error}</p>
              <Link to="/login" className="text-primary text-sm hover:underline">
                Back to sign in
              </Link>
            </div>
          ) : (
            <p className="text-sm text-muted text-center py-4">One moment…</p>
          )}
        </div>
      </div>
    </div>
  );
}
