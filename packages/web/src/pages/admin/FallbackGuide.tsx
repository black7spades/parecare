import { CONTACT_LINK } from '../../components/ContactStrip';

/**
 * Step-by-step setup for the fallback AI service, shown as soon as one is
 * chosen in System settings. Each service gets the steps it actually needs,
 * with a link to the exact page where the key or download lives, and a plain
 * line on what is still missing. The clever part, which fields matter for
 * which service, is worked out here so the person never has to guess.
 */

export type FallbackChoice = 'off' | 'anthropic' | 'openai' | 'google' | 'ollama' | 'lmstudio' | 'openai-compatible';

/** The fallback choices as a person would know them, for the dropdown. */
export const FALLBACK_OPTION_LABELS: Record<string, string> = {
  off: 'Off',
  anthropic: 'Claude, from Anthropic',
  openai: 'OpenAI',
  google: 'Gemini, from Google',
  ollama: 'Ollama',
  lmstudio: 'LM Studio',
  'openai-compatible': 'Another service that works like OpenAI',
};

const CLOUD: readonly string[] = ['anthropic', 'openai', 'google'];

/** Whether a fallback setting has any use for the service chosen, so the form shows only what matters. */
export function fallbackFieldShown(key: string, choice: string): boolean {
  if (!key.startsWith('ai.fallback_') || key === 'ai.fallback_provider') return true;
  if (choice === 'off' || !choice) return false;
  if (key === 'ai.fallback_api_key') return choice !== 'ollama' && choice !== 'lmstudio';
  if (key === 'ai.fallback_base_url') return !CLOUD.includes(choice);
  return true; // the model applies to every service
}

interface Step {
  text: string;
  link?: { label: string; url: string };
}

const STEPS: Record<string, { name: string; intro: string; steps: Step[]; privacy: string }> = {
  anthropic: {
    name: 'Claude',
    intro: 'Claude needs a key from Anthropic.',
    steps: [
      { text: 'Sign in to the Anthropic console and choose Create Key.', link: { label: 'Open Anthropic keys', url: 'https://console.anthropic.com/settings/keys' } },
      { text: 'Add some credit to the account. A key on an account with no credit does not answer.', link: { label: 'Open Anthropic billing', url: 'https://console.anthropic.com/settings/billing' } },
      { text: 'Paste the key into Fallback service key below. When the Anthropic key above is already set, skip this: Pare uses that one.' },
      { text: 'Leave Fallback service model empty to use Claude Haiku, which is quick and low cost.' },
    ],
    privacy: 'While the fallback is in use, records are sent to Anthropic to be read.',
  },
  openai: {
    name: 'OpenAI',
    intro: 'OpenAI needs a key.',
    steps: [
      { text: 'Sign in to OpenAI and choose Create new secret key.', link: { label: 'Open OpenAI keys', url: 'https://platform.openai.com/api-keys' } },
      { text: 'Add some credit to the account. A key on an account with no credit does not answer.', link: { label: 'Open OpenAI billing', url: 'https://platform.openai.com/settings/organization/billing/overview' } },
      { text: 'Paste the key into Fallback service key below. It starts with sk-.' },
      { text: 'Leave Fallback service model empty to use GPT-4o mini, which is quick and low cost.' },
    ],
    privacy: 'While the fallback is in use, records are sent to OpenAI to be read.',
  },
  google: {
    name: 'Gemini',
    intro: 'Gemini needs a key from Google AI Studio.',
    steps: [
      { text: 'Sign in to Google AI Studio and choose Create API key.', link: { label: 'Open Google AI Studio keys', url: 'https://aistudio.google.com/app/apikey' } },
      { text: 'Paste the key into Fallback service key below.' },
      { text: 'Leave Fallback service model empty to use Gemini 2.0 Flash.' },
    ],
    privacy: 'While the fallback is in use, records are sent to Google to be read.',
  },
  ollama: {
    name: 'Ollama',
    intro: 'Ollama runs a model on a computer you own. It needs no key.',
    steps: [
      { text: 'Install Ollama on the computer that will answer when the main service cannot.', link: { label: 'Download Ollama', url: 'https://ollama.com/download' } },
      { text: 'Pick a model and download it in Ollama, then type its name into Fallback service model, for example gemma3.', link: { label: 'Browse Ollama models', url: 'https://ollama.com/library' } },
      { text: 'Type that computer\'s address into Fallback service base URL, ending in /v1, for example http://192.168.1.20:11434/v1. Leave it empty when Ollama runs on this same computer.' },
    ],
    privacy: 'It runs on your own hardware, so records stay with you.',
  },
  lmstudio: {
    name: 'LM Studio',
    intro: 'LM Studio runs a model on a computer you own. It needs no key.',
    steps: [
      { text: 'Install LM Studio on the computer that will answer when the main service cannot.', link: { label: 'Download LM Studio', url: 'https://lmstudio.ai/download' } },
      { text: 'Download a model in LM Studio, load it, and start its local server.', link: { label: 'How to start the server', url: 'https://lmstudio.ai/docs/app/api' } },
      { text: 'Type the model\'s name, as LM Studio shows it, into Fallback service model.' },
      { text: 'Type that computer\'s address into Fallback service base URL, ending in :1234/v1. Leave it empty when LM Studio runs on this same computer.' },
    ],
    privacy: 'It runs on your own hardware, so records stay with you.',
  },
  'openai-compatible': {
    name: 'another service that works like OpenAI',
    intro: 'Any service that works like OpenAI. OpenRouter and Groq both do, and so do most servers you run yourself.',
    steps: [
      { text: 'Get a key from the service.', link: { label: 'OpenRouter keys', url: 'https://openrouter.ai/settings/keys' } },
      { text: 'For Groq, the key comes from its console instead.', link: { label: 'Groq keys', url: 'https://console.groq.com/keys' } },
      { text: 'Type its address into Fallback service base URL, ending in /v1. OpenRouter is https://openrouter.ai/api/v1 and Groq is https://api.groq.com/openai/v1.' },
      { text: 'Type the name of the model to use, as the service lists it, into Fallback service model.' },
      { text: 'Paste the key into Fallback service key. A server you run yourself may not need one.' },
    ],
    privacy: 'While the fallback is in use, records are sent to that service to be read.',
  },
};

