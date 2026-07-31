import {  } from 'react';
import { Link } from 'react-router-dom';
import {  } from '../../../../components/ui/icons';
import {  } from '../../../../components/CatalogueCombo';
import { ProseReport } from '../../../../components/ProseReport';
import {  } from '../../../../components/AllergyModal';
import {  PLAN_NARRATIVE_SECTIONS, planSectionLabel, planVersionStatusLabel,
     type PlanChange, type PlanContent, type PlanEntry,
  type PlanPermissions, type PlanReview, type PlanSignature, type PlanVersionMeta } from '../../../../lib/care';
import { SECTION_MANAGE_LINKS, SECTION_ORDER, fieldLabel, fieldText, fmtWhen } from './shared';
import { useState } from 'react';
import {  useQuery } from '@tanstack/react-query';
import {  } from 'date-fns';
import { api } from '../../../../api/client';
import { Button } from '../../../../components/ui/Button';
import { Modal } from '../../../../components/ui/Modal';

export function ContentSections({ content }: { content: PlanContent }) {
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

export function VersionViewer({
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
