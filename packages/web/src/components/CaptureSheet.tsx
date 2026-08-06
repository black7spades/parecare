import { useRef, useState } from 'react';
import { useMatch } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { IngestModal } from './IngestModal';
import { submitNote } from '../lib/captureQueue';
import { announce } from '../lib/announce';
import { buzz } from '../lib/haptics';

/**
 * Capture anywhere: one control in thumb reach on a phone that opens a sheet
 * with two ways in, each with a typed equivalent. Write a note (the phone's own
 * microphone dictates straight into it, so speaking needs no separate service),
 * or take a photo, which goes through the same review flow as an uploaded
 * document. Everything lands against the person on screen, or asks which person
 * once when there is no current one.
 *
 * A note saved with no connection is kept on the device and sent on reconnect,
 * confirmed both in a line here and to a screen reader, with a short buzz.
 */
interface ProfileLite {
  id: string;
  full_name: string;
  preferred_name: string | null;
}

function PlusIcon() {
  return (
    <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" aria-hidden>
      <line x1="12" y1="5" x2="12" y2="19" />
      <line x1="5" y1="12" x2="19" y2="12" />
    </svg>
  );
}

const selectClass = 'w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

export function CaptureSheet() {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState('');
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState('');
  const [chosenProfile, setChosenProfile] = useState('');
  const [photoFile, setPhotoFile] = useState<File | null>(null);
  const [ingestProfile, setIngestProfile] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const match = useMatch('/app/:profileId/*');
  const routeProfileId = match?.params['profileId'];

  const { data } = useQuery({
    queryKey: ['care-profiles-summary'],
    queryFn: () => api.get<{ profiles: ProfileLite[] }>('/care-profiles/summary'),
    enabled: open,
  });
  const profiles = data?.profiles ?? [];
  // The route id counts only when it is really one of this person's profiles,
  // never a top-level section like Directory or Reports.
  const currentId = routeProfileId && profiles.some((p) => p.id === routeProfileId) ? routeProfileId : '';
  const soleId = profiles.length === 1 ? profiles[0]!.id : '';
  const effectiveId = currentId || chosenProfile || soleId;
  const needsPerson = !effectiveId && profiles.length > 1;

  const nameOf = (id: string) => {
    const p = profiles.find((x) => x.id === id);
    return p ? p.preferred_name || p.full_name : 'this person';
  };

  const close = () => {
    setOpen(false);
    setBody('');
    setNotice('');
    setChosenProfile('');
  };

  const saveNote = async () => {
    if (!effectiveId || !body.trim()) return;
    setSaving(true);
    setNotice('');
    try {
      const result = await submitNote({
        client_key: crypto.randomUUID(),
        profile_id: effectiveId,
        entry_type: 'observation',
        body: body.trim(),
        occurred_at: new Date().toISOString(),
      });
      buzz();
      if (result === 'sent') {
        announce('Note saved.');
        close();
      } else {
        const msg = 'Saved on this device. It will send when you are back online.';
        announce(msg);
        setNotice(msg);
        setBody('');
        window.setTimeout(close, 2600);
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : 'The note could not be saved.';
      announce(msg);
      setNotice(msg);
    } finally {
      setSaving(false);
    }
  };

  const onPhotoChosen = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    e.target.value = '';
    if (!f) return;
    if (!effectiveId) {
      setNotice('Choose who this is for first.');
      return;
    }
    setPhotoFile(f);
    setIngestProfile(effectiveId);
    setOpen(false);
  };

  return (
    <>
      <button
        type="button"
        aria-label="Add to the care log"
        onClick={() => setOpen(true)}
        className="md:hidden fixed bottom-4 left-4 z-40 h-14 w-14 rounded-full bg-primary text-white shadow-lg flex items-center justify-center active:scale-95 transition-transform"
        style={{ marginBottom: 'env(safe-area-inset-bottom)' }}
      >
        <PlusIcon />
      </button>

      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        className="hidden"
        onChange={onPhotoChosen}
      />

      <Modal open={open} onClose={close} title="Add to the care log">
        <div className="space-y-4">
          {needsPerson ? (
            <div>
              <label htmlFor="cap-person" className="block text-sm font-medium text-ink mb-1">Who is this about?</label>
              <select id="cap-person" className={selectClass} value={chosenProfile} onChange={(e) => setChosenProfile(e.target.value)}>
                <option value="">Choose a person</option>
                {profiles.map((p) => (
                  <option key={p.id} value={p.id}>{p.preferred_name || p.full_name}</option>
                ))}
              </select>
            </div>
          ) : effectiveId ? (
            <p className="text-sm text-muted">For {nameOf(effectiveId)}.</p>
          ) : null}

          <div>
            <label htmlFor="cap-note" className="block text-sm font-medium text-ink mb-1">Write a note</label>
            <textarea
              id="cap-note"
              autoFocus
              rows={4}
              value={body}
              onChange={(e) => setBody(e.target.value)}
              placeholder="What happened? Your phone's microphone works here too."
              className={selectClass}
            />
          </div>

          {notice ? <p className="text-sm text-primary" role="status">{notice}</p> : null}

          <div className="flex items-center gap-2">
            <Button variant="secondary" onClick={() => fileInputRef.current?.click()}>Take a photo</Button>
            <span className="ml-auto flex gap-2">
              <Button variant="ghost" onClick={close}>Cancel</Button>
              <Button loading={saving} disabled={!effectiveId || !body.trim()} onClick={saveNote}>Save note</Button>
            </span>
          </div>
        </div>
      </Modal>

      {photoFile && ingestProfile ? (
        <IngestModal
          profileId={ingestProfile}
          initialFile={photoFile}
          title="Take a photo and file with Pare"
          onClose={() => {
            setPhotoFile(null);
            setIngestProfile(null);
          }}
        />
      ) : null}
    </>
  );
}
