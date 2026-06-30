import { useNavigate } from 'react-router-dom';
import { Modal } from './ui/Modal';
import { Button } from './ui/Button';
import { useSubscriptionStore } from '../stores/subscription';

export function UpgradePrompt() {
  const { upgradePrompt, dismissUpgradePrompt } = useSubscriptionStore();
  const navigate = useNavigate();

  function handleViewPlans() {
    dismissUpgradePrompt();
    navigate('/account/subscription');
  }

  return (
    <Modal open={upgradePrompt.visible} onClose={dismissUpgradePrompt}>
      <div className="text-center">
        <div className="mx-auto mb-4 h-12 w-12 rounded-full bg-primary-50 flex items-center justify-center">
          <svg className="h-6 w-6 text-primary" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M12 6v6m0 0v6m0-6h6m-6 0H6" />
          </svg>
        </div>
        <h3 className="text-base font-semibold mb-2">This feature requires a plan upgrade</h3>
        <p className="text-sm text-muted mb-6">
          {upgradePrompt.message ?? 'Upgrade your plan to access this feature.'}
        </p>
        <div className="flex flex-col gap-2">
          <Button onClick={handleViewPlans}>View plans</Button>
          <Button variant="ghost" onClick={dismissUpgradePrompt}>
            Not now
          </Button>
        </div>
      </div>
    </Modal>
  );
}
