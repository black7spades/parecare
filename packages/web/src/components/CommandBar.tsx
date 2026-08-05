import { useEffect, useState } from 'react';
import { useMatch, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Palette, type PaletteGroup, type PaletteItem } from './ui/Palette';
import { useCommandBar } from '../stores/commandBar';
import { useAssistantStore } from '../stores/assistant';
import { useAuthStore } from '../stores/auth';
import { fuzzyRank } from '../lib/fuzzy';
import { PROFILE_NAV_ITEMS } from '../pages/app/profile/tabs';
import { COMMANDS } from '../lib/commands';

interface BarProfile {
  id: string;
  full_name: string;
  preferred_name: string | null;
  relationship: string | null;
}

interface AttentionRow {
  profile_id: string;
  profile_name: string;
  label: string;
  section: string;
  key: string;
}

interface SearchHit {
  type: 'profile' | 'medication' | 'condition' | 'appointment' | 'document' | 'provider' | 'task';
  id: string;
  profile_id: string;
  profile_name: string;
  title: string;
  subtitle: string | null;
  route: string;
}

const HIT_LABEL: Record<SearchHit['type'], string> = {
  profile: 'Person',
  medication: 'Medication',
  condition: 'Condition',
  appointment: 'Appointment',
  document: 'Document',
  provider: 'Provider',
  task: 'Task',
};

// Segments under /app that are not a person, so we do not treat them as one.
const RESERVED = new Set(['profiles', 'directory', 'reports', 'updates']);

function isEditable(el: EventTarget | null): boolean {
  const n = el as HTMLElement | null;
  if (!n) return false;
  return n.tagName === 'INPUT' || n.tagName === 'TEXTAREA' || n.tagName === 'SELECT' || n.isContentEditable;
}

/**
 * One keystroke to any person, section, record or action. Three tiers, in
 * order, and only the last is slow: Go and Do are instant and never touch the
 * network or the model; Find is a debounced search; Ask Pare, always last and
 * set apart, is the only row that reaches the assistant. Opening it with
 * nothing typed answers "what should I be doing" from what already needs
 * attention, so the first thing it does is never a blank box.
 */
