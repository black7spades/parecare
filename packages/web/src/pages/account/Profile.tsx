import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { Button } from '../../components/ui/Button';
import { Input } from '../../components/ui/Input';
import { Avatar } from '../../components/ui/Avatar';
import { useAuthStore } from '../../stores/auth';

interface Me {
  id: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
  date_of_birth: string | null;
  gender: string | null;
  pronouns: string | null;
}

interface Relationship {
  id: string;
  relationship: string;
  account_id: string;
  display_name: string;
  email: string;
  avatar_url: string | null;
}

const RELATIONSHIP_SUGGESTIONS = [
  'mother', 'father', 'parent', 'son', 'daughter', 'child', 'brother', 'sister', 'sibling',
  'spouse', 'husband', 'wife', 'partner', 'grandparent', 'grandchild', 'aunt', 'uncle',
  'cousin', 'niece', 'nephew', 'friend', 'carer',
];

export function Profile() {
  const { account, updateAccount } = useAuthStore();
  const queryClient = useQueryClient();
  const fileInput = useRef<HTMLInputElement>(null);

  const { data: me } = useQuery({ queryKey: ['me'], queryFn: () => api.get<Me>('/auth/me') });

  const [displayName, setDisplayName] = useState('');
  const [dob, setDob] = useState('');
  const [gender, setGender] = useState('');
  const [pronouns, setPronouns] = useState('');
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (!me) return;
    setDisplayName(me.display_name);
    setDob(me.date_of_birth ? me.date_of_birth.slice(0, 10) : '');
    setGender(me.gender ?? '');
    setPronouns(me.pronouns ?? '');
  }, [me]);

  const saveMutation = useMutation({
    mutationFn: () =>
      api.patch('/auth/me', {
        display_name: displayName.trim(),
        date_of_birth: dob || null,
        gender: gender.trim() || null,
        pronouns: pronouns.trim() || null,
      }),
    onSuccess: () => {
      setError('');
      setSaved(true);
      setTimeout(() => setSaved(false), 2500);
      updateAccount({ display_name: displayName.trim() });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to save'),
  });

  const avatarMutation = useMutation({
    mutationFn: (file: File) => {
      const form = new FormData();
      form.append('avatar', file);
      return api.upload<{ avatar_url: string }>('/auth/me/avatar', form);
    },
    onSuccess: (res) => {
      updateAccount({ avatar_url: res.avatar_url });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
      if (fileInput.current) fileInput.current.value = '';
    },
  });

  const removeAvatarMutation = useMutation({
    mutationFn: () => api.delete('/auth/me/avatar'),
    onSuccess: () => {
      updateAccount({ avatar_url: null });
      void queryClient.invalidateQueries({ queryKey: ['me'] });
    },
  });

  if (!account) return null;

  return (
    <div className="max-w-2xl space-y-6">
      <div>
        <h1 className="text-xl font-semibold text-ink">Profile</h1>
        <p className="text-sm text-muted">Your personal details and how you relate to the people in your circles.</p>
      </div>

      <div className="card space-y-4">
        <div className="flex items-center gap-4">
          <Avatar
            accountId={account.id}
            name={account.display_name}
            avatarUrl={me?.avatar_url ?? account.avatar_url}
            size={72}
          />
          <div className="space-y-2">
            <input
              ref={fileInput}
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) avatarMutation.mutate(f);
              }}
            />
            <div className="flex gap-2">
              <Button size="sm" variant="secondary" onClick={() => fileInput.current?.click()} loading={avatarMutation.isPending}>
                {me?.avatar_url ? 'Change photo' : 'Upload photo'}
              </Button>
              {me?.avatar_url ? (
                <Button size="sm" variant="ghost" onClick={() => removeAvatarMutation.mutate()} loading={removeAvatarMutation.isPending}>
                  Remove
                </Button>
              ) : null}
            </div>
            <p className="text-xs text-muted">JPG or PNG, up to 5 MB.</p>
          </div>
        </div>

        <form
          className="space-y-4"
          onSubmit={(e) => {
            e.preventDefault();
            saveMutation.mutate();
          }}
        >
          <Input label="Display name" value={displayName} onChange={(e) => setDisplayName(e.target.value)} required />
          <div className="grid gap-4 sm:grid-cols-3">
            <Input label="Birthday" type="date" value={dob} onChange={(e) => setDob(e.target.value)} />
            <div>
              <label htmlFor="gender" className="block text-sm font-medium text-ink mb-1">Gender</label>
              <input
                id="gender"
                list="gender-options"
                className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm placeholder-muted shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                value={gender}
                onChange={(e) => setGender(e.target.value)}
                placeholder="e.g. Female"
              />
              <datalist id="gender-options">
                <option value="Female" />
                <option value="Male" />
                <option value="Non-binary" />
                <option value="Prefer not to say" />
              </datalist>
            </div>
            <div>
              <label htmlFor="pronouns" className="block text-sm font-medium text-ink mb-1">Pronouns</label>
              <input
                id="pronouns"
                list="pronoun-options"
                className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm placeholder-muted shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
                value={pronouns}
                onChange={(e) => setPronouns(e.target.value)}
                placeholder="e.g. she/her"
              />
              <datalist id="pronoun-options">
                <option value="she/her" />
                <option value="he/him" />
                <option value="they/them" />
              </datalist>
            </div>
          </div>
          {error ? <p className="text-sm text-red-600">{error}</p> : null}
          <div className="flex items-center gap-3">
            <Button type="submit" loading={saveMutation.isPending}>Save profile</Button>
            {saved ? <span className="text-sm text-primary">Saved ✓</span> : null}
          </div>
        </form>
      </div>

      <RelationshipsCard />
    </div>
  );
}

