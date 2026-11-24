import { useAuthStore } from '../../stores/auth';
import { Link } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { api } from '../../api/client';
import { DataToolbar } from '../../components/data/DataToolbar';
import { SortableTh } from '../../components/data/SortableTh';
import { useDataView, type DataSort, type DataFilter } from '../../components/data/useDataView';
import { Avatar } from '../../components/ui/Avatar';
import { Button } from '../../components/ui/Button';
import { ImportExport } from '../../components/ImportExport';
import { EditableSubheader } from '../../components/ui/EditableSubheader';
import { RecordPanel } from '../../components/record/RecordPanel';
import { RECORD_ROW_CLASS, useRecordPanel } from '../../components/record/useRecordPanel';
import { ageFrom, phaseLabel, CARE_PHASES, type ProfileKind } from '../../lib/care';
import { formatDateOnly } from '../../lib/datetime';
import { CONTACT_LINK } from '../../components/ContactStrip';
import { useCountry } from '../../lib/country';

interface CircleMember {
  display_name: string;
  relationship: string | null;
  role: string;
}

interface DirectoryProfile {
  id: string;
  full_name: string;
  preferred_name: string | null;
  date_of_birth: string | null;
  current_phase: string;
  photo_url: string | null;
  photo_color: string | null;
  contact_name: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  owner_relationship: string | null;
  species: string | null;
  breed: string | null;
  desexed: boolean;
  microchip_number: string | null;
  owner_name: string | null;
  circle_members: CircleMember[] | null;
  room_number?: string | null;
  gp_name?: string | null;
  gp_phone?: string | null;
  gp_practice?: string | null;
  next_of_kin_name?: string | null;
  next_of_kin_relationship?: string | null;
  next_of_kin_phone?: string | null;
}

// Missing values sort to the end, whichever way round.
const last = (v: string | null | undefined) => (v && v.trim() ? v : '\uffff');
const telOf = (phone: string) => `tel:${phone.replace(/[^\d+]/g, '')}`;

const contactText = (p: DirectoryProfile) => (p.contact_name ?? p.contact_phone ?? p.contact_email ?? '');
const circleCount = (p: DirectoryProfile) => p.circle_members?.length ?? 0;

const PEOPLE_SORTS: DataSort<DirectoryProfile>[] = [
  { key: 'name', label: 'Name', compare: (a, b) => a.full_name.localeCompare(b.full_name) },
  { key: 'age', label: 'Age', compare: (a, b) => (ageFrom(b.date_of_birth) ?? -1) - (ageFrom(a.date_of_birth) ?? -1) },
  { key: 'dob', label: 'Date of birth', compare: (a, b) => (a.date_of_birth ?? '').localeCompare(b.date_of_birth ?? '') },
  { key: 'room', label: 'Room', compare: (a, b) => last(a.room_number).localeCompare(last(b.room_number), undefined, { numeric: true }) },
  { key: 'phase', label: 'Phase', compare: (a, b) => phaseLabel(a.current_phase).localeCompare(phaseLabel(b.current_phase)) },
  { key: 'gp', label: 'GP', compare: (a, b) => last(a.gp_name).localeCompare(last(b.gp_name)) },
  { key: 'gp_phone', label: 'GP phone', compare: (a, b) => last(a.gp_phone).localeCompare(last(b.gp_phone)) },
  { key: 'kin', label: 'Next of kin', compare: (a, b) => last(a.next_of_kin_name).localeCompare(last(b.next_of_kin_name)) },
  { key: 'kin_relationship', label: 'Relationship', compare: (a, b) => last(a.next_of_kin_relationship).localeCompare(last(b.next_of_kin_relationship)) },
  { key: 'kin_phone', label: 'Next of kin phone', compare: (a, b) => last(a.next_of_kin_phone).localeCompare(last(b.next_of_kin_phone)) },
  { key: 'circle', label: 'Care circle', compare: (a, b) => circleCount(b) - circleCount(a) },
];

