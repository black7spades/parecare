import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '../../api/client';
import { DataToolbar } from '../../components/data/DataToolbar';
import { useDataView, type DataSort, type DataFilter } from '../../components/data/useDataView';
import { Avatar } from '../../components/ui/Avatar';
import { ageFrom, phaseLabel, CARE_PHASES, type ProfileKind } from '../../lib/care';
import { format } from 'date-fns';

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
  circle_members: CircleMember[] | null;
}

const PEOPLE_SORTS: DataSort<DirectoryProfile>[] = [
  { key: 'name', label: 'Name', compare: (a, b) => a.full_name.localeCompare(b.full_name) },
  { key: 'age', label: 'Age', compare: (a, b) => (ageFrom(b.date_of_birth) ?? -1) - (ageFrom(a.date_of_birth) ?? -1) },
  { key: 'phase', label: 'Phase', compare: (a, b) => phaseLabel(a.current_phase).localeCompare(phaseLabel(b.current_phase)) },
];

const PETS_SORTS: DataSort<DirectoryProfile>[] = [
  { key: 'name', label: 'Name', compare: (a, b) => a.full_name.localeCompare(b.full_name) },
  { key: 'species', label: 'Species', compare: (a, b) => (a.species ?? '').localeCompare(b.species ?? '') },
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
  const isPeople = kind === 'person';
  const label = isPeople ? 'People' : 'Pets';
  const endpoint = isPeople ? '/directory/people' : '/directory/pets';
  const sorts = isPeople ? PEOPLE_SORTS : PETS_SORTS;
  const filters = isPeople ? PEOPLE_FILTERS : PETS_FILTERS;

  const { data, isLoading } = useQuery({
    queryKey: ['directory-profiles', kind],
    queryFn: () => api.get<{ profiles: DirectoryProfile[]; can_edit: boolean }>(endpoint),
  });
  const profiles = data?.profiles ?? [];

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
        ...(p.circle_members ?? []).map((m) => m.display_name),
      ]
        .filter(Boolean)
        .join(' '),
    sorts,
    filters,
  });

  return (
    <div>
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-ink">{label} directory</h2>
          <p className="text-sm text-muted">
            {isPeople
              ? 'All people across your care profiles.'
              : 'All pets across your care profiles.'}
          </p>
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
        <div className="card text-center py-10">
          <p className="text-sm text-muted">No {label.toLowerCase()} in the directory yet.</p>
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
                <th className="px-3 py-2 font-medium">Name</th>
                {isPeople ? (
                  <>
                    <th className="px-3 py-2 font-medium">Age</th>
                    <th className="px-3 py-2 font-medium">Date of birth</th>
                    <th className="px-3 py-2 font-medium">Phase</th>
                  </>
                ) : (
                  <>
                    <th className="px-3 py-2 font-medium">Species</th>
                    <th className="px-3 py-2 font-medium">Breed</th>
                  </>
                )}
                <th className="px-3 py-2 font-medium">Contact</th>
                <th className="px-3 py-2 font-medium">Care circle</th>
              </tr>
            </thead>
            <tbody>
              {dv.view.map((p) => (
                <tr
                  key={p.id}
                  className="border-b border-border last:border-0 align-top hover:bg-surface-2/50"
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
                          ? format(new Date(p.date_of_birth), 'd MMM yyyy')
                          : '-'}
                      </td>
                      <td className="px-3 py-2">
                        <span className="badge bg-surface-2 text-muted text-xs">
                          {phaseLabel(p.current_phase)}
                        </span>
                      </td>
                    </>
                  ) : (
                    <>
                      <td className="px-3 py-2 text-muted">{p.species || '-'}</td>
                      <td className="px-3 py-2 text-muted">{p.breed || '-'}</td>
                    </>
                  )}
                  <td className="px-3 py-2">
                    {p.contact_name || p.contact_phone || p.contact_email ? (
                      <span className="text-ink text-xs">
                        {p.contact_name ? <span>{p.contact_name}</span> : null}
                        {p.contact_phone ? (
                          <>
                            {p.contact_name ? <br /> : null}
                            <a
                              href={`tel:${p.contact_phone}`}
                              className="text-primary hover:underline"
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
                              className="text-primary hover:underline"
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
                  </td>
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
    </div>
  );
}