function RelationshipsCard() {
  const { account } = useAuthStore();
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ['relationships'],
    queryFn: () => api.get<{ relationships: Relationship[] }>('/account/relationships'),
  });
  const relationships = data?.relationships ?? [];

  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/account/relationships/${id}`),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['relationships'] }),
  });

  if (!account) return null;

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="text-base font-semibold text-ink">Relationships</h2>
        <p className="text-sm text-muted">Record who people are to you, so everyone can see how the circle fits together.</p>
      </div>

      {relationships.length > 0 ? (
        <RelationshipMap me={account.display_name} meId={account.id} meAvatar={account.avatar_url} relationships={relationships} />
      ) : null}

      <ul className="divide-y divide-border -my-1">
        {relationships.length === 0 ? (
          <li className="py-3 text-sm text-muted">No relationships yet. Add someone below.</li>
        ) : (
          relationships.map((r) => (
            <li key={r.id} className="py-3 flex items-center gap-3">
              <Avatar accountId={r.account_id} name={r.display_name} avatarUrl={r.avatar_url} size={36} />
              <div className="flex-1 min-w-0">
                <div className="text-sm text-ink font-medium truncate">{r.display_name}</div>
                <div className="text-xs text-muted">your {r.relationship}</div>
              </div>
              <button
                type="button"
                className="text-xs text-muted hover:text-red-600"
                onClick={() => removeMutation.mutate(r.id)}
              >
                Remove
              </button>
            </li>
          ))
        )}
      </ul>

      <AddRelationship />
    </div>
  );
}

function AddRelationship() {
  const queryClient = useQueryClient();
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<{ id: string; display_name: string } | null>(null);
  const [relationship, setRelationship] = useState('');
  const [error, setError] = useState('');

  const { data } = useQuery({
    queryKey: ['people-search', query],
    queryFn: () => api.get<{ people: { id: string; display_name: string; email: string }[] }>(`/account/people/search?q=${encodeURIComponent(query)}`),
    enabled: query.trim().length >= 2 && !selected,
  });
  const results = data?.people ?? [];

  const addMutation = useMutation({
    mutationFn: () => api.post('/account/relationships', { to_account_id: selected!.id, relationship: relationship.trim() }),
    onSuccess: () => {
      setQuery('');
      setSelected(null);
      setRelationship('');
      setError('');
      void queryClient.invalidateQueries({ queryKey: ['relationships'] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Failed to add'),
  });

  return (
    <div className="border-t border-border pt-4 space-y-2">
      <span className="block text-sm font-medium text-ink">Add a relationship</span>
      {selected ? (
        <div className="flex flex-wrap items-end gap-2">
          <div className="flex-1 min-w-[10rem]">
            <span className="block text-xs text-muted mb-1">Person</span>
            <div className="flex items-center gap-2 rounded-md border border-border px-3 py-2 text-sm">
              <span className="flex-1 truncate">{selected.display_name}</span>
              <button type="button" className="text-xs text-muted hover:text-ink" onClick={() => setSelected(null)}>change</button>
            </div>
          </div>
          <div className="flex-1 min-w-[10rem]">
            <label htmlFor="rel" className="block text-xs text-muted mb-1">is my…</label>
            <input
              id="rel"
              list="relationship-options"
              className="block w-full rounded-md border border-border bg-card px-3 py-2 text-sm placeholder-muted shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary"
              value={relationship}
              onChange={(e) => setRelationship(e.target.value)}
              placeholder="e.g. brother"
            />
            <datalist id="relationship-options">
              {RELATIONSHIP_SUGGESTIONS.map((r) => (
                <option key={r} value={r} />
              ))}
            </datalist>
          </div>
          <Button size="sm" onClick={() => addMutation.mutate()} loading={addMutation.isPending} disabled={!relationship.trim()}>
            Add
          </Button>
        </div>
      ) : (
        <div className="relative">
          <Input
            aria-label="Search people"
            placeholder="Search people by name or email…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
          {query.trim().length >= 2 && results.length > 0 ? (
            <ul className="absolute z-10 mt-1 w-full rounded-md border border-border bg-card shadow-lg max-h-56 overflow-auto">
              {results.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="w-full text-left px-3 py-2 text-sm hover:bg-surface-2"
                    onClick={() => {
                      setSelected({ id: p.id, display_name: p.display_name });
                      setQuery(p.display_name);
                    }}
                  >
                    <span className="text-ink">{p.display_name}</span>{' '}
                    <span className="text-xs text-muted">{p.email}</span>
                  </button>
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      )}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}
    </div>
  );
}

/** Compact radial diagram: you in the centre, related people around you. */
function RelationshipMap({
  me,
  meId,
  meAvatar,
  relationships,
}: {
  me: string;
  meId: string;
  meAvatar?: string | null;
  relationships: Relationship[];
}) {
  const width = 320;
  const height = 220;
  const cx = width / 2;
  const cy = height / 2;
  const radius = 78;
  const n = relationships.length;

  return (
    <div className="overflow-x-auto">
      <svg width={width} height={height} className="mx-auto" role="img" aria-label="Relationship map">
        {relationships.map((r, i) => {
          const angle = (i / Math.max(n, 1)) * 2 * Math.PI - Math.PI / 2;
          const x = cx + radius * Math.cos(angle);
          const y = cy + radius * Math.sin(angle);
          return <line key={r.id} x1={cx} y1={cy} x2={x} y2={y} stroke="var(--c-border)" strokeWidth={1.5} />;
        })}
        {/* centre = me */}
        <foreignObject x={cx - 26} y={cy - 26} width={52} height={52}>
          <div className="flex items-center justify-center h-full">
            <Avatar accountId={meId} name={me} avatarUrl={meAvatar} size={48} />
          </div>
        </foreignObject>
        {relationships.map((r, i) => {
          const angle = (i / Math.max(n, 1)) * 2 * Math.PI - Math.PI / 2;
          const x = cx + radius * Math.cos(angle);
          const y = cy + radius * Math.sin(angle);
          return (
            <g key={r.id}>
              <foreignObject x={x - 18} y={y - 18} width={36} height={36}>
                <div className="flex items-center justify-center h-full">
                  <Avatar accountId={r.account_id} name={r.display_name} avatarUrl={r.avatar_url} size={34} />
                </div>
              </foreignObject>
              <text x={x} y={y + 30} textAnchor="middle" className="fill-current text-muted" style={{ fontSize: 10 }}>
                {r.relationship}
              </text>
            </g>
          );
        })}
      </svg>
    </div>
  );
}
