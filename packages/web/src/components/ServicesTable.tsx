import { useState } from 'react';
import { api } from '../api/client';
import { Button } from './ui/Button';
import { Input } from './ui/Input';
import { Modal } from './ui/Modal';
import { DataToolbar } from './data/DataToolbar';
import { SortableTh } from './data/SortableTh';
import { useDataView, type DataSort } from './data/useDataView';
import { CONTACT_LINK } from './ContactStrip';
import { PhoneLink } from './cards/profile/links';
import { formatDateOnly } from '../lib/datetime';
import type { Service } from '../lib/country';

/**
 * The national services people are sent to, one row each: what it is for,
 * its name, phone and website, where the details come from and when they
 * were last checked. Change any of them, mark one as still right, put the
 * original back, or add one. Used for everyone by whoever runs PareCare,
 * and by an account owner for their own account.
 */

const SOURCE_WORDS: Record<Service['source'], string> = {
  original: 'Built in',
  everyone: 'Set for everyone',
  own: 'Your own',
};

const SORTS: DataSort<Service>[] = [
  { key: 'label', label: 'What it is for', compare: (a, b) => a.label.localeCompare(b.label) },
  { key: 'name', label: 'Name', compare: (a, b) => (a.name ?? '~').localeCompare(b.name ?? '~') },
  { key: 'phone', label: 'Phone', compare: (a, b) => (a.phone ?? '~').localeCompare(b.phone ?? '~') },
  { key: 'website', label: 'Website', compare: (a, b) => (a.website ?? '~').localeCompare(b.website ?? '~') },
  { key: 'source', label: 'Details from', compare: (a, b) => SOURCE_WORDS[a.source].localeCompare(SOURCE_WORDS[b.source]) },
  { key: 'checked', label: 'Last checked', compare: (a, b) => (a.checked_on ?? '0000').localeCompare(b.checked_on ?? '0000') },
];

const host = (url: string) => {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch {
    return url;
  }
};

