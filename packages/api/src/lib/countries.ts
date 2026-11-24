/**
 * The countries PareCare knows, and what changes from one to the next: the
 * national services people are sent to, the ID numbers on their cards, the
 * funding schemes, a few rules (how long a referral lasts, which yearly
 * checks are offered) and the words and formats people expect.
 *
 * Features refer to a kind of service or rule here, never to a number of
 * their own. Whoever runs PareCare picks the country; an account may pick
 * its own; any service can be changed or added on top, and those changes
 * are kept in the database, so a new release with fresher details here
 * never overwrites them.
 *
 * Only numbers and sites that are public and well known are filled in.
 * Where a country has no single national service of a kind, the entry is
 * left empty and the screen asks for the number instead of guessing.
 */

export const COUNTRY_CODES = ['AU', 'NZ', 'GB', 'IE', 'CA', 'US'] as const;
export type CountryCode = (typeof COUNTRY_CODES)[number];
export const isCountryCode = (v: unknown): v is CountryCode => typeof v === 'string' && (COUNTRY_CODES as readonly string[]).includes(v);

/** When the details below were last checked against each service's own site. */
export const PRESETS_CHECKED_ON = '2026-11-25';

/** The kinds of national service a step, a sheet or a page can point to. */
export const SERVICE_KINDS = [
  { key: 'emergency', label: 'Emergency number' },
  { key: 'poisons', label: 'Poisons advice' },
  { key: 'mental_health_crisis', label: 'Crisis support line' },
  { key: 'mental_health_support', label: 'Mental health support' },
  { key: 'youth_helpline', label: 'Helpline for children and young people' },
  { key: 'eating_disorders', label: 'Eating disorder support' },
  { key: 'quit_smoking', label: 'Quit smoking support' },
  { key: 'alcohol_drugs', label: 'Alcohol and drug support' },
  { key: 'carer_support', label: 'Support for carers' },
  { key: 'dementia_support', label: 'Dementia support' },
  { key: 'aged_care_assessment', label: 'Aged care assessment' },
  { key: 'aged_care_finder', label: 'Finding an aged care home or provider' },
  { key: 'aged_care_finances', label: 'Aged care costs and fees' },
  { key: 'disability_funding', label: 'Disability funding' },
  { key: 'parenting_perinatal', label: 'Support for new parents' },
  { key: 'breastfeeding', label: 'Feeding support for babies' },
] as const;
export type ServiceKind = (typeof SERVICE_KINDS)[number]['key'];
export const SERVICE_KIND_KEYS = SERVICE_KINDS.map((k) => k.key) as ServiceKind[];
export const isServiceKind = (v: unknown): v is ServiceKind => typeof v === 'string' && (SERVICE_KIND_KEYS as string[]).includes(v);
export const serviceKindLabel = (k: string): string => SERVICE_KINDS.find((s) => s.key === k)?.label ?? 'Service';

export interface ServiceDetails {
  name: string | null;
  phone: string | null;
  website: string | null;
}

/** The ID number fields, defined once in services/identifiers.ts. */
export type IdFieldKey =
  | 'medicare_number' | 'medicare_irn' | 'medicare_valid_to' | 'ihi_number' | 'dva_number' | 'dva_card_colour'
  | 'ndis_number' | 'my_aged_care_number' | 'health_fund_name' | 'health_fund_member_number'
  | 'nhs_number' | 'nhi_number' | 'pps_number' | 'medical_card_number'
  | 'health_card_province' | 'health_card_number' | 'health_card_version' | 'medicare_mbi' | 'medicaid_number';

export interface IdGroup {
  legend: string;
  fields: Array<{ key: IdFieldKey; label?: string }>;
}

/**
 * The funding plan kinds. The stored keys are kinds, not names: "ndis" is
 * whatever pays for disability support where the person lives, so a plan
 * reads as an NDIS plan in Australia and a personal budget in the UK.
 */
