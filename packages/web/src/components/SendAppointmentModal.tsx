import { useState } from 'react';
import { useMutation } from '@tanstack/react-query';
import { api, ApiError } from '../api/client';
import { Button } from './ui/Button';
import { Modal } from './ui/Modal';
import { ShareLinkBox } from './ShareLinkBox';
import { SendDone, SendToPicker, emptySendTo, sendToMissing, sendToPayload, useSendOptions, type SendResult, type SendToValue } from './SendTo';
import { usePickablePeople } from './PersonPicker';
import { personKey } from '../lib/care';

/**
 * Send one appointment to someone, such as whoever is driving: the time, the
 * place, the contact's phone, what to bring and how to get ready, with the
 * calendar entry attached. Notes stay private.
 */
export function SendAppointmentModal({
  profileId,
  appointmentId,
  title,
  driver,
  onClose,
}: {
  profileId: string;
  appointmentId: string;
  title: string;
  /** Whoever is driving, picked first when there is one. */
  driver?: { circle_member_id: string | null; account_id: string | null } | null;
  onClose: () => void;
}) {
  const opts = useSendOptions(profileId);
  const { data: peopleData } = usePickablePeople(profileId);
  const driverKey = driver?.circle_member_id ? `m:${driver.circle_member_id}` : driver?.account_id ? `a:${driver.account_id}` : '';
  const known = (peopleData?.people ?? []).some((p) => personKey(p.ref) === driverKey);
  const [to, setTo] = useState<SendToValue | null>(null);
  const value = to ?? (known ? { ...emptySendTo, key: driverKey } : emptySendTo);
  const [missing, setMissing] = useState('');
  const [done, setDone] = useState<SendResult | null>(null);
  const [failed, setFailed] = useState<{ message: string; url: string | null } | null>(null);

  const send = useMutation({
    mutationFn: () => api.post<SendResult>(`/care-profiles/${profileId}/appointments/${appointmentId}/send`, { to: sendToPayload(value) }),
    onSuccess: (res) => {
      setDone(res);
      setFailed(null);
    },
    onError: (err) => {
      const data = err instanceof ApiError ? (err.data as { link?: { url: string } } | undefined) : undefined;
      setFailed({ message: err instanceof Error ? err.message : 'It could not be sent just now. Try again in a moment.', url: data?.link?.url ?? null });
    },
  });

  return (
    <Modal open onClose={onClose} title={`Send ${title}`}>
      <div className="space-y-4">
        <p className="text-sm text-ink">Sends the time, place, phone and what to bring. Notes stay private.</p>
        {done ? (
          <>
            <SendDone result={done} what="the appointment" />
            <div className="flex justify-end">
              <Button onClick={onClose}>Done</Button>
            </div>
          </>
        ) : (
          <>
            <SendToPicker id={`appt-send-${appointmentId}`} profileId={profileId} value={value} onChange={(v) => { setTo(v); setMissing(''); }} />
            {failed ? (
              <div className="space-y-2">
                <p className="text-sm text-red-600" role="alert">{failed.message}</p>
                {failed.url ? <ShareLinkBox url={failed.url} primary={false} /> : null}
              </div>
            ) : null}
            <div className="flex flex-wrap items-center justify-end gap-3">
              {missing ? <p className="text-sm text-red-600" role="alert">{missing}</p> : null}
              <Button variant="ghost" onClick={onClose}>Cancel</Button>
              <Button
                loading={send.isPending}
                onClick={() => {
                  // Send always answers: say what is missing.
                  const need = sendToMissing(value, opts);
                  if (need) {
                    setMissing(need);
                    return;
                  }
                  setMissing('');
                  send.mutate();
                }}
              >
                Send
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

/** Download one appointment as a calendar file, to add to someone's own calendar. */
export async function downloadAppointmentIcs(profileId: string, appointmentId: string, title: string): Promise<void> {
  const blob = await api.blob(`/care-profiles/${profileId}/appointments/${appointmentId}/calendar.ics`);
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `${title.replace(/[^\w -]+/g, '').trim().replace(/\s+/g, '-').toLowerCase() || 'appointment'}.ics`;
  a.click();
  URL.revokeObjectURL(url);
}
