import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { Button } from '../../../components/ui/Button';
import { Input } from '../../../components/ui/Input';
import { Modal } from '../../../components/ui/Modal';
import { CIRCLE_ROLES } from '../../../lib/care';

const SELECT = 'block w-full rounded-md border border-border bg-card px-3 py-2 text-sm focus:border-primary focus:outline-none focus:ring-1 focus:ring-primary';

/**
 * One invite for many people: a new carer for a wing accepts once and is in
 * every circle. Anyone already in a circle is skipped, and the result says so.
 */
export function BulkInviteModal({ profileIds, notYours, onClose, onSent }: { profileIds: string[]; notYours: number; onClose: () => void; onSent: (message: string) => void }) {
  const queryClient = useQueryClient();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [role, setRole] = useState('support_worker');
  const [permission, setPermission] = useState<'contributor' | 'viewer'>('contributor');
  const [error, setError] = useState('');
  const n = profileIds.length;

  const send = useMutation({
    mutationFn: () =>
      api.post<{ invited: number; email: string; skipped: Array<{ reason: string }>; not_yours: number; full: number }>('/care-profiles/bulk-invite', {
        profile_ids: profileIds,
        email: email.trim(),
        display_name: name.trim(),
        role,
        permission,
      }),
    onSuccess: (r) => {
      void queryClient.invalidateQueries({ queryKey: ['circle'] });
      const left = [
        r.skipped.length ? `${r.skipped.length} ${r.skipped.length === 1 ? 'person was' : 'people were'} left out because they already have access.` : null,
        notYours > 0 ? `${notYours} set up by someone else ${notYours === 1 ? 'was' : 'were'} left out.` : null,
        r.full > 0 ? `${r.full} with a full circle on your plan ${r.full === 1 ? 'was' : 'were'} left out.` : null,
      ].filter(Boolean).join(' ');
      onSent(`Sent one invite to ${r.email} for ${r.invited} ${r.invited === 1 ? 'person' : 'people'}. They see all of them when they accept.${left ? ` ${left}` : ''}`);
    },
    onError: (err) => setError(err instanceof Error ? err.message : 'The invite was not sent. Try again.'),
  });

  const submit = () => {
    const missing = [!name.trim() ? 'their name' : null, !email.trim() ? 'their email' : null].filter(Boolean);
    if (missing.length) {
      setError(`Add ${missing.join(' and ')}, then send the invite.`);
      document.getElementById(!name.trim() ? 'bulk-invite-name' : 'bulk-invite-email')?.focus();
      return;
    }
    setError('');
    send.mutate();
  };

  return (
    <Modal open onClose={onClose} title={`Invite someone to help with ${n} ${n === 1 ? 'person' : 'people'}`}>
      <form className="space-y-4" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <Input id="bulk-invite-name" label="Their name" value={name} onChange={(e) => setName(e.target.value)} placeholder="e.g. Sam Taylor" />
        <Input id="bulk-invite-email" type="email" label="Their email" value={email} onChange={(e) => setEmail(e.target.value)} placeholder="e.g. sam@example.com" />
        <div>
          <label htmlFor="bulk-invite-role" className="block text-sm font-medium text-ink mb-1">Role</label>
          <select id="bulk-invite-role" className={SELECT} value={role} onChange={(e) => setRole(e.target.value)}>
            {CIRCLE_ROLES.map((r) => <option key={r.value} value={r.value}>{r.label}</option>)}
          </select>
        </div>
        <fieldset>
          <legend className="block text-sm font-medium text-ink mb-1">What they can do</legend>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="radio" name="bulk-invite-permission" checked={permission === 'contributor'} onChange={() => setPermission('contributor')} />
            View and add records
          </label>
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="radio" name="bulk-invite-permission" checked={permission === 'viewer'} onChange={() => setPermission('viewer')} />
            View only
          </label>
        </fieldset>
        {notYours > 0 ? (
          <p className="text-xs text-muted">{notYours} of those chosen {notYours === 1 ? 'was' : 'were'} set up by someone else, so only they can invite to {notYours === 1 ? 'it' : 'them'}.</p>
        ) : null}
        {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={send.isPending}>Send one invite</Button>
        </div>
      </form>
    </Modal>
  );
}