const PETS_SORTS: DataSort<DirectoryProfile>[] = [
  { key: 'name', label: 'Name', compare: (a, b) => a.full_name.localeCompare(b.full_name) },
  { key: 'species', label: 'Species', compare: (a, b) => (a.species ?? '').localeCompare(b.species ?? '') },
  { key: 'breed', label: 'Breed', compare: (a, b) => (a.breed ?? '').localeCompare(b.breed ?? '') },
  { key: 'owner', label: 'Owner', compare: (a, b) => (a.owner_name ?? '').localeCompare(b.owner_name ?? '') },
  { key: 'contact', label: 'Contact', compare: (a, b) => contactText(a).localeCompare(contactText(b)) },
  { key: 'circle', label: 'Care circle', compare: (a, b) => circleCount(b) - circleCount(a) },
];

const PEOPLE_FILTERS: DataFilter<DirectoryProfile>[] = [
  {
    key: 'phase',
    label: 'Phase',
    options: CARE_PHASES.map((p) => ({ value: p.value, label: p.label })),
    match: (row, value) => row.current_phase === value,
  },
];

const PETS_FILTERS: DataFilter<DirectoryProfile>[] = [];

export function DirectoryPeoplePage() {
  return <DirectoryProfilesPage kind="person" />;
}

export function DirectoryPetsPage() {
  return <DirectoryProfilesPage kind="pet" />;
}