/** What is filled in so far, read from the form as it stands, saved or not. */
export interface FallbackFormState {
  choice: string;
  mainProvider: string;
  keySet: boolean;
  anthropicKeySet: boolean;
  model: string;
  baseUrl: string;
}

/** The fallback settings still empty that this service needs, by their names on the form. */
function stillNeeded(s: FallbackFormState): string[] {
  const out: string[] = [];
  if (CLOUD.includes(s.choice) && !s.keySet && !(s.choice === 'anthropic' && s.anthropicKeySet)) out.push('Fallback service key');
  if (!CLOUD.includes(s.choice) && !s.model.trim()) out.push('Fallback service model');
  if (s.choice === 'openai-compatible' && !s.baseUrl.trim()) out.push('Fallback service base URL');
  return out;
}

const joinNames = (names: string[]): string =>
  names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;

export function FallbackGuide({ state }: { state: FallbackFormState }) {
  const guide = STEPS[state.choice];
  if (!guide) {
    return (
      <p className="text-xs text-muted">
        Choose a fallback service and the steps to set it up show here. Pare uses it only while the main service is not
        answering.
      </p>
    );
  }
  const needed = stillNeeded(state);
  // The same kind of service at the same address is down when the main one is.
  const sameAsMain = state.choice === state.mainProvider && !state.baseUrl.trim();

  return (
    <div className="rounded-md border border-border bg-surface p-3 space-y-2" data-testid="fallback-guide">
      <p className="text-sm font-semibold text-ink">Setting up {guide.name} as the fallback</p>
      <p className="text-sm text-ink">{guide.intro}</p>
      <ol className="list-decimal pl-5 space-y-1.5">
        {guide.steps.map((step) => (
          <li key={step.text} className="text-sm text-ink">
            {step.text}
            {step.link ? (
              <>
                {' '}
                <a href={step.link.url} target="_blank" rel="noreferrer" className={`${CONTACT_LINK} whitespace-nowrap`}>
                  {step.link.label} ↗
                </a>
              </>
            ) : null}
          </li>
        ))}
      </ol>
      <p className="text-xs text-muted">{guide.privacy}</p>
      {sameAsMain ? (
        <p className="text-sm text-ink">
          This is the same service as the main one, so when one stops the other usually does too. A different service
          keeps Pare answering.
        </p>
      ) : null}
      <p className={`text-sm ${needed.length ? 'text-ink' : 'text-primary'}`} role="status">
        {needed.length
          ? `Still needed: ${joinNames(needed)}.`
          : 'Everything it needs is filled in. Save, then choose Test AI connection to check it answers.'}
      </p>
    </div>
  );
}
