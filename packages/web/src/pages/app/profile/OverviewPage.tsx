import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { PoaBadge } from '../../../components/PoaBadge';
import { AttentionPanel } from '../../../components/AttentionPanel';
import { SetPoaForm } from '../../../components/SetPoaForm';
import { ConditionModal } from '../../../components/QuickAddModals';
import { CurrentHealthSection } from './CurrentHealthSection';
import { CareLogSection } from './CareLogSection';
import { CardAiSummary } from './CardAiSummary';
import { useProfile } from './ProfileLayout';
import {
  conditionCategoryLabel,
  conditionStatusLabel,
  diagnosisStatusLabel,
  neurotypeLabelText,
  poaLabel,
  providerTypeLabel,
  residenceTypeLabel,
  roomAreaTypeLabel,
  substanceClassLabel,
  substanceStatusLabel,
  type CareDocument,
  type CareProfile,
  type CircleMember,
  type MedicalCondition,
  type Provider,
  type SubstanceUse,
} from '../../../lib/care';

const CARD_KEYS = ['profile', 'conditions', 'neurotypes', 'substance-use', 'poa', 'upcoming', 'health', 'health-spend', 'log'] as const;
type CardKey = (typeof CARD_KEYS)[number];

const CARD_LABELS: Record<CardKey, string> = {
  profile: 'Contact details',
  conditions: 'Conditions',
  neurotypes: 'Neurotypes',
  'substance-use': 'Substance use',
  poa: 'Power of attorney',
  upcoming: 'Coming up',
  health: 'Current health',
  'health-spend': 'Health spend',
  log: 'Care log',
};

function loadCardOrder(): CardKey[] {
  try {
    const raw = localStorage.getItem('overview-card-order');
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      const valid = parsed.filter((k): k is CardKey => (CARD_KEYS as readonly string[]).includes(k));
      const missing = CARD_KEYS.filter((k) => !valid.includes(k));
      return [...valid, ...missing];
    }
  } catch { /* ignore */ }
  return [...CARD_KEYS];
}

function loadCollapsed(): Set<CardKey> {
  try {
    const raw = localStorage.getItem('overview-collapsed');
    if (raw) return new Set(JSON.parse(raw) as CardKey[]);
  } catch { /* ignore */ }
  return new Set();
}

