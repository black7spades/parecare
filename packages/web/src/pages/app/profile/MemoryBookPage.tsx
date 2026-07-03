import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input, Textarea } from '../../../components/ui/Input';
import { useAuthStore } from '../../../stores/auth';
import { useProfile } from './ProfileLayout';
import type { MemoryEntry } from '../../../lib/care';

export function MemoryBookPage() {
  const { profile, careName } = useProfile();
  const queryClient = useQueryClient();
  const me = useAuthStore((s) => s.account);
  const fileInput = useRef<HTMLInputElement>(null);

  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [photo, setPhoto] = useState<File | null>(null);
  const [error, setError] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['memory-book', profile.id],
    queryFn: () => api.get<{ entries: MemoryEntry[] }>(`/care-profiles/${profile.id}/memory-book`),
  });
  const entries = data?.entries ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['memory-book', profile.id] });

  const addMutation = useMutation({
    mutationFn: () => {
      const form = new FormData();
      if (title.trim()) form.append('title', title.trim());
      form.append('body', body.trim());
      if (photo) form.append('photo', photo);
      return api.upload(`/care-profiles/${profile.id}/memory-book`, form);
    },
    onSuccess: () => {
      setTitle('');
      setBody('');
      setPhoto(null);
      setError('');
      if (fileInput.current) fileInput.current.value = '';
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save memory'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profile.id}/memory-book/${id}`),
    onSuccess: invalidate,
  });

  const firstName = careName;

  return (
    <div className="space-y-6 max-w-3xl">
      <form
        className="card space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (body.trim()) addMutation.mutate();
        }}
      >
        <h2 className="text-base font-semibold text-ink">Add a memory</h2>
        <p className="text-sm text-muted -mt-2">
          Stories, photos and messages for {firstName}, written while there's still time to share them together.
        </p>
        <Input label="Title (optional)" value={title} onChange={(e) => setTitle(e.target.value)} placeholder="e.g. The caravan trip, 1987" />
        <Textarea
          label="The memory"
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={4}
          required
          placeholder="Write the story the way you'd tell it…"
        />
        <div>
          <label htmlFor="memory-photo" className="block text-sm font-medium text-ink mb-1">
            Photo (optional)
          </label>
          <input
            id="memory-photo"
            ref={fileInput}
            type="file"
            accept="image/*"
            className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-sm file:text-primary hover:file:bg-primary-100"
            onChange={(e) => setPhoto(e.target.files?.[0] ?? null)}
          />
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end">
          <Button type="submit" loading={addMutation.isPending} disabled={!body.trim()}>
            Add to the book
          </Button>
        </div>
      </form>

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : entries.length === 0 ? (
        <p className="text-sm text-muted">The book is empty. The first memory is the hardest to write, so start small.</p>
      ) : (
        <div className="space-y-4">
          {entries.map((entry) => (
            <div key={entry.id} className="card group">
              {entry.photo_url ? <MemoryPhoto profileId={profile.id} entryId={entry.id} alt={entry.title ?? 'Memory photo'} /> : null}
              {entry.title ? <h3 className="text-sm font-semibold text-ink mb-1">{entry.title}</h3> : null}
              <p className="text-sm text-ink whitespace-pre-wrap">{entry.body}</p>
              <div className="mt-2 flex items-center justify-between">
                <p className="text-xs text-muted">
                  {entry.author_name ?? 'Someone'} · {format(new Date(entry.created_at), 'd MMM yyyy')}
                </p>
                {entry.author_account_id === me?.id ? (
                  <button
                    type="button"
                    className="text-xs text-muted hover:text-red-600 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity"
                    onClick={() => deleteMutation.mutate(entry.id)}
                  >
                    Remove
                  </button>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// <img> can't send the Authorization header, so fetch the photo as a blob
function MemoryPhoto({ profileId, entryId, alt }: { profileId: string; entryId: string; alt: string }) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    let url: string | null = null;
    let cancelled = false;
    void api.blob(`/care-profiles/${profileId}/memory-book/${entryId}/photo`).then((blob) => {
      if (cancelled) return;
      url = URL.createObjectURL(blob);
      setSrc(url);
    });
    return () => {
      cancelled = true;
      if (url) URL.revokeObjectURL(url);
    };
  }, [profileId, entryId]);
  if (!src) return <div className="mb-3 h-40 rounded-md bg-surface-2 animate-pulse" />;
  return <img src={src} alt={alt} className="mb-3 max-h-80 rounded-md object-cover" />;
}
