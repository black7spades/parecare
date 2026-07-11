import { z } from 'zod';
import { db } from '../config/database';
import { accountHasRight } from '../middleware/accountRights';
import { getEffectiveTier, PLAN_LIMITS, getCareAccess } from '../middleware/subscriptionGate';
import { extractActionBlocks, crossProfileActionSchema, resolveProfileByName, type CrossProfileAction, type ExtractedActions } from './aiActions';
import type { Account, CareProfile } from '../types';

/**
 * Actions Pare can take from the dashboard, where no single profile is
 * open: navigating the user to a profile section, and creating a new care
 * profile conversationally. Same fenced ```parecare-action``` block pattern
 * as the profile-level assistant; these use an "action" discriminator.
 *
 * Navigation is carried out by the web app, so the server only validates
 * that the target profile is reachable by this account and passes the
 * action through. Profile creation runs under the caller's account rights
 * and subscription limits, exactly like POST /care-profiles.
 */

export const PROFILE_SECTIONS = [
  'overview',
  'medications',
  'log',
  'tasks',
  'questions',
  'documents',
  'circle',
  'plan',
  'calendar',
  'ask',
  'memory-book',
] as const;

const navigateSchema = z.object({
  action: z.literal('navigate_to_profile'),
  profile_id: z.string().uuid(),
  section: z.enum(PROFILE_SECTIONS).default('overview'),
});

const createProfileSchema = z.object({
  action: z.literal('create_care_profile'),
  kind: z.enum(['person', 'pet']).default('person'),
  first_name: z.string().min(1).max(100),
  last_name: z.string().max(100).optional().nullable(),
  relationship: z.string().max(100).optional().nullable(),
  species: z.string().max(60).optional().nullable(),
  breed: z.string().max(120).optional().nullable(),
});

// Pare never completes a task itself. It proposes completion, which the app
// turns into an explicit confirm button; only the person's click completes it.
const proposeCompleteTaskSchema = z.object({
  action: z.literal('propose_complete_task'),
  profile_name: z.string().min(1).max(200),
  title: z.string().min(1).max(255),
});

export const dashboardActionSchema = z.discriminatedUnion('action', [navigateSchema, createProfileSchema, proposeCompleteTaskSchema]);
export type DashboardAction = z.infer<typeof dashboardActionSchema>;

/**
 * Everything the dashboard assistant can emit: single-profile dashboard
 * actions (discriminated by "action") plus the cross-profile logging
 * actions shared with the profile assistant (discriminated by "type").
 */
const anyDashboardActionSchema = z.union([dashboardActionSchema, crossProfileActionSchema]);
export type AnyDashboardAction = DashboardAction | CrossProfileAction;

/** Actions the web app carries out after the reply arrives. */
export interface ClientAction {
  action: 'navigate_to_profile' | 'profile_created';
  profile_id: string;
  section?: (typeof PROFILE_SECTIONS)[number];
  name?: string;
}

/**
 * A completion Pare has proposed, resolved to a real task. The app renders it
 * as an explicit confirm button in the chat; nothing is completed until the
 * person clicks it, so the assistant never closes anything out on its own.
 */
export interface TaskConfirmation {
  kind: 'complete_task';
  profile_id: string;
  reminder_id: string;
  title: string;
  profile_name: string;
}

export function extractDashboardActions(reply: string): ExtractedActions<AnyDashboardAction> {
  return extractActionBlocks(reply, anyDashboardActionSchema);
}

/** Split a mixed batch into dashboard actions and cross-profile actions. */
export function splitDashboardActions(actions: AnyDashboardAction[]): {
  single: DashboardAction[];
  cross: CrossProfileAction[];
} {
  const single: DashboardAction[] = [];
  const cross: CrossProfileAction[] = [];
  for (const a of actions) {
    if ('action' in a) single.push(a);
    else cross.push(a);
  }
  return { single, cross };
}

