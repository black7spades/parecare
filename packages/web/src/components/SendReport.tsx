import { useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { format } from '../lib/dateFormat';
import { api, ApiError } from '../api/client';
import { Button } from './ui/Button';
import { ShareLinkBox } from './ShareLinkBox';
import { SendDone, SendToPicker, emptySendTo, sendToMissing, sendToPayload, useSendOptions, type SendResult, type SendToValue } from './SendTo';
import type { CareDocument } from '../lib/care';

/**
 * Send one person's report to someone, such as a specialist's rooms, with
 * documents to go with it: a referral, a letter. They get an email with a
 * link that opens with no login for 30 days. Documents shared only with some
 * roles are never offered.
 */
export function SendReportCard({
  profileIds,
  profileName,
  reportName,
  sections,
  dateRange,
  narrative,
}: {
  profileIds: string[];
  profileName: string | null;
  reportName: string;
  sections: Array<{ key: string; fields: string[]; filters: Record<string, unknown> }>;
  dateRange: { from: string; to: string } | null;
  narrative: string | null;
}) {
  const profileId = profileIds.length === 1 ? profileIds[0]! : null;
  if (!profileId) {
    return (
      <div className="card print:hidden">
        <h3 className="text-sm font-semibold text-ink mb-1">Send to</h3>
        <p className="text-sm text-muted">A report is sent for one person at a time. Go back to the builder and tick one person to send theirs.</p>
      </div>
    );
  }
  return <SendReportForm key={profileId} profileId={profileId} profileName={profileName} reportName={reportName} sections={sections} dateRange={dateRange} narrative={narrative} />;
}

function SendReportForm({
  profileId,
  profileName,
  reportName,
  sections,
  dateRange,
  narrative,
}: {
  profileId: string;
  profileName: string | null;
  reportName: string;
  sections: Array<{ key: string; fields: string[]; filters: Record<string, unknown> }>;
  dateRange: { from: string; to: string } | null;
  narrative: string | null;
}) {
  const opts = useSendOptions(profileId);
  const [to, setTo] = useState<SendToValue>(emptySendTo);
  const [docIds, setDocIds] = useState<string[]>([]);
  const [missing, setMissing] = useState('');
  const [done, setDone] = useState<SendResult | null>(null);
  const [failed, setFailed] = useState<{ message: string; url: string | null } | null>(null);

  const { data: docData } = useQuery({
    queryKey: ['documents', profileId],
    queryFn: () => api.get<{ documents: CareDocument[] }>(`/care-profiles/${profileId}/documents`),
  });
  // Only what the whole circle may see goes outside it.
  const docs = (docData?.documents ?? []).filter((d) => !(d.visible_to_roles ?? []).length);
  const held = (docData?.documents ?? []).length - docs.length;

  const send = useMutation({
    mutationFn: () =>
      api.post<SendResult>('/reports/send', {
        profile_id: profileId,
        report: { name: profileName ? `${reportName}` : reportName, sections, dateRange, narrative },
        to: sendToPayload(to),
        document_ids: docIds,
      }),
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
    <div className="card space-y-3 print:hidden">
      <div>
        <h3 className="text-sm font-semibold text-ink">Send to</h3>
        <p className="text-xs text-muted">
          {profileName ? `${profileName}'s report` : 'This report'} goes as a link that opens without logging in, for 30 days.
        </p>
      </div>
      {done ? (
        <>
          <SendDone result={done} what="the report" />
          <Button size="sm" variant="ghost" onClick={() => { setDone(null); setTo(emptySendTo); setDocIds([]); }}>
            Send to someone else
          </Button>
        </>
      ) : (
        <>
          <SendToPicker id={`report-send-${profileId}`} profileId={profileId} value={to} onChange={(v) => { setTo(v); setMissing(''); }} />
          <fieldset>
            <legend className="text-sm font-medium text-ink mb-1">Also send</legend>
            {docs.length === 0 ? (
              <p className="text-xs text-muted">No documents on file to send with it.</p>
            ) : (
              <ul className="space-y-1">
                {docs.map((d) => (
                  <li key={d.id}>
                    <label className="flex items-center gap-2 text-sm text-ink">
                      <input
                        type="checkbox"
                        className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                        checked={docIds.includes(d.id)}
                        onChange={(e) => setDocIds((ids) => (e.target.checked ? [...ids, d.id] : ids.filter((x) => x !== d.id)))}
                      />
                      <span>{d.label}</span>
                      {d.category_name ? <span className="text-xs text-muted">{d.category_name}</span> : null}
                      <span className="text-xs text-muted">{format(new Date(d.created_at), 'd MMM yyyy')}</span>
                    </label>
                  </li>
                ))}
              </ul>
            )}
            {held > 0 ? (
              <p className="mt-1 text-xs text-muted">
                {held === 1 ? 'One document is' : `${held} documents are`} shared only with some people in the circle, so {held === 1 ? 'it is' : 'they are'} not offered here.
              </p>
            ) : null}
          </fieldset>
          {failed ? (
            <div className="space-y-2">
              <p className="text-sm text-red-600" role="alert">{failed.message}</p>
              {failed.url ? <ShareLinkBox url={failed.url} primary={false} /> : null}
            </div>
          ) : null}
          <div className="flex flex-wrap items-center justify-end gap-3">
            {missing ? <p className="text-sm text-red-600" role="alert">{missing}</p> : null}
            <Button
              loading={send.isPending}
              onClick={() => {
                // Send always answers: say what is missing.
                const need = sendToMissing(to, opts);
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
  );
}
