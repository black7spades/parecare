import { useQuery } from '@tanstack/react-query';
import { api } from '../../../api/client';
import { PoaBadge } from '../../../components/PoaBadge';
import { SetPoaForm } from '../../../components/SetPoaForm';
import { poaLabel, providerTypeLabel, type CircleMember, type Provider } from '../../../lib/care';
import { keys } from '../../../lib/queryKeys';
import { EmailLink, PhoneLink } from './links';
import { CardShell } from '../CardShell';
import type { CardProps } from '../types';

/**
 * Who is allowed to decide for somebody who cannot.
 *
 * Both lists are already fetched by the form inside this card, so asking for
 * them here costs nothing beyond a cache read.
 */
export function PoaCardSlot({ profileId, isOwner, careName }: CardProps) {
  const { data: circleData } = useQuery({
    queryKey: keys.circle(profileId),
    queryFn: () => api.get<{ members: CircleMember[] }>(`/care-profiles/${profileId}/circle`),
  });
  const { data: providersData } = useQuery({
    queryKey: keys.providers(profileId),
    queryFn: () => api.get<{ providers: Provider[] }>(`/care-profiles/${profileId}/providers`),
  });

  const holders: PoaHolder[] = [
    ...(circleData?.members ?? [])
      .filter((m) => m.poa_type)
      .map((m) => ({
        key: m.id,
        name: m.display_name,
        sublabel: m.relationship,
        poa_type: m.poa_type,
        poa_activated: m.poa_activated,
        phone: null,
        email: m.account_email ?? m.invited_email,
        address: null,
      })),
    ...(providersData?.providers ?? [])
      .filter((p) => p.poa_type)
      .map((p) => ({
        key: p.id,
        name: p.name,
        sublabel: providerTypeLabel(p.provider_type),
        poa_type: p.poa_type,
        poa_activated: p.poa_activated,
        phone: p.phone,
        email: p.email,
        address: p.address,
      })),
  ];

  return (
    <CardShell>
      <PoaCard profileId={profileId} poaHolders={holders} isOwner={isOwner} careName={careName} />
    </CardShell>
  );
}

interface PoaHolder {
  key: string;
  name: string;
  sublabel: string | null;
  poa_type: string | null;
  poa_activated: boolean;
  phone: string | null;
  email: string | null;
  address: string | null;
}

function PoaCard({
  profileId,
  poaHolders,
  isOwner,
  careName,
}: {
  profileId: string;
  poaHolders: PoaHolder[];
  isOwner: boolean;
  careName: string;
}) {
  if (poaHolders.length > 0) {
    return (
      <div className="space-y-3">
        <p className="text-sm text-ink">
          Power of attorney means someone is legally authorised to make decisions on {careName}'s behalf.
          The type of authority determines what decisions they can make. A medical POA can make healthcare
          decisions; a financial POA can manage money and property; an enduring POA continues even if
          {careName} loses capacity to make their own decisions.
        </p>
        <div className="divide-y divide-border">
          {poaHolders.map((h) => (
            <div key={h.key} className="py-2 flex items-start gap-3">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className="text-sm font-medium text-ink">{h.name}</span>
                  <PoaBadge type={h.poa_type} activated={h.poa_activated} />
                </div>
                {h.sublabel ? <p className="text-xs text-muted">{h.sublabel}</p> : null}
                <p className="text-xs text-muted mt-0.5">
                  {poaLabel(h.poa_type ?? '')} {h.poa_activated ? '(activated)' : '(not yet activated)'}
                </p>
                {h.phone || h.email ? (
                  <p className="text-xs text-muted mt-0.5">
                    {h.phone ? (
                      <>
                        Phone: <PhoneLink phone={h.phone} />
                      </>
                    ) : null}
                    {h.phone && h.email ? ' · ' : null}
                    {h.email ? (
                      <>
                        Email: <EmailLink email={h.email} />
                      </>
                    ) : null}
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
        {isOwner ? <SetPoaForm profileId={profileId} compact /> : null}
      </div>
    );
  }

  if (isOwner) {
    return <SetPoaForm profileId={profileId} />;
  }

  return <p className="text-sm text-muted">No power of attorney recorded.</p>;
}
