import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Textarea } from '../../../components/ui/Input';
import { CheckIcon, CrossIcon, PencilIcon, RefreshIcon } from '../../../components/ui/icons';

export interface OverviewCardSummary {
  card_key: string;
  content: string;
  source: 'ai' | 'edited';
  generated_at: string | null;
  updated_at: string;
}

/**
 * The stored Pare summary shown at the top of an overview card. Written
 * once by the assistant and kept, never regenerated on page load; carers
 * with edit access get icon controls to regenerate, edit and save it.
 */
export function CardAiSummary({
  profileId,
  cardKey,
  canEdit,
  autoGenerate = false,
}: {
  profileId: string;
  cardKey: string;
  canEdit: boolean;
  /** Generate on first load when nothing is stored yet. */
  autoGenerate?: boolean;
}) {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState('');
  const autoTried = useRef(false);

  const { data, isLoading } = useQuery({
    queryKey: ['overview-summaries', profileId],
    queryFn: () => api.get<{ summaries: OverviewCardSummary[] }>(`/care-profiles/${profileId}/overview-summaries`),
  });
  const summary = data?.summaries.find((s) => s.card_key === cardKey) ?? null;

  const applySaved = (saved: OverviewCardSummary) => {
    queryClient.setQueryData<{ summaries: OverviewCardSummary[] }>(['overview-summaries', profileId], (prev) => {
      const rest = (prev?.summaries ?? []).filter((s) => s.card_key !== cardKey);
      return { summaries: [...rest, saved] };
    });
  };

  // True only while the automatic first-load attempt is in flight, so its
  // failure stays silent; a deliberate regenerate shows what went wrong.
  const silentAttempt = useRef(false);

  const generateMutation = useMutation({
    mutationFn: () =>
      api.post<{ summary: OverviewCardSummary }>(`/care-profiles/${profileId}/overview-summaries/${cardKey}/generate`, {}),
    onSuccess: (res) => {
      setError('');
      applySaved(res.summary);
    },
    onError: (err) => {
      if (silentAttempt.current) return;
      setError(err instanceof Error ? err.message : 'Could not generate the summary.');
    },
    onSettled: () => {
      silentAttempt.current = false;
    },
  });

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch<{ summary: OverviewCardSummary }>(`/care-profiles/${profileId}/overview-summaries/${cardKey}`, {
        content: draft.trim(),
      }),
    onSuccess: (res) => {
      setError('');
      setEditing(false);
      applySaved(res.summary);
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save the summary.'),
  });

  // First load only: if nothing is stored yet, ask Pare once. The result
  // is persisted, so later visits read the stored text instead.
  useEffect(() => {
    if (!autoGenerate || !canEdit || isLoading || summary || autoTried.current || generateMutation.isPending) return;
    autoTried.current = true;
    silentAttempt.current = true;
    generateMutation.mutate();
  }, [autoGenerate, canEdit, isLoading, summary, generateMutation]);

  if (isLoading) return null;
  if (!summary && !canEdit) return null;
  if (!summary && !generateMutation.isPending && !error) {
    return (
      <div className="flex items-center gap-2">
        <p className="text-xs text-muted flex-1">Pare can write a short summary of this card.</p>
        <Button
          size="xs"
          variant="ghost"
          aria-label="Generate summary"
          title="Generate summary"
          onClick={() => generateMutation.mutate()}
        >
          <RefreshIcon />
        </Button>
      </div>
    );
  }

  return (
    <div className="rounded-md bg-surface-2 px-3 py-2">
      <div className="flex items-start gap-2">
        <div className="flex-1 min-w-0">
          <p className="text-xs text-muted mb-1">
            Pare summary
            {summary?.source === 'edited' ? ' · edited by a carer' : null}
          </p>
          {editing ? (
            <Textarea
              aria-label="Edit the summary"
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              rows={4}
            />
          ) : generateMutation.isPending ? (
            <p className="text-sm text-muted">Pare is writing a summary…</p>
          ) : summary ? (
            <p className="text-sm text-ink leading-relaxed whitespace-pre-wrap">{summary.content}</p>
          ) : null}
          {error ? <p className="mt-1 text-xs text-red-600">{error}</p> : null}
        </div>
        {canEdit ? (
          <span className="flex items-center gap-1 shrink-0">
            {editing ? (
              <>
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label="Save summary"
                  title="Save summary"
                  loading={saveMutation.isPending}
                  disabled={!draft.trim()}
                  onClick={() => saveMutation.mutate()}
                >
                  <CheckIcon />
                </Button>
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label="Cancel editing"
                  title="Cancel editing"
                  onClick={() => {
                    setEditing(false);
                    setError('');
                  }}
                >
                  <CrossIcon />
                </Button>
              </>
            ) : (
              <>
                <Button
                  size="xs"
                  variant="ghost"
                  aria-label="Regenerate summary"
                  title="Regenerate summary"
                  loading={generateMutation.isPending}
                  onClick={() => generateMutation.mutate()}
                >
                  <RefreshIcon />
                </Button>
                {summary ? (
                  <Button
                    size="xs"
                    variant="ghost"
                    aria-label="Edit summary"
                    title="Edit summary"
                    onClick={() => {
                      setDraft(summary.content);
                      setError('');
                      setEditing(true);
                    }}
                  >
                    <PencilIcon />
                  </Button>
                ) : null}
              </>
            )}
          </span>
        ) : null}
      </div>
    </div>
  );
}
