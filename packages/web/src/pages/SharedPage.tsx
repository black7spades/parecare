import { CONTACT_LINK } from '../components/ContactStrip';
import { useEffect, type ReactNode } from 'react';
import { useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { format } from '../lib/dateFormat';
import { api, ApiError } from '../api/client';
import { Button } from '../components/ui/Button';
import { EmergencySheetView, type EmergencySheet } from '../components/EmergencySheetView';
import { ReportSectionTable, type ReportResult } from '../components/ReportTables';
import { PhoneLink } from '../components/cards/profile/links';
import { forgetOffline, keepOffline } from '../lib/offline';

/**
 * The page a share link opens, with no login and no app around it: an
 * emergency sheet for a paramedic, one appointment for whoever is driving,
 * or a report for a specialist's rooms. Read only. An emergency sheet is
 * kept on the phone that opened it, so it opens again with no signal.
 */
interface SharedAppointment {
  id: string;
  title: string;
  starts_at: string | null;
  ends_at: string | null;
  all_day: boolean;
  place: string | null;
  directions_link: string | null;
  telehealth_link: string | null;
  preparation: string | null;
  provider: { name: string; role_label: string | null; phone: string | null; address: string | null; organisation: { name: string } | null } | null;
  bring: string[];
  going: Array<{ name: string; is_driver: boolean }>;
  interpreter_language: string | null;
  status: string;
  when_text: string;
}

type SharedPayload =
  | { kind: 'emergency_sheet'; shared_by: string; profile_name: string; sheet: EmergencySheet }
  | { kind: 'appointment'; shared_by: string; profile_name: string; appointment: SharedAppointment }
  | {
      kind: 'report';
      shared_by: string;
      profile_name: string;
      report: { name: string; generated_at: string; result: ReportResult };
      documents: Array<{ id: string; label: string; category_name: string | null }>;
    };

const keepKey = (token: string) => `parecare.shared.${token.slice(0, 16)}`;
function keep(token: string, payload: SharedPayload) {
  try {
    if (payload.kind === 'emergency_sheet') window.localStorage.setItem(keepKey(token), JSON.stringify({ saved_at: new Date().toISOString(), payload }));
  } catch {
    /* the page still works; it just will not open with no signal */
  }
}
function kept(token: string): { saved_at: string; payload: SharedPayload } | null {
  try {
    const raw = window.localStorage.getItem(keepKey(token));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function SharedPage() {
  const { token = '' } = useParams<{ token: string }>();
  const { data, error, isLoading } = useQuery({
    queryKey: ['shared', token],
    // offline_saved_at is set only on the copy kept on this phone, served with no signal.
    queryFn: () => api.get<SharedPayload & { offline_saved_at?: string }>(`/shared/${token}`),
    retry: false,
    // One open, one count: coming back to the tab does not count again.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
    staleTime: Infinity,
  });
  const turnedOff = error instanceof ApiError && (error.status === 410 || error.status === 404);
  useEffect(() => {
    // An emergency sheet stays on the phone that opened it, for no signal.
    if (data && !data.offline_saved_at && data.kind === 'emergency_sheet') {
      keep(token, data);
      keepOffline([{ url: `/shared/${token}`, body: data }]);
    }
  }, [data, token]);
  useEffect(() => {
    // A link turned off takes its kept copy with it.
    if (!turnedOff) return;
    try {
      window.localStorage.removeItem(keepKey(token));
    } catch {
      /* nothing kept */
    }
    forgetOffline([`/shared/${token}`]);
  }, [turnedOff, token]);

  const fallback = !data && error && !turnedOff ? kept(token) : null;
  const copy = data?.offline_saved_at ? { saved_at: data.offline_saved_at } : fallback;
  const page = data ?? fallback?.payload ?? null;

  return (
    <div className="min-h-screen bg-surface">
      <div className="mx-auto max-w-3xl px-4 py-6 space-y-4">
        {isLoading ? (
          <p className="text-sm text-muted">Opening.</p>
        ) : turnedOff ? (
          <div className="card space-y-2">
            <h1 className="text-2xl font-bold text-ink">This link is turned off</h1>
            <p className="text-sm text-ink">{error instanceof Error ? error.message : 'Ask whoever sent it for a new one.'}</p>
          </div>
        ) : !page ? (
          <div className="card space-y-2">
            <h1 className="text-2xl font-bold text-ink">This could not be opened just now</h1>
            <p className="text-sm text-ink">Check the connection and try again in a moment.</p>
          </div>
        ) : (
          <>
            {copy ? (
              <p className="rounded-md border-l-4 border-l-amber-500 bg-amber-50 px-3 py-2 text-sm text-amber-800 dark:bg-amber-900/10 dark:text-amber-200 print:hidden" role="status">
                No connection. This is the copy kept on this phone on {format(new Date(copy.saved_at), 'd MMM yyyy, HH:mm')}. It may be out of date.
              </p>
            ) : null}
            <div className="flex flex-wrap items-center justify-between gap-2 print:hidden">
              <p className="text-xs text-muted">Shared by {page.shared_by} through PareCare.</p>
              <Button size="sm" variant="secondary" onClick={() => window.print()}>Print</Button>
            </div>
            {page.kind === 'emergency_sheet' ? (
              <EmergencySheetView
                sheet={page.sheet}
                documentHref={(docId) => `/api/v1/shared/${token}/documents/${docId}`}
                footer={<>Shared by {page.shared_by} through PareCare. Check details before relying on them.</>}
              />
            ) : page.kind === 'appointment' ? (
              <AppointmentCard token={token} profileName={page.profile_name} a={page.appointment} />
            ) : (
              <ReportView token={token} page={page} />
            )}
          </>
        )}
      </div>
    </div>
  );
}

function Line({ label, children }: { label: string; children: ReactNode }) {
  return (
    <p className="text-sm text-ink flex flex-wrap gap-x-2">
      <span className="text-muted min-w-[8rem]">{label}</span>
      <span>{children}</span>
    </p>
  );
}

function AppointmentCard({ token, profileName, a }: { token: string; profileName: string; a: SharedAppointment }) {
  // The time where the person lives, as the email gave it.
  const when = a.when_text;
  const web = (v: string | null) => (v && /^https?:\/\//i.test(v) ? v : null);
  const directions = web(a.directions_link);
  const video = web(a.telehealth_link);
  return (
    <div className="card space-y-4">
      <div>
        <h1 className="text-2xl font-bold text-ink">{a.title}</h1>
        <p className="text-sm text-muted">For {profileName}</p>
      </div>
      {a.status === 'cancelled' ? (
        <p className="rounded-md border-l-4 border-l-red-500 bg-red-50 px-3 py-2 text-sm font-semibold text-red-700 dark:bg-red-900/10 dark:text-red-300" role="alert">
          This appointment has been cancelled. There is no need to go.
        </p>
      ) : null}
      <div className="space-y-1">
        <Line label="When">{when}</Line>
        {a.place ? <Line label="Where">{a.place}</Line> : null}
        {directions ? (
          <Line label="Directions">
            <a href={directions} target="_blank" rel="noopener noreferrer" className={CONTACT_LINK}>Open map</a>
          </Line>
        ) : null}
        {video ? (
          <Line label="Video call">
            <a href={video} target="_blank" rel="noopener noreferrer" className={CONTACT_LINK}>Join the video call</a>
          </Line>
        ) : null}
        {a.provider ? <Line label="With">{[a.provider.name, a.provider.role_label, a.provider.organisation?.name].filter(Boolean).join(', ')}</Line> : null}
        {a.provider?.phone ? <Line label="Their phone"><PhoneLink phone={a.provider.phone} /></Line> : null}
        {a.going.length ? <Line label="Who's going">{a.going.map((g) => g.name).join(', ')}</Line> : null}
        {a.going.some((g) => g.is_driver) ? <Line label="Driving">{a.going.filter((g) => g.is_driver).map((g) => g.name).join(', ')}</Line> : null}
        {a.interpreter_language ? <Line label="Interpreter">{a.interpreter_language}</Line> : null}
        {a.bring.length ? <Line label="Bring">{a.bring.join(', ')}</Line> : null}
        {a.preparation ? <Line label="How to get ready">{a.preparation}</Line> : null}
      </div>
      {a.starts_at && a.status !== 'cancelled' ? (
        <p className="print:hidden">
          <a href={`/api/v1/shared/${token}/calendar.ics`} className={`text-sm ${CONTACT_LINK}`}>Add to my calendar</a>
        </p>
      ) : null}
    </div>
  );
}

function ReportView({ token, page }: { token: string; page: Extract<SharedPayload, { kind: 'report' }> }) {
  const r = page.report.result;
  return (
    <div className="space-y-4">
      <div className="card space-y-1">
        <h1 className="text-2xl font-bold text-ink">{page.report.name}</h1>
        <p className="text-sm text-muted">For {page.profile_name}. Made on {format(new Date(page.report.generated_at), 'd MMM yyyy')}.</p>
      </div>
      {page.documents.length ? (
        <div className="card">
          <h2 className="text-sm font-semibold text-ink mb-2">Sent with it</h2>
          <ul className="space-y-1">
            {page.documents.map((d) => (
              <li key={d.id} className="text-sm">
                <a href={`/api/v1/shared/${token}/documents/${d.id}`} target="_blank" rel="noopener noreferrer" className={CONTACT_LINK}>{d.label}</a>
                {d.category_name ? <span className="ml-2 text-xs text-muted">{d.category_name}</span> : null}
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      {r.aiNarrative ? (
        <div className="card">
          <h2 className="text-sm font-semibold text-ink mb-2">Summary</h2>
          <div className="text-sm text-ink whitespace-pre-wrap">{r.aiNarrative}</div>
        </div>
      ) : null}
      {r.sections.map((s) => (
        <ReportSectionTable key={s.key} section={s} />
      ))}
    </div>
  );
}