export function OverviewPage() {
  const { profile, isOwner, canEdit, access } = useProfile();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [editView, setEditView] = useState(false);
  const [cardOrder, setCardOrder] = useState<CardKey[]>(loadCardOrder);
  const [collapsed, setCollapsed] = useState<Set<CardKey>>(loadCollapsed);

  const { data: circleData } = useQuery({
    queryKey: ['circle', profile.id],
    queryFn: () => api.get<{ members: CircleMember[] }>(`/care-profiles/${profile.id}/circle`),
  });
  const { data: conditionsData } = useQuery({
    queryKey: ['conditions', profile.id],
    queryFn: () => api.get<{ conditions: MedicalCondition[] }>(`/care-profiles/${profile.id}/conditions`),
  });
  const neurotypes = (conditionsData?.conditions ?? []).filter((c) => c.category === 'neurotype');
  const { data: substanceData } = useQuery({
    queryKey: ['substance-use', profile.id],
    queryFn: () => api.get<{ substance_use: SubstanceUse[] }>(`/care-profiles/${profile.id}/substance-use`),
  });
  const substanceUse = substanceData?.substance_use ?? [];
  const { data: providersData } = useQuery({
    queryKey: ['providers', profile.id],
    queryFn: () => api.get<{ providers: Provider[] }>(`/care-profiles/${profile.id}/providers`),
  });
  const members = circleData?.members ?? [];
  const providers = providersData?.providers ?? [];

  const poaHolders: PoaHolder[] = [
    ...members
      .filter((m) => m.poa_type)
      .map((m) => ({
        key: m.id,
        name: m.display_name,
        sublabel: m.relationship,
        poa_type: m.poa_type,
        poa_activated: m.poa_activated,
        phone: null,
        email: m.account_email ?? m.invited_email,
        address: null,
      })),
    ...providers
      .filter((p) => p.poa_type)
      .map((p) => ({
        key: p.id,
        name: p.name,
        sublabel: providerTypeLabel(p.provider_type),
        poa_type: p.poa_type,
        poa_activated: p.poa_activated,
        phone: p.phone,
        email: p.email,
        address: p.address,
      })),
  ];

  const [confirmText, setConfirmText] = useState('');
  const [deleteError, setDeleteError] = useState('');

  const archiveMutation = useMutation({
    mutationFn: () => api.delete(`/care-profiles/${profile.id}`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['care-profiles'] });
      navigate('/app');
    },
  });

  const deleteMutation = useMutation({
    mutationFn: () => api.delete(`/care-profiles/${profile.id}/permanent`),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['care-profiles'] });
      void queryClient.invalidateQueries({ queryKey: ['care-profiles-summary'] });
      navigate('/app');
    },
    onError: (err) => setDeleteError(err instanceof Error ? err.message : 'Failed to delete'),
  });

  const nameMatches = confirmText.trim().toLowerCase() === profile.full_name.trim().toLowerCase();
  const closeArchive = () => {
    setArchiveOpen(false);
    setConfirmText('');
    setDeleteError('');
  };

  const toggleCollapse = useCallback((key: CardKey) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      localStorage.setItem('overview-collapsed', JSON.stringify([...next]));
      return next;
    });
  }, []);

  // The header control folds or unfolds every card at once.
  const allCollapsed = CARD_KEYS.every((k) => collapsed.has(k));
  const toggleAllCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next: Set<CardKey> = prev.size >= CARD_KEYS.length ? new Set() : new Set(CARD_KEYS);
      localStorage.setItem('overview-collapsed', JSON.stringify([...next]));
      return next;
    });
  }, []);

  const moveCard = useCallback((key: CardKey, dir: -1 | 1) => {
    setCardOrder((prev) => {
      const idx = prev.indexOf(key);
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      localStorage.setItem('overview-card-order', JSON.stringify(next));
      return next;
    });
  }, []);

  const isPet = profile.kind === 'pet';
  const careName = profile.preferred_name ?? profile.full_name;

  const renderCard = (key: CardKey) => {
    const isCollapsed = collapsed.has(key);
    switch (key) {
      case 'profile':
        return (
          <CollapsibleCard
            key={key}
            cardKey={key}
            label={CARD_LABELS[key]}
            collapsed={isCollapsed}
            editView={editView}
            onToggle={toggleCollapse}
            onMove={moveCard}
            order={cardOrder}
          >
            {isPet ? (
              <div className="space-y-4">
                <PetDetails
                  species={profile.species}
                  breed={profile.breed}
                  desexed={profile.desexed}
                  microchip={profile.microchip_number}
                  owner={profile.owner_profile ?? null}
                />
                <ProfileContact profile={profile} />
              </div>
            ) : (
              <ProfileContact profile={profile} />
            )}
          </CollapsibleCard>
        );
      case 'conditions':
        return (
          <CollapsibleCard
            key={key}
            cardKey={key}
            label={CARD_LABELS[key]}
            collapsed={isCollapsed}
            editView={editView}
            onToggle={toggleCollapse}
            onMove={moveCard}
            order={cardOrder}
          >
            <ConditionsOverview profileId={profile.id} canEdit={canEdit} careName={careName} />
          </CollapsibleCard>
        );
      case 'neurotypes':
        // The card only exists for a neurodivergent person.
        if (neurotypes.length === 0) return null;
        return (
          <CollapsibleCard
            key={key}
            cardKey={key}
            label={CARD_LABELS[key]}
            collapsed={isCollapsed}
            editView={editView}
            onToggle={toggleCollapse}
            onMove={moveCard}
            order={cardOrder}
          >
            <NeurotypesOverview profileId={profile.id} careName={careName} canEdit={canEdit} neurotypes={neurotypes} />
          </CollapsibleCard>
        );
      case 'substance-use':
        // The card only exists once a substance has been recorded.
        if (substanceUse.length === 0) return null;
        return (
          <CollapsibleCard
            key={key}
            cardKey={key}
            label={CARD_LABELS[key]}
            collapsed={isCollapsed}
            editView={editView}
            onToggle={toggleCollapse}
            onMove={moveCard}
            order={cardOrder}
          >
            <SubstanceUseSummary records={substanceUse} />
          </CollapsibleCard>
        );
      case 'poa':
        if (isPet) return null;
        return (
          <CollapsibleCard
            key={key}
            cardKey={key}
            label={CARD_LABELS[key]}
            collapsed={isCollapsed}
            editView={editView}
            onToggle={toggleCollapse}
            onMove={moveCard}
            order={cardOrder}
          >
            <PoaCard
              profileId={profile.id}
              poaHolders={poaHolders}
              isOwner={isOwner}
              careName={careName}
            />
          </CollapsibleCard>
        );
      case 'upcoming':
        return (
          <CollapsibleCard
            key={key}
            cardKey={key}
            label={CARD_LABELS[key]}
            collapsed={isCollapsed}
            editView={editView}
            onToggle={toggleCollapse}
            onMove={moveCard}
            order={cardOrder}
          >
            <UpcomingEvents profileId={profile.id} />
          </CollapsibleCard>
        );
      case 'health':
        return (
          <CollapsibleCard
            key={key}
            cardKey={key}
            label={CARD_LABELS[key]}
            collapsed={isCollapsed}
            editView={editView}
            onToggle={toggleCollapse}
            onMove={moveCard}
            order={cardOrder}
          >
            <div className="space-y-3">
              <CardAiSummary profileId={profile.id} cardKey="health" canEdit={canEdit} />
              <CurrentHealthSection profileId={profile.id} canEdit={canEdit} careName={careName} />
            </div>
          </CollapsibleCard>
        );
      case 'health-spend':
        // Care costs are for the owner and admins only, not the wider circle.
        if (access !== 'owner' && access !== 'admin') return null;
        return (
          <CollapsibleCard
            key={key}
            cardKey={key}
            label={CARD_LABELS[key]}
            collapsed={isCollapsed}
            editView={editView}
            onToggle={toggleCollapse}
            onMove={moveCard}
            order={cardOrder}
          >
            <HealthSpendOverview profileId={profile.id} careName={careName} />
          </CollapsibleCard>
        );
      case 'log':
        return (
          <CollapsibleCard
            key={key}
            cardKey={key}
            label={CARD_LABELS[key]}
            collapsed={isCollapsed}
            editView={editView}
            onToggle={toggleCollapse}
            onMove={moveCard}
            order={cardOrder}
          >
            <div className="space-y-3">
              <CardAiSummary profileId={profile.id} cardKey="log" canEdit={canEdit} />
              <CareLogSection profileId={profile.id} canEdit={canEdit} />
            </div>
          </CollapsibleCard>
        );
      default:
        return null;
    }
  };

  return (
    <div className="space-y-6">
      <AttentionPanel profileId={profile.id} />

      <div className="flex items-center justify-end gap-1">
        <button
          type="button"
          aria-label={allCollapsed ? 'Expand all cards' : 'Collapse all cards'}
          title={allCollapsed ? 'Expand all' : 'Collapse all'}
          className="p-1.5 text-muted hover:text-ink"
          onClick={toggleAllCollapsed}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            {allCollapsed ? (
              <>
                <polyline points="7 13 12 18 17 13" />
                <polyline points="7 6 12 11 17 6" />
              </>
            ) : (
              <>
                <polyline points="17 11 12 6 7 11" />
                <polyline points="17 18 12 13 7 18" />
              </>
            )}
          </svg>
        </button>
        <Button
          variant={editView ? 'secondary' : 'ghost'}
          size="sm"
          onClick={() => setEditView((v) => !v)}
        >
          {editView ? 'Done editing' : 'Edit view'}
        </Button>
      </div>

      {cardOrder.map(renderCard)}

      <div className="pt-4 border-t border-border">
        <Button variant="ghost" size="sm" onClick={() => setArchiveOpen(true)}>
          Archive or delete this profile
        </Button>
      </div>

      <Modal open={archiveOpen} onClose={closeArchive} title="Archive or delete profile">
        <p className="text-sm text-muted mb-4">
          Archiving hides {careName}'s profile and its records from your
          dashboard. Nothing is deleted, and you can bring it back later.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={closeArchive}>Cancel</Button>
          <Button variant="secondary" loading={archiveMutation.isPending} onClick={() => archiveMutation.mutate()}>
            Archive
          </Button>
        </div>

        {isOwner ? (
          <div className="mt-6 pt-4 border-t border-border">
            <p className="text-sm font-medium text-ink mb-1">Delete permanently</p>
            <p className="text-sm text-muted mb-3">
              This cannot be undone. It removes {careName} and everything recorded
              for them: journeys, care log, tasks, medications, documents and the care circle. To confirm, type their
              full name <span className="font-medium text-ink">{profile.full_name}</span> below.
            </p>
            <Input
              aria-label="Type the full name to confirm deletion"
              value={confirmText}
              onChange={(e) => setConfirmText(e.target.value)}
              placeholder={profile.full_name}
            />
            {deleteError ? <p className="mt-2 text-sm text-red-600">{deleteError}</p> : null}
            <div className="mt-3 flex justify-end">
              <Button
                variant="danger"
                loading={deleteMutation.isPending}
                disabled={!nameMatches}
                onClick={() => {
                  setDeleteError('');
                  deleteMutation.mutate();
                }}
              >
                Delete permanently
              </Button>
            </div>
          </div>
        ) : null}
      </Modal>
    </div>
  );
}

