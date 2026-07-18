import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { format } from 'date-fns';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { AllergyModal } from '../../../components/AllergyModal';
import { PagePurpose } from '../../../components/PagePurpose';
import { ProseReport } from '../../../components/ProseReport';
import { OptionChips } from '../../../components/CatalogueCombo';
import { useAuthStore } from '../../../stores/auth';
import { useProfile } from './ProfileLayout';
import {
  PLAN_ACCESS_ROLES,
  PLAN_NARRATIVE_SECTIONS,
  PLAN_SECTION_ORDER,
  RELATIONSHIPS,
  planAccessRoleLabel,
  planSectionLabel,
  planVersionStatusLabel,
  type CarePlan,
  type CircleMember,
  type PlanAccessRow,
  type PlanChange,
  type PlanContent,
  type PlanEntry,
  type PlanPendingInfo,
  type PlanPermissions,
  type PlanReview,
  type PlanSignature,
  type PlanVersionMeta,
} from '../../../lib/care';

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

const SECTION_MANAGE_LINKS: Record<string, { to: string; label: string }> = {
  allergies: { to: '../allergies', label: 'Allergies page' },
  conditions: { to: '../conditions', label: 'Conditions page' },
  medications: { to: '../medications', label: 'Medications page' },
  treatments: { to: '../treatments', label: 'Treatments page' },
  needs: { to: '../care-needs', label: 'Care needs page' },
  directive: { to: '../care-needs', label: 'Care needs page' },
  emergency_contacts: { to: '../care-needs', label: 'Care needs page' },
  providers: { to: '../providers', label: 'Providers page' },
};

const SECTION_ORDER = PLAN_SECTION_ORDER;

const fieldLabel = (f: string): string => f.replace(/_/g, ' ').replace(/^./, (c) => c.toUpperCase());

const fieldText = (v: string | number | boolean | null | undefined): string => {
  if (v === null || v === undefined) return '';
  if (typeof v === 'boolean') return v ? 'Yes' : 'No';
  return String(v);
};

const entryName = (fields: Record<string, string | number | boolean | null> | null | undefined): string => {
  if (!fields) return '';
  const v = fields['substance'] ?? fields['name'] ?? fields['value'] ?? fields['location'] ?? '';
  return fieldText(v);
};

