import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { EditableSubheader } from '../../../components/ui/EditableSubheader';
import { PencilIcon, TrashIcon } from '../../../components/ui/icons';
import { AllergyModal } from '../../../components/AllergyModal';
import { PagePurpose } from '../../../components/PagePurpose';
import { useDataView, type DataSort } from '../../../components/data/useDataView';
import { DataToolbar } from '../../../components/data/DataToolbar';
import { SortableTh } from '../../../components/data/SortableTh';
import { RecordPanel } from '../../../components/record/RecordPanel';
import { RECORD_ROW_CLASS, useRecordPanel } from '../../../components/record/useRecordPanel';
import { useHiddenIds, useUndoStore } from '../../../stores/undo';
import { SEVERITY_RANK, severityLabel, type Allergy, type NoKnownAllergies } from '../../../lib/care';
import { formatDateOnly } from '../../../lib/datetime';
import { useProfile } from './ProfileLayout';

const SORTS: DataSort<Allergy>[] = [
  { key: 'substance', label: 'Substance', compare: (a, b) => a.substance.localeCompare(b.substance) },
  { key: 'reaction', label: 'Reaction', compare: (a, b) => (a.reaction ?? '').localeCompare(b.reaction ?? '') },
  { key: 'severity', label: 'How bad', compare: (a, b) => (SEVERITY_RANK[a.severity ?? ''] ?? 0) - (SEVERITY_RANK[b.severity ?? ''] ?? 0) },
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

  const { data, isLoading } = useQuery({
    queryKey: ['allergies', profile.id],
    queryFn: () => api.get<{ allergies: Allergy[]; no_known: NoKnownAllergies | null }>(`/care-profiles/${profile.id}/allergies`),
  });
  const allergies = data?.allergies ?? [];
  const noKnown = data?.no_known ?? null;
  const [noneError, setNoneError] = useState('');
  // Checked: no known allergies. Adding one clears it.
  const confirmNone = useMutation({
    mutationFn: () => api.post(`/care-profiles/${profile.id}/allergies/none`, {}),
    onSuccess: () => {
      setNoneError('');
      void queryClient.invalidateQueries({ queryKey: ['allergies', profile.id] });
      void queryClient.invalidateQueries({ queryKey: ['emergency-sheet', profile.id] });
    },
    onError: (err) => setNoneError(err instanceof Error ? err.message : 'That could not be saved. Try again in a moment.'),
  });

  // Deleting is held back a few seconds with Undo, never a "sure?" box.
  const deferDelete = useUndoStore((s) => s.deferDelete);
  const hidden = useHiddenIds();
  const deleteAllergy = (a: Allergy) => {
    deferDelete({
      message: `Deleted the allergy to ${a.substance}.`,
      ids: [a.id],
      commit: () => api.delete(`/care-profiles/${profile.id}/allergies/${a.id}`),
      onCommitted: () => void queryClient.invalidateQueries({ queryKey: ['allergies', profile.id] }),
    });
  };

  const visible = allergies.filter((a) => !hidden.has(a.id));
  const panel = useRecordPanel(visible, (a) => a.id);
  const dv = useDataView<Allergy>({
    rows: visible,
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
          <EditableSubheader copyKey="profile.allergies.subheader" vars={{ name: careName }} />
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
          {allergies.length === 0 && noKnown ? (
            <p className="text-sm text-ink">
              No known allergies, checked{noKnown.by_name ? ` by ${noKnown.by_name}` : ''} on {formatDateOnly(noKnown.on, 'd MMM yyyy')}. Adding an allergy clears this.
            </p>
          ) : allergies.length === 0 ? (
            <div className="space-y-3">
              <p className="text-sm text-ink">
                Record anything {careName} must not be given, so it shows on the emergency sheet and the medicine round.
              </p>
              {canEdit ? (
                <div className="flex flex-wrap justify-center gap-2">
                  <Button size="sm" variant="secondary" loading={confirmNone.isPending} onClick={() => confirmNone.mutate()}>
                    No known allergies
                  </Button>
                </div>
              ) : null}
              {noneError ? <p className="text-sm text-red-600" role="alert">{noneError}</p> : null}
            </div>
          ) : (
            <p className="text-sm text-muted">No allergies match your search.</p>
          )}
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto border-l-4 border-l-red-500">
          <table className="w-full text-sm">
            <thead>
              <tr className="text-left text-xs text-muted border-b border-border">
                <SortableTh label="Allergic to" sortKey="substance" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="How bad" sortKey="severity" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Reaction" sortKey="reaction" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                {canEdit ? <th className="px-3 py-2 text-right">Actions</th> : null}
              </tr>
            </thead>
            <tbody>
              {dv.view.map((a) => (
                <tr key={a.id} {...panel.rowProps(a.id)} className={`border-b border-border last:border-0 ${RECORD_ROW_CLASS}`}>
                  <td className="px-3 py-2 font-medium text-red-700 dark:text-red-300">{a.substance}</td>
                  <td className={`px-3 py-2 ${a.severity === 'life_threatening' || a.severity === 'severe' ? 'font-semibold text-red-700 dark:text-red-300' : 'text-ink'}`}>{severityLabel(a.severity) ?? ''}</td>
                  <td className="px-3 py-2 text-ink">{a.reaction ?? ''}</td>
                  {canEdit ? (
                    <td className="px-3 py-2 text-right whitespace-nowrap">
                      <Button size="xs" variant="ghost" className="mr-1" aria-label={`Edit ${a.substance}`} title="Edit" onClick={() => setEditing(a)}>
                        <PencilIcon />
                      </Button>
                      <Button size="xs" variant="ghost-danger" aria-label={`Delete ${a.substance}`} title="Delete" onClick={() => deleteAllergy(a)}>
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

      {panel.current ? (
        <RecordPanel
          key={panel.current.id}
          kindLabel="Allergy"
          title={panel.current.substance}
          kind="allergies"
          recordId={panel.current.id}
          profileId={profile.id}
          canEdit={canEdit}
          fields={[
            { label: 'Allergic to', value: panel.current.substance },
            { label: 'How bad', value: severityLabel(panel.current.severity) },
            { label: 'Reaction', value: panel.current.reaction },
          ]}
          onEdit={() => setEditing(panel.current)}
          onDelete={() => {
            deleteAllergy(panel.current!);
            panel.close();
          }}
          onClose={panel.close}
        />
      ) : null}
    </div>
  );
}