function CollapsibleCard({
  cardKey,
  label,
  collapsed,
  editView,
  onToggle,
  onMove,
  order,
  children,
}: {
  cardKey: CardKey;
  label: string;
  collapsed: boolean;
  editView: boolean;
  onToggle: (key: CardKey) => void;
  onMove: (key: CardKey, dir: -1 | 1) => void;
  order: CardKey[];
  children: React.ReactNode;
}) {
  const idx = order.indexOf(cardKey);
  const isFirst = idx === 0;
  const isLast = idx === order.length - 1;

  return (
    <div className="card">
      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          className="flex items-center gap-2 text-sm font-semibold text-ink hover:text-primary"
          onClick={() => onToggle(cardKey)}
          aria-expanded={!collapsed}
          aria-label={`${collapsed ? 'Expand' : 'Collapse'} ${label}`}
        >
          <span className="text-xs text-muted">{collapsed ? '▶' : '▼'}</span>
          {label}
        </button>
        {editView ? (
          <span className="flex items-center gap-1">
            <button
              type="button"
              aria-label={`Move ${label} up`}
              disabled={isFirst}
              onClick={() => onMove(cardKey, -1)}
              className="p-1 text-xs text-muted hover:text-ink disabled:opacity-30"
            >
              ↑
            </button>
            <button
              type="button"
              aria-label={`Move ${label} down`}
              disabled={isLast}
              onClick={() => onMove(cardKey, 1)}
              className="p-1 text-xs text-muted hover:text-ink disabled:opacity-30"
            >
              ↓
            </button>
          </span>
        ) : null}
      </div>
      {collapsed ? null : <div className="mt-3">{children}</div>}
    </div>
  );
}