export const FUNDING_KINDS = ['ndis', 'support_at_home', 'home_care_package', 'other'] as const;
export type FundingKind = (typeof FUNDING_KINDS)[number];

export interface FundingScheme {
  key: FundingKind;
  /** What the plan is called: "NDIS plan". */
  label: string;
  /** How a task names the review: "the NDIS review". */
  review_word: string;
  /** How it can be managed, when that is asked. */
  management: { agency: string; plan: string; self: string } | null;
  /** The local coordinator people are linked to, when the scheme has one. */
  area_coordinator: string | null;
  /** The progress report made for its review, when there is one. */
  progress_report: string | null;
}

/** Who pays a cost: the stored keys are kinds, named for the country. */
export const COST_SOURCES = ['self', 'ndis', 'private_health', 'medicare', 'government', 'other'] as const;
export type CostSource = (typeof COST_SOURCES)[number];

export interface CountryPreset {
  code: CountryCode;
  name: string;
  /** For dates and times written out by the server, and the web app's formats. */
  locale: string;
  /** "25 Nov 2026" or "Nov 25, 2026". */
  date_order: 'dmy' | 'mdy';
  /** 24 hour or 12 hour clock. */
  clock: '24h' | '12h';
  dial_code: string;
  phone_example: string;
  currency: 'AUD' | 'NZD' | 'GBP' | 'EUR' | 'CAD' | 'USD';
  financial_year_start_month: number;
  services: Partial<Record<ServiceKind, ServiceDetails>>;
  id_groups: IdGroup[];
  funding: FundingScheme[];
  cost_sources: Record<CostSource, string>;
  /** How long a referral lasts in months, from the first visit; null where referrals do not run out by rule. */
  referral: { gp_months: number; specialist_months: number } | null;
  /** The yearly checks offered, by rule key (see services/recalls.ts). */
  recalls: string[];
  /** The month flu vaccines start each year. */
  flu_season_month: number;
  words: {
    /** What a written record of treatment wishes is called. */
    advance_directive: string;
    /** One sentence on what it is, for setup. */
    advance_directive_meaning: string;
    /** The health fund box. */
    health_fund: string;
    health_fund_example: string;
    member_number: string;
    /** The care standards a care plan is written to. */
    care_standards: string;
    /** A state, county or province on an address. */
    suburb: string;
    state: string;
    postcode: string;
  };
  /** Example rows in the file templates for addresses. */
  sample_address: { line1: string; suburb: string; state: string; postcode: string; country: string };
  /** Health funds and insurers offered in the ID numbers form. */
  health_funds: string[];
}

const svc = (name: string | null, phone: string | null, website: string | null): ServiceDetails => ({ name, phone, website });

const PRIVATE = (label = 'Private health', fund?: string, member?: string): IdGroup => ({
  legend: label,
  fields: [{ key: 'health_fund_name', label: fund }, { key: 'health_fund_member_number', label: member }],
});

const MANAGED = (agency: string, plan: string, self: string) => ({ agency, plan, self });

