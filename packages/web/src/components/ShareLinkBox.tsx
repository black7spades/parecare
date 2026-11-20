import { useState } from 'react';
import { Button } from './ui/Button';

/** A share link as the screens show it. */
export interface ShareLink {
  id: string;
  kind: 'emergency_sheet' | 'appointment' | 'report';
  url: string;
  entity_id: string | null;
  recipient_email: string | null;
  expires_at: string | null;
  revoked_at: string | null;
  last_opened_at: string | null;
  open_count: number;
  created_at: string;
}

/**
 * A link that opens with no login, with Copy link. When copying is blocked,
 * the link is selected so it can be copied by hand.
 */
export function ShareLinkBox({ url, primary = true }: { url: string; primary?: boolean }) {
  const [copied, setCopied] = useState<'yes' | 'no' | null>(null);
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied('yes');
    } catch {
      setCopied('no');
      const box = document.getElementById(`share-${url.slice(-12)}`) as HTMLInputElement | null;
      box?.select();
    }
  };
  return (
    <div className="space-y-1">
      <div className="flex flex-wrap items-center gap-2">
        <input
          id={`share-${url.slice(-12)}`}
          readOnly
          aria-label="The link"
          value={url}
          onFocus={(e) => e.target.select()}
          className="flex-1 min-w-[12rem] rounded-md border border-border bg-surface px-3 py-2 text-xs text-ink"
        />
        <Button size="sm" variant={primary ? 'primary' : 'secondary'} onClick={() => void copy()}>
          Copy link
        </Button>
      </div>
      {copied === 'yes' ? <p className="text-xs text-muted" role="status">Copied. Paste it into a message or an email.</p> : null}
      {copied === 'no' ? <p className="text-xs text-muted" role="status">This browser would not copy it. The link is selected, so copy it by hand.</p> : null}
    </div>
  );
}
