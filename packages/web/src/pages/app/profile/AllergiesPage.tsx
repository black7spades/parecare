import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { PencilIcon, TrashIcon } from '../../../components/ui/icons';
import { Modal } from '../../../components/ui/Modal';
import { AllergyModal } from '../../../components/AllergyModal';
import { PagePurpose } from '../../../components/PagePurpose';
import { useDataView, type DataSort } from '../../../components/data/useDataView';
import { DataToolbar } from '../../../components/data/DataToolbar';
import type { Allergy } from '../../../lib/care';
import { useProfile } from './ProfileLayout';

const SORTS: DataSort<Allergy>[] = [
  { key: 'substance', label: 'Substance', compare: (a, b) => a.substance.localeCompare(b.substance) },
  { key: 'reaction', label: 'Reaction', compare: (a, b) => (a.reaction ?? '').localeCompare(b.reaction ?? '') },
];

/**
 * The data entry home for allergies. Everywhere else that shows an
 * allergy (the care plan, the emergency sheet) reads from here.
 */
export function AllergiesPage() {
  const { profile, careName, canEdit } = useProfile();
  const queryClient = useQueryClient();
  const [adding, setAdding] = useState(false);
  const [editing, setEditing] = useState<Allergy | null>(null);
  const [confirmDelete, setConfirmDelete] = useState<Allergy | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['allergies', profile.id],
    queryFn: () => api.get<{ allergies: Allergy[] }>(`/care-profiles/${profile.id}/allergies`),
  });
  const allergies = data?.allergies ?? [];

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profile.id}/allergies/${id}`),
    onSuccess: () => {
      setConfirmDelete(null);
      void queryClient.invalidateQueries({ queryKey: ['allergies', profile.id] });
    },
  });

  const dv = useDataView<Allergy>({
    rows: allergies,
    getId: (a) => a.id,
    searchText: (a) => [a.substance, a.reaction].filter(Boolean).join(' '),
    sorts: SORTS,
    filters: [],
    defaultPageSize: 25,
  });

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex items-start justify-between gap-3 flex-wrap">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-ink">Allergies</h2>
            <PagePurpose kind="entry" />
          </div>
          <p className="text-sm text-muted">
            What {careName} must not be given, and what happens if they are. One row per substance.
          </p>
        </div>
        {canEdit ? (
          <Button size="sm" onClick={() => setAdding(true)}>
            Add allergy
          </Button>
        ) : null}
      </div>

      <DataToolbar
        search={dv.search}
        onSearch={dv.setSearch}
        searchPlaceholder="Search allergies..."
        sorts={SORTS.map((s) => ({ key: s.key, label: s.label }))}
        sortKey={dv.sortKey}
        onSort={dv.setSortKey}
        filters={[]}
        filterValues={dv.filterValues}
        onFilter={dv.setFilter}
        selectedCount={0}
        bulkActions={[]}
        onClearSelection={dv.clearSelection}
        page={dv.page}
        totalPages={dv.totalPages}
        pageSize={dv.pageSize}
        totalFiltered={dv.totalFiltered}
        onPageChange={dv.setPage}
        onPageSizeChange={dv.setPageSize}
      />

      {isLoading ? (
        <p className="text-sm text-muted">Loading...</p>
      ) : dv.view.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm text-muted">
            {allergies.length === 0
              ? `No allergies recorded for ${careName} yet.`
              : 'No allergies match your search.'}
          </p>
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto border-l-4 border-l-red-500">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-border">
                <th className="px-3 py-2">Allergic to</th>
                <th className="px-3 py-2">Reaction</th>
                {canEdit ? <th className="px-3 py-2 text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {dv.view.map((a) => (
                <tr key={a.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2 font-medium text-red-700 dark:text-red-300">{a.substance}</td>
                  <td className="px-3 py-2 text-ink">{a.reaction ?? ''}</td>
                  {canEdit ? (
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button size="xs" variant="ghost" className="mr-1" aria-label={`Edit ${a.substance}`} title="Edit" onClick={() => setEditing(a)}>
                        <PencilIcon />
                      </Button>
                      <Button size="xs" variant="ghost-danger" aria-label={`Delete ${a.substance}`} title="Delete" onClick={() => setConfirmDelete(a)}>
                        <TrashIcon />
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {adding ? <AllergyModal profileId={profile.id} open onClose={() => setAdding(false)} /> : null}
      {editing ? (
        <AllergyModal profileId={profile.id} allergy={editing} open onClose={() => setEditing(null)} />
      ) : null}

      <Modal open={confirmDelete !== null} onClose={() => setConfirmDelete(null)} title="Delete allergy">
        <p className="text-sm text-muted mb-4">
          Delete the allergy to <span className="font-medium text-ink">{confirmDelete?.substance}</span>? This
          cannot be undone.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDelete(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            loading={deleteMutation.isPending}
            onClick={() => confirmDelete && deleteMutation.mutate(confirmDelete.id)}
          >
            Delete
          </Button>
        </div>
      </Modal>
    </div>
  );
}