const AU: CountryPreset = {
  code: 'AU',
  name: 'Australia',
  locale: 'en-AU',
  date_order: 'dmy',
  clock: '24h',
  dial_code: '61',
  phone_example: '0400 000 000',
  currency: 'AUD',
  financial_year_start_month: 7,
  services: {
    emergency: svc('Emergency', '000', 'https://www.triplezero.gov.au'),
    poisons: svc('Poisons Information Centre', '13 11 26', null),
    mental_health_crisis: svc('Lifeline', '13 11 14', 'https://www.lifeline.org.au'),
    mental_health_support: svc('Beyond Blue', '1300 22 4636', 'https://www.beyondblue.org.au'),
    youth_helpline: svc('Kids Helpline', '1800 55 1800', 'https://kidshelpline.com.au'),
    eating_disorders: svc('Butterfly Foundation', '1800 33 4673', 'https://butterfly.org.au'),
    quit_smoking: svc('Quitline', '13 7848', 'https://www.quit.org.au'),
    alcohol_drugs: svc('National Alcohol and Other Drug Hotline', '1800 250 015', null),
    carer_support: svc('Carer Gateway', '1800 422 737', 'https://www.carergateway.gov.au'),
    dementia_support: svc('Dementia Australia', '1800 100 500', 'https://www.dementia.org.au'),
    aged_care_assessment: svc('My Aged Care', '1800 200 422', 'https://www.myagedcare.gov.au'),
    aged_care_finder: svc('My Aged Care', '1800 200 422', 'https://www.myagedcare.gov.au/find-a-provider'),
    aged_care_finances: svc('Services Australia', '1800 227 475', 'https://www.servicesaustralia.gov.au'),
    disability_funding: svc('NDIS', '1800 800 110', 'https://www.ndis.gov.au'),
    parenting_perinatal: svc('PANDA', '1300 726 306', 'https://panda.org.au'),
    breastfeeding: svc('Australian Breastfeeding Association', '1800 686 268', 'https://www.breastfeeding.asn.au'),
  },
  id_groups: [
    { legend: 'Medicare', fields: [{ key: 'medicare_number' }, { key: 'medicare_irn' }, { key: 'medicare_valid_to' }] },
    { legend: 'My Health Record', fields: [{ key: 'ihi_number' }] },
    { legend: 'Veterans', fields: [{ key: 'dva_number' }, { key: 'dva_card_colour' }] },
    { legend: 'NDIS', fields: [{ key: 'ndis_number' }] },
    PRIVATE('Private health', 'Health fund', 'Member number'),
    { legend: 'Aged care', fields: [{ key: 'my_aged_care_number' }] },
  ],
  funding: [
    { key: 'ndis', label: 'NDIS plan', review_word: 'NDIS', management: MANAGED('Managed by the NDIA', 'Plan managed', 'Self managed'), area_coordinator: 'Local Area Coordinator', progress_report: 'NDIS progress report' },
    { key: 'support_at_home', label: 'Support at Home', review_word: 'Support at Home', management: MANAGED('Managed by the provider', 'Plan managed', 'Self managed'), area_coordinator: null, progress_report: null },
    { key: 'home_care_package', label: 'Home Care Package', review_word: 'Home Care Package', management: MANAGED('Managed by the provider', 'Plan managed', 'Self managed'), area_coordinator: null, progress_report: null },
    { key: 'other', label: 'Other funding', review_word: 'funding', management: MANAGED('Managed by the provider', 'Plan managed', 'Self managed'), area_coordinator: null, progress_report: null },
  ],
  cost_sources: { self: 'Self funded', ndis: 'NDIS', private_health: 'Private health', medicare: 'Medicare', government: 'Government', other: 'Other' },
  referral: { gp_months: 12, specialist_months: 3 },
  recalls: ['flu', 'health_check_75', 'gp_management_plan', 'dental', 'eye_test', 'licence_medical'],
  flu_season_month: 4,
  words: {
    advance_directive: 'Advance care directive',
    advance_directive_meaning: 'An advance care directive writes down the care wanted if the person cannot say.',
    health_fund: 'Health fund',
    health_fund_example: 'Medibank',
    member_number: 'Member number',
    care_standards: "the Australian Government's Support at Home program and the Aged Care Quality Standards",
    suburb: 'Suburb',
    state: 'State',
    postcode: 'Postcode',
  },
  sample_address: { line1: '1 Main St', suburb: 'Morayfield', state: 'QLD', postcode: '4506', country: 'Australia' },
  health_funds: ['ahm', 'Australian Unity', 'Bupa', 'CBHS', 'Defence Health', 'GMHBA', 'HBF', 'HCF', 'Medibank', 'nib', 'Peoplecare', 'Teachers Health', 'Westfund'],
};