const fmtWhen = (d: string) => format(new Date(d), 'd MMM yyyy HH:mm');

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
    queryFn: () => api.get<PlanPendingInfo>(`/care-profiles/${profile.id}/plan/versions/pending`),
  });
  const { data: versionData, isLoading: versionsLoading } = useQuery({
    queryKey: ['plan-versions', profile.id],
    queryFn: () =>
      api.get<{ versions: PlanVersionMeta[]; permissions: PlanPermissions }>(
        `/care-profiles/${profile.id}/plan/versions`
      ),
  });
  const { data: changelogData } = useQuery({
    queryKey: ['plan-changelog', profile.id],
    queryFn: () => api.get<{ changes: PlanChange[] }>(`/care-profiles/${profile.id}/plan/changelog`),
  });

  // Generation runs in the background; poll its job while one is running, so a
  // slow model (or a page reload mid-run) never leaves the page hanging.
  const { data: genStatus } = useQuery({
    queryKey: ['plan-gen-status', profile.id],
    queryFn: () => api.get<{ job: GenerationJob | null }>(`/care-profiles/${profile.id}/plan/versions/generate/status`),
    refetchInterval: (query) => (query.state.data?.job?.status === 'running' ? 2000 : false),
  });
  const genJob = genStatus?.job ?? null;
  const jobRunning = genJob?.status === 'running';

  const versions = versionData?.versions ?? [];
  const permissions: PlanPermissions = versionData?.permissions ?? {
    view: true,
    comment: false,
    edit: canEdit,
    sign: false,
  };
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
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not update the care plan.'),
  });

  // Opening this page is reviewing the plan, so any "care plan ready" notice
  // for this person is cleared: its bell entry is marked read and the nav pip
  // goes out. Keyed by the finished job, done once per job.
  const markPlanSeen = useMutation({
    mutationFn: (key: string) => api.post('/notifications/read', { keys: [key] }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['notifications'] }),
  });
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
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not approve the version.'),
  });
  const rejectMutation = useMutation({
    mutationFn: (versionId: string) =>
      api.post(`/care-profiles/${profile.id}/plan/versions/${versionId}/reject`),
    onSuccess: invalidate,
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not reject the version.'),
  });
  const revertMutation = useMutation({
    mutationFn: (versionId: string) =>
      api.post(`/care-profiles/${profile.id}/plan/versions/${versionId}/revert`),
    onSuccess: () => {
      setConfirmRevert(null);
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not restore the version.'),
  });
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
    },
  });

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
  onAccess,
}: {
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
  onRevert,
}: {
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

function ContentSections({ content }: { content: PlanContent }) {
  const sections = SECTION_ORDER.filter((s) => (content.sections[s] ?? []).length > 0);
  if (sections.length === 0) return <p className="text-sm text-muted">This version is empty.</p>;
  return (
    <div className="space-y-4">
      {sections.map((s) => {
        const entries = content.sections[s] ?? [];
        const fieldNames = [...new Set(entries.flatMap((e: PlanEntry) => Object.keys(e.fields)))];
        const manage = SECTION_MANAGE_LINKS[s];
        const synthesized = PLAN_NARRATIVE_SECTIONS.has(s);
        return (
          <div key={s}>
            <div className="flex items-baseline justify-between gap-2">
              <h4 className="text-sm font-semibold text-ink">{planSectionLabel(s)}</h4>
              {synthesized ? (
                <span className="text-xs text-muted">Synthesized from the recorded facts</span>
              ) : manage ? (
                <Link to={manage.to} className="text-xs text-primary hover:underline">
                  Manage on the {manage.label}
                </Link>
              ) : null}
            </div>
            <div className="overflow-x-auto mt-1">
              <table className="w-full text-sm">
                <thead>
                  <tr className="border-b border-border text-left text-xs text-muted">
                    {fieldNames.map((f) => (
                      <th key={f} className="py-1.5 pr-3">
                        {fieldLabel(f)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody className="divide-y divide-border">
                  {entries.map((e: PlanEntry) => (
                    <tr key={e.key}>
                      {fieldNames.map((f) => (
                        <td key={f} className="py-1.5 pr-3 text-ink align-top whitespace-pre-line">
                          {fieldText(e.fields[f])}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        );
      })}
    </div>
  );
}

interface VersionDetail {
  version: PlanVersionMeta & { content: PlanContent; report: string | null };
  changes: PlanChange[];
  signatures: PlanSignature[];
  reviews: PlanReview[];
  permissions: PlanPermissions;
}

function VersionViewer({
  profileId,
  meta,
  onClose,
}: {
  profileId: string;
  meta: PlanVersionMeta;
  onClose: () => void;
}) {
  const [showRecord, setShowRecord] = useState(false);
  const { data, isLoading } = useQuery({
    queryKey: ['plan-version', profileId, meta.id],
    queryFn: () => api.get<VersionDetail>(`/care-profiles/${profileId}/plan/versions/${meta.id}`),
  });

  return (
    <Modal open onClose={onClose} title={`Care plan version ${meta.version}`} wide>
      {isLoading || !data ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : (
        <div className="space-y-4">
          <p className="text-xs text-muted">
            {planVersionStatusLabel(data.version.status)} · Created {fmtWhen(data.version.created_at)}
            {data.version.author_name ? ` by ${data.version.author_name}` : ''} · SHA-256{' '}
            {data.version.content_hash}
          </p>
          {data.version.report ? <ProseReport report={data.version.report} /> : null}
          {data.version.changelog ? (
            <div>
              <h4 className="text-sm font-semibold text-ink mb-1">What changed in this version</h4>
              <pre className="text-xs text-muted whitespace-pre-wrap font-sans bg-surface-2 rounded-md p-3">
                {data.version.changelog}
              </pre>
            </div>
          ) : null}
          {data.version.report ? (
            <div className="border-t border-border pt-3">
              <div className="flex items-center justify-between gap-2">
                <div>
                  <h4 className="text-sm font-semibold text-ink">Data record</h4>
                  <p className="text-xs text-muted">The structured facts this report was written from.</p>
                </div>
                <Button size="xs" variant="ghost" onClick={() => setShowRecord((v) => !v)}>
                  {showRecord ? 'Hide' : 'Show'}
                </Button>
              </div>
              {showRecord ? (
                <div className="mt-3">
                  <ContentSections content={data.version.content} />
                </div>
              ) : null}
            </div>
          ) : (
            <ContentSections content={data.version.content} />
          )}
          {data.signatures.length > 0 ? (
            <div>
              <h4 className="text-sm font-semibold text-ink mb-1">Signatures</h4>
              <ul className="space-y-1">
                {data.signatures.map((s) => (
                  <li key={s.id} className="text-xs text-muted">
                    Signed by <span className="text-ink">{s.signer_name}</span> at {fmtWhen(s.signed_at)} ·
                    hash {s.signature_hash.slice(0, 16)}…
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          {data.reviews.length > 0 ? (
            <div>
              <h4 className="text-sm font-semibold text-ink mb-1">Reviews</h4>
              <ul className="space-y-1">
                {data.reviews.map((r) => (
                  <li key={r.id} className="text-xs text-muted">
                    {r.invited_name ?? r.invited_email ?? 'Reviewer'}: {r.status}
                    {r.comment ? ` · "${r.comment}"` : ''}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex justify-end">
            <Button variant="ghost" onClick={onClose}>
              Cancel
            </Button>
          </div>
        </div>
      )}
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// First-run wizard: collect missing baseline facts via inline modals

function GenerateWizard({
  profileId,
  careName,
  gaps,
  generating,
  onGenerate,
  onClose,
}: {
  profileId: string;
  careName: string;
  gaps: { allergies: boolean; emergency_contacts: boolean; gp: boolean; needs: boolean };
  generating: boolean;
  onGenerate: () => void;
  onClose: () => void;
}) {
  const queryClient = useQueryClient();
  const [allergyOpen, setAllergyOpen] = useState(false);
  const [allergiesAdded, setAllergiesAdded] = useState(0);
  const [noKnownAllergies, setNoKnownAllergies] = useState(false);

  const { data: planData } = useQuery({
    queryKey: ['care-plan', profileId],
    queryFn: () => api.get<{ plan: CarePlan | null }>(`/care-profiles/${profileId}/plan`),
  });
  const asArray = <T,>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);
  const plan: CarePlan = {
    dietary_requirements: asArray<string>(planData?.plan?.dietary_requirements),
    mobility_aids: asArray<string>(planData?.plan?.mobility_aids),
    communication_needs: asArray<string>(planData?.plan?.communication_needs),
    advance_care_directive: planData?.plan?.advance_care_directive ?? false,
    advance_care_directive_location: planData?.plan?.advance_care_directive_location ?? null,
    emergency_contacts: asArray(planData?.plan?.emergency_contacts),
  };

  const savePlanMutation = useMutation({
    mutationFn: (next: CarePlan) => api.put(`/care-profiles/${profileId}/plan`, next),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['care-plan', profileId] }),
  });

  return (
    <Modal open onClose={onClose} title="Generate care plan" wide>
      <div className="space-y-4">
        <p className="text-sm text-muted">
          Version 1 is assembled from everything already recorded for {careName}. A few basics are still
          missing; fill them in here or skip them, they can always be added later.
        </p>

        {gaps.allergies && !noKnownAllergies && allergiesAdded === 0 ? (
          <GapRow label="Allergies" detail="No allergies are recorded.">
            <Button size="sm" variant="secondary" onClick={() => setAllergyOpen(true)}>
              Add allergy
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setNoKnownAllergies(true)}>
              None known
            </Button>
          </GapRow>
        ) : null}

        {gaps.emergency_contacts && plan.emergency_contacts.length === 0 ? (
          <GapRow label="Emergency contacts" detail="Nobody is listed to call first.">
            <InlineContactForm
              saving={savePlanMutation.isPending}
              onAdd={(contact) =>
                savePlanMutation.mutate({ ...plan, emergency_contacts: [...plan.emergency_contacts, contact] })
              }
            />
          </GapRow>
        ) : null}

        {gaps.gp ? <GpGapRow profileId={profileId} /> : null}

        {gaps.needs ? (
          <GapRow label="Day-to-day needs" detail="No dietary requirements, mobility aids or communication needs are recorded.">
            <div className="space-y-3 w-full">
              <OptionChips
                label="Dietary requirements"
                category="dietary_requirement"
                values={plan.dietary_requirements}
                onChange={(v) => savePlanMutation.mutate({ ...plan, dietary_requirements: v })}
                canEdit
                addLabel="Add, e.g. Low salt"
              />
              <OptionChips
                label="Mobility aids"
                category="mobility_aid"
                values={plan.mobility_aids}
                onChange={(v) => savePlanMutation.mutate({ ...plan, mobility_aids: v })}
                canEdit
                addLabel="Add, e.g. Walking frame"
              />
            </div>
          </GapRow>
        ) : null}

        {!gaps.allergies && !gaps.emergency_contacts && !gaps.gp && !gaps.needs ? (
          <p className="text-sm text-ink">Everything needed for a useful first version is already recorded.</p>
        ) : null}

        <div className="flex justify-end gap-2 pt-2 border-t border-border">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={generating} onClick={onGenerate}>
            Generate version 1
          </Button>
        </div>
      </div>

      {allergyOpen ? (
        <AllergyModal
          profileId={profileId}
          open
          onClose={() => setAllergyOpen(false)}
          onSaved={() => setAllergiesAdded((n) => n + 1)}
        />
      ) : null}
    </Modal>
  );
}

function GapRow({ label, detail, children }: { label: string; detail: string; children: React.ReactNode }) {
  return (
    <div className="rounded-md border border-border p-3">
      <p className="text-sm font-semibold text-ink">{label}</p>
      <p className="text-xs text-muted mb-2">{detail}</p>
      <div className="flex flex-wrap items-end gap-2">{children}</div>
    </div>
  );
}

function InlineContactForm({
  saving,
  onAdd,
}: {
  saving: boolean;
  onAdd: (contact: { name: string; relationship?: string; phone: string }) => void;
}) {
  const [name, setName] = useState('');
  const [relationship, setRelationship] = useState('');
  const [phone, setPhone] = useState('');
  const selectClass =
    'rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';
  return (
    <>
      <Input aria-label="Contact name" placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} className="w-36" />
      <select aria-label="Relationship" className={selectClass} value={relationship} onChange={(e) => setRelationship(e.target.value)}>
        <option value="">Relationship</option>
        {RELATIONSHIPS.filter((r) => r !== 'Myself').map((r) => (
          <option key={r} value={r}>
            {r}
          </option>
        ))}
      </select>
      <Input aria-label="Contact phone" type="tel" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-32" />
      <Button
        size="sm"
        variant="secondary"
        disabled={!name.trim() || !phone.trim()}
        loading={saving}
        onClick={() => {
          onAdd({ name: name.trim(), relationship: relationship || undefined, phone: phone.trim() });
          setName('');
          setRelationship('');
          setPhone('');
        }}
      >
        Add
      </Button>
    </>
  );
}

function GpGapRow({ profileId }: { profileId: string }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [practice, setPractice] = useState('');
  const [phone, setPhone] = useState('');
  const [added, setAdded] = useState(false);

  const addMutation = useMutation({
    mutationFn: () =>
      api.post(`/care-profiles/${profileId}/providers`, {
        provider_type: 'gp',
        name: name.trim(),
        organisation: practice.trim() || null,
        phone: phone.trim() || null,
      }),
    onSuccess: () => {
      setAdded(true);
      void queryClient.invalidateQueries({ queryKey: ['providers', profileId] });
    },
  });

  if (added) return null;
  return (
    <GapRow label="GP" detail="No GP is recorded.">
      <Input aria-label="GP name" placeholder="GP name" value={name} onChange={(e) => setName(e.target.value)} className="w-36" />
      <Input aria-label="GP practice" placeholder="Practice" value={practice} onChange={(e) => setPractice(e.target.value)} className="w-36" />
      <Input aria-label="GP phone" type="tel" placeholder="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} className="w-32" />
      <Button size="sm" variant="secondary" disabled={!name.trim()} loading={addMutation.isPending} onClick={() => addMutation.mutate()}>
        Add GP
      </Button>
    </GapRow>
  );
}

// ---------------------------------------------------------------------------
// Signing

function SignaturePad({ onChange }: { onChange: (dataUrl: string | null) => void }) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const drawing = useRef(false);
  const drew = useRef(false);

  const pos = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: e.clientX - rect.left, y: e.clientY - rect.top };
  };

  return (
    <div>
      <canvas
        ref={canvasRef}
        width={360}
        height={120}
        className="border border-border rounded-md bg-card touch-none w-full"
        aria-label="Draw your signature"
        onPointerDown={(e) => {
          drawing.current = true;
          const ctx = e.currentTarget.getContext('2d');
          if (!ctx) return;
          const p = pos(e);
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
        }}
        onPointerMove={(e) => {
          if (!drawing.current) return;
          const ctx = e.currentTarget.getContext('2d');
          if (!ctx) return;
          const p = pos(e);
          ctx.lineWidth = 2;
          ctx.lineCap = 'round';
          ctx.strokeStyle = '#1a1a1a';
          ctx.lineTo(p.x, p.y);
          ctx.stroke();
          drew.current = true;
        }}
        onPointerUp={(e) => {
          drawing.current = false;
          if (drew.current) onChange(e.currentTarget.toDataURL('image/png'));
        }}
        onPointerLeave={(e) => {
          if (drawing.current && drew.current) onChange(e.currentTarget.toDataURL('image/png'));
          drawing.current = false;
        }}
      />
      <Button
        size="xs"
        variant="ghost"
        className="mt-1"
        onClick={() => {
          const canvas = canvasRef.current;
          const ctx = canvas?.getContext('2d');
          if (canvas && ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
          drew.current = false;
          onChange(null);
        }}
      >
        Clear
      </Button>
    </div>
  );
}

function SignModal({
  profileId,
  version,
  defaultName,
  onClose,
  onSigned,
}: {
  profileId: string;
  version: PlanVersionMeta;
  defaultName: string;
  onClose: () => void;
  onSigned: () => void;
}) {
  const [name, setName] = useState(defaultName);
  const [consent, setConsent] = useState(false);
  const [image, setImage] = useState<string | null>(null);
  const [error, setError] = useState('');

  const signMutation = useMutation({
    mutationFn: () =>
      api.post(`/care-profiles/${profileId}/plan/versions/${version.id}/sign`, {
        signer_name: name.trim(),
        signature_image: image,
        consent: true,
      }),
    onSuccess: () => {
      onSigned();
      onClose();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not record the signature.'),
  });

  return (
    <Modal open onClose={onClose} title={`Sign care plan version ${version.version}`}>
      <div className="space-y-4">
        <p className="text-xs text-muted">
          Your signature is bound to this exact version by its integrity hash, with the time, your account,
          and the device it came from. A signed version is locked: later automatic updates wait for
          sign-off instead of publishing themselves.
        </p>
        <Input label="Your full name" value={name} onChange={(e) => setName(e.target.value)} />
        <div>
          <span className="block text-sm font-medium text-ink mb-1">Signature</span>
          <SignaturePad onChange={setImage} />
        </div>
        <label className="flex items-start gap-2 text-sm text-ink">
          <input
            type="checkbox"
            className="h-4 w-4 mt-0.5 rounded border-border text-primary focus:ring-primary"
            checked={consent}
            onChange={(e) => setConsent(e.target.checked)}
          />
          I have reviewed version {version.version} and consent to signing it electronically.
        </label>
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button loading={signMutation.isPending} disabled={!name.trim() || !consent} onClick={() => signMutation.mutate()}>
            Sign
          </Button>
        </div>
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Reviewer invitations

function InviteReviewerModal({
  profileId,
  version,
  onClose,
}: {
  profileId: string;
  version: PlanVersionMeta;
  onClose: () => void;
}) {
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [canApprove, setCanApprove] = useState(false);
  const [link, setLink] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');

  const inviteMutation = useMutation({
    mutationFn: () =>
      api.post<{ review_path: string }>(`/care-profiles/${profileId}/plan/versions/${version.id}/reviews`, {
        invited_name: name.trim() || null,
        invited_email: email.trim() || null,
        can_comment: true,
        can_approve: canApprove,
      }),
    onSuccess: (res) => setLink(`${window.location.origin}${res.review_path}`),
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not create the review link.'),
  });

  return (
    <Modal open onClose={onClose} title={`Invite a reviewer for version ${version.version}`}>
      <div className="space-y-4">
        {link ? (
          <>
            <p className="text-sm text-ink">Share this secure link. It expires after 14 days.</p>
            <div className="flex items-center gap-2">
              <Input aria-label="Review link" value={link} readOnly className="flex-1" />
              <Button
                size="sm"
                variant="secondary"
                onClick={() => {
                  void navigator.clipboard.writeText(link);
                  setCopied(true);
                  setTimeout(() => setCopied(false), 2000);
                }}
              >
                {copied ? 'Copied' : 'Copy link'}
              </Button>
            </div>
            <div className="flex justify-end">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
            </div>
          </>
        ) : (
          <>
            <p className="text-xs text-muted">
              The reviewer opens a secure link to read this version and leave a comment, without needing an
              account. Every view and response is recorded in the activity log.
            </p>
            <Input label="Reviewer name" value={name} onChange={(e) => setName(e.target.value)} />
            <Input label="Reviewer email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} hint="Used to label their responses. The link itself is what grants access." />
            <label className="flex items-center gap-2 text-sm text-ink">
              <input
                type="checkbox"
                className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                checked={canApprove}
                onChange={(e) => setCanApprove(e.target.checked)}
              />
              Allow this reviewer to approve the version
            </label>
            {error ? <p className="text-sm text-red-600">{error}</p> : null}
            <div className="flex justify-end gap-2">
              <Button variant="ghost" onClick={onClose}>
                Cancel
              </Button>
              <Button loading={inviteMutation.isPending} onClick={() => inviteMutation.mutate()}>
                Create link
              </Button>
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}

// ---------------------------------------------------------------------------
// Access control

function AccessModal({ profileId, onClose }: { profileId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [who, setWho] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('carer');
  const [perms, setPerms] = useState({ can_view: true, can_comment: true, can_edit: false, can_sign: false });
  const [error, setError] = useState('');

  const { data } = useQuery({
    queryKey: ['plan-access', profileId],
    queryFn: () => api.get<{ access: PlanAccessRow[]; can_manage: boolean }>(`/care-profiles/${profileId}/plan/access`),
  });
  const { data: circleData } = useQuery({
    queryKey: ['circle', profileId],
    queryFn: () => api.get<{ members: CircleMember[] }>(`/care-profiles/${profileId}/circle`),
  });
  const members = circleData?.members ?? [];
  const rows = data?.access ?? [];
  const canManage = data?.can_manage ?? false;
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['plan-access', profileId] });

  const addMutation = useMutation({
    mutationFn: () =>
      api.post(`/care-profiles/${profileId}/plan/access`, {
        account_id: who && who !== 'email' ? who : null,
        email: who === 'email' ? email.trim() : null,
        access_role: role,
        ...perms,
      }),
    onSuccess: () => {
      setWho('');
      setEmail('');
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not grant access.'),
  });
  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profileId}/plan/access/${id}`),
    onSuccess: invalidate,
  });

  const selectClass =
    'rounded-md border border-border bg-card px-3 py-2 text-sm shadow-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

  return (
    <Modal open onClose={onClose} title="Care plan access" wide>
      <div className="space-y-4">
        <p className="text-xs text-muted">
          Without an entry here, circle access applies: the owner and lead coordinators do everything,
          contributors view, comment and update, and viewers only read. An entry below replaces that for
          the person named.
        </p>
        {rows.length === 0 ? (
          <p className="text-sm text-muted">No explicit access entries.</p>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead>
                <tr className="border-b border-border text-left text-xs text-muted">
                  <th className="py-1.5 pr-3">Who</th>
                  <th className="py-1.5 pr-3">Role</th>
                  <th className="py-1.5 pr-3">View</th>
                  <th className="py-1.5 pr-3">Comment</th>
                  <th className="py-1.5 pr-3">Edit</th>
                  <th className="py-1.5 pr-3">Sign</th>
                  {canManage ? <th className="py-1.5 w-20" /> : null}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.map((r) => (
                  <tr key={r.id}>
                    <td className="py-2 pr-3 text-ink">{r.account_name ?? r.email ?? r.account_email ?? ''}</td>
                    <td className="py-2 pr-3 text-ink">{planAccessRoleLabel(r.access_role)}</td>
                    <td className="py-2 pr-3 text-ink">{r.can_view ? 'Yes' : 'No'}</td>
                    <td className="py-2 pr-3 text-ink">{r.can_comment ? 'Yes' : 'No'}</td>
                    <td className="py-2 pr-3 text-ink">{r.can_edit ? 'Yes' : 'No'}</td>
                    <td className="py-2 pr-3 text-ink">{r.can_sign ? 'Yes' : 'No'}</td>
                    {canManage ? (
                      <td className="py-2 text-right">
                        <Button size="xs" variant="ghost-danger" onClick={() => removeMutation.mutate(r.id)}>
                          Remove
                        </Button>
                      </td>
                    ) : null}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {canManage ? (
          <div className="border-t border-border pt-3 space-y-3">
            <h4 className="text-sm font-semibold text-ink">Grant access</h4>
            <div className="flex flex-wrap items-end gap-2">
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Who</span>
                <select aria-label="Who to grant access" className={selectClass} value={who} onChange={(e) => setWho(e.target.value)}>
                  <option value="">Choose a person</option>
                  {members
                    .filter((m) => m.account_id)
                    .map((m) => (
                      <option key={m.id} value={m.account_id!}>
                        {m.display_name}
                      </option>
                    ))}
                  <option value="email">Someone by email</option>
                </select>
              </label>
              {who === 'email' ? (
                <label className="flex flex-col gap-1">
                  <span className="text-xs text-muted">Email</span>
                  <Input aria-label="Email to share with" type="email" value={email} onChange={(e) => setEmail(e.target.value)} className="w-48" />
                </label>
              ) : null}
              <label className="flex flex-col gap-1">
                <span className="text-xs text-muted">Role</span>
                <select aria-label="Access role" className={selectClass} value={role} onChange={(e) => setRole(e.target.value)}>
                  {PLAN_ACCESS_ROLES.map((r) => (
                    <option key={r.value} value={r.value}>
                      {r.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <div className="flex flex-wrap items-center gap-4">
              {(
                [
                  ['can_view', 'View'],
                  ['can_comment', 'Comment'],
                  ['can_edit', 'Edit'],
                  ['can_sign', 'Sign'],
                ] as const
              ).map(([key, label]) => (
                <label key={key} className="flex items-center gap-1.5 text-sm text-ink">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-border text-primary focus:ring-primary"
                    checked={perms[key]}
                    onChange={(e) => setPerms({ ...perms, [key]: e.target.checked })}
                  />
                  {label}
                </label>
              ))}
              <Button
                size="sm"
                variant="secondary"
                disabled={!who || (who === 'email' && !email.trim())}
                loading={addMutation.isPending}
                onClick={() => addMutation.mutate()}
              >
                Grant
              </Button>
            </div>
          </div>
        ) : null}
        {error ? <p className="text-sm text-red-600">{error}</p> : null}
        <div className="flex justify-end">
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
        </div>
      </div>
    </Modal>
  );
}
