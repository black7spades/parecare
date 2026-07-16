import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../api/client';
import { Button } from '../components/ui/Button';
import { Textarea } from '../components/ui/Input';
import { planSectionLabel, planVersionStatusLabel, type PlanContent, type PlanEntry } from '../lib/care';

/**
 * The public receiving end of a care plan review invitation. The secure
 * link token is the credential: no login is needed, the reviewer reads
 * the exact version they were invited to, and can comment or, when
 * allowed, approve it. Every view and response is audited.
 */

interface ReviewPayload {
  review: {
    invited_name: string | null;
    can_comment: boolean;
    can_approve: boolean;
    status: string;
    comment: string | null;
    expires_at: string;
  };
  version: {
    version: number;
    status: string;
    content: PlanContent;
    content_hash: string;
    changelog: string | null;
    created_at: string;
  };
  profile_name: string;
}

const fieldLabel = (f: string): string => f.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const fieldText = (v: string | number | boolean | null | undefined): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
};

export function PlanReviewPage() {
  const { token } = useParams<{ token: string }>();
  const queryClient = useQueryClient();
  const [comment, setComment] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['plan-review', token],
    queryFn: () => api.get<ReviewPayload>(`/plan-reviews/${token}`),
    retry: false,
  });

  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['plan-review', token] });

  const commentMutation = useMutation({
    mutationFn: () => api.post(`/plan-reviews/${token}/comment`, { comment: comment.trim() }),
    onSuccess: () => {
      setComment('');
      setError('');
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not record the comment.'),
  });
  const approveMutation = useMutation({
    mutationFn: () => api.post(`/plan-reviews/${token}/approve`, { comment: comment.trim() || null }),
    onSuccess: () => {
      setError('');
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not record the approval.'),
  });

  if (isLoading) {
    return <p className="text-sm text-muted text-center mt-12">Loading…</p>;
  }
  if (isError || !data) {
    return (
      <div className="card text-center py-12 max-w-md mx-auto mt-12">
        <h1 className="text-lg font-semibold text-ink mb-2">This review link is invalid or has expired</h1>
        <p className="text-sm text-muted">Ask the person who invited you to send a new one.</p>
      </div>
    );
  }

  const { review, version, profile_name } = data;
  const responded = review.status === 'approved' || review.status === 'declined';
  const sections = Object.keys(version.content.sections).filter(
    (s) => (version.content.sections[s] ?? []).length > 0
  );

  return (
    <div className="max-w-3xl mx-auto px-4 py-8 space-y-5">
      <div>
        <h1 className="text-2xl font-bold text-ink">Care plan for {profile_name}</h1>
        <p className="text-xs text-muted">
          Version {version.version} · {planVersionStatusLabel(version.status)} · Created{' '}
          {format(new Date(version.created_at), 'd MMM yyyy HH:mm')} · SHA-256 {version.content_hash.slice(0, 16)}…
        </p>
        {review.invited_name ? (
          <p className="text-sm text-muted mt-1">
            You were invited to review this version{review.can_approve ? ' and may approve it' : ''}. The
            link expires {format(new Date(review.expires_at), 'd MMM yyyy')}.
          </p>
        ) : null}
      </div>

      {version.changelog ? (
        <div className="card">
          <h2 className="text-sm font-semibold text-ink mb-1">What changed in this version</h2>
          <pre className="text-xs text-muted whitespace-pre-wrap font-sans">{version.changelog}</pre>
        </div>
      ) : null}

      {sections.map((s) => {
        const entries = version.content.sections[s] ?? [];
        const fieldNames = [...new Set(entries.flatMap((e: PlanEntry) => Object.keys(e.fields)))];
        return (
          <div key={s} className="card">
            <h2 className="text-sm font-semibold text-ink mb-2">{planSectionLabel(s)}</h2>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    {fieldNames.map((f) => (
                      <th key={f} className="py-1.5 pr-3">
                        {fieldLabel(f)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries.map((e: PlanEntry) => (
                    <tr key={e.key}>
                      {fieldNames.map((f) => (
                        <td key={f} className="py-1.5 pr-3 text-ink">
                          {fieldText(e.fields[f])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}

      <div className="card space-y-3">
        <h2 className="text-sm font-semibold text-ink">Your response</h2>
        {responded ? (
          <p className="text-sm text-ink">
            You {review.status} this version{review.comment ? ` with the comment: "${review.comment}"` : ''}.
            Thank you.
          </p>
        ) : (
          <>
            {review.comment ? (
              <p className="text-xs text-muted">Your earlier comment: "{review.comment}"</p>
            ) : null}
            {review.can_comment ? (
              <Textarea
                label="Comment"
                rows={3}
                value={comment}
                onChange={(e) => setComment(e.target.value)}
                placeholder="What should change, or what looks right"
              />
            ) : null}
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex justify-end gap-2">
              {review.can_comment ? (
                <Button
                  variant="secondary"
                  disabled={!comment.trim()}
                  loading={commentMutation.isPending}
                  onClick={() => commentMutation.mutate()}
                >
                  Send comment
                </Button>
              ) : null}
              {review.can_approve ? (
                <Button loading={approveMutation.isPending} onClick={() => approveMutation.mutate()}>
                  Approve
                </Button>
              ) : null}
            </div>
          </>
        )}
      </div>

      <p className="text-xs text-muted text-center">
        Shared securely from PareCare. Every view and response on this link is recorded.
      </p>
    </div>
  );
}
