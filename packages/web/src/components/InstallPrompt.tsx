import { useEffect, useState } from 'react';
import { Button } from './ui/Button';
import { canInstall, isStandalone, onInstallChange, promptInstall } from '../lib/pwa';

/**
 * A quiet offer to install PareCare to the home screen, shown only once the
 * browser says it can and only until the person acts on it or waves it away.
 * The browser's own prompt is easy to miss; this puts it where it helps, for
 * something meant to be reached one-handed.
 */
const DISMISS_KEY = 'parecare-install-dismissed';

export function InstallPrompt() {
  const [show, setShow] = useState(false);

  useEffect(() => {
    const update = () => {
      let dismissed = false;
      try {
        dismissed = localStorage.getItem(DISMISS_KEY) === '1';
      } catch {
        /* ignore */
      }
      setShow(canInstall() && !isStandalone() && !dismissed);
    };
    update();
    return onInstallChange(update);
  }, []);

  if (!show) return null;

  const dismiss = () => {
    try {
      localStorage.setItem(DISMISS_KEY, '1');
    } catch {
      /* ignore */
    }
    setShow(false);
  };

  return (
    <div className="fixed inset-x-3 bottom-3 z-40 md:left-auto md:right-4 md:w-80 rounded-lg border border-border bg-card shadow-lg p-3 flex items-center gap-3">
      <span className="text-sm text-ink flex-1">Add PareCare to your home screen for one tap access.</span>
      <Button
        size="sm"
        onClick={async () => {
          await promptInstall();
          setShow(false);
        }}
      >
        Add
      </Button>
      <button type="button" className="text-sm text-muted hover:text-ink" onClick={dismiss}>
        Not now
      </button>
    </div>
  );
}