function DirectoryProfilesPage({ kind }: { kind: ProfileKind }) {
  // Example numbers the way this country writes them.
  const { config: country } = useCountry();
  const isPeople = kind === 'person';
  const label = isPeople ? 'People' : 'Pets';
  const endpoint = isPeople ? '/directory/people' : '/directory/pets';
  const sorts = isPeople ? PEOPLE_SORTS : PETS_SORTS;
  const filters = isPeople ? PEOPLE_FILTERS : PETS_FILTERS;

  const queryClient = useQueryClient();
  const { data, isLoading } = useQuery({
    queryKey: ['directory-profiles', kind],
    queryFn: () => api.get<{ profiles: DirectoryProfile[]; can_edit: boolean; can_import?: boolean }>(endpoint),
  });
  const profiles = data?.profiles ?? [];
  const canEdit = data?.can_edit ?? false;
  const canImport = data?.can_import ?? canEdit;
  const canCreate = useAuthStore((s) => s.account?.can_create_care_profiles !== false);
  const invalidate = () => void queryClient.invalidateQueries({ queryKey: ['directory-profiles', kind] });

  const dv = useDataView<DirectoryProfile>({
    rows: profiles,
    getId: (p) => p.id,
    searchText: (p) =>
      [
        p.full_name,
        p.preferred_name,
        p.contact_name,
        p.contact_phone,
        p.contact_email,
        p.owner_relationship,
        isPeople ? phaseLabel(p.current_phase) : null,
        p.species,
        p.breed,
        p.owner_name,
        p.room_number,
        p.gp_name,
        p.next_of_kin_name,
        ...(p.circle_members ?? []).map((m) => m.display_name),
      ]
        .filter(Boolean)
        .join(' '),
    sorts,
    filters,
  });
  const panel = useRecordPanel(profiles, (p) => p.id);
  const current = panel.current;

  return (
    <div>
      <div className="flex items-center justify-between gap-3 mb-4">
        <div className="min-w-0">
          <h2 className="text-base font-semibold text-ink">{label} directory</h2>
          <EditableSubheader copyKey={isPeople ? 'directory.profiles.people.subheader' : 'directory.profiles.pets.subheader'} />
        </div>
        <div className="flex gap-2 shrink-0">
          <ImportExport
            basePath={isPeople ? '/directory/people' : '/directory/pets'}
            resource={isPeople ? 'people' : 'pets'}
            canImport={isPeople ? canImport : canEdit}
            onImported={invalidate}
            templateHeaders={isPeople
              ? ['Name', 'Preferred name', 'Date of birth', 'Pronouns', 'Language', 'Phase', 'Relationship', 'Room', 'GP name', 'GP phone', 'GP practice', 'Next of kin name', 'Next of kin relationship', 'Next of kin phone', 'Next of kin email']
              : ['Name', 'Species', 'Breed', 'Desexed', 'Microchip', 'Date of birth', 'Relationship', 'Contact name', 'Contact phone', 'Contact email']}
            templateSample={isPeople
              ? ['Marie Rose', 'Marie', '1948-03-14', 'she/her', 'English', 'Residential ongoing', 'Resident', '112', 'Dr Rachel Cohen', country.phone_example, 'City Medical', 'Chris Rattray', 'Son', country.phone_example, 'chris@example.com']
              : ['Bread Loaf', 'Cat', 'Domestic Shorthair', 'true', '', '2019-06-01', 'Cat', 'Chris Rattray', country.phone_example, '']}
          />
          {/* Offered to everyone allowed to set up a profile. */}
          {profiles.length > 0 && canCreate ? (
            <Link to={`/app/profiles/new?kind=${kind}`}>
              <Button>{isPeople ? 'Add person' : 'Add pet'}</Button>
            </Link>
          ) : null}
        </div>
      </div>

      {profiles.length > 0 ? (
        <div className="mb-4">
          <DataToolbar
            search={dv.search}
            onSearch={dv.setSearch}
            searchPlaceholder={`Search ${label.toLowerCase()}…`}
            sorts={sorts}
            sortKey={dv.sortKey}
            onSort={dv.setSortKey}
            filters={filters}
            filterValues={dv.filterValues}
            onFilter={dv.setFilter}
            selectedCount={0}
            bulkActions={[]}
            onClearSelection={() => {}}
            page={dv.page}
            totalPages={dv.totalPages}
            pageSize={dv.pageSize}
            totalFiltered={dv.totalFiltered}
            onPageChange={dv.setPage}
            onPageSizeChange={dv.setPageSize}
          />
        </div>
      ) : null}

      {isLoading ? (
        <p className="text-sm text-muted">Loading…</p>
      ) : profiles.length === 0 ? (
        <div className="card text-center py-10 space-y-3">
          <p className="text-sm font-semibold text-ink">{isPeople ? 'No one here yet' : 'No pets here yet'}</p>
          <p className="text-sm text-muted max-w-md mx-auto">
            {isPeople
              ? 'Everyone you look after shows here, with who to contact and who is in their care circle. Add the first person to get started.'
              : 'Every pet you look after shows here, with their owner and who to contact. Add the first pet to get started.'}
          </p>
          {canCreate ? (
            <Link to={`/app/profiles/new?kind=${kind}`} className="inline-block">
              <Button>{isPeople ? 'Add a person' : 'Add a pet'}</Button>
            </Link>
          ) : (
            <p className="text-xs text-muted">The person who manages this account adds people here.</p>
          )}
        </div>
      ) : dv.view.length === 0 ? (
        <div className="card text-center py-10">
          <p className="text-sm text-muted">No {label.toLowerCase()} match your search.</p>
        </div>
      ) : (
        <div className="card p-0 overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="border-b border-border">
              <tr className="text-left text-xs text-muted">
                <SortableTh label="Name" sortKey="name" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                {isPeople ? (
                  <>
                    <SortableTh label="Age" sortKey="age" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                    <SortableTh label="Date of birth" sortKey="dob" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                    <SortableTh label="Room" sortKey="room" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                    <SortableTh label="Phase" sortKey="phase" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                    <SortableTh label="GP" sortKey="gp" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                    <SortableTh label="GP phone" sortKey="gp_phone" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                    <SortableTh label="Next of kin" sortKey="kin" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                    <SortableTh label="Relationship" sortKey="kin_relationship" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                    <SortableTh label="Next of kin phone" sortKey="kin_phone" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  </>
                ) : (
                  <>
                    <SortableTh label="Species" sortKey="species" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                    <SortableTh label="Breed" sortKey="breed" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                    <SortableTh label="Owner" sortKey="owner" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
                  </>
                )}
                {isPeople ? null : <SortableTh label="Contact" sortKey="contact" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />}
                <SortableTh label="Care circle" sortKey="circle" activeKey={dv.sortKey} dir={dv.sortDir} onToggle={dv.toggleSort} />
              </tr>
            </thead>
            <tbody>
              {dv.view.map((p) => (
                <tr
                  key={p.id}
                  {...panel.rowProps(p.id)}
                  className={`border-b border-border last:border-0 align-top ${RECORD_ROW_CLASS}`}
                >
                  <td className="px-3 py-2">
                    <Link
                      to={`/app/${p.id}`}
                      className="flex items-center gap-2 hover:underline"
                    >
                      <Avatar
                        accountId={p.id}
                        name={p.full_name}
                        avatarUrl={p.photo_url}
                        color={p.photo_color}
                        fetchPath={`/care-profiles/${p.id}/photo`}
                        size={28}
                      />
                      <span>
                        <span className="font-medium text-primary">{p.full_name}</span>
                        {p.preferred_name ? (
                          <span className="block text-xs text-muted">
                            Known as {p.preferred_name}
                          </span>
                        ) : null}
                        {p.owner_relationship ? (
                          <span className="block text-xs text-muted">
                            {p.owner_relationship}
                          </span>
                        ) : null}
                      </span>
                    </Link>
                  </td>
                  {isPeople ? (
                    <>
                      <td className="px-3 py-2 text-muted">
                        {ageFrom(p.date_of_birth) != null ? ageFrom(p.date_of_birth) : '-'}
                      </td>
                      <td className="px-3 py-2 text-muted">
                        {p.date_of_birth
                          ? formatDateOnly(p.date_of_birth, 'd MMM yyyy')
                          : '-'}
                      </td>
                      <td className="px-3 py-2 text-ink whitespace-nowrap">{p.room_number || '-'}</td>
                      <td className="px-3 py-2">
                        <span className="badge bg-surface-2 text-muted text-xs">
                          {phaseLabel(p.current_phase)}
                        </span>
                      </td>
                      <td className="px-3 py-2 text-ink">{p.gp_name || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {p.gp_phone ? <a href={telOf(p.gp_phone)} className={CONTACT_LINK} onClick={(e) => e.stopPropagation()} aria-label={`Call ${p.gp_name ?? 'their GP'} on ${p.gp_phone}`}>{p.gp_phone}</a> : <span className="text-muted">-</span>}
                      </td>
                      <td className="px-3 py-2 text-ink">{p.next_of_kin_name || '-'}</td>
                      <td className="px-3 py-2 text-muted">{p.next_of_kin_relationship || '-'}</td>
                      <td className="px-3 py-2 whitespace-nowrap">
                        {p.next_of_kin_phone ? <a href={telOf(p.next_of_kin_phone)} className={CONTACT_LINK} onClick={(e) => e.stopPropagation()} aria-label={`Call ${p.next_of_kin_name ?? 'their next of kin'} on ${p.next_of_kin_phone}`}>{p.next_of_kin_phone}</a> : <span className="text-muted">-</span>}
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2 text-muted">{p.species || '-'}</td>
                      <td className="px-3 py-2 text-muted">{p.breed || '-'}</td>
                      <td className="px-3 py-2">
                        {p.owner_name ? <span className="text-ink text-xs">{p.owner_name}</span> : <span className="text-muted">-</span>}
                      </td>
                    </>
                  )}
                  {isPeople ? null : <td className="px-3 py-2">
                    {p.contact_name || p.contact_phone || p.contact_email ? (
                      <span className="text-ink text-xs">
                        {p.contact_name ? <span>{p.contact_name}</span> : null}
                        {p.contact_phone ? (
                          <>
                            {p.contact_name ? <br /> : null}
                            <a
                              href={`tel:${p.contact_phone}`}
                              className={`${CONTACT_LINK}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {p.contact_phone}
                            </a>
                          </>
                        ) : null}
                        {p.contact_email ? (
                          <>
                            {p.contact_name || p.contact_phone ? <br /> : null}
                            <a
                              href={`mailto:${p.contact_email}`}
                              className={`${CONTACT_LINK}`}
                              onClick={(e) => e.stopPropagation()}
                            >
                              {p.contact_email}
                            </a>
                          </>
                        ) : null}
                      </span>
                    ) : (
                      <span className="text-muted">-</span>
                    )}
                  </td>}
                  <td className="px-3 py-2">
                    {p.circle_members && p.circle_members.length > 0 ? (
                      <div className="flex flex-wrap gap-1">
                        {p.circle_members.map((m, i) => (
                          <span
                            key={i}
                            className="badge bg-surface-2 text-muted text-xs"
                          >
                            {m.display_name}
                            {m.relationship ? ` (${m.relationship})` : ''}
                          </span>
                        ))}
                      </div>
                    ) : (
                      <span className="text-xs text-muted">No members</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {current ? (
        <RecordPanel
          key={current.id}
          kindLabel={isPeople ? 'Person' : 'Pet'}
          title={current.full_name}
          subtitle={current.preferred_name ? `Known as ${current.preferred_name}` : undefined}
          recordId={current.id}
          canEdit={canEdit}
          fields={[
            { label: 'Preferred name', value: current.preferred_name },
            { label: 'Relationship', value: current.owner_relationship },
            { label: 'Date of birth', value: current.date_of_birth ? formatDateOnly(current.date_of_birth, 'd MMM yyyy') : null },
            { label: 'Age', value: ageFrom(current.date_of_birth) != null ? String(ageFrom(current.date_of_birth)) : null },
            ...(isPeople
              ? [
                  { label: 'Phase', value: phaseLabel(current.current_phase) },
                  { label: 'Room', value: current.room_number ?? null },
                  { label: 'GP', value: current.gp_name ?? null },
                  { label: 'GP practice', value: current.gp_practice ?? null },
                  { label: 'GP phone', value: current.gp_phone ? <a href={telOf(current.gp_phone)} className={CONTACT_LINK}>{current.gp_phone}</a> : null },
                  { label: 'Next of kin', value: current.next_of_kin_name ?? null },
                  { label: 'Next of kin relationship', value: current.next_of_kin_relationship ?? null },
                ]
              : [
                  { label: 'Species', value: current.species },
                  { label: 'Breed', value: current.breed },
                  { label: 'Desexed', value: current.desexed ? 'Yes' : 'No' },
                  { label: 'Microchip number', value: current.microchip_number },
                  { label: 'Owner', value: current.owner_name },
                ]),
            { label: 'Contact name', value: current.contact_name },
            {
              label: 'Contact phone',
              value: current.contact_phone ? <a href={`tel:${current.contact_phone}`} className={`${CONTACT_LINK}`}>{current.contact_phone}</a> : null,
            },
            {
              label: 'Contact email',
              value: current.contact_email ? <a href={`mailto:${current.contact_email}`} className={`${CONTACT_LINK}`}>{current.contact_email}</a> : null,
            },
          ]}
          links={[
            { label: 'Overview', value: `Open ${current.preferred_name || current.full_name}`, to: `/app/${current.id}` },
            ...(current.circle_members ?? []).map((m) => ({
              label: m.relationship || 'Care circle',
              value: m.display_name,
              to: `/app/${current.id}/circle`,
            })),
          ]}
          onClose={panel.close}
        />
      ) : null}
    </div>
  );
}
