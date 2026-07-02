import { useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { DOCUMENT_CATEGORIES, documentCategoryLabel, type CareDocument } from '../../../lib/care';
import { useProfile } from './ProfileLayout';

function formatSize(bytes: number | null): string {
  if (!bytes) return '';
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function DocumentsPage() {
  const { profile } = useProfile();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [label, setLabel] = useState('');
  const [category, setCategory] = useState('medical_record');
  const [restrictedRoles, setRestrictedRoles] = useState<string[]>([]);
  const [error, setError] = useState('');
  const [deleting, setDeleting] = useState<CareDocument | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['documents', profile.id],
    queryFn: () => api.get<{ documents: CareDocument[] }>(`/care-profiles/${profile.id}/documents`),
  });
  const documents = data?.documents ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['documents', profile.id] });

  const uploadMutation = useMutation({
    mutationFn: () => {
      const form = new FormData();
      form.append('file', file!);
      form.append('category', category);
      form.append('label', label.trim() || file!.name);
      for (const role of restrictedRoles) form.append('visible_to_roles', role);
      return api.upload(`/care-profiles/${profile.id}/documents`, form);
    },
    onSuccess: () => {
      setFile(null);
      setLabel('');
      setRestrictedRoles([]);
      setError('');
      if (fileInput.current) fileInput.current.value = '';
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Upload failed'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profile.id}/documents/${id}`),
    onSuccess: () => {
      setDeleting(null);
      invalidate();
    },
  });

  async function download(doc: CareDocument) {
    const blob = await api.blob(`/care-profiles/${profile.id}/documents/${doc.id}/file`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    const ext = doc.file_url.includes('.') ? doc.file_url.slice(doc.file_url.lastIndexOf('.')) : '';
    a.download = `${doc.label}${ext}`;
    a.click();
    URL.revokeObjectURL(url);
  }

  return (
    <div className="grid gap-6 lg:grid-cols-[1fr_20rem] items-start">
      <div className="card">
        <h2 className="text-base font-semibold text-ink mb-4">Document repository</h2>
        {isLoading ? (
          <p className="text-sm text-muted">Loading…</p>
        ) : documents.length === 0 ? (
          <p className="text-sm text-muted">
            No documents yet. Keep medical certificates, the will, POA papers and care plans here so nobody hunts
            through email chains.
          </p>
        ) : (
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-border">
                <th className="py-2 font-medium">Document</th>
                <th className="py-2 font-medium">Category</th>
                <th className="py-2 font-medium">Added</th>
                <th className="py-2 font-medium text-right">Actions</th>
              </tr>
            </thead>
            <tbody>
              {documents.map((doc) => (
                <tr key={doc.id} className="border-b border-border last:border-0">
                  <td className="py-2.5">
                    <span className="font-medium text-ink">{doc.label}</span>
                    <span className="text-xs text-muted ml-2">{formatSize(doc.file_size_bytes)}</span>
                  </td>
                  <td className="py-2.5">
                    <span className="badge bg-surface-2 text-muted text-xs">{documentCategoryLabel(doc.category)}</span>
                    {(doc.visible_to_roles?.length ?? 0) > 0 ? (
                      <span
                        className="badge bg-amber-50 text-amber-700 text-xs ml-1"
                        title={`Visible to the owner and: ${doc.visible_to_roles!.join(', ')}`}
                      >
                        Restricted
                      </span>
                    ) : null}
                  </td>
                  <td className="py-2.5 text-muted text-xs">{format(new Date(doc.created_at), 'd MMM yyyy')}</td>
                  <td className="py-2.5 text-right whitespace-nowrap space-x-2">
                    <Button size="sm" variant="secondary" onClick={() => void download(doc)}>
                      Download
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setDeleting(doc)}>
                      Delete
                    </Button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <form
        className="card space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          if (file) uploadMutation.mutate();
        }}
      >
        <h2 className="text-base font-semibold text-ink">Upload a document</h2>
        <div>
          <label htmlFor="doc-file" className="block text-sm font-medium text-ink mb-1">
            File
          </label>
          <input
            id="doc-file"
            ref={fileInput}
            type="file"
            className="block w-full text-sm text-muted file:mr-3 file:rounded-md file:border-0 file:bg-primary-50 file:px-3 file:py-1.5 file:text-sm file:text-primary hover:file:bg-primary-100"
            onChange={(e) => {
              const f = e.target.files?.[0] ?? null;
              setFile(f);
              if (f && !label) setLabel(f.name.replace(/\.[^.]+$/, ''));
            }}
          />
          <p className="mt-1 text-xs text-muted">Up to 50 MB.</p>
        </div>
        <Input label="Label" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Medical certificate, March" />
        <div>
          <label htmlFor="doc-category" className="block text-sm font-medium text-ink mb-1">
            Category
          </label>
          <select
            id="doc-category"
            className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
            value={category}
            onChange={(e) => setCategory(e.target.value)}
          >
            {DOCUMENT_CATEGORIES.map((c) => (
              <option key={c.value} value={c.value}>
                {c.label}
              </option>
            ))}
          </select>
        </div>
        <div>
          <span className="block text-sm font-medium text-ink mb-1">Who can see it</span>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              checked={restrictedRoles.length > 0}
              onChange={(e) => setRestrictedRoles(e.target.checked ? ['family'] : [])}
            />
            Restrict to selected roles
          </label>
          {restrictedRoles.length > 0 ? (
            <div className="mt-2 space-y-1 pl-6">
              {['family', 'carer', 'legal', 'organisation'].map((role) => (
                <label key={role} className="flex items-center gap-2 text-sm text-ink capitalize">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    checked={restrictedRoles.includes(role)}
                    onChange={(e) =>
                      setRestrictedRoles((prev) =>
                        e.target.checked ? [...prev, role] : prev.filter((r) => r !== role)
                      )
                    }
                  />
                  {role}
                </label>
              ))}
              <p className="text-xs text-muted">The profile owner always has access.</p>
            </div>
          ) : (
            <p className="mt-1 text-xs text-muted pl-6">Everyone in the care circle can see it.</p>
          )}
        </div>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <Button type="submit" className="w-full" loading={uploadMutation.isPending} disabled={!file}>
          Upload
        </Button>
      </form>

      <Modal open={deleting !== null} onClose={() => setDeleting(null)} title="Delete document">
        <p className="text-sm text-muted mb-4">
          Permanently delete <span className="font-medium text-ink">{deleting?.label}</span>? This cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setDeleting(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={deleteMutation.isPending}
            onClick={() => deleting && deleteMutation.mutate(deleting.id)}
          >
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}