async function createProfile(
  action: z.infer<typeof createProfileSchema>,
  account: Account
): Promise<{ outcome: string; clientAction: ClientAction | null }> {
  if (!accountHasRight(account, 'can_create_care_profiles')) {
    return {
      outcome: 'No profile was created: your account cannot create care profiles. Ask an administrator to enable it.',
      clientAction: null,
    };
  }
  const limit = PLAN_LIMITS.care_profiles[getEffectiveTier(account)];
  if (limit !== Infinity) {
    const result = await db('care_profiles').where({ account_id: account.id, archived: false }).count('id as count').first();
    if (Number(result?.count ?? 0) >= limit) {
      return {
        outcome: 'No profile was created: you have reached the number of care profiles your plan allows.',
        clientAction: null,
      };
    }
  }

  const firstName = action.first_name.trim();
  const lastName = (action.last_name ?? '').trim() || null;
  const fullName = [firstName, lastName].filter(Boolean).join(' ');
  const [profile] = await db<CareProfile>('care_profiles')
    .insert({
      account_id: account.id,
      kind: action.kind,
      first_name: firstName,
      last_name: lastName,
      full_name: fullName,
      owner_relationship: (action.relationship ?? '').trim() || null,
      species: action.kind === 'pet' ? (action.species ?? '').trim() || null : null,
      breed: action.kind === 'pet' ? (action.breed ?? '').trim() || null : null,
      current_phase: 'early_concern',
    })
    .returning('*');

  return {
    outcome: `Created a care profile for ${fullName}.`,
    clientAction: { action: 'profile_created', profile_id: profile.id, name: fullName },
  };
}

export interface DashboardActionResults {
  outcomes: string[];
  clientActions: ClientAction[];
  confirmations: TaskConfirmation[];
}

// Resolve a proposed completion to a real open task, so the app can offer a
// confirm button. Never completes anything here.
async function proposeCompleteTask(
  action: z.infer<typeof proposeCompleteTaskSchema>,
  account: Account
): Promise<{ confirmation?: TaskConfirmation; outcome?: string }> {
  const resolved = await resolveProfileByName(action.profile_name, account.id);
  if (!resolved) return { outcome: `I could not tell whose task "${action.title}" is. Which person is it for?` };
  if (resolved.access.level === 'viewer') {
    return { outcome: `You have view-only access to ${resolved.name}, so tasks there cannot be changed.` };
  }
  const task = await db('reminders')
    .where({ care_profile_id: resolved.profileId, completed: false })
    .whereRaw('lower(title) = lower(?)', [action.title.trim()])
    .orderBy('next_due_at', 'asc')
    .first();
  if (!task) return { outcome: `I could not find an open task called "${action.title}" for ${resolved.name}.` };
  return {
    confirmation: { kind: 'complete_task', profile_id: resolved.profileId, reminder_id: task.id, title: task.title, profile_name: resolved.name },
  };
}

export async function executeDashboardActions(actions: DashboardAction[], account: Account): Promise<DashboardActionResults> {
  const outcomes: string[] = [];
  const clientActions: ClientAction[] = [];
  const confirmations: TaskConfirmation[] = [];
  for (const action of actions) {
    try {
      if (action.action === 'navigate_to_profile') {
        const access = await getCareAccess(account, action.profile_id);
        if (!access) {
          outcomes.push('Could not open that profile: it does not exist or you do not have access to it.');
          continue;
        }
        clientActions.push({ action: 'navigate_to_profile', profile_id: action.profile_id, section: action.section });
      } else if (action.action === 'propose_complete_task') {
        const { confirmation, outcome } = await proposeCompleteTask(action, account);
        if (confirmation) confirmations.push(confirmation);
        if (outcome) outcomes.push(outcome);
      } else {
        const { outcome, clientAction } = await createProfile(action, account);
        outcomes.push(outcome);
        if (clientAction) clientActions.push(clientAction);
      }
    } catch (err) {
      console.warn('Dashboard assistant action failed:', (err as Error).message);
      outcomes.push('One of the requested changes could not be saved. Please try it directly in the app.');
    }
  }
  return { outcomes, clientActions, confirmations };
}
