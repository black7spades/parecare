import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {  } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import {  } from '../../../components/ui/icons';
import {  } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import {  } from '../../../components/AllergyModal';
import { PagePurpose } from '../../../components/PagePurpose';
import {  } from '../../../components/ProseReport';
import {  } from '../../../components/CatalogueCombo';
import { useAuthStore } from '../../../stores/auth';
import { useProfile } from './ProfileLayout';
import {  entryName, fmtWhen } from './plan/shared';
import { VersionViewer } from './plan/VersionViewer';
import { GenerateWizard } from './plan/GenerateWizard';
import { SignModal } from './plan/SignModal';
import { InviteReviewerModal } from './plan/InviteReviewerModal';
import { AccessModal } from './plan/AccessModal';
import {
  
  
  
  
  
  planSectionLabel,
  planVersionStatusLabel,
  type PlanChange,
  type PlanPendingInfo,
  type PlanPermissions,
  type PlanVersionMeta } from '../../../lib/care';

/**
 * The Care plan page is OUTPUT ONLY. Nothing is collected here: every
 * fact is recorded on its own data entry page (Allergies, Conditions,
 * Medications, Treatments, Providers, Care needs) and flows into the
 * versioned plan document through the event-driven updater. This page
 * shows the current version, what is waiting to go in, the auditable
 * changelog, the version history, sign-off, signatures, reviewer
 * invitations and access control.
 */

interface GenerationJob {
  id: string;
  status: 'running' | 'succeeded' | 'failed';
  error: string | null;
  result: { status: string | null; applied: number };
  version: PlanVersionMeta | null;
}

