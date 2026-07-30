import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { AttentionPanel } from '../../../components/AttentionPanel';
import { CardLayout } from '../../../components/cards/CardLayout';
import { PROFILE_CARDS, PROFILE_CARD_KEYS } from '../../../components/cards/registry';
import { useProfile } from './ProfileLayout';
import { useAuthStore } from '../../../stores/auth';

/**
 * Somebody's overview: what needs attention, then a set of cards.
 *
 * This screen no longer knows what is in any of those cards. It arranges
 * them, remembers how somebody left them, and gets out of the way. Which
 * cards there are, and what each one contains, belongs to the cards
 * themselves, so the set can later be worked out from the record instead of
 * being written down here.
 */

/**
 * How this browser remembers the arrangement of somebody's overview.
 *
 * Scoped to the person signed in and the person they are looking at. Without
 * that, arranging one mother's overview rearranged everybody else's, and two
 * people sharing a machine quietly overwrote each other's work.
 */
const orderKeyFor = (accountId: string, profileId: string) => `parecare-overview-order:${accountId}:${profileId}`;
const collapsedKeyFor = (accountId: string, profileId: string) => `parecare-overview-collapsed:${accountId}:${profileId}`;

function loadCardOrder(storageKey: string): string[] {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) {
      const parsed = JSON.parse(raw) as string[];
      const valid = parsed.filter((k) => PROFILE_CARD_KEYS.includes(k));
      const missing = PROFILE_CARD_KEYS.filter((k) => !valid.includes(k));
      return [...valid, ...missing];
    }
  } catch { /* ignore */ }
  return [...PROFILE_CARD_KEYS];
}

function loadCollapsed(storageKey: string): Set<string> {
  try {
    const raw = localStorage.getItem(storageKey);
    if (raw) return new Set(JSON.parse(raw) as string[]);
  } catch { /* ignore */ }
  return new Set();
}

export function OverviewPage() {
  const { profile, isOwner, canEdit, access } = useProfile();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const accountId = useAuthStore((s) => s.account?.id) ?? 'anon';
  const orderKey = orderKeyFor(accountId, profile.id);
  const collapsedKey = collapsedKeyFor(accountId, profile.id);
  const [archiveOpen, setArchiveOpen] = useState(false);
  const [editView, setEditView] = useState(false);
  const [cardOrder, setCardOrder] = useState<string[]>(() => loadCardOrder(orderKey));
  const [collapsed, setCollapsed] = useState<Set<string>>(() => loadCollapsed(collapsedKey));

  // Moving from one person to another keeps this component mounted, so the
  // arrangement has to be re-read or the previous person's stays on screen.
  useEffect(() => {
    setCardOrder(loadCardOrder(orderKey));
    setCollapsed(loadCollapsed(collapsedKey));
  }, [orderKey, collapsedKey]);

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

  const careName = profile.preferred_name ?? profile.full_name;
  const nameMatches = confirmText.trim().toLowerCase() === profile.full_name.trim().toLowerCase();
  const closeArchive = () => {
    setArchiveOpen(false);
    setConfirmText('');
    setDeleteError('');
  };

  const cardContext = { profileId: profile.id, profile, access, isOwner, canEdit, careName };
  // Only the cards this person actually has count towards folding everything
  // away, or the control points the wrong way on a pet and for a visitor.
  const presentKeys = PROFILE_CARDS.filter((c) => c.shows?.(cardContext) ?? true).map((c) => c.key);

  const toggleCollapse = useCallback((key: string) => {
    setCollapsed((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      localStorage.setItem(collapsedKey, JSON.stringify([...next]));
      return next;
    });
  }, [collapsedKey]);

  // The header control folds or unfolds every card at once.
  const allCollapsed = presentKeys.every((k) => collapsed.has(k));
  const toggleAllCollapsed = useCallback(() => {
    setCollapsed((prev) => {
      const next = presentKeys.every((k) => prev.has(k)) ? new Set<string>() : new Set(presentKeys);
      localStorage.setItem(collapsedKey, JSON.stringify([...next]));
      return next;
    });
  }, [collapsedKey, presentKeys]);

  const moveCard = useCallback((key: string, dir: -1 | 1) => {
    setCardOrder((prev) => {
      const idx = prev.indexOf(key);
      const target = idx + dir;
      if (target < 0 || target >= prev.length) return prev;
      const next = [...prev];
      [next[idx], next[target]] = [next[target], next[idx]];
      localStorage.setItem(orderKey, JSON.stringify(next));
      return next;
    });
  }, [orderKey]);

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

      <CardLayout
        cards={PROFILE_CARDS}
        ctx={cardContext}
        order={cardOrder}
        collapsed={collapsed}
        editView={editView}
        onToggle={toggleCollapse}
        onMove={moveCard}
      />

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