export function CommandBar() {
  const { open, setOpen, toggle } = useCommandBar();
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const navigate = useNavigate();
  const openWithMessage = useAssistantStore((s) => s.openWithMessage);
  const role = useAuthStore((s) => s.account?.role);

  const profileMatch = useMatch('/app/:profileId/*');
  const first = profileMatch?.params.profileId;
  const profileId = first && !RESERVED.has(first) ? first : null;

  // The one global shortcut dispatcher. Cmd/Ctrl+K from anywhere; the forward
  // slash only when focus is not already in a field, so typing is never stolen.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        toggle();
      } else if (e.key === '/' && !open && !isEditable(e.target)) {
        e.preventDefault();
        setOpen(true);
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, toggle, setOpen]);

  useEffect(() => {
    if (open) setQuery('');
  }, [open]);

  useEffect(() => {
    const t = window.setTimeout(() => setDebounced(query.trim()), 180);
    return () => window.clearTimeout(t);
  }, [query]);

  const { data: profilesData } = useQuery({
    queryKey: ['care-profiles-summary'],
    queryFn: () => api.get<{ profiles: BarProfile[] }>('/care-profiles/summary'),
    enabled: open,
  });
  const profiles = profilesData?.profiles ?? [];

  const { data: attentionData } = useQuery({
    queryKey: ['pare-attention'],
    queryFn: () => api.get<{ items: AttentionRow[] }>('/ai/dashboard/attention'),
    enabled: open,
  });
  const attention = attentionData?.items ?? [];

  const { data: searchData } = useQuery({
    queryKey: ['command-search', debounced],
    queryFn: () => api.get<{ results: SearchHit[] }>(`/search?q=${encodeURIComponent(debounced)}`),
    enabled: open && debounced.length >= 2,
  });
  const hits = searchData?.results ?? [];

  const go = (to: string) => {
    setOpen(false);
    navigate(to);
  };

  const personItem = (p: BarProfile): PaletteItem => ({
    id: `p-${p.id}`,
    content: (
      <span className="min-w-0 flex-1">
        <span className="block truncate text-ink">{p.preferred_name || p.full_name}</span>
        {p.relationship ? <span className="block truncate text-xs capitalize text-muted">{p.relationship}</span> : null}
      </span>
    ),
    onSelect: () => go(`/app/${p.id}`),
  });

  const destinations: Array<{ label: string; to: string }> = [
    { label: 'Homeboard', to: '/app' },
    { label: 'People', to: '/app/directory/people' },
    { label: 'Pets', to: '/app/directory/pets' },
    { label: 'Providers directory', to: '/app/directory/providers' },
    { label: 'Suppliers', to: '/app/directory/suppliers' },
    { label: 'Assets', to: '/app/directory/assets' },
    { label: 'Addresses', to: '/app/directory/addresses' },
    { label: 'Reports', to: '/app/reports' },
    { label: "What's new", to: '/app/updates' },
    { label: 'Account settings', to: '/account/settings' },
    ...(role === 'admin' || role === 'super_admin'
      ? [{ label: 'Manage users', to: '/system/users' }, { label: 'System settings', to: '/system/settings' }]
      : []),
  ];

  const groups: PaletteGroup[] = [];
  const q = query.trim();

  if (!q) {
    const attn = attention.slice(0, 6).map<PaletteItem>((it) => ({
      id: `attn-${it.key}`,
      content: (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ink">{it.label}</span>
          <span className="block truncate text-xs text-muted">{it.profile_name}</span>
        </span>
      ),
      onSelect: () => go(`/app/${it.profile_id}/${it.section}`),
    }));
    if (attn.length) groups.push({ key: 'attention', heading: 'Needs attention', items: attn });
    const ppl = profiles.slice(0, 8).map(personItem);
    if (ppl.length) groups.push({ key: 'people', heading: 'People', items: ppl });
  } else {
    const people = fuzzyRank(q, profiles, (p) => `${p.full_name} ${p.preferred_name ?? ''} ${p.relationship ?? ''}`, 0.5)
      .slice(0, 5)
      .map(personItem);
    const sections = profileId
      ? fuzzyRank(q, PROFILE_NAV_ITEMS, (s) => s.label, 0.5).slice(0, 5).map<PaletteItem>((s) => ({
          id: `sec-${s.key}`,
          content: <span className="flex-1 text-ink">{s.label}</span>,
          onSelect: () => go(`/app/${profileId}/${s.to}`),
        }))
      : [];
    const dests = fuzzyRank(q, destinations, (d) => d.label, 0.5).slice(0, 5).map<PaletteItem>((d) => ({
      id: `dest-${d.to}`,
      content: <span className="flex-1 text-ink">{d.label}</span>,
      onSelect: () => go(d.to),
    }));
    const goItems = [...people, ...sections, ...dests];
    if (goItems.length) groups.push({ key: 'go', heading: 'Go to', items: goItems });

    const doable = COMMANDS.filter((c) => !c.needsProfile || profileId);
    const doItems = fuzzyRank(q, doable, (c) => `${c.label} ${c.keywords}`, 0.5).slice(0, 6).map<PaletteItem>((c) => ({
      id: `do-${c.id}`,
      content: <span className="flex-1 text-ink">{c.label}</span>,
      onSelect: () => go(c.route(profileId ?? '')),
    }));
    if (doItems.length) groups.push({ key: 'do', heading: 'Do', items: doItems });

    const findItems = fuzzyRank(q, hits, (h) => h.title, 0.4).slice(0, 8).map<PaletteItem>((h) => ({
      id: `hit-${h.type}-${h.id}`,
      content: (
        <span className="min-w-0 flex-1">
          <span className="block truncate text-ink">{h.title}</span>
          <span className="block truncate text-xs text-muted">
            {HIT_LABEL[h.type]} · {h.profile_name}
            {h.subtitle ? ` · ${h.subtitle}` : ''}
          </span>
        </span>
      ),
      onSelect: () => go(h.route),
    }));
    if (findItems.length) groups.push({ key: 'find', heading: 'Found', items: findItems });

    // Always last, and set apart: the one row that reaches the model.
    groups.push({
      key: 'ask',
      heading: 'Ask Pare',
      items: [
        {
          id: 'ask',
          content: (
            <span className="flex-1 text-ink">
              Ask Pare<span className="text-muted"> about “{q}”</span>
            </span>
          ),
          onSelect: () => {
            setOpen(false);
            openWithMessage(q, profileId);
          },
        },
      ],
    });
  }

  return (
    <Palette
      open={open}
      onClose={() => setOpen(false)}
      query={query}
      onQueryChange={setQuery}
      placeholder="Find or do anything"
      label="Find or do anything"
      groups={groups}
      empty="Type a name, a place, or what you want to do."
      footer={
        <span>
          <span className="font-medium">↑ ↓</span> to move · <span className="font-medium">Enter</span> to open ·{' '}
          <span className="font-medium">Esc</span> to close
        </span>
      }
    />
  );
}