export function PlanPage() {
  const { profile, careName, canEdit } = useProfile();
  const queryClient = useQueryClient();
  const account = useAuthStore((s) => s.account);

  const [generateOpen, setGenerateOpen] = useState(false);
  const [viewingVersion, setViewingVersion] = useState<PlanVersionMeta | null>(null);
  const [signVersion, setSignVersion] = useState<PlanVersionMeta | null>(null);
  const [inviteVersion, setInviteVersion] = useState<PlanVersionMeta | null>(null);
  const [accessOpen, setAccessOpen] = useState(false);
  const [confirmRevert, setConfirmRevert] = useState<PlanVersionMeta | null>(null);
  const [confirmDeleteAll, setConfirmDeleteAll] = useState(false);
  const [error, setError] = useState('');

  const { data: pendingData, isLoading: pendingLoading } = useQuery({
    queryKey: ['plan-pending', profile.id],
    queryFn: () => api.get<PlanPendingInfo>(`/care-profiles/${profile.id}/plan/versions/pending`) });
  const { data: versionData, isLoading: versionsLoading } = useQuery({
    queryKey: ['plan-versions', profile.id],
    queryFn: () =>
      api.get<{ versions: PlanVersionMeta[]; permissions: PlanPermissions }>(
        `/care-profiles/${profile.id}/plan/versions`
      ) });
  const { data: changelogData } = useQuery({
    queryKey: ['plan-changelog', profile.id],
    queryFn: () => api.get<{ changes: PlanChange[] }>(`/care-profiles/${profile.id}/plan/changelog`) });

  // Generation runs in the background; poll its job while one is running, so a
  // slow model (or a page reload mid-run) never leaves the page hanging.
  const { data: genStatus } = useQuery({
    queryKey: ['plan-gen-status', profile.id],
    queryFn: () => api.get<{ job: GenerationJob | null }>(`/care-profiles/${profile.id}/plan/versions/generate/status`),
    refetchInterval: (query) => (query.state.data?.job?.status === 'running' ? 2000 : false) });
  const genJob = genStatus?.job ?? null;
  const jobRunning = genJob?.status === 'running';

  const versions = versionData?.versions ?? [];
  const permissions: PlanPermissions = versionData?.permissions ?? {
    view: true,
    comment: false,
    edit: canEdit,
    sign: false };
  const latestPublished = versions.find((v) => v.status === 'published') ?? null;
  const awaiting = pendingData?.awaiting_signoff ?? null;
  const pendingEvents = pendingData?.pending_events ?? [];
  const hasVersions = pendingData?.has_versions ?? versions.length > 0;

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['plan-pending', profile.id] });
    void queryClient.invalidateQueries({ queryKey: ['plan-versions', profile.id] });
    void queryClient.invalidateQueries({ queryKey: ['plan-changelog', profile.id] });
    void queryClient.invalidateQueries({ queryKey: ['documents', profile.id] });
  };

  const generateMutation = useMutation({
    mutationFn: () => api.post<{ job: GenerationJob }>(`/care-profiles/${profile.id}/plan/versions/generate`),
    onSuccess: (res) => {
      setError('');
      setGenerateOpen(false);
      // Seed the poller with the running job so the spinner shows at once.
      queryClient.setQueryData(['plan-gen-status', profile.id], { job: res.job });
      void queryClient.invalidateQueries({ queryKey: ['plan-gen-status', profile.id] });
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not update the care plan.') });

  // Opening this page is reviewing the plan, so any "care plan ready" notice
  // for this person is cleared: its bell entry is marked read and the nav pip
  // goes out. Keyed by the finished job, done once per job.
  const markPlanSeen = useMutation({
    mutationFn: (key: string) => api.post('/notifications/read', { keys: [key] }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }) });
  const seenJobRef = useRef<string | null>(null);
  useEffect(() => {
    if (genJob?.status === 'succeeded' && genJob.version && genJob.id !== seenJobRef.current) {
      seenJobRef.current = genJob.id;
      markPlanSeen.mutate(`care_plan_ready:${genJob.id}`);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genJob?.status, genJob?.id]);

  // React only when a run we are watching finishes: refresh the plan on
  // success, surface the reason on failure. A pre-existing completed job on
  // first load is ignored (prev starts null).
  const prevJobStatus = useRef<string | null>(null);
  useEffect(() => {
    const status = genJob?.status ?? null;
    const prev = prevJobStatus.current;
    prevJobStatus.current = status;
    if (prev !== 'running') return;
    if (status === 'succeeded') {
      setError('');
      invalidate();
    } else if (status === 'failed') {
      setError(genJob?.error || 'Care plan generation did not finish. Please try again.');
      void queryClient.invalidateQueries({ queryKey: ['plan-pending', profile.id] });
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [genJob?.status, genJob?.id]);
  const approveMutation = useMutation({
    mutationFn: (versionId: string) =>
      api.post(`/care-profiles/${profile.id}/plan/versions/${versionId}/approve`),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not approve the version.') });
  const rejectMutation = useMutation({
    mutationFn: (versionId: string) =>
      api.post(`/care-profiles/${profile.id}/plan/versions/${versionId}/reject`),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not reject the version.') });
  const revertMutation = useMutation({
    mutationFn: (versionId: string) =>
      api.post(`/care-profiles/${profile.id}/plan/versions/${versionId}/revert`),
    onSuccess: () => {
      setConfirmRevert(null);
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not restore the version.') });
  const deleteAllMutation = useMutation({
    mutationFn: () => api.delete(`/care-profiles/${profile.id}/plan/versions`),
    onSuccess: () => {
      setConfirmDeleteAll(false);
      setError('');
      invalidate();
    },
    onError: (err) => {
      setConfirmDeleteAll(false);
      setError(err instanceof Error ? err.message : 'Could not delete the care plan.');
    } });

  const exportPdf = async (v: PlanVersionMeta) => {
    const blob = await api.blob(`/care-profiles/${profile.id}/plan/versions/${v.id}/export`);
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `care-plan-v${v.version}.pdf`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (pendingLoading || versionsLoading) return <p className="text-sm text-muted">Loading…</p>;

  return (
    <div className="space-y-4 max-w-4xl">
      <div className="flex flex-col sm:flex-row sm:items-start sm:justify-between gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-base font-semibold text-ink">Care plan</h2>
            <PagePurpose kind="output" />
          </div>
          <p className="text-sm text-muted">
            The assembled, versioned plan for {careName}. Nothing is recorded here: facts are entered on
            their own pages and each change flows in as a tracked update.
          </p>
        </div>
        <Link to="../emergency">
          <Button type="button" variant="secondary" size="sm">
            Emergency sheet
          </Button>
        </Link>
      </div>
      {jobRunning ? (
        <div className="flex items-center gap-2 rounded-md border border-primary/30 bg-primary-50 dark:bg-primary-900/20 px-3 py-2 text-sm text-ink">
          <span className="inline-block h-3.5 w-3.5 animate-spin rounded-full border-2 border-primary border-t-transparent" aria-hidden />
          Generating the care plan. This can take a minute on a self-hosted model; you can leave this page and come back.
        </div>
      ) : null}
      {error ? <p className="text-sm text-red-600">{error}</p> : null}

      {!hasVersions ? (
        <div className="card text-center py-10 space-y-3">
          <h3 className="text-sm font-semibold text-ink">No care plan yet</h3>
          <p className="text-sm text-muted max-w-md mx-auto">
            Generate version 1 from everything already recorded for {careName}. You can fill any missing
            basics on the way, and every later change to the record becomes a tracked plan update.
          </p>
          {permissions.edit && canEdit ? (
            <Button onClick={() => setGenerateOpen(true)}>Generate care plan</Button>
          ) : (
            <p className="text-xs text-muted">Someone with edit access can generate it.</p>
          )}
        </div>
      ) : (
        <>
          {awaiting ? (
            <div className="card border-l-4 border-l-red-500 bg-red-50 dark:bg-red-900/10">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-red-700 dark:text-red-300">
                    Version {awaiting.version} is awaiting sign-off
                  </p>
                  <p className="text-xs text-muted">
                    This update includes high-risk or unusually large changes, or follows a signed version,
                    so a person must approve it before it is published.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Button size="sm" variant="ghost" onClick={() => setViewingVersion(awaiting)}>
                    View
                  </Button>
                  {permissions.sign ? (
                    <>
                      <Button
                        size="sm"
                        variant="secondary"
                        loading={approveMutation.isPending}
                        onClick={() => approveMutation.mutate(awaiting.id)}
                      >
                        Approve
                      </Button>
                      <Button
                        size="sm"
                        variant="ghost-danger"
                        loading={rejectMutation.isPending}
                        onClick={() => rejectMutation.mutate(awaiting.id)}
                      >
                        Reject
                      </Button>
                    </>
                  ) : null}
                </div>
              </div>
            </div>
          ) : null}

          {pendingEvents.length > 0 && !awaiting ? (
            <div className="card border-l-4 border-l-amber-500">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <p className="text-sm font-semibold text-ink">
                    {pendingEvents.length} recorded {pendingEvents.length === 1 ? 'change' : 'changes'} not
                    yet in the plan
                  </p>
                  <p className="text-xs text-muted">
                    {[...new Set(pendingEvents.map((e) => e.summary).filter(Boolean))].slice(0, 4).join(', ')}
                  </p>
                </div>
                {permissions.edit && canEdit ? (
                  <Button size="sm" loading={generateMutation.isPending || jobRunning} onClick={() => generateMutation.mutate()}>
                    Update care plan
                  </Button>
                ) : null}
              </div>
            </div>
          ) : null}

          {latestPublished ? (
            <CurrentVersionCard
              version={latestPublished}
              permissions={permissions}
              canEdit={canEdit}
              onView={() => setViewingVersion(latestPublished)}
              onExport={() => void exportPdf(latestPublished)}
              onSign={() => setSignVersion(latestPublished)}
              onInvite={() => setInviteVersion(latestPublished)}
              onAccess={() => setAccessOpen(true)}
            />
          ) : null}

          <ChangelogCard changes={changelogData?.changes ?? []} />

          <VersionsCard
            versions={versions}
            latestPublishedId={latestPublished?.id ?? null}
            canRevert={permissions.edit && canEdit}
            onView={setViewingVersion}
            onExport={(v) => void exportPdf(v)}
            onRevert={setConfirmRevert}
          />

          {canEdit ? (
            <div className="card border-l-4 border-l-red-500">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h3 className="text-sm font-semibold text-red-700 dark:text-red-300">Delete care plan</h3>
                  <p className="text-xs text-muted">
                    Wipes every version, its changelog, signatures, review links, access grants and the plan
                    documents filed in Documents. The recorded facts stay; the next Generate starts from a
                    fresh version 1. Only the profile owner or an admin can do this.
                  </p>
                </div>
                <Button variant="danger" onClick={() => setConfirmDeleteAll(true)}>
                  Delete care plan
                </Button>
              </div>
            </div>
          ) : null}
        </>
      )}

      {generateOpen ? (
        <GenerateWizard
          profileId={profile.id}
          careName={careName}
          gaps={pendingData?.baseline_gaps ?? { allergies: false, emergency_contacts: false, gp: false, needs: false }}
          generating={generateMutation.isPending || jobRunning}
          error={error}
          onGenerate={() => generateMutation.mutate()}
          onClose={() => setGenerateOpen(false)}
        />
      ) : null}

      {viewingVersion ? (
        <VersionViewer
          profileId={profile.id}
          meta={viewingVersion}
          onClose={() => setViewingVersion(null)}
        />
      ) : null}

      {signVersion ? (
        <SignModal
          profileId={profile.id}
          version={signVersion}
          defaultName={account?.display_name ?? ''}
          onClose={() => setSignVersion(null)}
          onSigned={invalidate}
        />
      ) : null}

      {inviteVersion ? (
        <InviteReviewerModal
          profileId={profile.id}
          version={inviteVersion}
          onClose={() => setInviteVersion(null)}
        />
      ) : null}

      {accessOpen ? <AccessModal profileId={profile.id} onClose={() => setAccessOpen(false)} /> : null}

      <Modal open={confirmDeleteAll} onClose={() => setConfirmDeleteAll(false)} title="Delete the entire care plan">
        <p className="text-sm text-ink mb-2">
          Are you sure? This permanently deletes, for {careName}:
        </p>
        <ul className="text-sm text-muted list-disc pl-5 space-y-0.5 mb-3">
          <li>all {versions.length} plan {versions.length === 1 ? 'version' : 'versions'} and the full changelog</li>
          <li>every signature and pending review link</li>
          <li>all care plan access grants</li>
          <li>the plan documents filed in Documents</li>
          <li>any recorded changes waiting to go into the plan</li>
        </ul>
        <p className="text-sm text-muted mb-4">
          This cannot be undone. The facts themselves, such as allergies, conditions and medications, are
          not touched, and a new version 1 can be generated afterwards.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDeleteAll(false)}>
            Cancel
          </Button>
          <Button variant="danger" loading={deleteAllMutation.isPending} onClick={() => deleteAllMutation.mutate()}>
            Delete care plan
          </Button>
        </div>
      </Modal>

      <Modal open={confirmRevert !== null} onClose={() => setConfirmRevert(null)} title="Restore version">
        <p className="text-sm text-muted mb-4">
          Restore the plan to version {confirmRevert?.version}? Nothing is lost: this creates a new version
          whose content matches version {confirmRevert?.version}, recorded in the changelog like any other
          change.
        </p>
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmRevert(null)}>
            Cancel
          </Button>
          <Button
            variant="secondary"
            loading={revertMutation.isPending}
            onClick={() => confirmRevert && revertMutation.mutate(confirmRevert.id)}
          >
            Restore
          </Button>
        </div>
      </Modal>
    </div>
  );
}

// ---------------------------------------------------------------------------

function CurrentVersionCard({
  version,
  permissions,
  canEdit,
  onView,
  onExport,
  onSign,
  onInvite,
  onAccess }: {
  version: PlanVersionMeta;
  permissions: PlanPermissions;
  canEdit: boolean;
  onView: () => void;
  onExport: () => void;
  onSign: () => void;
  onInvite: () => void;
  onAccess: () => void;
}) {
  return (
    <div className="card">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-ink">Current plan: version {version.version}</h3>
          <p className="text-xs text-muted">
            {planVersionStatusLabel(version.status)}
            {version.locked ? ', signed and locked' : ''} · Created {fmtWhen(version.created_at)}
            {version.author_name ? ` by ${version.author_name}` : ''}
            {version.restored_from_version ? ` · Restores version ${version.restored_from_version}` : ''}
          </p>
          <p className="text-xs text-muted">
            {version.signature_count > 0
              ? `${version.signature_count} ${version.signature_count === 1 ? 'signature' : 'signatures'} · `
              : ''}
            Integrity hash {version.content_hash.slice(0, 16)}…
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" variant="ghost" onClick={onView}>
            View
          </Button>
          <Button size="sm" variant="secondary" onClick={onExport}>
            Export PDF
          </Button>
          {permissions.sign ? (
            <Button size="sm" variant="secondary" onClick={onSign}>
              Sign
            </Button>
          ) : null}
          {permissions.edit && canEdit ? (
            <>
              <Button size="sm" variant="ghost" onClick={onInvite}>
                Invite reviewer
              </Button>
              <Button size="sm" variant="ghost" onClick={onAccess}>
                Manage access
              </Button>
            </>
          ) : null}
        </div>
      </div>
      <p className="text-xs text-muted mt-2">
        The full content opens under View, and each section links to the page where its facts are managed.
      </p>
    </div>
  );
}

function describeChange(c: PlanChange): string {
  const name = entryName(c.after) || entryName(c.before) || c.entry_key;
  if (c.op === 'add') return `Added ${name}`;
  if (c.op === 'remove') return `Removed ${name}`;
  return `Updated ${name}`;
}

function ChangelogCard({ changes }: { changes: PlanChange[] }) {
  const [showAll, setShowAll] = useState(false);
  const view = showAll ? changes : changes.slice(0, 10);
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-ink mb-1">Changelog</h3>
      <p className="text-xs text-muted mb-3">
        Every operation applied to the plan, with when it happened, who caused it, and the recorded change
        events it came from.
      </p>
      {changes.length === 0 ? (
        <p className="text-sm text-muted">No changes recorded yet.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b border-border text-left text-xs text-muted">
                <th className="py-1.5 pr-3">When</th>
                <th className="py-1.5 pr-3">Version</th>
                <th className="py-1.5 pr-3">Change</th>
                <th className="py-1.5 pr-3">Section</th>
                <th className="py-1.5 pr-3">By</th>
                <th className="py-1.5 pr-3">Source events</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-border">
              {view.map((c) => (
                <tr key={c.id}>
                  <td className="py-2 pr-3 text-ink whitespace-nowrap">{fmtWhen(c.created_at)}</td>
                  <td className="py-2 pr-3 text-ink">{c.version}</td>
                  <td className="py-2 pr-3 text-ink">{describeChange(c)}</td>
                  <td className="py-2 pr-3 text-ink">{planSectionLabel(c.section)}</td>
                  <td className="py-2 pr-3 text-ink">{c.actor_name ?? 'System'}</td>
                  <td className="py-2 pr-3 text-muted">
                    <span title={c.source_event_ids.join(', ')}>
                      {c.source_event_ids.length > 0 ? `${c.source_event_ids.length} event${c.source_event_ids.length === 1 ? '' : 's'}` : ''}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {changes.length > 10 ? (
        <div className="mt-2">
          <Button size="xs" variant="ghost" onClick={() => setShowAll(!showAll)}>
            {showAll ? 'Show fewer' : `Show all ${changes.length}`}
          </Button>
        </div>
      ) : null}
    </div>
  );
}

function VersionsCard({
  versions,
  latestPublishedId,
  canRevert,
  onView,
  onExport,
  onRevert }: {
  versions: PlanVersionMeta[];
  latestPublishedId: string | null;
  canRevert: boolean;
  onView: (v: PlanVersionMeta) => void;
  onExport: (v: PlanVersionMeta) => void;
  onRevert: (v: PlanVersionMeta) => void;
}) {
  return (
    <div className="card">
      <h3 className="text-sm font-semibold text-ink mb-1">Versions</h3>
      <p className="text-xs text-muted mb-3">
        Every version is also filed in{' '}
        <Link to="../documents" className="text-primary hover:underline">
          Documents
        </Link>{' '}
        and can be exported to PDF with its version number and integrity hash embedded.
      </p>
      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-border text-left text-xs text-muted">
              <th className="py-1.5 pr-3">Version</th>
              <th className="py-1.5 pr-3">Status</th>
              <th className="py-1.5 pr-3">Created</th>
              <th className="py-1.5 pr-3">Author</th>
              <th className="py-1.5 pr-3">Signatures</th>
              <th className="py-1.5 pr-3 text-right">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-border">
            {versions.map((v) => (
              <tr key={v.id}>
                <td className="py-2 pr-3 font-medium text-ink">
                  {v.version}
                  {v.restored_from_version ? (
                    <span className="text-xs text-muted"> restores {v.restored_from_version}</span>
                  ) : null}
                </td>
                <td className="py-2 pr-3 text-ink">
                  {planVersionStatusLabel(v.status)}
                  {v.locked ? ' · signed' : ''}
                </td>
                <td className="py-2 pr-3 text-ink whitespace-nowrap">{fmtWhen(v.created_at)}</td>
                <td className="py-2 pr-3 text-ink">{v.author_name ?? ''}</td>
                <td className="py-2 pr-3 text-ink">{v.signature_count > 0 ? v.signature_count : ''}</td>
                <td className="py-2 text-right whitespace-nowrap">
                  <Button size="xs" variant="ghost" className="mr-1" onClick={() => onView(v)}>
                    View
                  </Button>
                  <Button size="xs" variant="ghost" className="mr-1" onClick={() => onExport(v)}>
                    Export PDF
                  </Button>
                  {canRevert && v.status === 'published' && v.id !== latestPublishedId ? (
                    <Button size="xs" variant="ghost" onClick={() => onRevert(v)}>
                      Restore
                    </Button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Version viewer