interface PoaHolder {
  key: string;
  name: string;
  sublabel: string | null;
  poa_type: string | null;
  poa_activated: boolean;
  phone: string | null;
  email: string | null;
  address: string | null;
}

function buildConditionsSummary(conditions: MedicalCondition[], careName: string): string {
  if (conditions.length === 0) return '';
  const active = conditions.filter((c) => c.status !== 'resolved');
  const resolved = conditions.filter((c) => c.status === 'resolved');
  const neurotypes = active.filter((c) => c.category === 'neurotype');
  const chronic = active.filter((c) => c.condition_type === 'chronic' && c.category !== 'neurotype');
  const acute = active.filter((c) => c.condition_type === 'acute' || c.category === 'illness' || c.category === 'acute_illness');
  const other = active.filter(
    (c) => !neurotypes.includes(c) && !chronic.includes(c) && !acute.includes(c)
  );

  const parts: string[] = [];

  if (neurotypes.length > 0) {
    parts.push(
      `${careName} is neurodivergent: ${neurotypes.map((c) => c.name).join(', ')}.`
    );
  }

  if (chronic.length > 0) {
    const managed = chronic.filter((c) => c.status === 'managed');
    if (managed.length === chronic.length) {
      parts.push(`${chronic.length === 1 ? 'Has' : 'Has'} ${chronic.map((c) => c.name).join(', ')}, currently managed.`);
    } else {
      parts.push(`Living with ${chronic.map((c) => `${c.name}${c.severity ? ` (${c.severity})` : ''}`).join(', ')}.`);
    }
  }

  if (acute.length > 0) {
    parts.push(`Currently dealing with ${acute.map((c) => c.name).join(', ')}.`);
  }

  if (other.length > 0) {
    parts.push(`Also recorded: ${other.map((c) => c.name).join(', ')}.`);
  }

  if (resolved.length > 0) {
    parts.push(`${resolved.length} resolved ${resolved.length === 1 ? 'condition' : 'conditions'}.`);
  }

  return parts.join(' ');
}

