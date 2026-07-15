import { useCallback, useEffect, useMemo, useState } from 'react';
import { useQuery, useMutation } from '@tanstack/react-query';
import { api } from '../../api/client';
import { useAuthStore } from '../../stores/auth';
import { Button } from '../../components/ui/Button';

// ── Types ──────────────────────────────────────────────────────────────

interface ReportField {
  key: string;
  label: string;
  type: string;
  enumValues?: string[];
}

interface ReportFilter {
  key: string;
  label: string;
  type: string;
  options?: { value: string; label: string }[];
}

interface SectionMeta {
  key: string;
  label: string;
  description: string;
  category: string;
  fields: ReportField[];
  filters: ReportFilter[];
  supportsDateRange: boolean;
}

interface SectionConfig {
  key: string;
  fields: string[];
  filters: Record<string, unknown>;
}

interface ProfileOption {
  id: string;
  full_name: string;
  preferred_name: string | null;
  kind: string;
  current_phase: string;
}

interface ReportSectionResult {
  key: string;
  label: string;
  rows: Record<string, unknown>[];
  fields: ReportField[];
}

interface ReportResult {
  generatedAt: string;
  profileCount: number;
  sections: ReportSectionResult[];
  aiNarrative?: string;
}

interface PresetConfig {
  sections: SectionConfig[];
  dateRangePreset: string | null;
  includeAiNarrative: boolean;
  aiPrompt: string | null;
}

interface Preset {
  id: string;
  name: string;
  description: string | null;
  is_system: boolean;
  config: PresetConfig;
}

type DatePreset = '7d' | '30d' | '90d' | '180d' | '1y' | 'custom' | 'all';

function dateRangeFromPreset(preset: DatePreset, customFrom: string, customTo: string): { from: string; to: string } | null {
  if (preset === 'all') return null;
  const to = new Date();
  if (preset === 'custom' && customFrom && customTo) return { from: customFrom, to: customTo };
  const days: Record<string, number> = { '7d': 7, '30d': 30, '90d': 90, '180d': 180, '1y': 365 };
  const d = days[preset] ?? 30;
  const from = new Date(to.getTime() - d * 24 * 3600 * 1000);
  return { from: from.toISOString().slice(0, 10), to: to.toISOString().slice(0, 10) };
}

const PHASE_LABELS: Record<string, string> = {
  early_concern: 'Early concern',
  home_with_support: 'Home with support',
  increased_dependency: 'Increased dependency',
  transition_to_residential: 'Transition to residential',
  residential_ongoing: 'Residential ongoing',
  end_of_life: 'End of life',
};

const CATEGORY_LABELS: Record<string, string> = {
  demographics: 'Profile',
  health: 'Health',
  medications: 'Medications and treatments',
  care: 'Care management',
  admin: 'Administration',
};

const SELECT_CLS = 'rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

// ── Main component ─────────────────────────────────────────────────────

