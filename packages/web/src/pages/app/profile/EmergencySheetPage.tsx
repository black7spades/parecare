import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { EditableSubheader } from '../../../components/ui/EditableSubheader';
import { Modal } from '../../../components/ui/Modal';
import { PagePurpose } from '../../../components/PagePurpose';
import { AllergyModal } from '../../../components/AllergyModal';
import { SetPoaForm } from '../../../components/SetPoaForm';
import { IdentifiersForm } from '../../../components/IdentifiersForm';
import { ShareLinkBox, type ShareLink } from '../../../components/ShareLinkBox';
import { EmergencySheetView, type EmergencySheet, type SheetAdd } from '../../../components/EmergencySheetView';
import { ConditionModal, EmergencyContactModal, GpModal, MedicationModal } from '../../../components/QuickAddModals';
import { useProfile } from './ProfileLayout';
import { keepOffline, sheetStoreKey } from '../../../lib/offline';

type SheetModal = 'ids' | 'allergy' | 'contact' | 'poa' | 'condition' | 'medication' | 'gp' | 'share' | null;

/** Where the copy kept on this phone lives, and whether one was ever saved. */
const storeKey = sheetStoreKey;
interface Kept {
  saved_at: string;
  sheet: EmergencySheet;
}
function readKept(id: string): Kept | null {
  try {
    const raw = window.localStorage.getItem(storeKey(id));
    return raw ? (JSON.parse(raw) as Kept) : null;
  } catch {
    return null;
  }
}
function writeKept(id: string, sheet: EmergencySheet): boolean {
  try {
    window.localStorage.setItem(storeKey(id), JSON.stringify({ saved_at: new Date().toISOString(), sheet }));
    return true;
  } catch {
    return false;
  }
}

