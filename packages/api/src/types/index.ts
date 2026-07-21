export type SubscriptionTier = 'free' | 'family' | 'professional';
export type SubscriptionStatus = 'active' | 'past_due' | 'canceled' | 'trialing' | 'incomplete';
export type AccountRole = 'super_admin' | 'admin' | 'user';

export interface Account {
  id: string;
  email: string;
  password_hash: string | null;
  /** Composed display name derived from the structured name parts. */
  display_name: string;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  role: AccountRole;
  avatar_url: string | null;
  avatar_color: string | null;
  date_of_birth: string | Date | null;
  gender: string | null;
  pronouns: string | null;
  oauth_provider: 'google' | 'facebook' | null;
  oauth_subject: string | null;
  mfa_secret: string | null;
  mfa_enabled: boolean;
  subscription_status: SubscriptionStatus | null;
  subscription_tier: SubscriptionTier;
  stripe_customer_id: string | null;
  stripe_subscription_id: string | null;
  current_period_end: string | Date | null;
  ai_tokens_used: number;
  ai_tokens_reset_at: string | Date;
  disabled_at: string | Date | null;
  can_create_care_profiles: boolean;
  can_invite_members: boolean;
  can_use_ai: boolean;
  can_export_data: boolean;
  /** IANA zone the browser last reported, for on-their-clock calculations. */
  timezone: string | null;
  /** Per-kind notification choices; a kind is on unless switched off. */
  notification_prefs: Record<string, unknown>;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface RightsTemplate {
  id: string;
  name: string;
  description: string | null;
  can_create_care_profiles: boolean;
  can_invite_members: boolean;
  can_use_ai: boolean;
  can_export_data: boolean;
  created_by_account_id: string | null;
  created_at: string | Date;
  updated_at: string | Date;
}

export type InvitationStatus = 'pending' | 'accepted' | 'revoked';

export interface Invitation {
  id: string;
  token: string;
  email: string;
  display_name: string;
  invited_by_account_id: string | null;
  status: InvitationStatus;
  expires_at: string | Date;
  accepted_account_id: string | null;
  accepted_at: string | Date | null;
  created_at: string | Date;
}

/** The highest-level kind of care profile: a person or a pet. */
export type ProfileKind = 'person' | 'pet';

export interface CareProfile {
  id: string;
  account_id: string;
  /** Person or pet: the top-level category the profile belongs to. */
  kind: ProfileKind;
  /** Composed display name derived from the structured name parts. */
  full_name: string;
  title: string | null;
  first_name: string | null;
  middle_name: string | null;
  last_name: string | null;
  suffix: string | null;
  date_of_birth: string | Date | null;
  current_phase: CarePhase;
  preferred_name: string | null;
  pronouns: string | null;
  primary_language: string | null;
  /** Pet only: the kind of animal, e.g. Dog, Cat, Rabbit. */
  species: string | null;
  /** Pet only: the breed, e.g. Ragdoll. */
  breed: string | null;
  /** Pet only: neutered or spayed. Recorded only when true. */
  desexed: boolean;
  /** Pet only: microchip number. */
  microchip_number: string | null;
  photo_url: string | null;
  photo_color: string | null;
  notes: string | null;
  owner_relationship: string | null;
  /** A pet's owner: a person profile (another care_profiles row). */
  owner_profile_id: string | null;
  /** Who to contact: 'self', 'user' (a platform account), 'contact', 'provider' (e.g. a care home), or 'profile' (another person). */
  contact_kind: 'self' | 'user' | 'contact' | 'provider' | 'profile' | null;
  contact_account_id: string | null;
  contact_provider_id: string | null;
  /** The primary carer when they are another person in the system. */
  contact_profile_id: string | null;
  contact_name: string | null;
  contact_relationship: string | null;
  contact_phone: string | null;
  contact_phone_type: 'home' | 'mobile' | null;
  contact_email: string | null;
  /** Where they live, each fact its own field. */
  residence_type: 'private_residence' | 'care_facility' | 'retirement_village' | 'group_home' | 'hospital' | 'other' | null;
  address_line1: string | null;
  address_line2: string | null;
  address_suburb: string | null;
  address_state: string | null;
  address_postcode: string | null;
  address_country: string | null;
  residence_provider_id: string | null;
  room_number: string | null;
  room_area_name: string | null;
  room_area_type: 'wing' | 'floor' | 'unit' | 'building' | 'house' | 'ward' | 'block' | 'other' | null;
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
  relationship: string | null;
  role_description: string | null;
  poa_type: string | null;
  poa_activated: boolean;
  poa_document_id: string | null;
  can_edit_profile: boolean;
  invitation_id: string | null;
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
  sentiment: number | null;
  sentiment_source: string | null;
  occurred_at: string | Date;
  created_at: string | Date;
}

export interface CarePlan {
  id: string;
  care_profile_id: string;
  /** Legacy: conditions live in medical_conditions since 032; never written. */
  conditions: string[];
  /** Legacy: medications live in the medications table since 022; never written. */
  medications: Record<string, unknown>[];
  dietary_requirements: string[];
  mobility_aids: string[];
  communication_needs: string[];
  advance_care_directive: boolean;
  advance_care_directive_location: string | null;
  emergency_contacts: Record<string, unknown>[];
  updated_by: string | null;
  updated_at: string | Date;
  created_at: string | Date;
}

export interface ChecklistItem {
  id: string;
  care_profile_id: string;
  /** Legacy phase slug; null for items that live on a journey phase. */
  phase: CarePhase | string | null;
  care_journey_phase_id: string | null;
  title: string;
  description: string | null;
  completed: boolean;
  completed_by: string | null;
  completed_at: string | Date | null;
  /** The day it really happened, distinct from completed_at. */
  achieved_on: string | Date | null;
  is_milestone: boolean;
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
  account_id: string;
  provider_type: string;
  name: string;
  organisation: string | null;
  phone: string | null;
  email: string | null;
  /** Composed one-line display, kept in step with the segmented parts. */
  address: string | null;
  address_line1: string | null;
  address_line2: string | null;
  address_suburb: string | null;
  address_state: string | null;
  address_postcode: string | null;
  address_country: string | null;
  booking_link: string | null;
  directions_link: string | null;
  created_at: string | Date;
}

export interface Supplier {
  id: string;
  account_id: string;
  /** The vendor name, e.g. "Chemist Warehouse". */
  name: string;
  phone: string | null;
  email: string | null;
  /** Composed one-line display, kept in step with the segmented parts. */
  address: string | null;
  address_line1: string | null;
  address_line2: string | null;
  /** The branch suburb, telling apart two branches of one vendor. */
  address_suburb: string | null;
  address_state: string | null;
  address_postcode: string | null;
  address_country: string | null;
  /** A direct link to reorder from this supplier. */
  order_url: string | null;
  created_at: string | Date;
}

export interface CareProfileSupplier {
  id: string;
  care_profile_id: string;
  supplier_id: string;
  created_at: string | Date;
}

export interface CareProfileProvider {
  id: string;
  care_profile_id: string;
  provider_id: string;
  poa_type: string | null;
  poa_activated: boolean;
  primary_contact_member_id: string | null;
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
  completed_at: string | Date | null;
  completed_by_account_id: string | null;
  desired_outcome: string | null;
  sentiment: number | null;
  claimed_by: string | null;
  claimed_at: string | Date | null;
  created_at: string | Date;
}

export interface AiConversation {
  id: string;
  /** Null for account-wide dashboard conversations with Pare. */
  care_profile_id: string | null;
  account_id: string;
  messages: Array<{ role: 'user' | 'assistant'; content: string; timestamp: string }>;
  tokens_used: number;
  created_at: string | Date;
  updated_at: string | Date;
}

export interface CareAccess {
  // 'admin' = platform admin / super admin with global access to any profile.
  level: 'owner' | 'admin' | 'contributor' | 'viewer';
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