export function ReportGeneratorPage() {
  // Data fetching
  const { data: registryData } = useQuery({
    queryKey: ['report-registry'],
    queryFn: () => api.get<{ sections: SectionMeta[] }>('/reports/registry'),
  });
  const allSections = registryData?.sections ?? [];

  const { data: profilesData } = useQuery({
    queryKey: ['report-profiles'],
    queryFn: () => api.get<{ profiles: ProfileOption[] }>('/reports/profiles'),
  });
  const allProfiles = profilesData?.profiles ?? [];

  const { data: presetsData, refetch: refetchPresets } = useQuery({
    queryKey: ['report-presets'],
    queryFn: () => api.get<{ presets: Preset[] }>('/reports/presets'),
  });
  const presets = presetsData?.presets ?? [];

  // Report builder state
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [selectedSections, setSelectedSections] = useState<Map<string, SectionConfig>>(new Map());
  const [datePreset, setDatePreset] = useState<DatePreset>('30d');
  const [customFrom, setCustomFrom] = useState('');
  const [customTo, setCustomTo] = useState('');
  const [includeAi, setIncludeAi] = useState(false);
  const [aiPrompt, setAiPrompt] = useState('');
  const [result, setResult] = useState<ReportResult | null>(null);
  const [activePresetId, setActivePresetId] = useState<string | null>(null);
  const [showPresetSave, setShowPresetSave] = useState(false);
  const [presetName, setPresetName] = useState('');
  const [presetDesc, setPresetDesc] = useState('');
  const [step, setStep] = useState<'configure' | 'results'>('configure');

  const sectionsByCategory = useMemo(() => {
    const map = new Map<string, SectionMeta[]>();
    for (const s of allSections) {
      const arr = map.get(s.category) ?? [];
      arr.push(s);
      map.set(s.category, arr);
    }
    return map;
  }, [allSections]);

  // Toggle section
  const toggleSection = useCallback((key: string) => {
    setSelectedSections((prev) => {
      const next = new Map(prev);
      if (next.has(key)) {
        next.delete(key);
      } else {
        next.set(key, { key, fields: [], filters: {} });
      }
      return next;
    });
  }, []);

  const updateSectionFilter = useCallback((sectionKey: string, filterKey: string, value: unknown) => {
    setSelectedSections((prev) => {
      const next = new Map(prev);
      const cfg = next.get(sectionKey);
      if (!cfg) return prev;
      next.set(sectionKey, { ...cfg, filters: { ...cfg.filters, [filterKey]: value } });
      return next;
    });
  }, []);

  const toggleSectionField = useCallback((sectionKey: string, fieldKey: string) => {
    setSelectedSections((prev) => {
      const next = new Map(prev);
      const cfg = next.get(sectionKey);
      if (!cfg) return prev;
      const fields = cfg.fields.includes(fieldKey)
        ? cfg.fields.filter((f) => f !== fieldKey)
        : [...cfg.fields, fieldKey];
      next.set(sectionKey, { ...cfg, fields });
      return next;
    });
  }, []);

  // Load preset
  const loadPreset = useCallback((preset: Preset) => {
    setActivePresetId(preset.id);
    const cfg = preset.config;
    const sectionMap = new Map<string, SectionConfig>();
    for (const s of cfg.sections) {
      sectionMap.set(s.key, s);
    }
    setSelectedSections(sectionMap);
    setDatePreset((cfg.dateRangePreset as DatePreset) ?? 'all');
    setIncludeAi(cfg.includeAiNarrative);
    setAiPrompt(cfg.aiPrompt ?? '');
    setStep('configure');
    setResult(null);
  }, []);

  // Generate report
  const generateMutation = useMutation({
    mutationFn: async () => {
      const dateRange = dateRangeFromPreset(datePreset, customFrom, customTo);
      const sections = Array.from(selectedSections.values());
      return api.post<ReportResult>('/reports/generate', {
        profileIds: selectedProfileIds,
        sections,
        dateRange,
        includeAiNarrative: includeAi,
        aiPrompt: aiPrompt || undefined,
      });
    },
    onSuccess: (data) => {
      setResult(data);
      setStep('results');
    },
  });

  // Export CSV
  const exportCsvMutation = useMutation({
    mutationFn: async () => {
      const dateRange = dateRangeFromPreset(datePreset, customFrom, customTo);
      const sections = Array.from(selectedSections.values());
      const token = useAuthStore.getState().token;
      const res = await fetch('/api/v1/reports/export/csv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ profileIds: selectedProfileIds, sections, dateRange }),
      });
      if (!res.ok) throw new Error('Export failed');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `parecare-report-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      URL.revokeObjectURL(url);
    },
  });

  // Save preset
  const savePresetMutation = useMutation({
    mutationFn: async () => {
      const config: PresetConfig = {
        sections: Array.from(selectedSections.values()),
        dateRangePreset: datePreset === 'all' ? null : datePreset,
        includeAiNarrative: includeAi,
        aiPrompt: aiPrompt || null,
      };
      return api.post('/reports/presets', { name: presetName, description: presetDesc || null, config });
    },
    onSuccess: () => {
      setShowPresetSave(false);
      setPresetName('');
      setPresetDesc('');
      refetchPresets();
    },
  });

  // Delete preset
  const deletePresetMutation = useMutation({
    mutationFn: async (id: string) => api.delete(`/reports/presets/${id}`),
    onSuccess: () => refetchPresets(),
  });

  // Select all profiles by default when loaded
  useEffect(() => {
    if (allProfiles.length > 0 && selectedProfileIds.length === 0) {
      setSelectedProfileIds(allProfiles.map((p) => p.id));
    }
  }, [allProfiles, selectedProfileIds.length]);

  const canGenerate = selectedSections.size > 0 && selectedProfileIds.length > 0;

  // ── Configure step ────────────────────────────────────────────────────

  if (step === 'results' && result) {
    return (
      <div className="space-y-6 max-w-5xl">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-base font-semibold text-ink">Report results</h2>
            <p className="text-sm text-muted">
              Generated {new Date(result.generatedAt).toLocaleString()} for {result.profileCount} {result.profileCount === 1 ? 'profile' : 'profiles'}
            </p>
          </div>
          <div className="flex items-center gap-2">
            <Button variant="secondary" size="sm" onClick={() => window.print()}>Print</Button>
            <Button variant="secondary" size="sm" onClick={() => exportCsvMutation.mutate()} loading={exportCsvMutation.isPending}>Export CSV</Button>
            <Button variant="secondary" size="sm" onClick={() => { setStep('configure'); setResult(null); }}>Back to builder</Button>
          </div>
        </div>

        {result.aiNarrative ? (
          <div className="card">
            <h3 className="text-sm font-semibold text-ink mb-3">AI narrative summary</h3>
            <div className="prose prose-sm max-w-none text-ink whitespace-pre-wrap">{result.aiNarrative}</div>
          </div>
        ) : null}

        {result.sections.map((section) => (
          <div key={section.key} className="card">
            <h3 className="text-sm font-semibold text-ink mb-1">{section.label}</h3>
            <p className="text-xs text-muted mb-3">{section.rows.length} {section.rows.length === 1 ? 'record' : 'records'}</p>
            {section.rows.length === 0 ? (
              <p className="text-sm text-muted">No data for this section.</p>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="text-left text-xs text-muted border-b border-border">
                      <th className="px-3 py-2 font-medium">Profile</th>
                      {section.fields.map((f) => (
                        <th key={f.key} className="px-3 py-2 font-medium">{f.label}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {section.rows.map((row, i) => (
                      <tr key={i} className="border-b border-border last:border-0">
                        <td className="px-3 py-2 font-medium">{String(row['_profile_name'] ?? '')}</td>
                        {section.fields.map((f) => (
                          <td key={f.key} className="px-3 py-2">
                            <CellValue value={row[f.key]} type={f.type} />
                          </td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        ))}
      </div>
    );
  }

  return (
    <div className="space-y-6 max-w-5xl">
      <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-ink">Report generator</h2>
          <p className="text-sm text-muted">Build custom reports from any data in the system</p>
        </div>
      </div>

      {/* Presets */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-ink">Templates and saved presets</h3>
          {selectedSections.size > 0 ? (
            <button
              type="button"
              className="text-xs text-primary hover:underline"
              onClick={() => setShowPresetSave(true)}
            >
              Save current as preset
            </button>
          ) : null}
        </div>

        {showPresetSave ? (
          <div className="mb-4 p-3 bg-surface-2 rounded-lg space-y-2">
            <input
              type="text"
              placeholder="Preset name"
              className={SELECT_CLS + ' w-full'}
              value={presetName}
              onChange={(e) => setPresetName(e.target.value)}
            />
            <input
              type="text"
              placeholder="Description (optional)"
              className={SELECT_CLS + ' w-full'}
              value={presetDesc}
              onChange={(e) => setPresetDesc(e.target.value)}
            />
            <div className="flex gap-2">
              <Button size="sm" onClick={() => savePresetMutation.mutate()} loading={savePresetMutation.isPending} disabled={!presetName.trim()}>
                Save
              </Button>
              <Button variant="secondary" size="sm" onClick={() => setShowPresetSave(false)}>Cancel</Button>
            </div>
          </div>
        ) : null}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {presets.map((preset) => (
            <button
              key={preset.id}
              type="button"
              className={`text-left p-3 rounded-lg border transition-colors ${
                activePresetId === preset.id
                  ? 'border-primary bg-primary-50'
                  : 'border-border bg-card hover:border-primary/50'
              }`}
              onClick={() => loadPreset(preset)}
            >
              <div className="flex items-start justify-between">
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium text-ink truncate">{preset.name}</div>
                  {preset.description ? <div className="text-xs text-muted mt-0.5 line-clamp-2">{preset.description}</div> : null}
                </div>
                <div className="flex items-center gap-1 ml-2 shrink-0">
                  {preset.is_system ? (
                    <span className="badge bg-surface-2 text-muted text-[10px]">Built-in</span>
                  ) : null}
                  {!preset.is_system ? (
                    <button
                      type="button"
                      className="text-muted hover:text-red-500 text-xs p-1"
                      onClick={(e) => { e.stopPropagation(); deletePresetMutation.mutate(preset.id); }}
                      title="Delete preset"
                    >
                      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6L6 18M6 6l12 12" /></svg>
                    </button>
                  ) : null}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Profile selector */}
      <div className="card">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-sm font-semibold text-ink">Profiles to include</h3>
          <div className="flex gap-2 text-xs">
            <button type="button" className="text-primary hover:underline" onClick={() => setSelectedProfileIds(allProfiles.map((p) => p.id))}>
              Select all
            </button>
            <button type="button" className="text-primary hover:underline" onClick={() => setSelectedProfileIds([])}>
              Clear
            </button>
          </div>
        </div>
        <div className="flex flex-wrap gap-2">
          {allProfiles.map((p) => {
            const selected = selectedProfileIds.includes(p.id);
            return (
              <button
                key={p.id}
                type="button"
                className={`px-3 py-1.5 rounded-full text-sm border transition-colors ${
                  selected
                    ? 'border-primary bg-primary-50 text-primary font-medium'
                    : 'border-border text-muted hover:text-ink hover:border-primary/50'
                }`}
                onClick={() => {
                  setSelectedProfileIds((prev) =>
                    selected ? prev.filter((id) => id !== p.id) : [...prev, p.id]
                  );
                }}
              >
                {p.preferred_name || p.full_name}
                {p.kind === 'pet' ? ' (pet)' : ''}
              </button>
            );
          })}
          {allProfiles.length === 0 ? <p className="text-sm text-muted">No profiles available.</p> : null}
        </div>
      </div>

      {/* Section selector */}
      <div className="card">
        <h3 className="text-sm font-semibold text-ink mb-3">Data sections</h3>
        <div className="space-y-4">
          {Array.from(sectionsByCategory.entries()).map(([category, sections]) => (
            <div key={category}>
              <div className="text-xs font-medium uppercase tracking-wide text-muted mb-2">
                {CATEGORY_LABELS[category] ?? category}
              </div>
              <div className="space-y-2">
                {sections.map((section) => {
                  const isSelected = selectedSections.has(section.key);
                  const cfg = selectedSections.get(section.key);
                  return (
                    <div key={section.key} className={`rounded-lg border transition-colors ${isSelected ? 'border-primary bg-primary-50/50' : 'border-border'}`}>
                      <button
                        type="button"
                        className="w-full flex items-center gap-3 px-4 py-3 text-left"
                        onClick={() => toggleSection(section.key)}
                      >
                        <div className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                          isSelected ? 'border-primary bg-primary' : 'border-border'
                        }`}>
                          {isSelected ? (
                            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
                          ) : null}
                        </div>
                        <div className="flex-1 min-w-0">
                          <div className="text-sm font-medium text-ink">{section.label}</div>
                          <div className="text-xs text-muted">{section.description}</div>
                        </div>
                      </button>

                      {isSelected && cfg ? (
                        <div className="px-4 pb-4 space-y-3" onClick={(e) => e.stopPropagation()}>
                          {/* Field picker */}
                          <div>
                            <div className="text-xs font-medium text-muted mb-1">
                              Fields {cfg.fields.length === 0 ? '(all included)' : `(${cfg.fields.length} selected)`}
                            </div>
                            <div className="flex flex-wrap gap-1.5">
                              {section.fields.map((f) => {
                                const on = cfg.fields.length === 0 || cfg.fields.includes(f.key);
                                return (
                                  <button
                                    key={f.key}
                                    type="button"
                                    className={`px-2 py-1 rounded text-xs transition-colors ${
                                      on
                                        ? 'bg-primary/10 text-primary border border-primary/30'
                                        : 'bg-surface-2 text-muted border border-transparent hover:border-border'
                                    }`}
                                    onClick={() => toggleSectionField(section.key, f.key)}
                                  >
                                    {f.label}
                                  </button>
                                );
                              })}
                            </div>
                          </div>

                          {/* Filters */}
                          {section.filters.length > 0 ? (
                            <div>
                              <div className="text-xs font-medium text-muted mb-1">Filters</div>
                              <div className="flex flex-wrap gap-2">
                                {section.filters.map((filter) => (
                                  <FilterControl
                                    key={filter.key}
                                    filter={filter}
                                    value={cfg.filters[filter.key]}
                                    onChange={(v) => updateSectionFilter(section.key, filter.key, v)}
                                  />
                                ))}
                              </div>
                            </div>
                          ) : null}
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Date range */}
      <div className="card">
        <h3 className="text-sm font-semibold text-ink mb-3">Date range</h3>
        <p className="text-xs text-muted mb-2">Applied to sections that support time-based filtering</p>
        <div className="flex items-center gap-2 flex-wrap">
          {(['7d', '30d', '90d', '180d', '1y', 'all', 'custom'] as const).map((p) => (
            <button
              key={p}
              type="button"
              className={`px-3 py-1.5 rounded-md text-sm transition-colors ${
                datePreset === p ? 'bg-primary text-white font-medium' : 'bg-surface-2 text-muted hover:text-ink'
              }`}
              onClick={() => setDatePreset(p)}
            >
              {p === 'all' ? 'All time' : p === 'custom' ? 'Custom' : p}
            </button>
          ))}
        </div>
        {datePreset === 'custom' ? (
          <div className="flex items-center gap-2 text-sm mt-2">
            <label className="text-muted">From</label>
            <input type="date" className={SELECT_CLS} value={customFrom} onChange={(e) => setCustomFrom(e.target.value)} />
            <label className="text-muted">To</label>
            <input type="date" className={SELECT_CLS} value={customTo} onChange={(e) => setCustomTo(e.target.value)} />
          </div>
        ) : null}
      </div>

      {/* AI narrative */}
      <div className="card">
          <div className="flex items-center gap-3">
            <button
              type="button"
              className={`w-5 h-5 rounded border-2 flex items-center justify-center shrink-0 transition-colors ${
                includeAi ? 'border-primary bg-primary' : 'border-border'
              }`}
              onClick={() => setIncludeAi(!includeAi)}
            >
              {includeAi ? (
                <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="white" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>
              ) : null}
            </button>
            <div>
              <h3 className="text-sm font-semibold text-ink">Include AI narrative summary</h3>
              <p className="text-xs text-muted">PareCare AI will analyse the report data and write a professional summary</p>
            </div>
          </div>
          {includeAi ? (
            <div className="mt-3">
              <label className="text-xs text-muted block mb-1">Custom instructions for the AI (optional)</label>
              <textarea
                className={SELECT_CLS + ' w-full h-20 resize-y'}
                placeholder="e.g. Focus on outbreak patterns, or write this as an NDIS progress update..."
                value={aiPrompt}
                onChange={(e) => setAiPrompt(e.target.value)}
              />
            </div>
          ) : null}
        </div>

      {/* Generate button */}
      <div className="flex items-center gap-3">
        <Button
          onClick={() => generateMutation.mutate()}
          loading={generateMutation.isPending}
          disabled={!canGenerate}
        >
          Generate report
        </Button>
        <Button
          variant="secondary"
          onClick={() => exportCsvMutation.mutate()}
          loading={exportCsvMutation.isPending}
          disabled={!canGenerate}
        >
          Export as CSV
        </Button>
        {generateMutation.isError ? (
          <p className="text-sm text-red-500">
            {(generateMutation.error as Error).message}
          </p>
        ) : null}
        {!canGenerate ? (
          <p className="text-sm text-muted">
            Select at least one profile and one data section
          </p>
        ) : null}
      </div>
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

function FilterControl({
  filter,
  value,
  onChange,
}: {
  filter: ReportFilter;
  value: unknown;
  onChange: (v: unknown) => void;
}) {
  if (filter.type === 'boolean') {
    const checked = value === true;
    return (
      <label className="flex items-center gap-1.5 text-xs cursor-pointer">
        <input
          type="checkbox"
          checked={checked}
          onChange={(e) => onChange(e.target.checked || undefined)}
          className="rounded border-border"
        />
        <span className="text-ink">{filter.label}</span>
      </label>
    );
  }

  if (filter.type === 'select' && filter.options) {
    return (
      <select
        className={SELECT_CLS + ' text-xs'}
        value={String(value ?? '')}
        onChange={(e) => onChange(e.target.value || undefined)}
      >
        <option value="">All {filter.label.toLowerCase()}</option>
        {filter.options.map((o) => (
          <option key={o.value} value={o.value}>{o.label}</option>
        ))}
      </select>
    );
  }

  if (filter.type === 'multi-select' && filter.options) {
    const selected = Array.isArray(value) ? value as string[] : [];
    return (
      <div className="flex flex-wrap gap-1">
        {filter.options.map((o) => {
          const on = selected.includes(o.value);
          return (
            <button
              key={o.value}
              type="button"
              className={`px-2 py-0.5 rounded text-xs transition-colors ${
                on
                  ? 'bg-primary/10 text-primary border border-primary/30'
                  : 'bg-surface-2 text-muted border border-transparent hover:border-border'
              }`}
              onClick={() => {
                const next = on ? selected.filter((v) => v !== o.value) : [...selected, o.value];
                onChange(next.length ? next : undefined);
              }}
            >
              {o.label}
            </button>
          );
        })}
      </div>
    );
  }

  return null;
}

function CellValue({ value, type }: { value: unknown; type: string }) {
  if (value === null || value === undefined || value === '') {
    return <span className="text-muted">-</span>;
  }
  if (type === 'boolean') {
    return <span>{value ? 'Yes' : 'No'}</span>;
  }
  if (type === 'date') {
    const d = new Date(String(value));
    if (!Number.isNaN(d.getTime())) {
      return <span className="tabular-nums">{d.toLocaleDateString()}</span>;
    }
  }
  if (type === 'enum') {
    const label = PHASE_LABELS[String(value)] ?? String(value).replace(/_/g, ' ');
    return <span className="capitalize">{label}</span>;
  }
  return <span>{String(value)}</span>;
}