const NZ: CountryPreset = {
  code: 'NZ',
  name: 'New Zealand',
  locale: 'en-NZ',
  date_order: 'dmy',
  clock: '24h',
  dial_code: '64',
  phone_example: '021 123 4567',
  currency: 'NZD',
  financial_year_start_month: 4,
  services: {
    emergency: svc('Emergency', '111', null),
    poisons: svc('National Poisons Centre', '0800 764 766', 'https://www.poisons.co.nz'),
    mental_health_crisis: svc('Need to talk? 1737', '1737', 'https://1737.org.nz'),
    mental_health_support: svc('Depression Helpline', '0800 111 757', 'https://depression.org.nz'),
    youth_helpline: svc('Youthline', '0800 376 633', 'https://www.youthline.co.nz'),
    eating_disorders: svc('EDANZ', '0800 233 269', 'https://www.ed.org.nz'),
    quit_smoking: svc('Quitline', '0800 778 778', 'https://quit.org.nz'),
    alcohol_drugs: svc('Alcohol Drug Helpline', '0800 787 797', 'https://alcoholdrughelp.org.nz'),
    carer_support: svc('Carers NZ', '0800 777 797', 'https://carers.net.nz'),
    dementia_support: svc('Dementia New Zealand', '0800 433 636', 'https://dementia.nz'),
    parenting_perinatal: svc('PlunketLine', '0800 933 922', 'https://www.plunket.org.nz'),
  },
  id_groups: [
    { legend: 'Health', fields: [{ key: 'nhi_number' }] },
    PRIVATE('Private health', 'Health insurer', 'Member number'),
  ],
  funding: [
    { key: 'ndis', label: 'Disability support funding', review_word: 'disability support', management: MANAGED('Managed by the provider', 'Managed by a host', 'Individualised funding'), area_coordinator: 'Needs assessment coordinator', progress_report: 'Progress report for the review' },
    { key: 'support_at_home', label: 'Home and community support', review_word: 'home support', management: MANAGED('Managed by the provider', 'Managed by a host', 'Individualised funding'), area_coordinator: 'Needs assessment coordinator', progress_report: null },
    { key: 'other', label: 'Other funding', review_word: 'funding', management: null, area_coordinator: null, progress_report: null },
  ],
  cost_sources: { self: 'Self funded', ndis: 'Disability support', private_health: 'Health insurance', medicare: 'Public health system', government: 'Government', other: 'Other' },
  referral: null,
  recalls: ['flu', 'condition_review', 'dental', 'eye_test', 'licence_medical'],
  flu_season_month: 4,
  words: {
    advance_directive: 'Advance directive',
    advance_directive_meaning: 'An advance directive writes down the care wanted if the person cannot say.',
    health_fund: 'Health insurer',
    health_fund_example: 'Southern Cross',
    member_number: 'Member number',
    care_standards: 'the Ngā Paerewa Health and Disability Services Standard',
    suburb: 'Suburb',
    state: 'Region',
    postcode: 'Postcode',
  },
  sample_address: { line1: '1 Queen Street', suburb: 'Auckland Central', state: 'Auckland', postcode: '1010', country: 'New Zealand' },
  health_funds: ['Southern Cross', 'nib', 'AIA', 'Partners Life', 'Accuro', 'UniMed'],
};

