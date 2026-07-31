import {  } from 'react';
import {  } from 'react-router-dom';
import { CrossIcon } from '../../../../components/ui/icons';
import {  } from '../../../../components/CatalogueCombo';
import {  } from '../../../../components/ProseReport';
import {  } from '../../../../components/AllergyModal';
import { PLAN_ACCESS_ROLES, planAccessRoleLabel,
   type CircleMember, type PlanAccessRow } from '../../../../lib/care';
import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {  } from 'date-fns';
import { api } from '../../../../api/client';
import { Button } from '../../../../components/ui/Button';
import { Input } from '../../../../components/ui/Input';
import { Modal } from '../../../../components/ui/Modal';

export function AccessModal({ profileId, onClose }: { profileId: string; onClose: () => void }) {
  const queryClient = useQueryClient();
  const [who, setWho] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('carer');
  const [perms, setPerms] = useState({ can_view: true, can_comment: true, can_edit: false, can_sign: false });
  const [error, setError] = useState('');

  const { data } = useQuery({
    queryKey: ['plan-access', profileId],
    queryFn: () => api.get<{ access: PlanAccessRow[]; can_manage: boolean }>(`/care-profiles/${profileId}/plan/access`) });
  const { data: circleData } = useQuery({
    queryKey: ['circle', profileId],
    queryFn: () => api.get<{ members: CircleMember[] }>(`/care-profiles/${profileId}/circle`) });
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
        ...perms }),
    onSuccess: () => {
      setWho('');
      setEmail('');
      invalidate();
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'Could not grant access.') });
  const removeMutation = useMutation({
    mutationFn: (id: string) => api.delete(`/care-profiles/${profileId}/plan/access/${id}`),
    onSuccess: invalidate });

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
                        <Button size="xs" variant="ghost-danger" aria-label={`Remove access for ${r.account_name ?? r.email ?? 'this person'}`} title="Remove" onClick={() => removeMutation.mutate(r.id)}>
                          <CrossIcon />
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