function ConditionsOverview({
  profileId,
  canEdit,
  careName,
}: {
  profileId: string;
  canEdit: boolean;
  careName: string;
}) {
  const [viewMode, setViewMode] = useState<'summary' | 'list'>('summary');
  const [adding, setAdding] = useState(false);

  const { data } = useQuery({
    queryKey: ['conditions', profileId],
    queryFn: () => api.get<{ conditions: MedicalCondition[] }>(`/care-profiles/${profileId}/conditions`),
  });
  const conditions = data?.conditions ?? [];
  const sorted = [...conditions].sort((a, b) => a.name.localeCompare(b.name));

  if (conditions.length === 0) {
    return (
      <div>
        <p className="text-sm text-muted">No conditions recorded yet.</p>
        {canEdit ? (
          <>
            <Button variant="secondary" size="sm" className="mt-2" onClick={() => setAdding(true)}>
              Add condition
            </Button>
            <ConditionModal profileId={profileId} open={adding} onClose={() => setAdding(false)} />
          </>
        ) : null}
      </div>
    );
  }

  const summary = buildConditionsSummary(conditions, careName);

  const pillClass = (active: boolean) =>
    active
      ? 'px-3 py-1 text-xs rounded-full bg-card text-ink font-medium shadow-sm'
      : 'px-3 py-1 text-xs rounded-full text-muted hover:text-ink';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1 rounded-full bg-surface-2 p-0.5">
          <button type="button" className={pillClass(viewMode === 'summary')} onClick={() => setViewMode('summary')}>
            Summary
          </button>
          <button type="button" className={pillClass(viewMode === 'list')} onClick={() => setViewMode('list')}>
            A-Z list
          </button>
        </div>
        <Link to="conditions" className="text-xs text-primary hover:underline">
          Manage conditions
        </Link>
      </div>

      {viewMode === 'summary' ? (
        <p className="text-sm text-ink leading-relaxed">{summary}</p>
      ) : (
        <ul className="divide-y divide-border">
          {sorted.map((c) => (
            <li key={c.id} className="py-1.5 flex items-center gap-3 text-sm">
              <span className="text-ink font-medium min-w-0 truncate">{c.name}</span>
              {c.category ? <span className="text-xs text-muted">{conditionCategoryLabel(c.category)}</span> : null}
              <span className="text-xs text-muted">{conditionStatusLabel(c.status)}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function NeurotypesOverview({
  profileId,
  careName,
  canEdit,
  neurotypes,
}: {
  profileId: string;
  careName: string;
  canEdit: boolean;
  neurotypes: MedicalCondition[];
}) {
  // Labels for the linked diagnosis documents. Only documents the viewer
  // is allowed to see come back, so a restricted document simply shows no
  // link for that viewer.
  const { data: docsData } = useQuery({
    queryKey: ['documents', profileId],
    queryFn: () => api.get<{ documents: CareDocument[] }>(`/care-profiles/${profileId}/documents`),
  });
  const docs = docsData?.documents ?? [];

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <p className="text-sm text-ink">{careName} is neurodivergent.</p>
        <Link to="neurotypes" className="text-xs text-primary hover:underline">
          Manage neurotypes
        </Link>
      </div>
      <CardAiSummary profileId={profileId} cardKey="neurotypes" canEdit={canEdit} autoGenerate />
      <div className="space-y-2">
        {neurotypes.map((n) => {
          const doc =
            n.diagnosis_status === 'formal' && n.diagnosis_document_id
              ? docs.find((d) => d.id === n.diagnosis_document_id)
              : undefined;
          return (
            <div key={n.id} className="flex items-start gap-3 text-sm flex-wrap">
              <span className="font-medium text-ink">{n.name}</span>
              {n.neurotype ? <span className="text-xs text-muted">{neurotypeLabelText(n.neurotype)}</span> : null}
              {n.diagnosis_status ? (
                <span className="text-xs text-muted">{diagnosisStatusLabel(n.diagnosis_status)}</span>
              ) : null}
              {doc ? (
                <Link
                  to={`documents?doc=${doc.id}`}
                  className="text-xs text-primary hover:underline"
                  title="Open the diagnosis document in Documents"
                >
                  Diagnosis document: {doc.label}
                </Link>
              ) : null}
            </div>
          );
        })}
      </div>
    </div>
  );
}

function PoaCard({
  profileId,
  poaHolders,
  isOwner,
  careName,
}: {
  profileId: string;
  poaHolders: PoaHolder[];
  isOwner: boolean;
  careName: string;
}) {
  if (poaHolders.length > 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink">
          Power of attorney means someone is legally authorised to make decisions on {careName}'s behalf.
          The type of authority determines what decisions they can make. A medical POA can make healthcare
          decisions; a financial POA can manage money and property; an enduring POA continues even if
          {careName} loses capacity to make their own decisions.
        </p>
        <div className="divide-y divide-border">
          {poaHolders.map((h) => (
            <div key={h.key} className="py-2 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-ink">{h.name}</span>
                  <PoaBadge type={h.poa_type} activated={h.poa_activated} />
                </div>
                {h.sublabel ? <p className="text-xs text-muted">{h.sublabel}</p> : null}
                <p className="text-xs text-muted mt-0.5">
                  {poaLabel(h.poa_type ?? '')} {h.poa_activated ? '(activated)' : '(not yet activated)'}
                </p>
                {h.phone || h.email ? (
                  <p className="text-xs text-muted mt-0.5">
                    {h.phone ? (
                      <>
                        Phone: <PhoneLink phone={h.phone} />
                      </>
                    ) : null}
                    {h.phone && h.email ? ' · ' : null}
                    {h.email ? (
                      <>
                        Email: <EmailLink email={h.email} />
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        {isOwner ? <SetPoaForm profileId={profileId} compact /> : null}
      </div>
    );
  }

  if (isOwner) {
    return <SetPoaForm profileId={profileId} />;
  }

  return <p className="text-sm text-muted">No power of attorney recorded.</p>;
}

function UpcomingEvents({ profileId }: { profileId: string }) {
  const from = new Date();
  const to = new Date(Date.now() + 14 * 24 * 3600 * 1000);
  const { data } = useQuery({
    queryKey: ['calendar-upcoming', profileId],
    queryFn: () =>
      api.get<{
        events: Array<{
          id: string;
          title: string;
          next_due_at: string;
          completed: boolean;
          kind?: string;
          location?: string | null;
          directions_link?: string | null;
          all_day?: boolean;
        }>;
      }>(`/care-profiles/${profileId}/calendar?from=${from.toISOString()}&to=${to.toISOString()}`),
  });
  const events = (data?.events ?? []).filter((e) => e.kind !== 'medication' && !e.completed).slice(0, 6);
  if (events.length === 0) {
    return <p className="text-sm text-muted">Nothing scheduled in the next two weeks.</p>;
  }

  return (
    <div>
      <div className="flex items-center justify-between gap-2 mb-2">
        <Link to="calendar" className="text-xs text-primary hover:underline">
          Open the calendar
        </Link>
      </div>
      <ul className="divide-y divide-border">
        {events.map((e) => {
          const when = new Date(e.next_due_at);
          return (
            <li key={e.id} className="py-1.5 flex items-baseline gap-3 text-sm">
              <span className="text-muted whitespace-nowrap tabular-nums">
                {when.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
                {e.all_day ? null : (
                  <span className="ml-1 text-ink">
                    {when.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}
                  </span>
                )}
              </span>
              <span className="text-ink min-w-0 truncate">{e.title}</span>
              {e.location ? <span className="text-xs text-muted truncate">{e.location}</span> : null}
              {e.directions_link ? (
                <a
                  href={e.directions_link}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="ml-auto shrink-0 inline-flex items-center gap-1 rounded-full border border-border px-2 py-0.5 text-xs text-primary hover:bg-primary/5"
                >
                  📍 Directions
                </a>
              ) : null}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

interface SpendEntry {
  id: string;
  amount: number;
  spent_on: string;
  category: 'medication' | 'appointment' | 'other';
  status: 'confirmed' | 'estimated';
  description: string | null;
  item_name: string | null;
}
interface SpendResponse {
  summary: {
    currency: string;
    currency_symbol: string;
    by_category: { medication: number; appointment: number; other: number };
    total: number;
    pending_total: number;
  };
  entries: SpendEntry[];
}

type SpendRange = '12m' | 'year' | 'all';

const CATEGORY_LABEL: Record<SpendEntry['category'], string> = {
  medication: 'Medication',
  appointment: 'Appointment',
  other: 'Other',
};

function spendRangeParams(range: SpendRange): string {
  const today = new Date();
  const iso = (d: Date) => d.toISOString().slice(0, 10);
  if (range === 'all') return '';
  if (range === 'year') return `?from=${today.getFullYear()}-01-01&to=${iso(today)}`;
  const from = new Date(today);
  from.setFullYear(from.getFullYear() - 1);
  return `?from=${iso(from)}&to=${iso(today)}`;
}

/**
 * A person's actual health spend over a chosen window: the total and its split
 * into medications, appointments and one-off costs, plus each dated entry.
 * Only confirmed amounts count; an appointment estimate awaiting confirmation
 * is shown apart. Reports do custom date ranges. Owner and admin only.
 */
function HealthSpendOverview({ profileId, careName }: { profileId: string; careName: string }) {
  const queryClient = useQueryClient();
  const [range, setRange] = useState<SpendRange>('12m');
  const [adding, setAdding] = useState(false);
  const [confirming, setConfirming] = useState<SpendEntry | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['health-spend', profileId, range],
    queryFn: () => api.get<SpendResponse>(`/care-profiles/${profileId}/health-spend${spendRangeParams(range)}`),
  });

  const refresh = () => queryClient.invalidateQueries({ queryKey: ['health-spend', profileId] });

  const sym = data?.summary.currency_symbol ?? '$';
  const money = (n: number): string => `${sym}${n.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  const fmtDay = (d: string) => { try { return format(new Date(d), 'd MMM yyyy'); } catch { return d; } };

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border border-border overflow-hidden text-xs">
          {([['12m', 'Last 12 months'], ['year', 'This year'], ['all', 'All time']] as [SpendRange, string][]).map(([val, label]) => (
            <button
              key={val}
              type="button"
              className={`px-2.5 py-1 ${range === val ? 'bg-primary text-white' : 'bg-card text-muted hover:text-ink'}`}
              onClick={() => setRange(val)}
            >
              {label}
            </button>
          ))}
        </div>
        <Button size="sm" variant="secondary" onClick={() => setAdding(true)}>Add a cost</Button>
      </div>

      {isLoading || !data ? (
        <p className="text-sm text-muted">Adding up the spend…</p>
      ) : (
        <>
          <div className="grid gap-3 sm:grid-cols-4">
            <div className="rounded-lg border border-primary/40 bg-primary/5 p-3">
              <p className="text-xs text-muted">Total spent</p>
              <p className="text-lg font-semibold text-ink">{money(data.summary.total)}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted">Medications</p>
              <p className="text-lg font-semibold text-ink">{money(data.summary.by_category.medication)}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted">Appointments</p>
              <p className="text-lg font-semibold text-ink">{money(data.summary.by_category.appointment)}</p>
            </div>
            <div className="rounded-lg border border-border p-3">
              <p className="text-xs text-muted">Other</p>
              <p className="text-lg font-semibold text-ink">{money(data.summary.by_category.other)}</p>
            </div>
          </div>

          {data.summary.pending_total > 0 ? (
            <p className="text-xs text-amber-700 dark:text-amber-300">
              {money(data.summary.pending_total)} in booked appointments is still an estimate, not counted above until the
              actual cost is confirmed.
            </p>
          ) : null}

          {data.entries.length === 0 ? (
            <p className="text-sm text-muted">
              No costs recorded in this window. A medication cost is logged when a repeat is replenished, an appointment when
              you confirm what it cost, and one-off costs with Add a cost.
            </p>
          ) : (
            <ul className="divide-y divide-border text-sm">
              {data.entries.map((e) => (
                <li key={e.id} className="flex items-center justify-between gap-3 py-1.5">
                  <div className="min-w-0">
                    <span className="text-ink">{e.item_name || CATEGORY_LABEL[e.category]}</span>
                    <span className="block text-xs text-muted">
                      {fmtDay(e.spent_on)} · {CATEGORY_LABEL[e.category]}
                      {e.status === 'estimated' ? ' · estimate' : ''}
                    </span>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <span className={e.status === 'estimated' ? 'text-muted italic' : 'text-ink font-medium'}>{money(e.amount)}</span>
                    {e.status === 'estimated' ? (
                      <Button size="xs" variant="secondary" onClick={() => setConfirming(e)}>Confirm</Button>
                    ) : null}
                  </div>
                </li>
              ))}
            </ul>
          )}
          <p className="text-xs text-muted">Need a specific date range or a breakdown to export? Use Reports.</p>
        </>
      )}

      {adding ? (
        <AddCostModal profileId={profileId} careName={careName} currencySymbol={sym} onClose={() => setAdding(false)} onSaved={() => { setAdding(false); void refresh(); }} />
      ) : null}
      {confirming ? (
        <ConfirmCostModal profileId={profileId} entry={confirming} currencySymbol={sym} onClose={() => setConfirming(null)} onSaved={() => { setConfirming(null); void refresh(); }} />
      ) : null}
    </div>
  );
}

/** Record a one-off health cost by hand: amount, the day it was spent, a note. */
function AddCostModal({ profileId, careName, currencySymbol, onClose, onSaved }: { profileId: string; careName: string; currencySymbol: string; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState('');
  const [spentOn, setSpentOn] = useState(new Date().toISOString().slice(0, 10));
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: () => api.post(`/care-profiles/${profileId}/health-spend`, {
      amount: Number(amount),
      spent_on: spentOn,
      description: note.trim() || null,
    }),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not save the cost.'),
  });
  return (
    <Modal open onClose={onClose} title={`Add a cost for ${careName}`}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (amount.trim()) mutation.mutate(); }}>
        <Input label={`Amount (${currencySymbol})`} type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        <Input label="Date spent" type="date" value={spentOn} onChange={(e) => setSpentOn(e.target.value)} required />
        <Input label="What was it for" value={note} onChange={(e) => setNote(e.target.value)} placeholder="e.g. Mobility aid, dental treatment" />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending} disabled={!amount.trim()}>Save</Button>
        </div>
      </form>
    </Modal>
  );
}

/** Confirm what a booked appointment actually cost, turning its estimate into
 * confirmed spend. */
function ConfirmCostModal({ profileId, entry, currencySymbol, onClose, onSaved }: { profileId: string; entry: SpendEntry; currencySymbol: string; onClose: () => void; onSaved: () => void }) {
  const [amount, setAmount] = useState(String(entry.amount));
  const [error, setError] = useState('');
  const mutation = useMutation({
    mutationFn: () => api.patch(`/care-profiles/${profileId}/health-spend/${entry.id}`, {
      amount: Number(amount),
      status: 'confirmed',
    }),
    onSuccess: onSaved,
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not confirm the cost.'),
  });
  return (
    <Modal open onClose={onClose} title={`Confirm what it cost: ${entry.item_name ?? 'appointment'}`}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); if (amount.trim()) mutation.mutate(); }}>
        <p className="text-sm text-muted">Booked with an estimate of {currencySymbol}{entry.amount}. Enter what it actually cost.</p>
        <Input label={`Actual amount (${currencySymbol})`} type="number" min="0" step="any" value={amount} onChange={(e) => setAmount(e.target.value)} required />
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={mutation.isPending} disabled={!amount.trim()}>Confirm cost</Button>
        </div>
      </form>
    </Modal>
  );
}

/** A phone number as a tap-to-call link. */
function PhoneLink({ phone }: { phone: string }) {
  return (
    <a href={`tel:${phone.replace(/[^\d+]/g, '')}`} className="text-primary hover:underline">
      {phone}
    </a>
  );
}

/** An email address as a mailto link. */
function EmailLink({ email }: { email: string }) {
  return (
    <a href={`mailto:${email}`} className="text-primary hover:underline">
      {email}
    </a>
  );
}

/** One line describing where the person lives, from a facility or a private address. */
function residenceLines(profile: CareProfile): { label: string; value: React.ReactNode }[] {
  const rows: { label: string; value: React.ReactNode }[] = [];
  const fac = profile.residence_provider;
  const kind = residenceTypeLabel(profile.residence_type);
  if (fac) {
    const spot = [
      profile.room_number ? `Room ${profile.room_number}` : null,
      profile.room_area_name ? `${profile.room_area_name}${profile.room_area_type ? ` ${roomAreaTypeLabel(profile.room_area_type)}` : ''}` : null,
    ]
      .filter(Boolean)
      .join(', ');
    rows.push({
      label: 'Lives at',
      value: (
        <span>
          {fac.name}
          {kind ? <span className="text-muted"> · {kind}</span> : null}
          {spot ? <span className="block text-xs text-muted">{spot}</span> : null}
        </span>
      ),
    });
  } else {
    const addr = [
      profile.address_line1,
      profile.address_line2,
      profile.address_suburb,
      profile.address_state,
      profile.address_postcode,
      profile.address_country,
    ]
      .filter(Boolean)
      .join(', ');
    if (addr) {
      rows.push({
        label: 'Address',
        value: (
          <span>
            {addr}
            {kind ? <span className="block text-xs text-muted">{kind}</span> : null}
          </span>
        ),
      });
    } else if (kind) {
      rows.push({ label: 'Lives in', value: kind });
    }
  }
  return rows;
}

function ProfileContact({ profile }: { profile: CareProfile }) {
  // The phone's kind becomes the row label, so it informs without taking
  // up a row of its own.
  const phoneLabel =
    profile.contact_phone_type === 'mobile' ? 'Mobile' : profile.contact_phone_type === 'home' ? 'Home phone' : 'Phone';
  const rows: { label: string; value: React.ReactNode }[] = [...residenceLines(profile)];
  if (profile.contact_kind === 'self') {
    rows.push({ label: 'Contact', value: 'Themselves' });
    if (profile.contact_phone) rows.push({ label: phoneLabel, value: <PhoneLink phone={profile.contact_phone} /> });
    if (profile.contact_email) rows.push({ label: 'Email', value: <EmailLink email={profile.contact_email} /> });
  } else if (profile.contact_kind === 'user') {
    if (profile.contact_account_name) rows.push({ label: 'Contact', value: profile.contact_account_name });
    if (profile.contact_account_email) rows.push({ label: 'Email', value: <EmailLink email={profile.contact_account_email} /> });
  } else if (profile.contact_kind === 'provider' && profile.contact_provider) {
    const p = profile.contact_provider;
    rows.push({ label: 'Contact via', value: p.name });
    if (p.phone) rows.push({ label: 'Phone', value: <PhoneLink phone={p.phone} /> });
    if (p.email) rows.push({ label: 'Email', value: <EmailLink email={p.email} /> });
  } else if (profile.contact_kind === 'profile' && profile.contact_profile) {
    const c = profile.contact_profile;
    rows.push({
      label: 'Primary carer',
      value: (
        <Link to={`/app/${c.id}`} className="text-primary hover:underline">
          {c.preferred_name || c.full_name}
        </Link>
      ),
    });
    if (c.contact_phone) rows.push({ label: 'Phone', value: <PhoneLink phone={c.contact_phone} /> });
    if (c.contact_email) rows.push({ label: 'Email', value: <EmailLink email={c.contact_email} /> });
  } else if (profile.contact_kind === 'contact') {
    if (profile.contact_name) rows.push({ label: 'Contact', value: profile.contact_name });
    if (profile.contact_relationship) rows.push({ label: 'Relationship', value: profile.contact_relationship });
    if (profile.contact_phone) rows.push({ label: phoneLabel, value: <PhoneLink phone={profile.contact_phone} /> });
    if (profile.contact_email) rows.push({ label: 'Email', value: <EmailLink email={profile.contact_email} /> });
  }
  if (rows.length === 0) return null;
  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label} className="flex gap-2">
          <dt className="w-24 shrink-0 text-muted">{r.label}</dt>
          <dd className="min-w-0 flex-1 text-ink">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}

/** A compact read of substance use for the overview; full detail on the page. */
function SubstanceUseSummary({ records }: { records: SubstanceUse[] }) {
  return (
    <div className="space-y-2">
      <ul className="space-y-1.5 text-sm">
        {records.map((r) => {
          const amount = [r.quantity, r.quantity_unit].filter(Boolean).join(' ');
          const detail = [amount, r.frequency].filter(Boolean).join(', ');
          return (
            <li key={r.id} className="flex flex-wrap items-baseline gap-x-2">
              <span className="font-medium text-ink">{r.substance}</span>
              <span className="badge bg-surface-2 text-muted text-xs">{substanceStatusLabel(r.status)}</span>
              <span className="text-xs text-muted">{substanceClassLabel(r.substance_class)}</span>
              {detail ? <span className="text-xs text-muted">· {detail}</span> : null}
            </li>
          );
        })}
      </ul>
      <Link to="substance-use" className="text-xs text-primary hover:underline">
        Manage substance use
      </Link>
    </div>
  );
}

function PetDetails({
  species,
  breed,
  desexed,
  microchip,
  owner,
}: {
  species: string | null;
  breed: string | null;
  desexed: boolean;
  microchip: string | null;
  owner: { id: string; full_name: string; preferred_name: string | null } | null;
}) {
  const rows: { label: string; value: React.ReactNode }[] = [];
  if (species) rows.push({ label: 'Species', value: species });
  if (breed) rows.push({ label: 'Breed', value: breed });
  rows.push({ label: 'Desexed', value: desexed ? 'Yes' : 'No' });
  if (microchip) rows.push({ label: 'Microchip', value: microchip });
  if (owner) {
    rows.push({
      label: 'Owner',
      value: (
        <Link to={`/app/${owner.id}`} className="text-primary hover:underline">
          {owner.preferred_name || owner.full_name}
        </Link>
      ),
    });
  }
  return (
    <dl className="grid gap-x-4 gap-y-1.5 text-sm sm:grid-cols-2">
      {rows.map((r) => (
        <div key={r.label} className="flex gap-2">
          <dt className="w-20 shrink-0 text-muted">{r.label}</dt>
          <dd className="min-w-0 flex-1 text-ink">{r.value}</dd>
        </div>
      ))}
    </dl>
  );
}