const GB: CountryPreset = {
  code: 'GB',
  name: 'United Kingdom',
  locale: 'en-GB',
  date_order: 'dmy',
  clock: '24h',
  dial_code: '44',
  phone_example: '07700 900123',
  currency: 'GBP',
  financial_year_start_month: 4,
  services: {
    emergency: svc('Emergency', '999', null),
    poisons: svc('NHS 111', '111', 'https://111.nhs.uk'),
    mental_health_crisis: svc('Samaritans', '116 123', 'https://www.samaritans.org'),
    mental_health_support: svc('Mind', '0300 123 3393', 'https://www.mind.org.uk'),
    youth_helpline: svc('Childline', '0800 1111', 'https://www.childline.org.uk'),
    eating_disorders: svc('Beat', '0808 801 0677', 'https://www.beateatingdisorders.org.uk'),
    quit_smoking: svc('NHS Smokefree', '0300 123 1044', 'https://www.nhs.uk/better-health/quit-smoking/'),
    alcohol_drugs: svc('FRANK', '0300 123 6600', 'https://www.talktofrank.com'),
    carer_support: svc('Carers UK', '0808 808 7777', 'https://www.carersuk.org'),
    dementia_support: svc("Alzheimer's Society", '0333 150 3456', 'https://www.alzheimers.org.uk'),
    aged_care_assessment: svc("Your council's adult social care", null, 'https://www.gov.uk/apply-needs-assessment-social-services'),
    aged_care_finder: svc('Care Quality Commission', '03000 616161', 'https://www.cqc.org.uk'),
    disability_funding: svc("Your council's adult social care", null, 'https://www.gov.uk/apply-needs-assessment-social-services'),
    breastfeeding: svc('National Breastfeeding Helpline', '0300 100 0212', 'https://www.nationalbreastfeedinghelpline.org.uk'),
  },
  id_groups: [
    { legend: 'NHS', fields: [{ key: 'nhs_number' }] },
    PRIVATE('Private health', 'Health insurer', 'Membership number'),
  ],
  funding: [
    { key: 'ndis', label: 'Personal budget', review_word: 'personal budget', management: MANAGED('Managed by the council', 'Managed by a provider', 'Direct payment'), area_coordinator: 'Social worker', progress_report: 'Progress report for the review' },
    { key: 'support_at_home', label: 'NHS Continuing Healthcare', review_word: 'Continuing Healthcare', management: MANAGED('Managed by the NHS', 'Managed by a provider', 'Personal health budget'), area_coordinator: null, progress_report: null },
    { key: 'other', label: 'Other funding', review_word: 'funding', management: null, area_coordinator: null, progress_report: null },
  ],
  cost_sources: { self: 'Self funded', ndis: 'Personal budget', private_health: 'Health insurance', medicare: 'NHS', government: 'Council', other: 'Other' },
  referral: null,
  recalls: ['flu', 'condition_review', 'dental', 'eye_test'],
  flu_season_month: 10,
  words: {
    advance_directive: 'Advance decision',
    advance_directive_meaning: 'An advance decision writes down the treatment wanted or refused if the person cannot say.',
    health_fund: 'Health insurer',
    health_fund_example: 'Bupa',
    member_number: 'Membership number',
    care_standards: 'the CQC fundamental standards',
    suburb: 'Town',
    state: 'County',
    postcode: 'Postcode',
  },
  sample_address: { line1: '1 High Street', suburb: 'York', state: 'North Yorkshire', postcode: 'YO1 7HH', country: 'United Kingdom' },
  health_funds: ['Bupa', 'AXA Health', 'Aviva', 'Vitality', 'WPA', 'Simplyhealth'],
};