export function ServicesTable({
  services,
  basePath,
  everyone,
  onChanged,
}: {
  services: Service[];
  /** '/admin/country' for everyone, '/country/account' for one account. */
  basePath: string;
  /** Changes here are for everyone, not one account. */
  everyone: boolean;
  /** The list after a change, as the server now has it. */
  onChanged: (services: Service[]) => void;
}) {
  const [editing, setEditing] = useState<Service | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [note, setNote] = useState<{ text: string; undo?: () => void } | null>(null);
  const [error, setError] = useState('');
  const dv = useDataView({
    rows: services,
    getId: (s) => s.kind,
    searchText: (s) => [s.label, s.name, s.phone, s.website].filter(Boolean).join(' '),
    sorts: SORTS,
    defaultPageSize: 25,
  });

  const run = async (key: string, fn: () => Promise<{ services: Service[] }>, done?: string, undo?: () => void) => {
    setBusy(key);
    setError('');
    try {
      const res = await fn();
      onChanged(res.services);
      setNote(done ? { text: done, undo } : null);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'That did not save. Try again in a moment.');
    } finally {
      setBusy(null);
    }
  };

  const path = (kind: string) => `${basePath}/services/${encodeURIComponent(kind)}`;

  const stillRight = (s: Service) =>
    run(`checked:${s.kind}`, () => api.post<{ services: Service[] }>(`${path(s.kind)}/checked`), `${s.name ?? s.label} marked as checked today.`);

  const backToOriginal = (s: Service) => {
    const was = { name: s.name, phone: s.phone, website: s.website, label: s.added ? s.label : null };
    void run(
      `reset:${s.kind}`,
      () => api.delete<{ services: Service[] }>(path(s.kind)),
      s.added ? `${s.label} removed.` : `${s.label} is back to the original details.`,
      // Undo puts back exactly what was there.
      () => {
        if (s.added) void run('undo', () => api.post<{ services: Service[] }>(`${basePath}/services`, was), `${s.label} is back.`);
        else void run('undo', () => api.put<{ services: Service[] }>(path(s.kind), was), 'Put back as it was.');
      }
    );
  };

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="flex-1 min-w-[14rem]">
          <DataToolbar
            search={dv.search}
            onSearch={dv.setSearch}
            searchPlaceholder="Search services…"
            sorts={SORTS}
            sortKey={dv.sortKey}
            onSort={dv.setSortKey}
            filters={[]}
            filterValues={dv.filterValues}
            onFilter={dv.setFilter}
            page={dv.page}
            totalPages={dv.totalPages}
            pageSize={dv.pageSize}
            totalFiltered={dv.totalFiltered}
            onPageChange={dv.setPage}
            onPageSizeChange={dv.setPageSize}
          />
        </div>
        <Button size="sm" variant="secondary" onClick={() => setEditing('new')}>
          Add a service
        </Button>
      </div>
      {note ? (
        <p className="text-sm text-muted flex flex-wrap items-center gap-2" role="status">
          {note.text}
          {note.undo ? (
            <Button size="xs" variant="ghost" onClick={() => { const u = note.undo; setNote(null); u?.(); }}>
              Undo
            </Button>
          ) : null}
        </p>
      ) : null}
      {error ? <p className="text-sm text-red-600" role="alert">{error}</p> : null}
      {dv.view.length === 0 ? (
        <div className="card text-center py-8">
          <p className="text-sm text-muted">No services match your search.</p>
        </div>
      ) : (
        <div className="card p-0 fit-table">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr className="text-left text-xs text-muted">
                <SortableTh label="What it is for" sortKey="label" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Name" sortKey="name" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Phone" sortKey="phone" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Website" sortKey="website" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Details from" sortKey="source" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <SortableTh label="Last checked" sortKey="checked" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                <th className="px-3 py-2" />
              </tr>
            </thead>
            <tbody>
              {dv.view.map((s) => (
                <tr key={s.kind} className="border-b border-border last:border-0 align-top">
                  <td className="px-3 py-2 text-ink">{s.label}</td>
                  <td className="px-3 py-2 text-ink">{s.name ?? <span className="text-muted">None yet</span>}</td>
                  <td className="px-3 py-2">{s.phone ? <PhoneLink phone={s.phone} /> : <span className="text-muted">-</span>}</td>
                  <td className="px-3 py-2">
                    {s.website ? (
                      <a href={s.website} target="_blank" rel="noopener noreferrer" className={CONTACT_LINK}>
                        {host(s.website)}
                      </a>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>
                  <td className="px-3 py-2 text-muted">{SOURCE_WORDS[s.source]}</td>
                  <td className="px-3 py-2 text-muted">{s.checked_on ? formatDateOnly(s.checked_on) : 'Not yet'}</td>
                  <td className="px-3 py-2">
                    <div className="flex flex-wrap justify-end gap-1">
                      {s.missing ? (
                        <Button size="xs" variant="secondary" onClick={() => setEditing(s)}>
                          Add the number
                        </Button>
                      ) : (
                        <>
                          <Button size="xs" variant="ghost" loading={busy === `checked:${s.kind}`} onClick={() => void stillRight(s)}>
                            Still right
                          </Button>
                          <Button size="xs" variant="ghost" onClick={() => setEditing(s)}>
                            Edit
                          </Button>
                        </>
                      )}
                      {s.source === (everyone ? 'everyone' : 'own') ? (
                        <Button size="xs" variant={s.added ? 'ghost-danger' : 'ghost'} loading={busy === `reset:${s.kind}`} onClick={() => backToOriginal(s)}>
                          {s.added ? 'Remove' : 'Back to the original'}
                        </Button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <ServiceEditor
        open={editing !== null}
        service={editing === 'new' ? null : editing}
        everyone={everyone}
        onClose={() => setEditing(null)}
        onSave={async (values) => {
          const res =
            editing === 'new'
              ? await api.post<{ services: Service[] }>(`${basePath}/services`, values)
              : await api.put<{ services: Service[] }>(path((editing as Service).kind), values);
          onChanged(res.services);
          setNote({ text: editing === 'new' ? `${values.label} added.` : `${(editing as Service).label} saved. It shows everywhere it is used.` });
          setEditing(null);
        }}
      />
    </div>
  );
}

/** Change a service's details, or add one. Save names any box still needed. */
export function ServiceEditor({
  open,
  service,
  everyone,
  onClose,
  onSave,
  title,
}: {
  open: boolean;
  service: Service | null;
  everyone: boolean;
  onClose: () => void;
  onSave: (v: { label: string; name: string; phone: string; website: string }) => Promise<void>;
  title?: string;
}) {
  const [label, setLabel] = useState('');
  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [website, setWebsite] = useState('');
  const [problem, setProblem] = useState('');
  const [saving, setSaving] = useState(false);
  const [openedFor, setOpenedFor] = useState<string | null>(null);

  const key = open ? service?.kind ?? 'new' : null;
  if (key !== openedFor) {
    setOpenedFor(key);
    setLabel(service?.added ? service.label : '');
    setName(service?.name ?? '');
    setPhone(service?.phone ?? '');
    setWebsite(service?.website ?? '');
    setProblem('');
  }

  const isNew = !service;
  const save = async () => {
    const missing: string[] = [];
    if (isNew && !label.trim()) missing.push('What it is for');
    if (!name.trim()) missing.push('Name');
    if (!phone.trim() && !website.trim()) missing.push('Phone or Website');
    if (missing.length) {
      setProblem(`Fill in ${missing.join(' and ')}.`);
      return;
    }
    setSaving(true);
    setProblem('');
    try {
      await onSave({ label: label.trim(), name: name.trim(), phone: phone.trim(), website: website.trim() });
    } catch (err) {
      setProblem(err instanceof Error ? err.message : 'That did not save. Try again in a moment.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal open={open} onClose={onClose} title={title ?? (isNew ? 'Add a service' : service!.label)}>
      <form
        className="space-y-3"
        onSubmit={(e) => {
          e.preventDefault();
          void save();
        }}
      >
        {isNew ? <Input label="What it is for" value={label} onChange={(e) => setLabel(e.target.value)} placeholder="e.g. Local hospice" /> : null}
        <Input label="Name" value={name} onChange={(e) => setName(e.target.value)} />
        <Input label="Phone" value={phone} onChange={(e) => setPhone(e.target.value)} inputMode="tel" />
        <Input label="Website" value={website} onChange={(e) => setWebsite(e.target.value)} placeholder="www.example.org" />
        <p className="text-xs text-muted">
          {everyone ? 'This changes it for everyone using PareCare.' : 'This changes it for everyone on your account.'} Today counts as the day it was last checked.
        </p>
        <div className="flex flex-wrap items-center justify-end gap-3">
          {problem ? <p className="text-sm text-red-600" role="alert">{problem}</p> : null}
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" loading={saving}>
            Save
          </Button>
        </div>
      </form>
    </Modal>
  );
}