export function EmergencySheetPage() {
  const { profile, canEdit } = useProfile();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [modal, setModal] = useState<SheetModal>(null);
  const [savedNote, setSavedNote] = useState('');
  const [error, setError] = useState('');

  const { data, isLoading, isError } = useQuery({
    queryKey: ['emergency-sheet', profile.id],
    // offline_saved_at is set only on the copy kept on this phone, served with no signal.
    queryFn: () => api.get<{ sheet: EmergencySheet; link: ShareLink | null; offline_saved_at?: string }>(`/care-profiles/${profile.id}/emergency-sheet`),
  });
  const refresh = () => void queryClient.invalidateQueries({ queryKey: ['emergency-sheet', profile.id] });
  const closeModal = () => {
    setModal(null);
    refresh();
  };

  // A copy kept on this phone stays up to date each time the sheet opens.
  const kept = readKept(profile.id);
  const keepNow = (sheetData: NonNullable<typeof data>) => {
    writeKept(profile.id, sheetData.sheet);
    keepOffline([
      { url: `/care-profiles/${profile.id}/emergency-sheet`, body: { sheet: sheetData.sheet, link: null } },
      { url: `/care-profiles/${profile.id}`, body: queryClient.getQueryData(['care-profile', profile.id]) },
    ]);
  };
  useEffect(() => {
    if (data?.sheet && !data.offline_saved_at && readKept(profile.id)) keepNow(data);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data, profile.id]);
  // With no signal: the kept copy, from the offline helper or from this browser.
  const servedKept = data?.offline_saved_at ?? null;
  const fallback = isError && !data && kept ? kept : null;
  const offlineAt = servedKept ?? fallback?.saved_at ?? null;
  const offline = !!offlineAt;
  const sheet = data?.sheet ?? fallback?.sheet ?? null;

  const confirmNone = useMutation({
    mutationFn: () => api.post(`/care-profiles/${profile.id}/allergies/none`, {}),
    onSuccess: () => {
      setError('');
      refresh();
      void queryClient.invalidateQueries({ queryKey: ['allergies', profile.id] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'That could not be saved. Try again in a moment.'),
  });

  const onAdd = (what: SheetAdd) => {
    if (what === 'no_allergies') confirmNone.mutate();
    else if (what === 'needs' || what === 'directive') navigate(`/app/${profile.id}/care-needs`);
    else setModal(what);
  };

  const saveOnPhone = () => {
    if (!data?.sheet || offline) {
      setSavedNote('There is no connection, so the copy already on this phone is the one shown.');
      return;
    }
    if (!writeKept(profile.id, data.sheet)) {
      setSavedNote('This browser would not keep a copy. Print the sheet instead, or try another browser.');
      return;
    }
    keepNow(data);
    setSavedNote('Saved on this phone. It opens without internet until you log out.');
  };

  return (
    <div>
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <div className="flex items-center gap-2">
          <EditableSubheader copyKey="profile.emergency.subheader" />
          <PagePurpose kind="output" />
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button onClick={() => window.print()}>Print</Button>
          {canEdit ? (
            <Button variant="secondary" onClick={() => setModal('share')}>
              Share a link
            </Button>
          ) : null}
          <Button variant="secondary" onClick={saveOnPhone}>
            Save on this phone
          </Button>
        </div>
      </div>
      {savedNote ? <p className="mb-3 text-sm text-ink print:hidden" role="status">{savedNote}</p> : null}
      {error ? <p className="mb-3 text-sm text-red-600 print:hidden" role="alert">{error}</p> : null}
      {offline ? (
        <p className="mb-3 rounded-md border-l-4 border-l-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/10 dark:text-amber-200 print:hidden" role="status">
          No connection. This is the copy saved on this phone on {format(new Date(offlineAt!), 'd MMM yyyy, HH:mm')}. It may be out of date.
        </p>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-muted">Putting the sheet together.</p>
      ) : !sheet ? (
        <p className="text-sm text-red-600" role="alert">
          The sheet could not be loaded just now. Check the connection and try again. Once it opens, Save on this phone keeps a copy for next time.
        </p>
      ) : (
        <EmergencySheetView
          sheet={sheet}
          editing={canEdit && !offline ? { onAdd, pending: confirmNone.isPending ? 'no_allergies' : null } : undefined}
          documentHref={(docId) => `/app/${profile.id}/documents?doc=${docId}`}
          onChangeContact={() => setModal('contact')}
        />
      )}

      <Modal open={modal === 'ids'} onClose={closeModal} title="ID numbers" wide>
        <IdentifiersForm profileId={profile.id} canEdit={canEdit} onSaved={closeModal} />
      </Modal>
      <AllergyModal profileId={profile.id} open={modal === 'allergy'} onClose={closeModal} />
      <EmergencyContactModal profileId={profile.id} open={modal === 'contact'} onClose={closeModal} ownerRelationship={profile.owner_relationship ?? null} />
      <ConditionModal profileId={profile.id} open={modal === 'condition'} onClose={closeModal} />
      <MedicationModal profileId={profile.id} open={modal === 'medication'} onClose={closeModal} />
      <GpModal profileId={profile.id} open={modal === 'gp'} onClose={closeModal} />
      <Modal open={modal === 'poa'} onClose={closeModal} title="Name a power of attorney holder" wide>
        <SetPoaForm profileId={profile.id} onSaved={closeModal} />
      </Modal>
      {modal === 'share' ? <ShareSheetModal profileId={profile.id} link={data?.link ?? null} onClose={closeModal} /> : null}
    </div>
  );
}

/**
 * Share the emergency sheet: one link that opens with no login and keeps
 * working until it is turned off. Opening the modal makes the link if there
 * is none yet.
 */
function ShareSheetModal({ profileId, link, onClose }: { profileId: string; link: ShareLink | null; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [current, setCurrent] = useState<ShareLink | null>(link);
  const [error, setError] = useState('');
  const [offNote, setOffNote] = useState('');
  const make = useMutation({
    mutationFn: () => api.post<{ link: ShareLink }>(`/care-profiles/${profileId}/share-links`, { kind: 'emergency_sheet' }),
    onSuccess: (res) => {
      setCurrent(res.link);
      setOffNote('');
      setError('');
      void queryClient.invalidateQueries({ queryKey: ['emergency-sheet', profileId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The link could not be made just now. Try again in a moment.'),
  });
  const [lastOff, setLastOff] = useState<ShareLink | null>(null);
  const turnOff = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profileId}/share-links/${id}`),
    onSuccess: () => {
      setLastOff(current);
      setCurrent(null);
      setOffNote('Turned off. Anyone with the old link now sees that it is turned off.');
      void queryClient.invalidateQueries({ queryKey: ['emergency-sheet', profileId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The link could not be turned off just now. Try again in a moment.'),
  });
  // Turning off is never one click from lost: Undo brings the same link back.
  const undoOff = useMutation({
    mutationFn: (id: string) => api.post<{ link: ShareLink }>(`/care-profiles/${profileId}/share-links/${id}/restore`, {}),
    onSuccess: (res) => {
      setCurrent(res.link);
      setLastOff(null);
      setOffNote('');
      void queryClient.invalidateQueries({ queryKey: ['emergency-sheet', profileId] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The link could not be turned back on just now. Try again in a moment.'),
  });
  const asked = useRef(false);
  useEffect(() => {
    if (asked.current) return;
    asked.current = true;
    if (!link) make.mutate();
    // Only on opening.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <Modal open onClose={onClose} title="Share the emergency sheet">
      <div className="space-y-4">
        <p className="text-sm text-ink">Anyone with the link sees this sheet without logging in. It keeps working until you turn it off.</p>
        {current ? (
          <>
            <ShareLinkBox url={current.url} />
            <p className="text-xs text-muted">
              {current.open_count === 0
                ? 'Not opened yet.'
                : `Opened ${current.open_count} ${current.open_count === 1 ? 'time' : 'times'}${current.last_opened_at ? `, last on ${format(new Date(current.last_opened_at), 'd MMM yyyy')}` : ''}.`}
            </p>
          </>
        ) : make.isPending ? (
          <p className="text-sm text-muted">Making the link.</p>
        ) : null}
        {offNote ? (
          <p className="text-sm text-ink flex flex-wrap items-center gap-2" role="status">
            {offNote}
            {lastOff ? (
              <Button size="xs" variant="ghost" loading={undoOff.isPending} onClick={() => undoOff.mutate(lastOff.id)}>
                Undo
              </Button>
            ) : null}
          </p>
        ) : null}
        {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
        <div className="flex flex-wrap justify-end gap-2">
          {current ? (
            <Button variant="ghost-danger" loading={turnOff.isPending} onClick={() => turnOff.mutate(current.id)}>
              Turn off
            </Button>
          ) : (
            <Button variant="secondary" loading={make.isPending} onClick={() => make.mutate()}>
              Make a new link
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Close
          </Button>
        </div>
      </div>
    </Modal>
  );
}