const IE: CountryPreset = {
  code: 'IE',
  name: 'Ireland',
  locale: 'en-IE',
  date_order: 'dmy',
  clock: '24h',
  dial_code: '353',
  phone_example: '087 123 4567',
  currency: 'EUR',
  financial_year_start_month: 1,
  services: {
    emergency: svc('Emergency', '112', null),
    poisons: svc('National Poisons Information Centre', '01 809 2166', 'https://www.poisons.ie'),
    mental_health_crisis: svc('Samaritans', '116 123', 'https://www.samaritans.org/ireland'),
    mental_health_support: svc('YourMentalHealth Information Line', '1800 111 888', 'https://www2.hse.ie/mental-health/'),
    youth_helpline: svc('Childline', '1800 66 66 66', 'https://www.childline.ie'),
    eating_disorders: svc('Bodywhys', '01 210 7906', 'https://www.bodywhys.ie'),
    quit_smoking: svc('HSE QUIT', '1800 201 203', 'https://www.quit.ie'),
    alcohol_drugs: svc('HSE Drugs and Alcohol Helpline', '1800 459 459', 'https://www.drugs.ie'),
    carer_support: svc('Family Carers Ireland', '1800 24 07 24', 'https://familycarers.ie'),
    dementia_support: svc('The Alzheimer Society of Ireland', '1800 341 341', 'https://alzheimer.ie'),
    aged_care_assessment: svc('HSE Live', '1800 700 700', 'https://www2.hse.ie'),
    aged_care_finances: svc('HSE Live', '1800 700 700', 'https://www2.hse.ie'),
  },
  id_groups: [
    { legend: 'Public services', fields: [{ key: 'pps_number' }] },
    { legend: 'Medical card', fields: [{ key: 'medical_card_number' }] },
    PRIVATE('Private health', 'Health insurer', 'Membership number'),
  ],
  funding: [
    { key: 'ndis', label: 'HSE disability support', review_word: 'disability support', management: MANAGED('Managed by the HSE', 'Managed by a provider', 'Personalised budget'), area_coordinator: 'Case manager', progress_report: 'Progress report for the review' },
    { key: 'support_at_home', label: 'HSE Home Support', review_word: 'home support', management: MANAGED('Managed by the HSE', 'Managed by a provider', 'Self managed'), area_coordinator: 'Case manager', progress_report: null },
    { key: 'other', label: 'Other funding', review_word: 'funding', management: null, area_coordinator: null, progress_report: null },
  ],
  cost_sources: { self: 'Self funded', ndis: 'HSE disability support', private_health: 'Health insurance', medicare: 'HSE', government: 'Government', other: 'Other' },
  referral: null,
  recalls: ['flu', 'condition_review', 'dental', 'eye_test', 'licence_medical_70'],
  flu_season_month: 10,
  words: {
    advance_directive: 'Advance healthcare directive',
    advance_directive_meaning: 'An advance healthcare directive writes down the treatment wanted or refused if the person cannot say.',
    health_fund: 'Health insurer',
    health_fund_example: 'Vhi',
    member_number: 'Membership number',
    care_standards: 'the HIQA national standards',
    suburb: 'Town',
    state: 'County',
    postcode: 'Eircode',
  },
  sample_address: { line1: '1 Main Street', suburb: 'Galway', state: 'County Galway', postcode: 'H91 A0C1', country: 'Ireland' },
  health_funds: ['Vhi', 'Laya Healthcare', 'Irish Life Health', 'Level Health'],
};

const CA: CountryPreset = {
  code: 'CA',
  name: 'Canada',
  locale: 'en-CA',
  date_order: 'mdy',
  clock: '12h',
  dial_code: '1',
  phone_example: '(555) 555-0100',
  currency: 'CAD',
  financial_year_start_month: 1,
  services: {
    emergency: svc('Emergency', '911', null),
    mental_health_crisis: svc('9-8-8 Suicide Crisis Helpline', '988', 'https://988.ca'),
    youth_helpline: svc('Kids Help Phone', '1-800-668-6868', 'https://kidshelpphone.ca'),
    eating_disorders: svc('NEDIC', '1-866-633-4220', 'https://nedic.ca'),
    dementia_support: svc('Alzheimer Society of Canada', null, 'https://alzheimer.ca'),
  },
  id_groups: [
    { legend: 'Health card', fields: [{ key: 'health_card_province' }, { key: 'health_card_number' }, { key: 'health_card_version' }] },
    PRIVATE('Extended health', 'Insurer', 'Member ID'),
  ],
  funding: [
    { key: 'ndis', label: 'Disability support funding', review_word: 'disability support', management: MANAGED('Managed by the program', 'Managed by an agency', 'Self managed'), area_coordinator: 'Case manager', progress_report: 'Progress report for the review' },
    { key: 'support_at_home', label: 'Home care', review_word: 'home care', management: MANAGED('Managed by the program', 'Managed by an agency', 'Self managed'), area_coordinator: 'Care coordinator', progress_report: null },
    { key: 'other', label: 'Other funding', review_word: 'funding', management: null, area_coordinator: null, progress_report: null },
  ],
  cost_sources: { self: 'Self funded', ndis: 'Disability support', private_health: 'Extended health', medicare: 'Provincial health plan', government: 'Government', other: 'Other' },
  referral: null,
  recalls: ['flu', 'condition_review', 'dental', 'eye_test'],
  flu_season_month: 10,
  words: {
    advance_directive: 'Advance directive',
    advance_directive_meaning: 'An advance directive writes down the care wanted if the person cannot say.',
    health_fund: 'Insurer',
    health_fund_example: 'Sun Life',
    member_number: 'Member ID',
    care_standards: 'the provincial home and community care standards',
    suburb: 'City',
    state: 'Province',
    postcode: 'Postal code',
  },
  sample_address: { line1: '1 Main Street', suburb: 'Toronto', state: 'ON', postcode: 'M5V 2T6', country: 'Canada' },
  health_funds: ['Sun Life', 'Manulife', 'Canada Life', 'Green Shield Canada', 'Blue Cross'],
};

