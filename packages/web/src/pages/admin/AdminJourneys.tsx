import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api, ApiError } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { PencilIcon, TrashIcon } from '../../components/ui/icons';
import { Input, Textarea } from '../../components/ui/Input';
import { Modal } from '../../components/ui/Modal';
import { useAuthStore } from '../../stores/auth';
import { useDataView, type DataSort, type DataFilter } from '../../components/data/useDataView';
import { DataToolbar } from '../../components/data/DataToolbar';
import {
  JOURNEY_KINDS,
  journeyKindLabel,
  stageAgeLabel,
  type JourneyTemplateFull,
  type JourneyTemplatePhase,
  type JourneyTemplateSummary,
  type LifeStage,
} from '../../lib/journeys';

/**
 * The journey library administration: life stages that organise it and
 * the templates inside it. Templates can be authored from scratch,
 * cloned, or composed by cherry-picking phases from any other template.
 * Enrolments are copies, so nothing here rewrites anyone's journey.
 */
export function AdminJourneys() {
  return (
    <div className="space-y-8">
      <LifeStagesManager />
      <TemplateLibrary />
    </div>
  );
}

// --------------------------------------------------------------- stages

function LifeStagesManager() {
  const queryClient = useQueryClient();
  const [editing, setEditing] = useState<Partial<LifeStage> | null>(null);
  const [error, setError] = useState('');

  const { data } = useQuery({
    queryKey: ['life-stages'],
    queryFn: () => api.get<{ stages: LifeStage[] }>(`/life-stages`),
  });
  const stages = data?.stages ?? [];
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['life-stages'] });

  const saveMutation = useMutation({
    mutationFn: (stage: Partial<LifeStage>) => {
      const body = {
        name: stage.name,
        description: stage.description ?? null,
        min_age_years: stage.min_age_years ?? null,
        max_age_years: stage.max_age_years ?? null,
        applies_before_birth: stage.applies_before_birth ?? false,
        sort_order: stage.sort_order ?? stages.length,
        retired: stage.retired ?? false,
      };
      return stage.id ? api.patch(`/life-stages/${stage.id}`, body) : api.post(`/life-stages`, body);
    },
    onSuccess: () => {
      setEditing(null);
      setError('');
      invalidate();
    },
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save the life stage.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/life-stages/${id}`),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not delete the life stage.'),
  });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-base font-semibold text-ink">Life stages</h2>
          <p className="text-sm text-muted">
            The stages that organise the journey library and drive suggestions. They never restrict which journeys a
            person can be on.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditing({})}>
          Add a life stage
        </Button>
      </div>
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-border">
            <tr className="text-left text-muted">
              <th className="px-3 py-2 font-medium">Name</th>
              <th className="px-3 py-2 font-medium">Ages</th>
              <th className="px-3 py-2 font-medium">Journeys assigned</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {stages.map((s) => (
              <tr key={s.id} className="border-b border-border last:border-0">
                <td className="px-3 py-2">
                  <p className="text-ink font-medium">{s.name}</p>
                  {s.description ? <p className="text-xs text-muted">{s.description}</p> : null}
                </td>
                <td className="px-3 py-2 text-muted whitespace-nowrap">{stageAgeLabel(s)}</td>
                <td className="px-3 py-2 text-muted">{s.template_count}</td>
                <td className="px-3 py-2">
                  {s.retired ? <span className="badge bg-surface-2 text-muted text-xs">Retired</span> : <span className="badge bg-primary-50 text-primary text-xs">Active</span>}
                </td>
                <td className="px-3 py-2 whitespace-nowrap">
                  <Button size="xs" variant="ghost" className="mr-1" aria-label="Edit stage" title="Edit" onClick={() => setEditing(s)}>
                    <PencilIcon />
                  </Button>
                  {s.template_count === 0 ? (
                    <Button size="xs" variant="ghost-danger" aria-label="Delete stage" title="Delete" onClick={() => deleteMutation.mutate(s.id)}>
                      <TrashIcon />
                    </Button>
                  ) : (
                    <Button
                      size="xs"
                      variant="ghost"
                      onClick={() => saveMutation.mutate({ ...s, retired: !s.retired })}
                    >
                      {s.retired ? 'Reactivate' : 'Retire'}
                    </Button>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      <Modal open={editing !== null} onClose={() => setEditing(null)} title={editing?.id ? 'Edit life stage' : 'Add a life stage'}>
        {editing ? (
          <div className="space-y-3">
            <Input label="Name" value={editing.name ?? ''} onChange={(e) => setEditing({ ...editing, name: e.target.value })} />
            <Textarea
              label="Description"
              rows={2}
              value={editing.description ?? ''}
              onChange={(e) => setEditing({ ...editing, description: e.target.value })}
            />
            <div className="grid grid-cols-2 gap-2">
              <Input
                label="Youngest age in years"
                type="number"
                value={editing.min_age_years ?? ''}
                onChange={(e) => setEditing({ ...editing, min_age_years: e.target.value === '' ? null : Number(e.target.value) })}
              />
              <Input
                label="Oldest age in years"
                type="number"
                value={editing.max_age_years ?? ''}
                onChange={(e) => setEditing({ ...editing, max_age_years: e.target.value === '' ? null : Number(e.target.value) })}
              />
            </div>
            <p className="text-xs text-muted">
              Leave an age blank for no limit on that side. Overlapping stages are fine; a person in two stages sees
              both sets of suggestions.
            </p>
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                checked={editing.applies_before_birth ?? false}
                onChange={(e) => setEditing({ ...editing, applies_before_birth: e.target.checked })}
              />
              Applies before birth, matched by due date
            </label>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={() => setEditing(null)}>
                Cancel
              </Button>
              <Button loading={saveMutation.isPending} disabled={!editing.name?.trim()} onClick={() => saveMutation.mutate(editing)}>
                Save
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </section>
  );
}

// ------------------------------------------------------------- templates

const byName = (a: JourneyTemplateSummary, b: JourneyTemplateSummary) => a.name.localeCompare(b.name);

const TEMPLATE_SORTS: DataSort<JourneyTemplateSummary>[] = [
  { key: 'name', label: 'By name (A–Z)', compare: byName },
  { key: 'kind', label: 'By kind', compare: (a, b) => a.kind.localeCompare(b.kind) || byName(a, b) },
  { key: 'phases', label: 'By number of phases', compare: (a, b) => b.phase_count - a.phase_count || byName(a, b) },
];

function TemplateLibrary() {
  const queryClient = useQueryClient();
  const isSuperAdmin = useAuthStore((s) => s.account?.role) === 'super_admin';
  const [editorId, setEditorId] = useState<string | 'new' | null>(null);
  const [error, setError] = useState('');

  const { data: stagesData } = useQuery({
    queryKey: ['life-stages'],
    queryFn: () => api.get<{ stages: LifeStage[] }>(`/life-stages`),
  });
  const stages = stagesData?.stages ?? [];
  const stageName = (id: string) => stages.find((s) => s.id === id)?.name ?? '';

  const { data } = useQuery({
    queryKey: ['journey-templates', 'all'],
    queryFn: () => api.get<{ templates: JourneyTemplateSummary[] }>(`/journey-templates?all=1`),
  });
  const templates = data?.templates ?? [];
  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['journey-templates'] });
    void queryClient.invalidateQueries({ queryKey: ['life-stages'] });
  };

  const kindFilter: DataFilter<JourneyTemplateSummary> = {
    key: 'kind',
    label: 'Kind',
    options: JOURNEY_KINDS.map((k) => ({ value: k.value, label: k.label })),
    match: (t, v) => t.kind === v,
  };
  const statusFilter: DataFilter<JourneyTemplateSummary> = {
    key: 'status',
    label: 'Status',
    options: [
      { value: 'published', label: 'Published' },
      { value: 'draft', label: 'Draft' },
      { value: 'archived', label: 'Archived' },
    ],
    match: (t, v) => t.status === v,
  };
  const lifeStageFilter: DataFilter<JourneyTemplateSummary> = {
    key: 'life_stage',
    label: 'Life stage',
    options: stages.map((s) => ({ value: s.id, label: s.name })),
    match: (t, v) => t.life_stage_ids.includes(v),
  };

  const dv = useDataView<JourneyTemplateSummary>({
    rows: templates,
    getId: (t) => t.id,
    searchText: (t) => [t.name, t.description, journeyKindLabel(t.kind)].filter(Boolean).join(' '),
    sorts: TEMPLATE_SORTS,
    filters: [kindFilter, statusFilter, lifeStageFilter],
  });

  const cloneMutation = useMutation({
    mutationFn: (id: string) => api.post<{ template: JourneyTemplateFull }>(`/journey-templates/${id}/clone`),
    onSuccess: (res) => {
      invalidate();
      setEditorId(res.template.id);
    },
  });

  const statusMutation = useMutation({
    mutationFn: ({ id, status }: { id: string; status: string }) => api.patch(`/journey-templates/${id}`, { status }),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not update the journey.'),
  });

  const deleteMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/journey-templates/${id}`),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not delete the journey.'),
  });

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between flex-wrap gap-2">
        <div>
          <h2 className="text-base font-semibold text-ink">Journey library</h2>
          <p className="text-sm text-muted">
            The journeys people can be enrolled in. Build new ones from scratch, clone and adapt, or cherry-pick
            phases from across the library. People's journeys are copies; library edits change no one's record.
          </p>
        </div>
        <Button size="sm" onClick={() => setEditorId('new')}>
          New journey
        </Button>
      </div>
      <DataToolbar
        search={dv.search}
        onSearch={dv.setSearch}
        searchPlaceholder="Search journeys…"
        sorts={TEMPLATE_SORTS.map((s) => ({ key: s.key, label: s.label }))}
        sortKey={dv.sortKey}
        onSort={dv.setSortKey}
        filters={[kindFilter, statusFilter, lifeStageFilter].map((f) => ({ key: f.key, label: f.label, options: f.options }))}
        filterValues={dv.filterValues}
        onFilter={dv.setFilter}
        page={dv.page}
        totalPages={dv.totalPages}
        pageSize={dv.pageSize}
        totalFiltered={dv.totalFiltered}
        onPageChange={dv.setPage}
        onPageSizeChange={dv.setPageSize}
      />
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
      <div className="card overflow-x-auto p-0">
        <table className="w-full text-sm">
          <thead className="border-b border-border">
            <tr className="text-left text-muted">
              <th className="px-3 py-2 font-medium">Journey</th>
              <th className="px-3 py-2 font-medium">Kind</th>
              <th className="px-3 py-2 font-medium">Life stages</th>
              <th className="px-3 py-2 font-medium">Phases</th>
              <th className="px-3 py-2 font-medium">Status</th>
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {dv.view.map((t) => {
              const canEdit = !t.is_system || isSuperAdmin;
              return (
                <tr key={t.id} className="border-b border-border last:border-0">
                  <td className="px-3 py-2">
                    <p className="text-ink font-medium">
                      {t.name}
                      {t.is_system ? <span className="ml-2 badge bg-surface-2 text-muted text-xs">Built in</span> : null}
                    </p>
                    <p className="text-xs text-muted line-clamp-1">{t.description}</p>
                  </td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">{journeyKindLabel(t.kind)}</td>
                  <td className="px-3 py-2 text-muted text-xs">{t.life_stage_ids.map(stageName).filter(Boolean).join(', ')}</td>
                  <td className="px-3 py-2 text-muted whitespace-nowrap">
                    {t.phase_count} · {t.task_count} items
                  </td>
                  <td className="px-3 py-2">
                    <span
                      className={`badge text-xs ${
                        t.status === 'published'
                          ? 'bg-primary-50 text-primary'
                          : t.status === 'draft'
                            ? 'bg-amber-50 text-amber-700'
                            : 'bg-surface-2 text-muted'
                      }`}
                    >
                      {t.status === 'published' ? 'Published' : t.status === 'draft' ? 'Draft' : 'Archived'}
                    </span>
                  </td>
                  <td className="px-3 py-2 whitespace-nowrap space-x-1">
                    <Button size="xs" variant="ghost" onClick={() => setEditorId(t.id)}>
                      {canEdit ? 'Edit' : 'View'}
                    </Button>
                    <Button size="xs" variant="ghost" onClick={() => cloneMutation.mutate(t.id)}>
                      Clone
                    </Button>
                    {canEdit ? (
                      t.status === 'published' ? (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => statusMutation.mutate({ id: t.id, status: 'archived' })}
                        >
                          Archive
                        </Button>
                      ) : (
                        <Button
                          size="xs"
                          variant="ghost"
                          onClick={() => statusMutation.mutate({ id: t.id, status: 'published' })}
                        >
                          Publish
                        </Button>
                      )
                    ) : null}
                    {canEdit && t.status === 'draft' && !t.is_system ? (
                      <Button size="xs" variant="ghost-danger" aria-label="Delete template" title="Delete" onClick={() => deleteMutation.mutate(t.id)}>
                        <TrashIcon />
                      </Button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {editorId ? (
        <TemplateEditor
          templateId={editorId === 'new' ? null : editorId}
          stages={stages}
          library={templates}
          onClose={() => {
            setEditorId(null);
            invalidate();
          }}
        />
      ) : null}
    </section>
  );
}

interface DraftTemplate {
  name: string;
  description: string;
  kind: string;
  status: string;
  life_stage_ids: string[];
  phases: JourneyTemplatePhase[];
}

/**
 * The journey builder: fields, life stage assignment, phases with their
 * checklist seeds, and an import panel that cherry-picks phases from any
 * other template in the library.
 */
function TemplateEditor({
  templateId,
  stages,
  library,
  onClose,
}: {
  templateId: string | null;
  stages: LifeStage[];
  library: JourneyTemplateSummary[];
  onClose: () => void;
}) {
  const isSuperAdmin = useAuthStore((s) => s.account?.role) === 'super_admin';
  const [draft, setDraft] = useState<DraftTemplate | null>(templateId ? null : emptyDraft());
  const [importFrom, setImportFrom] = useState('');
  const [error, setError] = useState('');

  const { data: fullData } = useQuery({
    queryKey: ['journey-template', templateId],
    queryFn: () => api.get<{ template: JourneyTemplateFull }>(`/journey-templates/${templateId}`),
    enabled: !!templateId,
  });
  const loaded = fullData?.template;
  const readOnly = !!loaded?.is_system && !isSuperAdmin;

  // Populate the draft once the template arrives.
  const current = useMemo<DraftTemplate | null>(() => {
    if (draft) return draft;
    if (!loaded) return null;
    return {
      name: loaded.name,
      description: loaded.description ?? '',
      kind: loaded.kind,
      status: loaded.status,
      life_stage_ids: loaded.life_stage_ids,
      phases: loaded.phases.map((p) => ({
        name: p.name,
        description: p.description,
        tasks: p.tasks.map((task) => ({ title: task.title, description: task.description, is_milestone: task.is_milestone })),
      })),
    };
  }, [draft, loaded]);

  const { data: importData } = useQuery({
    queryKey: ['journey-template', importFrom],
    queryFn: () => api.get<{ template: JourneyTemplateFull }>(`/journey-templates/${importFrom}`),
    enabled: !!importFrom,
  });

  const saveMutation = useMutation({
    mutationFn: (d: DraftTemplate) => {
      const body = {
        name: d.name.trim(),
        description: d.description.trim() || null,
        kind: d.kind,
        status: d.status,
        life_stage_ids: d.life_stage_ids,
        phases: d.phases.map((p) => ({
          name: p.name,
          description: p.description || null,
          tasks: p.tasks.map((task) => ({
            title: task.title,
            description: task.description || null,
            is_milestone: task.is_milestone,
          })),
        })),
      };
      return templateId ? api.patch(`/journey-templates/${templateId}`, body) : api.post(`/journey-templates`, body);
    },
    onSuccess: onClose,
    onError: (err) => setError(err instanceof ApiError ? err.message : 'Could not save the journey.'),
  });

  if (!current) {
    return (
      <Modal open onClose={onClose} title="Journey">
        <p className="text-sm text-muted">Loading…</p>
      </Modal>
    );
  }

  const set = (patch: Partial<DraftTemplate>) => setDraft({ ...current, ...patch });
  const setPhase = (i: number, patch: Partial<JourneyTemplatePhase>) =>
    set({ phases: current.phases.map((p, j) => (j === i ? { ...p, ...patch } : p)) });
  const movePhase = (i: number, dir: -1 | 1) => {
    const phases = [...current.phases];
    const j = i + dir;
    if (j < 0 || j >= phases.length) return;
    [phases[i], phases[j]] = [phases[j], phases[i]];
    set({ phases });
  };

  const valid = current.name.trim().length > 0 && current.phases.length > 0 && current.phases.every((p) => p.name.trim());

  return (
    <Modal open onClose={onClose} title={templateId ? (readOnly ? 'View journey' : 'Edit journey') : 'New journey'} wide>
      <div className="space-y-4 max-h-[70vh] overflow-y-auto pr-1">
        {readOnly ? (
          <p className="text-sm text-muted rounded-md bg-surface-2 p-2">
            Built-in journeys can only be changed by a super admin. Clone it to make your own version.
          </p>
        ) : null}
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Name" value={current.name} onChange={(e) => set({ name: e.target.value })} disabled={readOnly} />
          <div>
            <label htmlFor="tpl-kind" className="block text-sm font-medium text-ink mb-1">
              Kind
            </label>
            <select
              id="tpl-kind"
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              value={current.kind}
              onChange={(e) => set({ kind: e.target.value })}
              disabled={readOnly}
            >
              {JOURNEY_KINDS.map((k) => (
                <option key={k.value} value={k.value}>
                  {k.label}
                </option>
              ))}
            </select>
          </div>
        </div>
        <Textarea
          label="Description"
          rows={2}
          value={current.description}
          onChange={(e) => set({ description: e.target.value })}
          disabled={readOnly}
        />

        <div>
          <p className="text-sm font-medium text-ink mb-1">Suggested for these life stages</p>
          <div className="flex flex-wrap gap-2">
            {stages.map((s) => {
              const on = current.life_stage_ids.includes(s.id);
              return (
                <button
                  key={s.id}
                  type="button"
                  disabled={readOnly}
                  className={`rounded-full px-3 py-1 text-xs transition-colors ${
                    on ? 'bg-primary text-white' : 'bg-surface-2 text-muted hover:text-ink'
                  }`}
                  onClick={() =>
                    set({
                      life_stage_ids: on
                        ? current.life_stage_ids.filter((id) => id !== s.id)
                        : [...current.life_stage_ids, s.id],
                    })
                  }
                >
                  {s.name}
                </button>
              );
            })}
          </div>
          <p className="text-xs text-muted mt-1">
            Stages only order the suggestions. A journey with no stage still appears in the full library.
          </p>
        </div>

        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <p className="text-sm font-medium text-ink">Phases</p>
            {!readOnly ? (
              <div className="flex items-center gap-2">
                <select
                  aria-label="Cherry-pick phases from another journey"
                  className="rounded-md border border-border bg-card px-2 py-1.5 text-xs shadow-sm focus:border-primary focus:outline-none"
                  value={importFrom}
                  onChange={(e) => setImportFrom(e.target.value)}
                >
                  <option value="">Cherry-pick phases from…</option>
                  {library
                    .filter((t) => t.id !== templateId)
                    .map((t) => (
                      <option key={t.id} value={t.id}>
                        {t.name}
                      </option>
                    ))}
                </select>
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => set({ phases: [...current.phases, { name: '', description: null, tasks: [] }] })}
                >
                  Add phase
                </Button>
              </div>
            ) : null}
          </div>

          {importFrom && importData?.template ? (
            <div className="rounded-md border border-border bg-surface p-2.5">
              <p className="text-xs text-muted mb-1.5">
                Click a phase from <span className="font-medium text-ink">{importData.template.name}</span> to add a
                copy of it, with its checklist items, to this journey.
              </p>
              <div className="flex flex-wrap gap-1.5">
                {importData.template.phases.map((p, i) => (
                  <button
                    key={p.id ?? i}
                    type="button"
                    className="rounded-full bg-card border border-border px-2.5 py-1 text-xs text-ink hover:border-primary"
                    onClick={() =>
                      set({
                        phases: [
                          ...current.phases,
                          {
                            name: p.name,
                            description: p.description,
                            tasks: p.tasks.map((task) => ({
                              title: task.title,
                              description: task.description,
                              is_milestone: task.is_milestone,
                            })),
                          },
                        ],
                      })
                    }
                  >
                    + {p.name} · {p.tasks.length} items
                  </button>
                ))}
              </div>
            </div>
          ) : null}

          {current.phases.map((phase, i) => (
            <PhaseEditor
              key={i}
              index={i}
              phase={phase}
              readOnly={readOnly}
              onChange={(patch) => setPhase(i, patch)}
              onMove={(dir) => movePhase(i, dir)}
              onRemove={() => set({ phases: current.phases.filter((_, j) => j !== i) })}
              isFirst={i === 0}
              isLast={i === current.phases.length - 1}
            />
          ))}
        </div>

        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex items-center justify-between gap-2 pt-2 border-t border-border">
          <label className="flex items-center gap-2 text-sm text-ink">
            <input
              type="checkbox"
              className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
              checked={current.status === 'published'}
              disabled={readOnly}
              onChange={(e) => set({ status: e.target.checked ? 'published' : 'draft' })}
            />
            Published and available to enrol
          </label>
          <div className="flex gap-2">
            <Button variant="ghost" onClick={onClose}>
              {readOnly ? 'Close' : 'Cancel'}
            </Button>
            {!readOnly ? (
              <Button loading={saveMutation.isPending} disabled={!valid} onClick={() => saveMutation.mutate(current)}>
                Save journey
              </Button>
            ) : null}
          </div>
        </div>
      </div>
    </Modal>
  );
}

function PhaseEditor({
  index,
  phase,
  readOnly,
  onChange,
  onMove,
  onRemove,
  isFirst,
  isLast,
}: {
  index: number;
  phase: JourneyTemplatePhase;
  readOnly: boolean;
  onChange: (patch: Partial<JourneyTemplatePhase>) => void;
  onMove: (dir: -1 | 1) => void;
  onRemove: () => void;
  isFirst: boolean;
  isLast: boolean;
}) {
  const [open, setOpen] = useState(false);
  const setTask = (i: number, patch: Partial<JourneyTemplatePhase['tasks'][number]>) =>
    onChange({ tasks: phase.tasks.map((t, j) => (j === i ? { ...t, ...patch } : t)) });

  return (
    <div className="rounded-md border border-border bg-card p-3">
      <div className="flex items-start gap-2">
        <span className="mt-2 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-surface-2 text-xs text-muted">
          {index + 1}
        </span>
        <div className="flex-1 space-y-2">
          <Input
            aria-label={`Phase ${index + 1} name`}
            placeholder="Phase name"
            value={phase.name}
            onChange={(e) => onChange({ name: e.target.value })}
            disabled={readOnly}
          />
          <Button size="xs" variant="ghost" onClick={() => setOpen((v) => !v)}>
            {open ? 'Hide checklist items' : `Show ${phase.tasks.length} checklist ${phase.tasks.length === 1 ? 'item' : 'items'}`}
          </Button>
          {open ? (
            <div className="space-y-2">
              {phase.tasks.map((task, i) => (
                <div key={i} className="flex items-start gap-2">
                  <div className="flex-1 space-y-1">
                    <Input
                      aria-label="Item title"
                      placeholder="Item title"
                      value={task.title}
                      onChange={(e) => setTask(i, { title: e.target.value })}
                      disabled={readOnly}
                    />
                    <Input
                      aria-label="Item description"
                      placeholder="Plain-language description"
                      value={task.description ?? ''}
                      onChange={(e) => setTask(i, { description: e.target.value })}
                      disabled={readOnly}
                    />
                  </div>
                  {!readOnly ? (
                    <div className="flex flex-col items-center gap-1 pt-1">
                      <button
                        type="button"
                        title="A milestone is celebrated in the Memory Book timeline"
                        className={`text-sm ${task.is_milestone ? '' : 'grayscale opacity-40'}`}
                        onClick={() => setTask(i, { is_milestone: !task.is_milestone })}
                      >
                        ⭐
                      </button>
                      <button
                        type="button"
                        aria-label="Remove item"
                        className="text-muted hover:text-red-600 text-xs"
                        onClick={() => onChange({ tasks: phase.tasks.filter((_, j) => j !== i) })}
                      >
                        ✕
                      </button>
                    </div>
                  ) : task.is_milestone ? (
                    <span className="pt-2 text-sm">⭐</span>
                  ) : null}
                </div>
              ))}
              {!readOnly ? (
                <Button
                  size="sm"
                  variant="secondary"
                  onClick={() => onChange({ tasks: [...phase.tasks, { title: '', description: null, is_milestone: false }] })}
                >
                  Add item
                </Button>
              ) : null}
            </div>
          ) : null}
        </div>
        {!readOnly ? (
          <div className="flex flex-col gap-1 text-xs text-muted">
            <button type="button" aria-label="Move phase up" disabled={isFirst} className="hover:text-ink disabled:opacity-30" onClick={() => onMove(-1)}>
              ↑
            </button>
            <button type="button" aria-label="Move phase down" disabled={isLast} className="hover:text-ink disabled:opacity-30" onClick={() => onMove(1)}>
              ↓
            </button>
            <button type="button" aria-label="Remove phase" className="hover:text-red-600" onClick={onRemove}>
              ✕
            </button>
          </div>
        ) : null}
      </div>
    </div>
  );
}

function emptyDraft(): DraftTemplate {
  return {
    name: '',
    description: '',
    kind: 'condition',
    status: 'draft',
    life_stage_ids: [],
    phases: [{ name: '', description: null, tasks: [] }],
  };
}
