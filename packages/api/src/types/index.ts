export type SubscriptionTier = 'free' | 'family' | 'professional';
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'trialing' | 'incomplete';
export type AccountRole = 'super_admin' | 'admin' | 'user';

export interface Account {
  id: string;
  email: string;
  password_hash: string;
  display_name: string;
  role: AccountRole;
  subscription_status: SubscriptionStatus | null;
  subscription_tier: SubscriptionTier;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | Date | null;
  ai_tokens_used: number;
  ai_tokens_reset_at: string | Date;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface CareProfile {
  id: string;
  account_id: string;
  full_name: string;
  date_of_birth: string | Date | null;
  current_phase: CarePhase;
  preferred_name: string | null;
  pronouns: string | null;
  primary_language: string | null;
  photo_url: string | null;
  notes: string | null;
  archived: boolean;
  ics_token: string;
  created_at: Date;
  updated_at: Date;
}

export interface Message {
  id: string;
  care_profile_id: string;
  author_account_id: string | null;
  body: string;
  created_at: string | Date;
}

export type CarePhase =
  | 'early_concern'
  | 'home_with_support'
  | 'increased_dependency'
  | 'transition_to_residential'
  | 'residential_ongoing'
  | 'end_of_life';

export type CirclePermission = 'viewer' | 'contributor';

export interface CareCircleMember {
  id: string;
  care_profile_id: string;
  account_id: string | null;
  invited_email: string | null;
  display_name: string;
  role: string;
  permission: CirclePermission;
  role_description: string | null;
  poa_type: string | null;
  poa_activated: boolean;
  poa_document_id: string | null;
  invite_token: string | null;
  invite_accepted: boolean;
  created_at: string | Date;
}

export interface CareLogEntry {
  id: string;
  care_profile_id: string;
  author_member_id: string | null;
  entry_type: string;
  title: string | null;
  body: string;
  occurred_at: string | Date;
  created_at: string | Date;
}

export interface CarePlan {
  id: string;
  care_profile_id: string;
  conditions: string[];
  medications: Record<string, unknown>[];
  dietary_requirements: string[];
  mobility_aids: string[];
  communication_preferences: string | null;
  advance_care_directive: boolean;
  advance_care_directive_location: string | null;
  gp_name: string | null;
  gp_practice: string | null;
  gp_phone: string | null;
  emergency_contacts: Record<string, unknown>[];
  updated_by: string | null;
  updated_at: string | Date;
  created_at: string | Date;
}

export interface ChecklistItem {
  id: string;
  care_profile_id: string;
  phase: CarePhase;
  title: string;
  description: string | null;
  completed: boolean;
  completed_by: string | null;
  completed_at: string | Date | null;
  is_custom: boolean;
  sort_order: number;
  created_at: string | Date;
}

export interface OpenQuestion {
  id: string;
  care_profile_id: string;
  raised_by: string | null;
  title: string;
  body: string | null;
  status: 'open' | 'resolved' | 'deferred';
  resolution: string | null;
  resolved_by: string | null;
  resolved_at: string | Date | null;
  created_at: string | Date;
}

export interface Document {
  id: string;
  care_profile_id: string;
  uploaded_by: string | null;
  category: string;
  label: string;
  file_url: string;
  file_size_bytes: number | null;
  mime_type: string | null;
  visible_to_roles: string[];
  created_at: string | Date;
}

export interface Provider {
  id: string;
  care_profile_id: string;
  provider_type: string;
  name: string;
  organisation: string | null;
  phone: string | null;
  email: string | null;
  address: string | null;
  primary_contact_member_id: string | null;
  notes: string | null;
  created_at: string | Date;
}

export interface Reminder {
  id: string;
  care_profile_id: string;
  assigned_to: string | null;
  title: string;
  body: string | null;
  reminder_type: 'once' | 'daily' | 'weekly' | 'monthly';
  next_due_at: string | Date;
  rrule: string | null;
  completed: boolean;
  created_at: string | Date;
}

export interface AiConversation {
  id: string;
  care_profile_id: string;
  account_id: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>;
  tokens_used: number;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface CareAccess {
  level: 'owner' | 'contributor' | 'viewer';
  member: CareCircleMember | null;
}

declare global {
  namespace Express {
    interface Request {
      account?: Account;
      careAccess?: CareAccess;
    }
  }
}