const US: CountryPreset = {
  code: 'US',
  name: 'United States',
  locale: 'en-US',
  date_order: 'mdy',
  clock: '12h',
  dial_code: '1',
  phone_example: '(555) 555-0100',
  currency: 'USD',
  financial_year_start_month: 1,
  services: {
    emergency: svc('Emergency', '911', null),
    poisons: svc('Poison Help', '1-800-222-1222', 'https://poisonhelp.hrsa.gov'),
    mental_health_crisis: svc('988 Suicide & Crisis Lifeline', '988', 'https://988lifeline.org'),
    mental_health_support: svc('NAMI HelpLine', '1-800-950-6264', 'https://www.nami.org'),
    quit_smoking: svc('1-800-QUIT-NOW', '1-800-784-8669', 'https://smokefree.gov'),
    alcohol_drugs: svc('SAMHSA National Helpline', '1-800-662-4357', 'https://www.samhsa.gov/find-help/helplines/national-helpline'),
    dementia_support: svc("Alzheimer's Association", '1-800-272-3900', 'https://www.alz.org'),
    aged_care_assessment: svc('Eldercare Locator', '1-800-677-1116', 'https://eldercare.acl.gov'),
    aged_care_finder: svc('Medicare Care Compare', '1-800-633-4227', 'https://www.medicare.gov/care-compare'),
    parenting_perinatal: svc('National Maternal Mental Health Hotline', '1-833-852-6262', 'https://mchb.hrsa.gov/national-maternal-mental-health-hotline'),
  },
  id_groups: [
    { legend: 'Medicare', fields: [{ key: 'medicare_mbi' }] },
    { legend: 'Medicaid', fields: [{ key: 'medicaid_number' }] },
    PRIVATE('Health insurance', 'Insurer', 'Member ID'),
  ],
  funding: [
    { key: 'ndis', label: 'Medicaid waiver', review_word: 'waiver', management: MANAGED('Managed by the agency', 'Managed by a provider', 'Self directed'), area_coordinator: 'Case manager', progress_report: 'Progress report for the review' },
    { key: 'support_at_home', label: 'Home care', review_word: 'home care', management: MANAGED('Managed by the agency', 'Managed by a provider', 'Self directed'), area_coordinator: 'Care coordinator', progress_report: null },
    { key: 'other', label: 'Other funding', review_word: 'funding', management: null, area_coordinator: null, progress_report: null },
  ],
  cost_sources: { self: 'Self funded', ndis: 'Medicaid', private_health: 'Health insurance', medicare: 'Medicare', government: 'Government', other: 'Other' },
  referral: null,
  recalls: ['flu', 'annual_wellness_visit', 'condition_review', 'dental', 'eye_test'],
  flu_season_month: 10,
  words: {
    advance_directive: 'Advance directive',
    advance_directive_meaning: 'An advance directive writes down the care wanted if the person cannot say.',
    health_fund: 'Insurer',
    health_fund_example: 'Aetna',
    member_number: 'Member ID',
    care_standards: 'the Medicare and Medicaid home and community care standards',
    suburb: 'City',
    state: 'State',
    postcode: 'ZIP code',
  },
  sample_address: { line1: '1 Main Street', suburb: 'Springfield', state: 'IL', postcode: '62701', country: 'United States' },
  health_funds: ['Aetna', 'Anthem', 'Blue Cross Blue Shield', 'Cigna', 'Humana', 'Kaiser Permanente', 'UnitedHealthcare'],
};

