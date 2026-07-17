import { useCallback, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
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
  type CareDocument,
  type CareProfile,
  type CircleMember,
  type MedicalCondition,
  type Provider,
} from '../../../lib/care';

const CARD_KEYS = ['profile', 'conditions', 'neurotypes', 'poa', 'upcoming', 'health', 'log'] as const;
type CardKey = (typeof CARD_KEYS)[number];

const CARD_LABELS: Record<CardKey, string> = {
  profile: 'Contact details',
  conditions: 'Conditions',
  neurotypes: 'Neurotypes',
  poa: 'Power of attorney',
  upcoming: 'Coming up',
  health: 'Current health',
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
  const { profile, isOwner, canEdit } = useProfile();
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
              <PetDetails
                species={profile.species}
                breed={profile.breed}
                desexed={profile.desexed}
                microchip={profile.microchip_number}
              />
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
      api.get<{ events: Array<{ id: string; title: string; next_due_at: string; completed: boolean; kind?: string; location?: string | null }> }>(
        `/care-profiles/${profileId}/calendar?from=${from.toISOString()}&to=${to.toISOString()}`
      ),
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
        {events.map((e) => (
          <li key={e.id} className="py-1.5 flex items-baseline gap-3 text-sm">
            <span className="text-muted whitespace-nowrap tabular-nums">
              {new Date(e.next_due_at).toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' })}
            </span>
            <span className="text-ink min-w-0 truncate">{e.title}</span>
            {e.location ? <span className="text-xs text-muted truncate">{e.location}</span> : null}
          </li>
        ))}
      </ul>
    </div>
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

function ProfileContact({ profile }: { profile: CareProfile }) {
  if (!profile.contact_kind) return null;
  // The phone's kind becomes the row label, so it informs without taking
  // up a row of its own.
  const phoneLabel =
    profile.contact_phone_type === 'mobile' ? 'Mobile' : profile.contact_phone_type === 'home' ? 'Home phone' : 'Phone';
  const rows: { label: string; value: React.ReactNode }[] = [];
  if (profile.contact_kind === 'self') {
    rows.push({ label: 'Contact', value: 'Themselves' });
    if (profile.contact_phone) rows.push({ label: phoneLabel, value: <PhoneLink phone={profile.contact_phone} /> });
    if (profile.contact_email) rows.push({ label: 'Email', value: <EmailLink email={profile.contact_email} /> });
  } else if (profile.contact_kind === 'user') {
    if (profile.contact_account_name) rows.push({ label: 'Contact', value: profile.contact_account_name });
    if (profile.contact_account_email) rows.push({ label: 'Email', value: <EmailLink email={profile.contact_account_email} /> });
  } else {
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

function PetDetails({
  species,
  breed,
  desexed,
  microchip,
}: {
  species: string | null;
  breed: string | null;
  desexed: boolean;
  microchip: string | null;
}) {
  const rows: { label: string; value: React.ReactNode }[] = [];
  if (species) rows.push({ label: 'Species', value: species });
  if (breed) rows.push({ label: 'Breed', value: breed });
  rows.push({ label: 'Desexed', value: desexed ? 'Yes' : 'No' });
  if (microchip) rows.push({ label: 'Microchip', value: microchip });
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
