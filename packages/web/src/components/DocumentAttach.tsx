import { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../api/client';
import type { CareDocument, CircleMember } from '../lib/care';
import { UploadDocumentModal } from '../pages/app/profile/DocumentsPage';
import { Button } from './ui/Button';

/**
 * Documents to go with a record while it is being written: a chip for each,
 * a list of what is already on file to add from, and Upload a new one. The
 * form's own save links them.
 */
export function DocumentAttach({
  profileId,
  value,
  onChange,
  label = 'Documents',
  addLabel = 'Attach a document',
  emptyText = 'No documents attached.',
  hint,
  idPrefix = 'docs',
}: {
  profileId: string;
  value: string[];
  onChange: (ids: string[]) => void;
  label?: string;
  addLabel?: string;
  emptyText?: string;
  hint?: string;
  idPrefix?: string;
}) {
  const queryClient = useQueryClient();
  const [picking, setPicking] = useState(false);
  const [uploading, setUploading] = useState(false);
  const { data } = useQuery({
    queryKey: ['documents', profileId],
    queryFn: () => api.get<{ documents: CareDocument[] }>(`/care-profiles/${profileId}/documents`),
  });
  const { data: circleData } = useQuery({
    queryKey: ['circle', profileId],
    queryFn: () => api.get<{ members: CircleMember[] }>(`/care-profiles/${profileId}/circle`),
    enabled: uploading,
  });
  const docs = data?.documents ?? [];
  const chosen = value.map((id) => docs.find((d) => d.id === id)).filter((d): d is CareDocument => !!d);
  const available = docs.filter((d) => !value.includes(d.id));

  return (
    <div>
      <p className="block text-sm font-medium text-ink mb-1">{label}</p>
      {chosen.length === 0 ? (
        <p className="text-xs text-muted">{emptyText}</p>
      ) : (
        <ul className="flex flex-wrap gap-2">
          {chosen.map((d) => (
            <li key={d.id} className="inline-flex items-center gap-1 rounded-full border border-border bg-surface px-2 py-0.5 text-xs text-ink">
              <span className="break-all">{d.label}</span>
              <Button
                type="button"
                size="xs"
                variant="ghost"
                className="!px-1 !py-0"
                aria-label={`Remove ${d.label}`}
                title="Remove"
                onClick={() => onChange(value.filter((x) => x !== d.id))}
              >
                ✕
              </Button>
            </li>
          ))}
        </ul>
      )}
      {hint ? <p className="mt-1 text-xs text-muted">{hint}</p> : null}
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <Button type="button" size="sm" variant="ghost" onClick={() => setPicking((v) => !v)} aria-expanded={picking}>
          {addLabel}
        </Button>
      </div>
      {picking ? (
        <div className="mt-2 rounded-md border border-border p-2 space-y-1">
          {available.length === 0 ? <p className="text-xs text-muted">Nothing else on file yet.</p> : null}
          {available.slice(0, 30).map((d) => (
            <label key={d.id} htmlFor={`${idPrefix}-${d.id}`} className="flex items-center gap-2 text-sm cursor-pointer">
              <input
                id={`${idPrefix}-${d.id}`}
                type="checkbox"
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                checked={false}
                onChange={() => onChange([...value, d.id])}
              />
              <span className="text-ink break-words">{d.label}</span>
              {d.category_name ? <span className="text-xs text-muted">{d.category_name}</span> : null}
            </label>
          ))}
          <div className="pt-1">
            <Button type="button" size="xs" variant="secondary" onClick={() => setUploading(true)}>Upload a new one</Button>
          </div>
        </div>
      ) : null}
      {uploading ? (
        <UploadDocumentModal
          profileId={profileId}
          members={circleData?.members ?? []}
          initialFile={null}
          onClose={() => setUploading(false)}
          onUploaded={(doc) => {
            setUploading(false);
            setPicking(false);
            void queryClient.invalidateQueries({ queryKey: ['documents', profileId] });
            onChange([...value, doc.id]);
          }}
        />
      ) : null}
    </div>
  );
}