export const PRESETS: Record<CountryCode, CountryPreset> = { AU, NZ, GB, IE, CA, US };
export const preset = (code: string | null | undefined): CountryPreset => PRESETS[isCountryCode(code) ? code : 'AU'];
export const COUNTRY_LIST = COUNTRY_CODES.map((c) => ({ code: c, name: PRESETS[c].name }));

/** A funding plan kind as this country names it; a kind the country has no scheme for reads as its own funding. */
export function fundingScheme(code: string | null | undefined, kind: string | null | undefined): FundingScheme {
  const p = preset(code);
  return p.funding.find((f) => f.key === kind) ?? p.funding.find((f) => f.key === 'other')!;
}

/**
 * The country a server is most likely in, from its time zone and language:
 * the first guess offered at first run, changed in one tap if it is wrong.
 */
export function inferCountry(timeZone?: string | null, language?: string | null): CountryCode {
  // "en_GB.UTF-8" and "en-AU@euro": the encoding and modifier are not part of the region.
  const region = (language ?? '').split('.')[0]!.split('@')[0]!.split(/[-_]/)[1]?.toUpperCase();
  if (region === 'UK') return 'GB';
  if (isCountryCode(region)) return region;
  const tz = timeZone ?? '';
  if (/^Australia\//.test(tz)) return 'AU';
  if (/^(Pacific\/Auckland|Pacific\/Chatham|NZ)/.test(tz)) return 'NZ';
  if (/^Europe\/(London|Belfast)|^GB/.test(tz)) return 'GB';
  if (/^Europe\/Dublin|^Eire/.test(tz)) return 'IE';
  if (/^America\/(Toronto|Vancouver|Edmonton|Winnipeg|Halifax|St_Johns|Regina|Montreal|Moncton|Whitehorse|Yellowknife|Iqaluit)|^Canada\//.test(tz)) return 'CA';
  if (/^America\/(New_York|Chicago|Denver|Los_Angeles|Phoenix|Anchorage|Detroit|Indiana|Kentucky|Boise)|^US\/|^Pacific\/Honolulu/.test(tz)) return 'US';
  return 'AU';
}

/** Built-in step titles that only make sense in Australia, and what they say elsewhere. */
const AU_ONLY_WORDS: Record<string, string> = {
  'Book the over seventy five health assessment': 'Book a yearly health check',
};

const caseLike = (sample: string, word: string): string => {
  if (sample === sample.toUpperCase()) return word.toUpperCase();
  const words = word.split(' ');
  const sampleWords = sample.split(' ');
  return words
    .map((w, i) => {
      const s = sampleWords[Math.min(i, sampleWords.length - 1)] ?? '';
      return /^[A-Z]/.test(s) ? w.charAt(0).toUpperCase() + w.slice(1) : w.toLowerCase();
    })
    .join(' ');
};

/**
 * Built-in step and plan words, in the country's own terms: the advance
 * care directive is an advance decision in the UK. Text a person typed is
 * never passed through this.
 */
export function localiseCareWords(text: string | null | undefined, code: string | null | undefined): string {
  const s = text ?? '';
  const p = preset(code);
  if (p.code === 'AU' || !s) return s;
  // Built-in step titles that name an Australian rule read as the plain check elsewhere.
  const plain = AU_ONLY_WORDS[s];
  if (plain) return plain;
  return s.replace(/advance care directives?/gi, (m) => {
    const plural = /s$/i.test(m);
    const term = p.words.advance_directive + (plural ? 's' : '');
    return caseLike(m, term);
  });
}
