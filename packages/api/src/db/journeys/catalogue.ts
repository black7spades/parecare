/**
 * The default Care Journey catalogue: life stages and journey templates
 * seeded by migration 031. Every row lands as ordinary, editable data;
 * admins can rename, rework or retire all of it. Names, phase names and
 * task text are UI copy: plain language, no parentheses, no em dashes.
 *
 * Task text marked `milestone: true` celebrates in the Memory Book
 * timeline; everything else is still recorded in the achievements
 * database, just not surfaced as a memory.
 */

export interface CatalogueTask {
  title: string;
  description?: string;
  milestone?: boolean;
}

export interface CataloguePhase {
  name: string;
  description?: string;
  /** Legacy care_profiles.current_phase value this phase mirrors. */
  legacy?: string;
  tasks?: CatalogueTask[];
}

export interface CatalogueTemplate {
  slug: string;
  name: string;
  description: string;
  kind: 'life_stage' | 'condition' | 'event' | 'end_of_life';
  /** Life stage names this template is suggested for. */
  stages: string[];
  phases: CataloguePhase[];
  handovers?: { to: string; label: string }[];
}

export interface CatalogueLifeStage {
  name: string;
  description: string;
  min_age_years: number | null;
  max_age_years: number | null;
  applies_before_birth: boolean;
  sort_order: number;
}

export const PREGNANCY = 'Pregnancy and birth';
export const BABY = 'Baby and toddler years';
export const CHILDHOOD = 'Childhood';
export const TEEN = 'Teenage years';
export const YOUNG_ADULT = 'Young adulthood';
export const ADULT = 'Adulthood';
export const LATER_LIFE = 'Later life';
export const END_OF_LIFE = 'End of life and beyond';

export const LIFE_STAGES: CatalogueLifeStage[] = [
  {
    name: PREGNANCY,
    description: 'From conception to birth, for the baby on the way or the person carrying them.',
    min_age_years: null,
    max_age_years: null,
    applies_before_birth: true,
    sort_order: 0,
  },
  {
    name: BABY,
    description: 'Birth to four years old.',
    min_age_years: 0,
    max_age_years: 4,
    applies_before_birth: false,
    sort_order: 1,
  },
  {
    name: CHILDHOOD,
    description: 'Five to twelve years old.',
    min_age_years: 5,
    max_age_years: 12,
    applies_before_birth: false,
    sort_order: 2,
  },
  {
    name: TEEN,
    description: 'Thirteen to seventeen years old.',
    min_age_years: 13,
    max_age_years: 17,
    applies_before_birth: false,
    sort_order: 3,
  },
  {
    name: YOUNG_ADULT,
    description: 'Eighteen to twenty nine years old.',
    min_age_years: 18,
    max_age_years: 29,
    applies_before_birth: false,
    sort_order: 4,
  },
  {
    name: ADULT,
    description: 'Thirty to fifty nine years old.',
    min_age_years: 30,
    max_age_years: 59,
    applies_before_birth: false,
    sort_order: 5,
  },
  {
    name: LATER_LIFE,
    description: 'Sixty years old and over.',
    min_age_years: 60,
    max_age_years: null,
    applies_before_birth: false,
    sort_order: 6,
  },
  {
    name: END_OF_LIFE,
    description: 'Journeys for the end of a life and what comes after, at any age.',
    min_age_years: null,
    max_age_years: null,
    applies_before_birth: false,
    sort_order: 7,
  },
];

export const JOURNEY_TEMPLATES: CatalogueTemplate[] = [
  // ------------------------------------------------------------------
  // Pregnancy and birth
  // ------------------------------------------------------------------
  {
    slug: 'trying-for-a-baby',
    name: 'Trying for a baby',
    description: 'Getting healthy, trying to conceive, and knowing when and where to get fertility help.',
    kind: 'life_stage',
    stages: [PREGNANCY, YOUNG_ADULT, ADULT],
    phases: [
      {
        name: 'Getting ready',
        tasks: [
          { title: 'Book a preconception health check', description: 'A general practitioner can review health, medicines and vaccinations before trying.' },
          { title: 'Start a folate supplement', description: 'Recommended from at least one month before conception.' },
          { title: 'Note cycle dates', description: 'A simple record of cycle dates helps time things and helps any specialist later.' },
        ],
      },
      {
        name: 'Trying',
        tasks: [
          { title: 'Keep a record of cycles and tests', description: 'Dates matter if you later need fertility help.' },
          { title: 'Agree when you would seek help', description: 'Commonly after twelve months of trying, or six months over thirty five.' },
        ],
      },
      {
        name: 'Fertility help',
        tasks: [
          { title: 'Ask for a referral to a fertility specialist', description: 'Your general practitioner can refer both partners for tests.' },
          { title: 'Record each appointment and result', description: 'Fertility care involves many results. Keep every one as its own note.' },
          { title: 'Talk about limits together', description: 'Agree how far you want to go, in money, time and rounds, before you are in the middle of it.' },
        ],
      },
      {
        name: 'Pregnancy confirmed',
        tasks: [
          { title: 'Celebrate the positive test', description: 'This is the moment this journey was for.', milestone: true },
          { title: 'Book the first pregnancy appointment', description: 'Usually with a general practitioner around six to eight weeks.' },
        ],
      },
    ],
    handovers: [{ to: 'expecting-a-baby', label: 'Pregnancy confirmed, start the pregnancy journey' }],
  },
  {
    slug: 'expecting-a-baby',
    name: 'Expecting a baby',
    description: 'A routine pregnancy from the first trimester to the first weeks at home.',
    kind: 'life_stage',
    stages: [PREGNANCY],
    phases: [
      {
        name: 'First trimester',
        tasks: [
          { title: 'Book the first scan', description: 'The dating scan is usually between eight and twelve weeks.' },
          { title: 'Choose your model of care', description: 'Midwife, shared care with a general practitioner, obstetrician, public or private.' },
          { title: 'Decide about early screening tests', description: 'Ask your care team to explain the options in plain language before you decide.' },
          { title: 'Hear the heartbeat', description: 'Often at the first scan.', milestone: true },
        ],
      },
      {
        name: 'Second trimester',
        tasks: [
          { title: 'Go to the twenty week scan', description: 'The detailed scan that checks how the baby is growing.', milestone: true },
          { title: 'Feel the first kicks', description: 'Usually somewhere between sixteen and twenty five weeks.', milestone: true },
          { title: 'Book antenatal classes', description: 'They fill up early. Partners welcome.' },
        ],
      },
      {
        name: 'Third trimester',
        tasks: [
          { title: 'Write the birth plan', description: 'Preferences for labour, pain relief and the hours after birth. Keep it flexible.' },
          { title: 'Pack the hospital bag', description: 'For the birthing person, the support person and the baby.' },
          { title: 'Install the baby car seat', description: 'Have the fitting checked professionally.' },
          { title: 'Agree who to call when labour starts', description: 'And who looks after pets, kids and the house.' },
        ],
      },
      {
        name: 'Birth',
        tasks: [
          { title: 'Welcome the baby', description: 'Record the time, weight and the first photo.', milestone: true },
          { title: 'Register the birth', description: 'Usually within sixty days. The hospital gives you the paperwork.' },
        ],
      },
      {
        name: 'First weeks home',
        tasks: [
          { title: 'Book the first home visit or clinic check', description: 'A midwife or child health nurse checks feeding, weight and how everyone is coping.' },
          { title: 'Watch how the parents are doing', description: 'Low days are common. Persistent low mood deserves the same care as any other health problem.' },
          { title: 'First night everyone slept', description: 'Worth recording. It will happen.', milestone: true },
        ],
      },
    ],
    handovers: [{ to: 'newborn-first-year', label: 'The baby has arrived, start the newborn journey on their own profile' }],
  },
  {
    slug: 'pregnancy-extra-care',
    name: 'A pregnancy that needs extra care',
    description: 'For pregnancies flagged as higher risk, with closer monitoring and a specialist team.',
    kind: 'condition',
    stages: [PREGNANCY],
    phases: [
      {
        name: 'Extra care identified',
        tasks: [
          { title: 'Understand why extra care is needed', description: 'Ask the doctor to explain the risk in plain language and write it down.' },
          { title: 'Meet the specialist team', description: 'Know who leads the care and who to call with worries.' },
        ],
      },
      {
        name: 'Specialist care plan',
        tasks: [
          { title: 'Record the monitoring schedule', description: 'Extra scans, blood tests and appointments, each in the calendar.' },
          { title: 'Know the warning signs', description: 'Write down exactly what should trigger a call or a hospital visit.' },
        ],
      },
      {
        name: 'Close monitoring',
        tasks: [
          { title: 'Log every appointment and result', description: 'Trends matter. Keep each result as its own record.' },
          { title: 'Arrange support at home', description: 'If rest is ordered, plan who covers what.' },
        ],
      },
      {
        name: 'Planning the birth',
        tasks: [
          { title: 'Agree the birth plan with the specialist team', description: 'Timing, place and what happens if plans need to change quickly.' },
          { title: 'Plan for a possible early arrival', description: 'Bag packed early, contacts ready, route to the right hospital known.' },
        ],
      },
      {
        name: 'Birth and recovery',
        tasks: [
          { title: 'Welcome the baby', description: 'After a watched pregnancy this moment deserves extra celebrating.', milestone: true },
          { title: 'Book the postnatal follow up', description: 'A pregnancy that needed extra care needs a proper debrief and recovery check.' },
        ],
      },
    ],
    handovers: [{ to: 'newborn-first-year', label: 'The baby has arrived, start the newborn journey' }],
  },
  {
    slug: 'expecting-baby-with-condition',
    name: 'Expecting a baby with a diagnosed condition',
    description: 'Support from an antenatal diagnosis through decisions, planning and birth.',
    kind: 'condition',
    stages: [PREGNANCY],
    phases: [
      {
        name: 'The diagnosis',
        tasks: [
          { title: 'Get the diagnosis explained twice', description: 'Once at the appointment, once written down. Ask for both.' },
          { title: 'Ask for the genetic counselling referral', description: 'Counsellors explain what the diagnosis means for this baby and future pregnancies.' },
        ],
      },
      {
        name: 'Learning and deciding',
        tasks: [
          { title: 'Connect with families who have walked this path', description: 'Condition specific support groups are often the most honest source of what life looks like.' },
          { title: 'Take the time you are allowed', description: 'Ask the team how much time you have for decisions. Do not let anyone rush inside it.' },
        ],
      },
      {
        name: 'Building the specialist team',
        tasks: [
          { title: 'Meet the paediatric specialists before the birth', description: 'Knowing the faces and the plan lowers the fear.' },
          { title: 'Record every specialist as a provider', description: 'Names, roles and numbers in one place for the day everything moves fast.' },
        ],
      },
      {
        name: 'Planning the birth',
        tasks: [
          { title: 'Choose the hospital with the right nursery', description: 'Birth should happen where the baby can be cared for without a transfer if possible.' },
          { title: 'Write the plan for the first hours', description: 'Who examines the baby, what is done immediately, when you get to hold them.' },
        ],
      },
      {
        name: 'Birth and intensive care',
        tasks: [
          { title: 'Welcome the baby', description: 'Whatever else the day holds, this is a birth day.', milestone: true },
          { title: 'Get the nursery routine explained', description: 'Visiting, feeding, kangaroo care and who updates you each day.' },
        ],
      },
    ],
    handovers: [
      { to: 'premature-baby-home', label: 'Baby is preparing to come home from the nursery' },
      { to: 'complex-needs-young-child', label: 'Baby is home, start the complex medical needs journey' },
    ],
  },
  {
    slug: 'losing-a-pregnancy',
    name: 'Losing a pregnancy',
    description: 'Care after miscarriage or stillbirth. Every task here is optional and in your own time.',
    kind: 'event',
    stages: [PREGNANCY, END_OF_LIFE],
    phases: [
      {
        name: 'Immediate care',
        tasks: [
          { title: 'Ask what happens next medically', description: 'Ask the hospital or doctor to explain the immediate steps and choices slowly.' },
          { title: 'Take any keepsakes offered', description: 'Hospitals can offer photos, prints or mementos. You can take them and decide later whether to look.' },
        ],
      },
      {
        name: 'Physical recovery',
        tasks: [
          { title: 'Book the follow up appointment', description: 'A physical check, and the place to ask why, if that question matters to you.' },
          { title: 'Let the routine care know', description: 'Ask for booked scans and pregnancy reminders to be cancelled so they do not ambush you.' },
        ],
      },
      {
        name: 'Grieving',
        tasks: [
          { title: 'Find the right support', description: 'Pregnancy loss support lines and counsellors exist for exactly this. Grief here is real grief.' },
          { title: 'Tell people in the way you choose', description: 'One message someone else sends for you is a valid way.' },
        ],
      },
      {
        name: 'Thinking about what comes next',
        tasks: [
          { title: 'Talk about whether and when to try again', description: 'There is no schedule. The right time is when both of you say so.' },
          { title: 'Ask what care a next pregnancy would get', description: 'Many services offer earlier scans and closer support after a loss.' },
        ],
      },
    ],
  },
  {
    slug: 'surrogacy-or-adoption',
    name: 'Becoming a parent through surrogacy or adoption',
    description: 'The long road of approvals, matching and welcoming a child home.',
    kind: 'event',
    stages: [PREGNANCY, YOUNG_ADULT, ADULT],
    phases: [
      {
        name: 'Preparation and approvals',
        tasks: [
          { title: 'Understand the legal path', description: 'Rules differ by state and country. Get advice specific to yours before anything else.' },
          { title: 'Complete the assessments', description: 'Checks and interviews take months. Track each requirement as its own item.' },
        ],
      },
      {
        name: 'Matching and waiting',
        tasks: [
          { title: 'Decide how to spend the wait', description: 'Courses, preparing the family, or deliberately living life. Waiting is the hardest phase.' },
          { title: 'Keep contact details current', description: 'A missed call in this phase can matter. Keep the agency up to date.' },
        ],
      },
      {
        name: 'Getting the home ready',
        tasks: [
          { title: 'Prepare the child’s space', description: 'For an older child, involve what you know of their tastes.', milestone: true },
          { title: 'Plan the first weeks of leave', description: 'Attachment takes presence. Arrange as much time as you can.' },
        ],
      },
      {
        name: 'Arrival',
        tasks: [
          { title: 'Welcome them home', description: 'The day the family changes shape.', milestone: true },
          { title: 'Complete the legal formalities', description: 'Orders, certificates and citizenship where relevant.' },
        ],
      },
      {
        name: 'Settling in as a family',
        tasks: [
          { title: 'Book the first health check', description: 'A full check with a general practitioner who knows the child’s history so far.' },
          { title: 'Keep the support visits', description: 'Post placement support exists to help, not to judge. Use it.' },
        ],
      },
    ],
    handovers: [{ to: 'newborn-first-year', label: 'A baby has arrived, start the newborn journey' }],
  },

  // ------------------------------------------------------------------
  // Baby and toddler years
  // ------------------------------------------------------------------
  {
    slug: 'newborn-first-year',
    name: 'Newborn and the first year',
    description: 'Feeding, sleeping, checks, immunisations and the milestones of year one.',
    kind: 'life_stage',
    stages: [BABY],
    phases: [
      {
        name: 'First weeks',
        tasks: [
          { title: 'Book the newborn checks', description: 'The hearing screen, the heel prick test and the six week check.' },
          { title: 'Register with a general practitioner and child health nurse', description: 'The two people you will call most in year one.' },
          { title: 'First smile', description: 'Usually around six weeks. Worth a photo.', milestone: true },
        ],
      },
      {
        name: 'Feeding and sleep',
        tasks: [
          { title: 'Get feeding support early if it hurts or worries you', description: 'Lactation consultants and feeding clinics exist for exactly this.' },
          { title: 'Learn safe sleep', description: 'On the back, own safe space, face clear. Every carer who does nights should know it.' },
        ],
      },
      {
        name: 'Immunisations and checks',
        tasks: [
          { title: 'Put the immunisation schedule in the calendar', description: 'Each visit as its own event, from six weeks on.' },
          { title: 'Keep the health record book up to date', description: 'Weights, lengths and checks in one place, and in PareCare.' },
        ],
      },
      {
        name: 'Watching milestones',
        tasks: [
          { title: 'First laugh', milestone: true },
          { title: 'Rolling, sitting, crawling', description: 'Record the dates. Ranges are wide and normal.', milestone: true },
          { title: 'Raise anything that niggles', description: 'If something feels off, ask the child health nurse. You will not be wasting anyone’s time.' },
        ],
      },
      {
        name: 'First birthday review',
        tasks: [
          { title: 'First birthday', description: 'One year of keeping a human alive. Celebrate properly.', milestone: true },
          { title: 'Do the twelve month check and immunisations', description: 'And look back through this year’s record together.' },
        ],
      },
    ],
  },
  {
    slug: 'premature-baby-home',
    name: 'A premature or medically fragile baby coming home',
    description: 'From the intensive care nursery to a settled life at home.',
    kind: 'condition',
    stages: [BABY],
    phases: [
      {
        name: 'Planning the trip home',
        tasks: [
          { title: 'Learn the care before discharge', description: 'Feeding, medicines, equipment and resuscitation basics, practised while nurses can still coach.' },
          { title: 'Write the discharge plan into PareCare', description: 'Follow up appointments, medicines and warning signs, each as its own record.' },
        ],
      },
      {
        name: 'First weeks at home',
        tasks: [
          { title: 'The first night home', description: 'After weeks or months of hospital, this night is the milestone.', milestone: true },
          { title: 'Protect the bubble', description: 'Small visitors carry big germs. Agree the visiting rules and let PareCare deliver the message.' },
        ],
      },
      {
        name: 'Equipment and follow up appointments',
        tasks: [
          { title: 'Track every follow up clinic', description: 'Eyes, hearing, development, specialists. Each one in the calendar with its outcome logged.' },
          { title: 'Keep an equipment list', description: 'What you have, who supplied it, who fixes it.' },
        ],
      },
      {
        name: 'Growing stronger',
        tasks: [
          { title: 'Celebrate corrected age milestones', description: 'Premature babies are measured from their due date, not their birth date. Each catch up is a win.', milestone: true },
          { title: 'Log weights and feeds', description: 'Growth is the report card. Keep the numbers.' },
        ],
      },
      {
        name: 'Stepping down support',
        tasks: [
          { title: 'Graduate from a clinic', description: 'Each specialist who says they no longer need to see the baby is a milestone.', milestone: true },
          { title: 'Move to the standard schedule', description: 'When the team agrees, shift to the normal child health checks.' },
        ],
      },
    ],
    handovers: [{ to: 'newborn-first-year', label: 'Settled at home, continue with the standard first year journey' }],
  },
  {
    slug: 'early-development-concern',
    name: 'Something to watch in early development',
    description: 'From a first niggle about speech, movement or connection through assessment to early support.',
    kind: 'condition',
    stages: [BABY, CHILDHOOD],
    phases: [
      {
        name: 'Something to watch',
        tasks: [
          { title: 'Write down what you are noticing', description: 'Specific examples with dates beat general worries at every appointment that follows.' },
          { title: 'Raise it at the child health check', description: 'Or book one specially. Trust the niggle.' },
        ],
      },
      {
        name: 'Getting assessed',
        tasks: [
          { title: 'Get on every waiting list at once', description: 'Paediatrician, speech, occupational therapy. Lists are long, join them in parallel, cancel later.' },
          { title: 'Ask about early support while you wait', description: 'In Australia the National Disability Insurance Scheme early childhood pathway can start before a diagnosis.' },
        ],
      },
      {
        name: 'Understanding the diagnosis',
        tasks: [
          { title: 'Get the report explained in plain language', description: 'Ask the assessor to walk through it. Ask what the jargon words mean until they all make sense.' },
          { title: 'Tell family in the way you choose', description: 'Decide together what to share and how.' },
        ],
      },
      {
        name: 'Early intervention underway',
        tasks: [
          { title: 'Build the therapy roster', description: 'Who takes which session, logged so the whole circle sees coverage.' },
          { title: 'Record what works', description: 'Therapists change. A record of what helps this child is gold for every new one.' },
          { title: 'First word, first sign, first step', description: 'However communication or movement comes, celebrate it.', milestone: true },
        ],
      },
      {
        name: 'Review and adjust',
        tasks: [
          { title: 'Review goals with the team', description: 'Every plan has a review date. Bring your record of what changed.' },
          { title: 'Update funding plans before they lapse', description: 'Reviews need evidence. Your logs are the evidence.' },
        ],
      },
    ],
    handovers: [{ to: 'starting-school-additional-needs', label: 'School is on the horizon, start the school transition journey' }],
  },
  {
    slug: 'complex-needs-young-child',
    name: 'A young child with complex medical needs',
    description: 'Running the team, the routine, the therapies and the hospital stays for a child with high needs.',
    kind: 'condition',
    stages: [BABY, CHILDHOOD],
    phases: [
      {
        name: 'Building the team',
        tasks: [
          { title: 'List every specialist as a provider', description: 'Names, roles, numbers and who coordinates. One list the whole circle can see.' },
          { title: 'Nominate the care coordinator', description: 'One person, professional or family, holds the threads. Name them.' },
        ],
      },
      {
        name: 'Daily routine in place',
        tasks: [
          { title: 'Write the daily care routine down', description: 'Meds, feeds, therapies and equipment checks so any trained carer can run a day.' },
          { title: 'Set up the medication list in PareCare', description: 'Every medicine with its own dose, route and schedule.' },
        ],
      },
      {
        name: 'Therapy blocks',
        tasks: [
          { title: 'Log therapy goals and progress', description: 'Each block has goals. Record them and what actually changed.' },
          { title: 'Celebrate the gains', description: 'Head control, a new sound, a tolerated food. In this journey these are the milestones.', milestone: true },
        ],
      },
      {
        name: 'Hospital stays',
        tasks: [
          { title: 'Keep a ready packed hospital bag', description: 'For the child and for the parent staying.' },
          { title: 'Log each admission and what changed', description: 'Dates, ward, what was tried, what the discharge plan says.' },
        ],
      },
      {
        name: 'Plan reviews',
        tasks: [
          { title: 'Prepare for each plan review with the record', description: 'Funding reviews reward evidence. Export the logs.' },
          { title: 'Check the circle is holding', description: 'Complex care burns carers out. Review who needs backup, including you.' },
        ],
      },
    ],
  },
  {
    slug: 'feeding-growth-sleep',
    name: 'Feeding, growth and sleep support',
    description: 'When eating, growing or sleeping is the battle, a short journey to name it, get help and review.',
    kind: 'condition',
    stages: [BABY, CHILDHOOD],
    phases: [
      {
        name: 'Naming the problem',
        tasks: [
          { title: 'Keep a one week diary', description: 'Feeds or meals, sleeps and wake ups, exactly as they happen. Patterns appear fast.' },
          { title: 'Rule out the simple things', description: 'A general practitioner check for reflux, intolerance, iron and ears.' },
        ],
      },
      {
        name: 'Getting help',
        tasks: [
          { title: 'Book the right clinic', description: 'Feeding clinic, sleep program or dietitian, depending on what the diary shows.' },
          { title: 'Agree one approach as a household', description: 'Mixed methods cancel each other out. Everyone runs the same plan.' },
        ],
      },
      {
        name: 'Trying the plan',
        tasks: [
          { title: 'Run the plan for the agreed period', description: 'Log the nights and meals so the review works from facts.' },
          { title: 'First full night or first fear food eaten', description: 'Whatever the win looks like here, record it.', milestone: true },
        ],
      },
      {
        name: 'Reviewing progress',
        tasks: [
          { title: 'Review with the diary in hand', description: 'Keep, adjust or escalate, decided on the record, not the worst night.' },
        ],
      },
    ],
  },
  {
    slug: 'starting-childcare-additional-needs',
    name: 'Starting childcare with additional needs',
    description: 'Choosing a setting that can meet the child’s needs and handing their care over well.',
    kind: 'event',
    stages: [BABY, CHILDHOOD],
    phases: [
      {
        name: 'Choosing the setting',
        tasks: [
          { title: 'Visit with your questions written down', description: 'Ratios, experience with similar needs, medication policy, how they handle the hard days.' },
          { title: 'Ask about inclusion support funding', description: 'Services can often access extra support staff. Ask directly.' },
        ],
      },
      {
        name: 'Preparing the handover',
        tasks: [
          { title: 'Write the about me handover', description: 'Needs, signals, calming strategies, medicines and emergency steps, one page carers actually read.' },
          { title: 'Do the medical training handover', description: 'If there are medicines or devices, the service needs training before day one, not after.' },
        ],
      },
      {
        name: 'Settling in',
        tasks: [
          { title: 'First day', description: 'A big day for the child and bigger for the parents.', milestone: true },
          { title: 'Agree the communication rhythm', description: 'A daily note or app update while everyone learns the child.' },
        ],
      },
      {
        name: 'First term review',
        tasks: [
          { title: 'Review how the setting is really going', description: 'With the educators, against what you agreed at enrolment.' },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------
  // Childhood
  // ------------------------------------------------------------------
  {
    slug: 'starting-school-additional-needs',
    name: 'Starting school with additional needs',
    description: 'From choosing a school through transition, the first term and the reviews that follow.',
    kind: 'event',
    stages: [CHILDHOOD],
    phases: [
      {
        name: 'Choosing the school',
        tasks: [
          { title: 'Tour schools with the same question list', description: 'Support staffing, adjustment experience, therapy access and how they talk about kids like yours.' },
          { title: 'Start enrolment conversations a year early', description: 'Support funding applications take time. Start before you feel ready.' },
        ],
      },
      {
        name: 'Transition planning',
        tasks: [
          { title: 'Set up the school support plan', description: 'The documented adjustments the school commits to. Get it in writing before day one.' },
          { title: 'Arrange transition visits', description: 'Extra orientation visits so the school is familiar before it is compulsory.' },
        ],
      },
      {
        name: 'First term',
        tasks: [
          { title: 'First day of school', milestone: true },
          { title: 'Set the teacher communication channel', description: 'Agree how day to day notes flow so problems surface small.' },
        ],
      },
      {
        name: 'Support plan review',
        tasks: [
          { title: 'Review the support plan against reality', description: 'What was promised, what is happening, what needs changing. Bring examples.' },
        ],
      },
      {
        name: 'Each new year',
        tasks: [
          { title: 'Brief the new teacher before term starts', description: 'The one page handover, updated. Do not make the child retrain the adults from scratch.' },
        ],
      },
    ],
  },
  {
    slug: 'long-term-condition-child',
    name: 'Managing a long-term condition in childhood',
    description: 'Asthma, diabetes, epilepsy, allergy or another lasting condition, from diagnosis to confident routine.',
    kind: 'condition',
    stages: [CHILDHOOD],
    phases: [
      {
        name: 'The new diagnosis',
        tasks: [
          { title: 'Get the action plan', description: 'Every long term childhood condition should come with a written plan for normal days and bad days.' },
          { title: 'Set up medicines in PareCare', description: 'Each medicine with its own dose, route and schedule so any carer can follow it.' },
        ],
      },
      {
        name: 'Learning the ropes',
        tasks: [
          { title: 'Train every regular carer', description: 'Grandparents, babysitters and the school all need the action plan and the practice.' },
          { title: 'Learn the triggers and early signs', description: 'Log episodes with dates and suspected triggers. Patterns emerge in the record.' },
        ],
      },
      {
        name: 'A stable routine',
        tasks: [
          { title: 'First month without an episode', milestone: true },
          { title: 'Book the regular reviews', description: 'Stable still needs reviewing. Set the recurring appointments.' },
        ],
      },
      {
        name: 'School and activities covered',
        tasks: [
          { title: 'Lodge the action plan with the school', description: 'And with sport clubs and camps. Update it every year.' },
          { title: 'First school camp or sleepover managed', description: 'The condition travelled and everyone coped.', milestone: true },
        ],
      },
      {
        name: 'Growing independence',
        tasks: [
          { title: 'Teach the child their own early signs', description: 'Age appropriate, one step at a time.' },
          { title: 'Let them carry something', description: 'The inhaler, the identification card, a piece of their own care.', milestone: true },
        ],
      },
    ],
    handovers: [{ to: 'taking-over-your-own-condition', label: 'Becoming a teenager, start handing the condition over to them' }],
  },
  {
    slug: 'neurodivergent-child-support',
    name: 'Support for a neurodivergent child',
    description: 'Understanding the child’s profile and building supports at home, in therapy and at school.',
    kind: 'condition',
    stages: [CHILDHOOD],
    phases: [
      {
        name: 'Understanding the profile',
        tasks: [
          { title: 'Get the assessment report explained', description: 'Strengths and needs in plain language, not just scores.' },
          { title: 'Learn from the child', description: 'What calms, what overwhelms, what fascinates. Write it down as the family knowledge base.' },
        ],
      },
      {
        name: 'Therapy and supports in place',
        tasks: [
          { title: 'Choose supports that fit the child', description: 'Not every recommended therapy suits every child. Trial, log, keep what works.' },
          { title: 'Apply for funding support', description: 'In Australia, the National Disability Insurance Scheme. Bring the assessment and your logs.' },
        ],
      },
      {
        name: 'School partnership',
        tasks: [
          { title: 'Agree classroom adjustments in writing', description: 'Sensory breaks, seating, instructions. Small adjustments, documented.' },
          { title: 'Set a teacher check in rhythm', description: 'Short and regular beats long and rare.' },
        ],
      },
      {
        name: 'Plan reviews',
        tasks: [
          { title: 'Review supports each year', description: 'The child changes every year. The supports should too.' },
        ],
      },
      {
        name: 'Preparing for high school',
        tasks: [
          { title: 'Choose the high school early', description: 'Visit in year five, decide in year six, transition with time to spare.' },
          { title: 'Build the self knowledge handover', description: 'Help the child describe their own needs. In high school they become their own first advocate.', milestone: true },
        ],
      },
    ],
    handovers: [{ to: 'disability-support-teen-years', label: 'Starting the teenage years, continue with teen disability support' }],
  },
  {
    slug: 'serious-illness-child',
    name: 'Serious illness treatment in childhood',
    description: 'A serious diagnosis in childhood, through treatment and back towards normal life.',
    kind: 'condition',
    stages: [CHILDHOOD],
    phases: [
      {
        name: 'Diagnosis and staging',
        tasks: [
          { title: 'Get the diagnosis and plan in writing', description: 'What it is, what the treatment path looks like, what the team is hoping for.' },
          { title: 'Nominate the family spokesperson', description: 'One person updates everyone else, so the parents can face the ward, not the phone.' },
        ],
      },
      {
        name: 'Treatment rounds',
        tasks: [
          { title: 'Map the treatment calendar', description: 'Rounds, recovery windows and scan dates, so the family can plan life in the gaps.' },
          { title: 'Log each round and how the child handled it', description: 'Side effects and what helped. The record shapes the next round.' },
        ],
      },
      {
        name: 'Living during treatment',
        tasks: [
          { title: 'Keep school in the picture', description: 'Hospital school programs and visits keep the child a schoolkid, not just a patient.' },
          { title: 'Plan one good thing per week', description: 'Small, reliable and theirs to choose.', milestone: true },
          { title: 'Mind the siblings', description: 'Brothers and sisters carry this too. Give them their own named support.' },
        ],
      },
      {
        name: 'Response review',
        tasks: [
          { title: 'Hear the results with support', description: 'Bring another adult to the results appointment. Four ears, one notebook.' },
          { title: 'Decide the next step with the team', description: 'Continue, change or celebrate. The handover options below are for the paths ahead.' },
        ],
      },
      {
        name: 'Recovery and monitoring',
        tasks: [
          { title: 'End of treatment bell', description: 'The day treatment finishes.', milestone: true },
          { title: 'Put surveillance scans in the calendar', description: 'Monitoring appointments, each with its result logged.' },
          { title: 'Return to school full time', milestone: true },
        ],
      },
    ],
    handovers: [{ to: 'living-with-terminal-illness', label: 'If treatment cannot cure, plan for comfort and time' }],
  },
  {
    slug: 'child-mental-health',
    name: 'Mental health and wellbeing support for a child',
    description: 'Noticing a struggle, getting it assessed and supporting a child back to steady.',
    kind: 'condition',
    stages: [CHILDHOOD],
    phases: [
      {
        name: 'Noticing',
        tasks: [
          { title: 'Write down what changed and when', description: 'Sleep, appetite, school refusal, withdrawal. Dates and examples.' },
          { title: 'Ask the child, gently and sideways', description: 'Car rides and walks work better than sit downs.' },
        ],
      },
      {
        name: 'Getting assessed',
        tasks: [
          { title: 'Start with the general practitioner', description: 'They can assess, refer and open a mental health care plan.' },
          { title: 'Loop the school in', description: 'The wellbeing team sees the child six hours a day. Make them allies.' },
        ],
      },
      {
        name: 'Support underway',
        tasks: [
          { title: 'Keep the sessions steady', description: 'Therapy works on rhythm. Protect the appointments.' },
          { title: 'Log the good days too', description: 'Recovery is jagged. The record shows the slope, not the spikes.' },
        ],
      },
      {
        name: 'Review and adjust',
        tasks: [
          { title: 'Review progress with the clinician', description: 'What is better, what is not, whether the approach still fits.' },
          { title: 'A whole good week', milestone: true },
        ],
      },
    ],
  },
  {
    slug: 'child-injury-recovery',
    name: 'Recovery from injury or major surgery in childhood',
    description: 'From the event through hospital, home and rehabilitation to full strength.',
    kind: 'event',
    stages: [CHILDHOOD, TEEN],
    phases: [
      {
        name: 'The event',
        tasks: [
          { title: 'Record what happened', description: 'Date, place, what was injured or operated on, who treated it.' },
        ],
      },
      {
        name: 'In hospital',
        tasks: [
          { title: 'Get the discharge plan explained', description: 'Wound care, medicines, restrictions and red flags, written down before leaving.' },
        ],
      },
      {
        name: 'Coming home',
        tasks: [
          { title: 'Set up home for the recovery', description: 'Sleeping arrangements, school plan and who supervises what.' },
          { title: 'Home from hospital', milestone: true },
        ],
      },
      {
        name: 'Rehabilitation',
        tasks: [
          { title: 'Keep the physiotherapy schedule', description: 'The boring exercises are the recovery. Log the sessions.' },
          { title: 'Back to school', milestone: true },
        ],
      },
      {
        name: 'Back to full strength',
        tasks: [
          { title: 'Get the final clearance', description: 'The all clear for sport and rough play, from the treating team, not from optimism.', milestone: true },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------
  // Teenage years
  // ------------------------------------------------------------------
  {
    slug: 'teen-mental-health',
    name: 'Teen mental health support',
    description: 'Noticing, talking, getting the right help and standing steadily back down.',
    kind: 'condition',
    stages: [TEEN],
    phases: [
      {
        name: 'Noticing and talking',
        tasks: [
          { title: 'Name what you are seeing, without diagnosis', description: 'You seem flat lately lands better than I think you are depressed.' },
          { title: 'Keep the door visibly open', description: 'Regular low stakes time together is the platform the conversation eventually lands on.' },
        ],
      },
      {
        name: 'Getting help',
        tasks: [
          { title: 'Let the teen choose the format where possible', description: 'In person, online or text based support. Used help beats ideal help.' },
          { title: 'Book the general practitioner assessment', description: 'A youth friendly doctor, a long appointment, and the teen seen alone for part of it.' },
        ],
      },
      {
        name: 'Support underway',
        tasks: [
          { title: 'Respect the privacy of the sessions', description: 'You support the logistics. The content is theirs unless safety requires otherwise.' },
          { title: 'Agree the safety plan', description: 'Who the teen tells and what happens when things get dark. Written, shared, rehearsed.' },
        ],
      },
      {
        name: 'Staying steady',
        tasks: [
          { title: 'Watch the foundations', description: 'Sleep, movement, food, mates. Log the drift before the dip.' },
          { title: 'Back doing the thing they love', milestone: true },
        ],
      },
      {
        name: 'Standing down support',
        tasks: [
          { title: 'Step down with the clinician, not cold', description: 'Agree what returning signs would mean and who calls whom.' },
        ],
      },
    ],
  },
  {
    slug: 'taking-over-your-own-condition',
    name: 'Taking over your own condition',
    description: 'The teenage handover: from parents managing a condition to the young person leading their own care.',
    kind: 'condition',
    stages: [TEEN],
    phases: [
      {
        name: 'Understanding my condition',
        tasks: [
          { title: 'Explain the condition back in your own words', description: 'To a parent or the doctor. Owning it starts with being able to say it.' },
          { title: 'Know your own medicines', description: 'What each one is for, the dose, and what happens if you skip it.' },
        ],
      },
      {
        name: 'Sharing the load',
        tasks: [
          { title: 'Take over one piece of the routine', description: 'Ordering scripts, packing the kit, logging the readings. One piece, fully yours.', milestone: true },
          { title: 'See the doctor alone for part of the visit', description: 'Standard practice from the mid teens. Parents wait outside for the first bit.' },
        ],
      },
      {
        name: 'Leading my own care',
        tasks: [
          { title: 'Run a whole month yourself', description: 'Medicines, appointments and logs, with parents as backup only.', milestone: true },
          { title: 'Handle a bad day by the plan', description: 'The first flare or low you manage yourself is the real graduation.', milestone: true },
        ],
      },
      {
        name: 'Moving to adult services',
        tasks: [
          { title: 'Plan the transfer with the paediatric team', description: 'A named adult service, a referral letter and ideally one joint appointment.' },
          { title: 'First adult clinic appointment attended', milestone: true },
        ],
      },
    ],
    handovers: [{ to: 'owning-my-own-health', label: 'Transferred to adult services, start owning your whole health' }],
  },
  {
    slug: 'serious-illness-teen',
    name: 'Serious illness treatment',
    description: 'A serious diagnosis in the teenage years, through treatment while staying a teenager.',
    kind: 'condition',
    stages: [TEEN],
    phases: [
      {
        name: 'Diagnosis and staging',
        tasks: [
          { title: 'Get the diagnosis explained to the teen directly', description: 'Age appropriate honesty. Teens cope better with truth than with corridors of whispers.' },
          { title: 'Get the plan in writing', description: 'The treatment path, the timeline and what the team is aiming for.' },
          { title: 'Nominate the update person', description: 'One person keeps the wider circle informed so the family can face the treatment, not the phone.' },
        ],
      },
      {
        name: 'Treatment rounds',
        tasks: [
          { title: 'Map the treatment calendar', description: 'Rounds, recovery windows and scan dates, so life can be planned in the gaps.' },
          { title: 'Log each round and the side effects', description: 'What hit hard and what helped. The record shapes the next round.' },
          { title: 'Let the teen hold some controls', description: 'Music in the ward, who visits, what gets posted. Control is scarce here, hand over every scrap.' },
        ],
      },
      {
        name: 'Living during treatment',
        tasks: [
          { title: 'Keep school and friends in reach', description: 'Part days, video calls into class, mates on the ward. On the teen’s terms.' },
          { title: 'Plan things worth looking forward to', description: 'Small and reliable, one each week.', milestone: true },
          { title: 'Connect with other young people in treatment', description: 'Youth cancer services run programs where everyone just gets it.' },
        ],
      },
      {
        name: 'Response review',
        tasks: [
          { title: 'Hear the results together, with support', description: 'The teen chooses who is in the room. Notes get taken.' },
          { title: 'Decide the next step with the team', description: 'Continue, change course or celebrate. The handover choices below are the paths ahead.' },
        ],
      },
      {
        name: 'Recovery and monitoring',
        tasks: [
          { title: 'End of treatment', description: 'Ring the bell.', milestone: true },
          { title: 'Set the surveillance schedule', description: 'Monitoring scans in the calendar with each result logged.' },
          { title: 'Back to normal life, redefined', description: 'School, sport, plans. It will not be the old normal and it counts anyway.', milestone: true },
        ],
      },
    ],
    handovers: [{ to: 'living-with-terminal-illness', label: 'If treatment cannot cure, plan for comfort and time' }],
  },
  {
    slug: 'disability-support-teen-years',
    name: 'Disability support through the teenage years',
    description: 'Supports that grow with the young person through puberty, school changes and rising independence.',
    kind: 'condition',
    stages: [TEEN],
    phases: [
      {
        name: 'Reviewing supports for the teen years',
        tasks: [
          { title: 'Reassess supports against the teenager, not the child', description: 'Needs, goals and dignity all change shape. The plan should too.' },
          { title: 'Bring the young person into the planning meeting', description: 'Their goals lead now, in whatever communication form is theirs.' },
        ],
      },
      {
        name: 'Body and identity changes',
        tasks: [
          { title: 'Get puberty support that fits', description: 'Accessible information about bodies, privacy and relationships is a right, not an extra.' },
          { title: 'Update personal care plans for dignity', description: 'Same gender carers, privacy rules and consent practices, written into the plan.' },
        ],
      },
      {
        name: 'School transitions',
        tasks: [
          { title: 'Plan the senior school pathway', description: 'Subjects, adjusted assessment and what the post school goal is.' },
        ],
      },
      {
        name: 'Building independence',
        tasks: [
          { title: 'Pick this year’s independence goal', description: 'Public transport, cooking a meal, managing money. One real goal, properly supported.', milestone: true },
          { title: 'First solo achievement unlocked', description: 'Whatever it was, record it. This is the point of everything.', milestone: true },
        ],
      },
      {
        name: 'Preparing for adult supports',
        tasks: [
          { title: 'Start the adult services paperwork early', description: 'Adult disability supports have their own processes. Begin at sixteen, not at the birthday.' },
        ],
      },
    ],
    handovers: [{ to: 'getting-ready-for-adulthood', label: 'Approaching eighteen, start the adulthood preparation journey' }],
  },
  {
    slug: 'getting-ready-for-adulthood',
    name: 'Getting ready for adulthood',
    description: 'What changes at eighteen: decisions, money, documents and adult services, sorted in advance.',
    kind: 'event',
    stages: [TEEN],
    phases: [
      {
        name: 'Understanding what changes at eighteen',
        tasks: [
          { title: 'List what legally changes for this person', description: 'Consent, contracts, voting, and for supported people, who may decide what.' },
        ],
      },
      {
        name: 'Decision making support',
        tasks: [
          { title: 'Choose the lightest decision support that works', description: 'Supported decision making first. Guardianship and administration orders only where truly needed.' },
          { title: 'Put the arrangements in place before the birthday', description: 'Court and tribunal processes take months. Eighteen arrives on schedule.' },
        ],
      },
      {
        name: 'Money and documents',
        tasks: [
          { title: 'Set up the bank account and identification', description: 'Tax file number, identification documents and a bank account they control or co control.' },
          { title: 'Sort government registrations', description: 'Health insurance, benefits and the electoral roll where relevant.' },
        ],
      },
      {
        name: 'Adult health services',
        tasks: [
          { title: 'Find the adult general practitioner', description: 'A doctor the young adult chooses and can see alone.' },
          { title: 'Transfer specialist care to adult services', description: 'Named services, referrals sent, records transferred.' },
        ],
      },
      {
        name: 'Launch',
        tasks: [
          { title: 'Eighteenth birthday', milestone: true },
          { title: 'Hand over the passwords', description: 'The records, accounts and logins are theirs now, or shared on their terms.', milestone: true },
        ],
      },
    ],
    handovers: [{ to: 'owning-my-own-health', label: 'Eighteen and launched, start owning your own health' }],
  },
  {
    slug: 'teen-recovery-support',
    name: 'Recovery support',
    description: 'For a young person facing an eating disorder or substance use, without judgement.',
    kind: 'condition',
    stages: [TEEN, YOUNG_ADULT],
    phases: [
      {
        name: 'Naming the problem',
        tasks: [
          { title: 'Say it out loud with someone safe', description: 'A parent, a school counsellor, a doctor or a helpline. Naming it is the first act of recovery.' },
          { title: 'Get a proper assessment', description: 'A clinician who works with young people assesses what this is and how serious.' },
        ],
      },
      {
        name: 'Finding the right help',
        tasks: [
          { title: 'Choose a program built for young people', description: 'Youth specific eating disorder and substance services exist and work differently to adult ones.' },
          { title: 'Decide what family involvement looks like', description: 'Family based treatment is often the evidence backed default for teens. Agree the roles.' },
        ],
      },
      {
        name: 'Treatment underway',
        tasks: [
          { title: 'Protect the appointments', description: 'Recovery is attendance plus time. Everything else flexes around the sessions.' },
          { title: 'Log the wins and the wobbles', description: 'Both are data. Neither is a verdict.' },
        ],
      },
      {
        name: 'Rebuilding routines',
        tasks: [
          { title: 'Rebuild one routine at a time', description: 'Meals, sleep, school, movement. One at a time, held gently.' },
          { title: 'A normal week', description: 'School, mates, meals, sleep. Unremarkable and hard won.', milestone: true },
        ],
      },
      {
        name: 'Staying well',
        tasks: [
          { title: 'Write the relapse plan together', description: 'Early signs, first responses and who to call, agreed while things are good.' },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------
  // Young adulthood
  // ------------------------------------------------------------------
  {
    slug: 'owning-my-own-health',
    name: 'Owning my own health',
    description: 'The first journey of adult life: your own doctor, your own records, your own habits.',
    kind: 'life_stage',
    stages: [YOUNG_ADULT],
    phases: [
      {
        name: 'My baseline',
        tasks: [
          { title: 'Book a full check up', description: 'Blood pressure, bloods, skin, and anything your family history says to watch.' },
          { title: 'Record your baseline numbers', description: 'Blood pressure, cholesterol and weight, each logged. Future you will thank you.' },
        ],
      },
      {
        name: 'My general practitioner and my records',
        tasks: [
          { title: 'Choose your own regular doctor', description: 'One practice that knows you beats a different clinic every time.' },
          { title: 'Gather your history into one place', description: 'Childhood conditions, immunisations, allergies and family history, recorded once, properly.' },
        ],
      },
      {
        name: 'Screening and immunisations up to date',
        tasks: [
          { title: 'Catch up any missed immunisations', description: 'Ask the practice to check the register.' },
          { title: 'Know your screening schedule', description: 'What applies to your body and age, and when each check is due.' },
        ],
      },
      {
        name: 'My habits',
        tasks: [
          { title: 'Pick one habit to build and one to cut', description: 'One of each, this year, tracked honestly.' },
          { title: 'Ninety days of the new habit', milestone: true },
        ],
      },
      {
        name: 'Yearly check in',
        tasks: [
          { title: 'Book the yearly review', description: 'A standing appointment. Numbers compared to baseline, habits reviewed, plan renewed.' },
        ],
      },
    ],
  },
  {
    slug: 'living-independently-with-disability',
    name: 'Living independently with disability',
    description: 'Planning and making the move to a place of your own, with the supports to run it your way.',
    kind: 'life_stage',
    stages: [YOUNG_ADULT, ADULT],
    phases: [
      {
        name: 'Planning the move',
        tasks: [
          { title: 'Define what independence means for you', description: 'Your own front door, your own timetable, your own risks. Write your version down.' },
          { title: 'Explore housing and funding options', description: 'Individual living options, shared supported housing or a rental with drop in support.' },
        ],
      },
      {
        name: 'Setting up supports',
        tasks: [
          { title: 'Build the support roster around your life', description: 'Supports fit your timetable, not the other way round.' },
          { title: 'Set up the home for how you live', description: 'Modifications, technology and equipment in place before move in day.' },
        ],
      },
      {
        name: 'Settling in',
        tasks: [
          { title: 'Move in day', milestone: true },
          { title: 'First week run on your own rhythm', milestone: true },
        ],
      },
      {
        name: 'Running my own supports',
        tasks: [
          { title: 'Learn to manage the support budget', description: 'Self managing or plan managing gives you choice and control. Get help learning it.' },
          { title: 'Hire and shape your own team', description: 'Good support workers amplify your life. You are the employer of your own life.' },
        ],
      },
      {
        name: 'Plan reviews',
        tasks: [
          { title: 'Review the plan with your evidence', description: 'Your logs show what supports made possible. Bring them.' },
        ],
      },
    ],
  },
  {
    slug: 'mental-health-recovery',
    name: 'Mental health recovery',
    description: 'From reaching out through treatment to a rhythm that holds.',
    kind: 'condition',
    stages: [YOUNG_ADULT, ADULT],
    phases: [
      {
        name: 'Reaching out',
        tasks: [
          { title: 'Tell one person', description: 'A friend, a doctor or a helpline. Out loud once beats silent for months.', milestone: true },
          { title: 'Book the long doctor appointment', description: 'Ask for a long consultation and say up front it is about mental health.' },
        ],
      },
      {
        name: 'Finding the right support',
        tasks: [
          { title: 'Get the care plan and referral', description: 'A mental health care plan opens subsidised sessions. Ask what fits your situation.' },
          { title: 'Shop for the right therapist', description: 'Fit matters more than modality. It is normal to change after a session or two.' },
        ],
      },
      {
        name: 'Treatment underway',
        tasks: [
          { title: 'Protect the sessions', description: 'Rhythm is the treatment. Everything else flexes.' },
          { title: 'Give any medication a fair trial', description: 'Weeks, not days, with effects logged and reviewed with the prescriber.' },
        ],
      },
      {
        name: 'Recovery rhythm',
        tasks: [
          { title: 'Rebuild the foundations one at a time', description: 'Sleep, movement, light, people. One at a time.' },
          { title: 'A genuinely good week', milestone: true },
        ],
      },
      {
        name: 'Staying well',
        tasks: [
          { title: 'Write your early warning plan', description: 'Your signs, your first responses, your people. Written while well.' },
        ],
      },
    ],
  },
  {
    slug: 'new-diagnosis-young-adult',
    name: 'A new long-term diagnosis',
    description: 'Hearing the news as an adult and building a life where the condition fits in, not the other way round.',
    kind: 'condition',
    stages: [YOUNG_ADULT],
    phases: [
      {
        name: 'Hearing the news',
        tasks: [
          { title: 'Get the diagnosis in writing', description: 'What it is, what it means, what happens next. Ask for the letter.' },
          { title: 'Take someone to the follow up', description: 'Four ears hear more than two, especially shocked ears.' },
        ],
      },
      {
        name: 'Learning the condition',
        tasks: [
          { title: 'Learn from the reputable sources', description: 'Ask the specialist which organisations to trust, and ignore the search engine rabbit holes.' },
          { title: 'Meet others living with it', description: 'Peer groups hold the practical knowledge no clinic teaches.' },
        ],
      },
      {
        name: 'Building the routine',
        tasks: [
          { title: 'Set up medicines and monitoring in PareCare', description: 'Each medicine and each number you track, as its own record.' },
          { title: 'Fit the condition around your life', description: 'Work, study, sport and travel all continue. Plan how, with the team.' },
        ],
      },
      {
        name: 'Condition under control',
        tasks: [
          { title: 'Three stable months', milestone: true },
          { title: 'First trip away managed well', description: 'The condition travels. Prove it once and the world reopens.', milestone: true },
        ],
      },
      {
        name: 'Yearly review',
        tasks: [
          { title: 'Book the annual review', description: 'A standing check that the plan still fits the life.' },
        ],
      },
    ],
  },
  {
    slug: 'rehab-after-injury',
    name: 'Rehabilitation after serious injury',
    description: 'From the event through hospital and rehabilitation to the new normal.',
    kind: 'event',
    stages: [YOUNG_ADULT, ADULT],
    phases: [
      {
        name: 'The event',
        tasks: [
          { title: 'Record what happened', description: 'Date, cause and injuries. Insurance and compensation will ask, repeatedly.' },
          { title: 'Open the insurance and compensation claims', description: 'Work, transport and insurance schemes have deadlines. Start them early.' },
        ],
      },
      {
        name: 'In hospital',
        tasks: [
          { title: 'Understand the injuries and the plan', description: 'Ask for the plain language version and write it down.' },
          { title: 'Meet the rehabilitation team early', description: 'Rehabilitation starts in the ward, not after it.' },
        ],
      },
      {
        name: 'Coming home',
        tasks: [
          { title: 'Get the home assessed and set up', description: 'An occupational therapist plans equipment and modifications before discharge.' },
          { title: 'Home from hospital', milestone: true },
        ],
      },
      {
        name: 'Rehabilitation',
        tasks: [
          { title: 'Do the program, log the program', description: 'The reps are the recovery. The log shows the slope on the flat weeks.' },
          { title: 'First big function back', description: 'Walking, driving, lifting, working. Whichever one matters most to you.', milestone: true },
        ],
      },
      {
        name: 'New normal',
        tasks: [
          { title: 'Return to work or study', description: 'Graduated plans work. Agree one with the employer and the team.', milestone: true },
          { title: 'Mark how far you have come', description: 'Read the first entries in this journey back. That is the distance travelled.', milestone: true },
        ],
      },
    ],
  },
  {
    slug: 'addiction-recovery',
    name: 'Recovery from addiction',
    description: 'Deciding to change, getting through the hard early stretch and building a life that holds.',
    kind: 'condition',
    stages: [YOUNG_ADULT, ADULT],
    phases: [
      {
        name: 'Deciding to change',
        tasks: [
          { title: 'Tell someone the decision', description: 'Spoken to one safe person, the decision becomes real.', milestone: true },
          { title: 'See a doctor before stopping', description: 'Some withdrawals are dangerous unmanaged. Get medical advice on how to stop safely.' },
        ],
      },
      {
        name: 'Detox and stabilising',
        tasks: [
          { title: 'Choose the right setting', description: 'Home with support, outpatient or residential, decided with the clinician, not with pride.' },
          { title: 'Get through the first fortnight', description: 'One day at a time is the method, not a slogan.', milestone: true },
        ],
      },
      {
        name: 'Treatment underway',
        tasks: [
          { title: 'Commit to the program', description: 'Counselling, groups or medication support. Attendance is the treatment.' },
          { title: 'Rebuild the day around recovery', description: 'The old routine held the old habit. Build a new one deliberately.' },
        ],
      },
      {
        name: 'Rebuilding',
        tasks: [
          { title: 'Repair what matters most first', description: 'One relationship, one obligation, one piece of health at a time.' },
          { title: 'Celebrate the clean milestones', description: 'Thirty days, ninety days, a year. Each one goes in the book.', milestone: true },
        ],
      },
      {
        name: 'Staying well',
        tasks: [
          { title: 'Write the relapse plan without shame', description: 'A lapse has a plan, so it stays a lapse. Signs, responses, people.' },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------
  // Adulthood
  // ------------------------------------------------------------------
  {
    slug: 'preventive-health',
    name: 'Preventive health and risk reduction',
    description: 'Know where you stand, name your risks, change the habit that matters most and hold the line.',
    kind: 'life_stage',
    stages: [ADULT, YOUNG_ADULT],
    phases: [
      {
        name: 'Where am I now',
        tasks: [
          { title: 'Book a full health check', description: 'Blood pressure, cholesterol, blood sugar, skin and anything your family history flags.' },
          { title: 'Record your numbers as the baseline', description: 'Each result logged on its own. This is the line everything gets measured against.' },
          { title: 'Answer the honest questions', description: 'Smoking, drinking, movement, sleep and stress, written down truthfully. Nobody else needs to see it.' },
        ],
      },
      {
        name: 'My risks and my plan',
        tasks: [
          { title: 'Name your top risk with the doctor', description: 'For most people one thing towers over the rest. Name it and aim at it.' },
          { title: 'Agree one change, not five', description: 'One habit changed and held beats five attempted and dropped.' },
          { title: 'Set the screening schedule for your age', description: 'The checks that apply to your body and decade, each with a due date.' },
        ],
      },
      {
        name: 'Making the change',
        tasks: [
          { title: 'Set a quit date or start date within two weeks', description: 'A date makes it real. Add it as a task so PareCare reminds you.' },
          { title: 'Book a support appointment', description: 'For smoking, your doctor can prescribe support that doubles your odds, and Quitline 13 7848 is free.' },
          { title: 'Choose your aids before day one', description: 'Patches, medication, an app or a program, picked and ready before the date, not on it.' },
          { title: 'Log every day of the new habit', description: 'Tick the days. The unbroken chain becomes the motivation.' },
          { title: 'Plan for the three hardest moments', description: 'Know your triggers and write down what you will do instead for each one.' },
          { title: 'One week in', milestone: true },
          { title: 'One month in', description: 'Most relapses happen in the first month. Getting past it changes the odds.', milestone: true },
        ],
      },
      {
        name: 'Holding the line',
        tasks: [
          { title: 'Book the follow up for week four', description: 'A booked appointment is an anchor in the hardest stretch.' },
          { title: 'One hundred days', milestone: true },
          { title: 'Handle the first slip as data', description: 'A slip is information about a trigger, not a verdict. Log it, adjust, continue.' },
          { title: 'One year', description: 'The habit is yours now.', milestone: true },
        ],
      },
      {
        name: 'Yearly review',
        tasks: [
          { title: 'Repeat the checks and compare to baseline', description: 'The same numbers, one year on. This is the payoff page.' },
          { title: 'Pick the next thing', description: 'Momentum is precious. Choose the next single change and go again.' },
        ],
      },
    ],
    handovers: [{ to: 'long-term-condition-adult', label: 'A diagnosis changes the plan, start the condition journey' }],
  },
  {
    slug: 'long-term-condition-adult',
    name: 'Managing a long-term condition',
    description: 'Diabetes, heart disease, asthma or another lasting condition, built into a working routine.',
    kind: 'condition',
    stages: [ADULT, YOUNG_ADULT],
    phases: [
      {
        name: 'The new diagnosis',
        tasks: [
          { title: 'Get the diagnosis and plan in writing', description: 'What it is, what the goal numbers are, what the treatment is.' },
          { title: 'Set up medicines in PareCare', description: 'Each medicine with its own dose, route and schedule.' },
        ],
      },
      {
        name: 'Learning the condition',
        tasks: [
          { title: 'Do the education program', description: 'Most major conditions have structured education. It is the highest value hours you will spend.' },
          { title: 'Learn your numbers and what moves them', description: 'Track the measures that matter for your condition and watch what changes them.' },
        ],
      },
      {
        name: 'Building the routine',
        tasks: [
          { title: 'Anchor the routine to existing habits', description: 'Medicines with breakfast, checks with the kettle. Attach new to old.' },
          { title: 'Set up the care team', description: 'Doctor, specialist, pharmacist and allied health, each recorded as a provider.' },
        ],
      },
      {
        name: 'Condition under control',
        tasks: [
          { title: 'First review with numbers in range', milestone: true },
          { title: 'Life event handled well', description: 'A holiday, a busy season or an illness that did not derail the routine.', milestone: true },
        ],
      },
      {
        name: 'Yearly review',
        tasks: [
          { title: 'Book the annual cycle of care', description: 'The yearly full review, plus the checks your condition requires.' },
        ],
      },
    ],
  },
  {
    slug: 'serious-illness-adult',
    name: 'Cancer and serious illness treatment',
    description: 'From diagnosis through treatment decisions and rounds, holding onto life along the way.',
    kind: 'condition',
    stages: [ADULT, YOUNG_ADULT, LATER_LIFE],
    phases: [
      {
        name: 'Diagnosis and staging',
        tasks: [
          { title: 'Get the full picture in writing', description: 'Diagnosis, stage and what it means. Ask for the letter and keep it in Documents.' },
          { title: 'Take a second set of ears to every big appointment', description: 'And a notebook. Shock deletes memory.' },
          { title: 'Nominate the update person', description: 'One person keeps everyone informed so you do not retell the hard news nightly.' },
        ],
      },
      {
        name: 'Treatment decisions',
        tasks: [
          { title: 'Ask about all the options, including doing less', description: 'Every option has trade offs. You are allowed to weigh quality against everything.' },
          { title: 'Consider a second opinion', description: 'Good doctors expect it. It confirms the plan or improves it.' },
          { title: 'Sort work, money and insurance early', description: 'Leave entitlements, insurance claims and hardship provisions, started before the fog of treatment.' },
        ],
      },
      {
        name: 'Treatment rounds',
        tasks: [
          { title: 'Map the treatment calendar', description: 'Rounds, recovery days and scans, so life gets planned in the gaps.' },
          { title: 'Log each round, the side effects and what helped', description: 'The record shapes the next round.' },
        ],
      },
      {
        name: 'Living during treatment',
        tasks: [
          { title: 'Accept the help, specifically', description: 'Turn every vague offer into a rostered task in PareCare. People want jobs, give them jobs.' },
          { title: 'Keep one normal thing sacred', description: 'The coffee, the walk, the show. One anchor that treatment does not get.', milestone: true },
        ],
      },
      {
        name: 'Response review',
        tasks: [
          { title: 'Hear the results with support', description: 'Someone with you, notes taken, questions asked twice if needed.' },
          { title: 'Decide the next step with the team', description: 'Continue, change or celebrate. The handover options below are the paths ahead.' },
        ],
      },
      {
        name: 'Recovery and monitoring',
        tasks: [
          { title: 'Treatment finished', milestone: true },
          { title: 'Set the surveillance schedule', description: 'Follow up scans in the calendar, each result logged.' },
          { title: 'Rebuild strength deliberately', description: 'Fatigue after treatment is real and slow. Pace the comeback.' },
        ],
      },
    ],
    handovers: [{ to: 'living-with-terminal-illness', label: 'If treatment cannot cure, plan for comfort and time' }],
  },
  {
    slug: 'adult-mental-health',
    name: 'Mental health support',
    description: 'Getting assessed, getting supported and staying steady, for adults carrying too much.',
    kind: 'condition',
    stages: [ADULT],
    phases: [
      {
        name: 'Reaching out',
        tasks: [
          { title: 'Tell one person', description: 'Out loud, once. It is the hardest task in this journey and it is first on purpose.', milestone: true },
          { title: 'Book the long doctor appointment', description: 'Say when booking that it is about mental health so they allow the time.' },
        ],
      },
      {
        name: 'Getting assessed',
        tasks: [
          { title: 'Get the care plan and referrals', description: 'Subsidised psychology sessions usually start with a care plan from the general practitioner.' },
        ],
      },
      {
        name: 'Support underway',
        tasks: [
          { title: 'Protect the sessions like meetings with the board', description: 'Because they are. Rhythm is the treatment.' },
          { title: 'Give medication a fair, logged trial', description: 'If prescribed. Weeks not days, effects recorded, reviewed with the prescriber.' },
        ],
      },
      {
        name: 'Staying steady',
        tasks: [
          { title: 'Rebuild the foundations', description: 'Sleep, movement, people, daylight. One at a time.' },
          { title: 'A genuinely good week', milestone: true },
        ],
      },
      {
        name: 'Standing down support',
        tasks: [
          { title: 'Step down with a plan, not a disappearance', description: 'Agree the returning signs and the re entry path with the clinician.' },
        ],
      },
    ],
  },
  {
    slug: 'looking-after-the-carer',
    name: 'Looking after the carer',
    description: 'For the person whose main health risk is the caring they do for everyone else.',
    kind: 'life_stage',
    stages: [ADULT, LATER_LIFE],
    phases: [
      {
        name: 'Naming the load',
        tasks: [
          { title: 'Write down everything you actually do', description: 'Every task, every person, every hour. Seeing the full list is the intervention.' },
          { title: 'Say the word carer about yourself', description: 'It unlocks payments, respite and support you cannot access while you are just helping out.', milestone: true },
        ],
      },
      {
        name: 'Respite and backup',
        tasks: [
          { title: 'Register with the carer gateway', description: 'In Australia, Carer Gateway 1800 422 737 opens respite, counselling and emergency backup.' },
          { title: 'Build the emergency care plan', description: 'If you went down tomorrow, who does what. Written in PareCare where the circle can see it.' },
          { title: 'Take the first real break', description: 'Planned, guilt resisted, actually taken.', milestone: true },
        ],
      },
      {
        name: 'My own health checks',
        tasks: [
          { title: 'Book your own doctor appointment', description: 'The one you have been postponing. Carers die earlier than the people they care for get credit for.' },
          { title: 'Screen your own mood honestly', description: 'Carer depression is an occupational hazard, not a personal failure.' },
        ],
      },
      {
        name: 'Sharing the load',
        tasks: [
          { title: 'Hand over two tasks permanently', description: 'Not delegated with supervision. Gone. Use the care circle roster.' },
        ],
      },
      {
        name: 'Regular review',
        tasks: [
          { title: 'Review the load each season', description: 'What grew back, what needs re handing over, how you actually are.' },
        ],
      },
    ],
  },
  {
    slug: 'surgery-and-rehab',
    name: 'Surgery and rehabilitation',
    description: 'Preparing well, recovering well and getting signed off properly.',
    kind: 'event',
    stages: [ADULT, LATER_LIFE],
    phases: [
      {
        name: 'Preparing for surgery',
        tasks: [
          { title: 'Understand the operation and the recovery time', description: 'What is being done, how long until normal life, what can go wrong.' },
          { title: 'Prehabilitate if there is time', description: 'Fitter in means faster out. Ask what exercises help before this operation.' },
          { title: 'Set up home for one handed weeks', description: 'Meals in the freezer, help rostered, the house arranged for the recovery.' },
        ],
      },
      {
        name: 'In hospital',
        tasks: [
          { title: 'Surgery done', milestone: true },
          { title: 'Get the discharge plan in writing', description: 'Wound care, medicines, restrictions, red flags and follow up dates.' },
        ],
      },
      {
        name: 'Coming home',
        tasks: [
          { title: 'Home from hospital', milestone: true },
          { title: 'Set the medication schedule in PareCare', description: 'Pain relief tapers and antibiotics finish. Schedule both properly.' },
        ],
      },
      {
        name: 'Rehabilitation',
        tasks: [
          { title: 'Do the physiotherapy, log the physiotherapy', description: 'The exercises are the outcome. The log keeps you honest on flat weeks.' },
        ],
      },
      {
        name: 'Recovered',
        tasks: [
          { title: 'Get the formal sign off', description: 'Cleared for work, driving and lifting by the surgeon, not by impatience.', milestone: true },
        ],
      },
    ],
  },

  // ------------------------------------------------------------------
  // Later life
  // ------------------------------------------------------------------
  {
    slug: 'ageing-well',
    name: 'Ageing well and staying independent',
    description: 'The proactive journey: strength, home, paperwork and people, sorted while everything is fine.',
    kind: 'life_stage',
    stages: [LATER_LIFE],
    phases: [
      {
        name: 'My baseline',
        tasks: [
          { title: 'Book the over seventy five health assessment', description: 'Or the full check for your age. A yearly full review is free in Australia from seventy five.' },
          { title: 'Get strength and balance measured', description: 'A physiotherapist baseline predicts falls before they happen and shows what to train.' },
        ],
      },
      {
        name: 'Home and habits',
        tasks: [
          { title: 'Do the home safety walk through', description: 'Rails, lighting, rugs, steps. An occupational therapist visit or a good checklist.' },
          { title: 'Build the strength habit', description: 'Twice weekly strength and balance work is the single best insurance policy at this age.' },
        ],
      },
      {
        name: 'Plans and paperwork in order',
        tasks: [
          { title: 'Make or update the will', description: 'Easiest sorted before any crisis.' },
          { title: 'Put power of attorney in place', description: 'While capacity is beyond question. Choose people, not just documents.' },
          { title: 'Write the advance care directive', description: 'Your wishes for medical treatment if you cannot speak for yourself. Store it in Documents.', milestone: true },
        ],
      },
      {
        name: 'Staying connected',
        tasks: [
          { title: 'Keep two regular social anchors', description: 'A club, a class, a standing coffee. Loneliness is a health risk on par with smoking.' },
        ],
      },
      {
        name: 'Yearly review',
        tasks: [
          { title: 'Repeat the assessment and compare', description: 'Same numbers, one year on. Adjust the plan, celebrate what held.' },
        ],
      },
    ],
    handovers: [{ to: 'more-help-at-home', label: 'More support is becoming necessary, start the support journey' }],
  },
  {
    slug: 'memory-concerns-dementia',
    name: 'Memory concerns and dementia support',
    description: 'From the first worries through diagnosis to living well and deciding what comes next.',
    kind: 'condition',
    stages: [LATER_LIFE],
    phases: [
      {
        name: 'First concerns',
        tasks: [
          { title: 'Write down specific examples with dates', description: 'Repeated questions, lost words, wrong turns. Specifics make the assessment useful.' },
          { title: 'Book the memory focused doctor visit', description: 'Ask for a long appointment and say memory is the concern.' },
        ],
      },
      {
        name: 'Assessment and diagnosis',
        tasks: [
          { title: 'Complete the assessments', description: 'Cognitive tests, bloods and scans rule treatable causes in or out.' },
          { title: 'Get the diagnosis explained to both of you', description: 'The person and their closest supporter, together, in plain language.' },
        ],
      },
      {
        name: 'Living well with dementia',
        tasks: [
          { title: 'Do the legal paperwork now', description: 'Power of attorney and an advance care directive need capacity. This window matters.' },
          { title: 'Register with dementia support services', description: 'In Australia, Dementia Australia 1800 100 500 for education, advice and support groups.' },
          { title: 'Build the memory book together', description: 'Photos, stories and voice recordings, gathered while the stories are still theirs to tell.', milestone: true },
          { title: 'Keep doing the loved things, adapted', description: 'The golf gets shorter, the recipes get simpler, the joy stays.', milestone: true },
        ],
      },
      {
        name: 'Increasing support',
        tasks: [
          { title: 'Review safety honestly each season', description: 'Driving, cooking, wandering and medicines, reviewed on evidence, not on one bad day.' },
          { title: 'Bring in help before the crisis', description: 'Support accepted early lasts. Support forced by collapse traumatises.' },
        ],
      },
      {
        name: 'Time to decide what is next',
        tasks: [
          { title: 'Hold the family decision conversation', description: 'What the person wanted, what home can still hold, what the options are. The handover choices below are the paths.' },
        ],
      },
    ],
    handovers: [
      { to: 'more-help-at-home', label: 'Staying home with more support' },
      { to: 'life-in-residential-care', label: 'Moving to residential care' },
      { to: 'palliative-care-at-home', label: 'Focusing on comfort at home' },
    ],
  },
  {
    slug: 'more-help-at-home',
    name: 'More help at home to residential care',
    description: 'The journey from first concerns about coping at home through growing support to residential care.',
    kind: 'life_stage',
    stages: [LATER_LIFE],
    phases: [
      {
        name: 'Early concern',
        legacy: 'early_concern',
        tasks: [
          { title: 'Book a GP appointment', description: "Start with a general health review. Mention any specific concerns you've observed." },
          { title: 'Have a family conversation about next steps', description: 'Agree on who will take the lead in coordinating care.' },
          { title: "Note any changes you've observed", description: 'Write down changes in memory, mobility, mood, or daily habits. Dates matter.' },
          { title: 'Check if they have a current Will', description: 'This is easiest to sort before a crisis.' },
          { title: 'Check if Power of Attorney is in place', description: 'If not, this should be arranged while the person has legal capacity to grant it.' },
        ],
      },
      {
        name: 'Home with support',
        legacy: 'home_with_support',
        tasks: [
          { title: 'Contact My Aged Care for an assessment', description: 'In Australia, call 1800 200 422 or visit myagedcare.gov.au to start the assessment process.' },
          { title: 'Arrange a home safety assessment', description: 'An occupational therapist can recommend modifications to reduce fall risk.' },
          { title: 'Set up medication management', description: 'Consider a blister pack dispensing service through your pharmacy.' },
          { title: 'Create a care roster', description: 'Agree on who visits when, and log it in PareCare so everyone can see coverage.' },
          { title: 'Arrange transport for appointments', description: 'Identify who drives, or register for community transport services.' },
        ],
      },
      {
        name: 'Increased dependency',
        legacy: 'increased_dependency',
        tasks: [
          { title: 'Research residential care options', description: 'Start early. Quality facilities often have waiting lists.' },
          { title: 'Request a financial assessment', description: 'This determines the level of government subsidy available for residential care.' },
          { title: 'Confirm Power of Attorney is activated if needed', description: 'Check the conditions under which it takes effect.' },
          { title: 'Complete or update the Advance Care Directive', description: "Documents the person's wishes for medical treatment if they can no longer communicate them." },
        ],
      },
      {
        name: 'Moving to residential care',
        legacy: 'transition_to_residential',
        tasks: [
          { title: 'Choose the facility together where possible', description: 'Visit shortlisted homes, eat the food, talk to residents.' },
          { title: 'Plan the move like a house move', description: 'Familiar furniture, photos and routines make the room theirs.' },
          { title: 'Hand over the care record', description: 'Medicines, routines, preferences and history, exported for the facility.' },
        ],
      },
      {
        name: 'Life in residential care',
        legacy: 'residential_ongoing',
        tasks: [
          { title: 'Settle the visiting rhythm', description: 'Predictable visits beat many visits. Set the roster in PareCare.' },
          { title: 'Attend the care conferences', description: 'The scheduled reviews where the care plan gets set. Bring your observations.' },
          { title: 'Keep the outside world coming in', description: 'Grandchildren, pets, music and outings. Life continues, relocated.', milestone: true },
        ],
      },
      {
        name: 'End of life',
        legacy: 'end_of_life',
        tasks: [
          { title: 'Confirm the advance care directive is on file', description: 'With the facility and the hospital, so wishes are followed.' },
          { title: 'Talk about what matters at the end', description: 'Who should be there, what comfort looks like, anything left to say.' },
          { title: 'Say the important things', description: 'Thank you, I love you, goodbye. Recorded or in person, in time.', milestone: true },
        ],
      },
    ],
    handovers: [
      { to: 'palliative-care-at-home', label: 'Focusing on comfort at home' },
      { to: 'the-final-days', label: 'The final days are here' },
    ],
  },
  {
    slug: 'long-term-conditions-later-life',
    name: 'Long-term conditions in later life',
    description: 'Heart failure, lung disease, Parkinson’s or other lasting conditions, managed for a full later life.',
    kind: 'condition',
    stages: [LATER_LIFE],
    phases: [
      {
        name: 'The new diagnosis',
        tasks: [
          { title: 'Get the diagnosis and plan in writing', description: 'What it is, what the treatment is, what to watch for.' },
          { title: 'Review every medicine together', description: 'New conditions meet old prescriptions. Ask the pharmacist for a full medication review.' },
        ],
      },
      {
        name: 'Learning the condition',
        tasks: [
          { title: 'Learn the early warning signs', description: 'Weight jumps, breathlessness, tremor changes. Know what should trigger a call.' },
        ],
      },
      {
        name: 'A routine that works',
        tasks: [
          { title: 'Set up the daily routine in PareCare', description: 'Medicines, checks and exercises, visible to the whole circle.' },
          { title: 'A stable season', milestone: true },
        ],
      },
      {
        name: 'More support needed',
        tasks: [
          { title: 'Add help before the gap hurts', description: 'When a task gets hard, roster support for it early.' },
        ],
      },
      {
        name: 'Regular reviews',
        tasks: [
          { title: 'Keep the specialist review cycle', description: 'Standing appointments with results logged against the last ones.' },
        ],
      },
    ],
    handovers: [{ to: 'more-help-at-home', label: 'Managing at home is getting harder, start the support journey' }],
  },
  {
    slug: 'falls-frailty-recovery',
    name: 'Falls, frailty and getting home from hospital',
    description: 'After a fall or an admission, the working journey of getting safely home and stronger.',
    kind: 'event',
    stages: [LATER_LIFE],
    phases: [
      {
        name: 'The fall or the admission',
        tasks: [
          { title: 'Record what happened', description: 'When, where, how, and what was found. The pattern across falls matters.' },
          { title: 'Ask why it happened', description: 'Falls have causes: medicines, blood pressure, eyes, feet. Ask for the review.' },
        ],
      },
      {
        name: 'In hospital',
        tasks: [
          { title: 'Push for movement every day', description: 'Deconditioning starts in forty eight hours. Ask for physiotherapy from day one.' },
          { title: 'Start discharge planning at admission', description: 'Ask on day one what going home requires, and start arranging it.' },
        ],
      },
      {
        name: 'Planning the trip home',
        tasks: [
          { title: 'Get the home assessed before discharge', description: 'Equipment and modifications in place before the person is, not after.' },
          { title: 'Set up the first fortnight of support', description: 'Meals, medicines, checks and transport, rostered in PareCare before discharge day.' },
        ],
      },
      {
        name: 'First month home',
        tasks: [
          { title: 'Home from hospital', milestone: true },
          { title: 'Keep the follow up appointments', description: 'The post discharge review and medication check catch the bounce backs.' },
        ],
      },
      {
        name: 'Stronger and steadier',
        tasks: [
          { title: 'Complete the strength and balance program', description: 'The evidence backed way to make this fall the last one.', milestone: true },
        ],
      },
    ],
    handovers: [{ to: 'more-help-at-home', label: 'Home needs to come with more support now' }],
  },
  {
    slug: 'life-in-residential-care',
    name: 'Life in residential care',
    description: 'Choosing a home, moving in, settling and living well as a resident.',
    kind: 'life_stage',
    stages: [LATER_LIFE],
    phases: [
      {
        name: 'Choosing the home',
        tasks: [
          { title: 'Visit the shortlist properly', description: 'Eat a meal, talk to residents, come back unannounced at a different hour.' },
          { title: 'Understand the costs in writing', description: 'Deposits, daily fees and extras, explained until they make sense.' },
        ],
      },
      {
        name: 'Admission',
        tasks: [
          { title: 'Hand over the full care record', description: 'Medicines, routines, preferences, history and the advance care directive, exported from PareCare.' },
          { title: 'Make the room theirs before night one', description: 'Photos, the good chair, their own blanket. Familiarity is medicine.' },
        ],
      },
      {
        name: 'Settling in',
        tasks: [
          { title: 'Set the visiting rhythm', description: 'Predictable and distributed across the circle. The roster lives in PareCare.' },
          { title: 'First friend made or activity joined', milestone: true },
        ],
      },
      {
        name: 'Ongoing care and reviews',
        tasks: [
          { title: 'Attend every care conference', description: 'The scheduled reviews where the care plan is set. Bring the circle’s observations.' },
          { title: 'Keep life flowing in', description: 'Grandchildren, pets, outings, music. Residence changed, life did not.', milestone: true },
        ],
      },
    ],
    handovers: [{ to: 'palliative-care-hospice', label: 'Care is turning to comfort' }],
  },

  // ------------------------------------------------------------------
  // End of life and beyond
  // ------------------------------------------------------------------
  {
    slug: 'planning-ahead-while-well',
    name: 'Planning ahead while well',
    description: 'Wishes, documents and conversations, sorted years before anyone needs them.',
    kind: 'life_stage',
    stages: [END_OF_LIFE, ADULT, LATER_LIFE, YOUNG_ADULT],
    phases: [
      {
        name: 'Why plan now',
        tasks: [
          { title: 'Read one honest page about why this matters', description: 'Plans made well cost an afternoon. Plans made in crisis cost families years.' },
        ],
      },
      {
        name: 'My wishes written down',
        tasks: [
          { title: 'Write what matters to you at the end', description: 'Where, who, what treatments you would want or refuse, what comfort means to you.' },
        ],
      },
      {
        name: 'The legal documents',
        tasks: [
          { title: 'Make or update the will', milestone: true },
          { title: 'Appoint power of attorney', description: 'The people who decide when you cannot. Choose for judgement, not for seniority.' },
          { title: 'Complete the advance care directive', description: 'The medical wishes document. Store it in Documents and give copies to the doctor.', milestone: true },
        ],
      },
      {
        name: 'Telling the people who matter',
        tasks: [
          { title: 'Tell the appointed people they are appointed', description: 'And what you want. A surprised attorney is a failed plan.' },
          { title: 'Tell the family where everything is', description: 'Documents, passwords, policies and wishes, findable without you.' },
        ],
      },
      {
        name: 'Reviewing every few years',
        tasks: [
          { title: 'Re read the documents every three years', description: 'Or after any big life change. Update what no longer fits.' },
        ],
      },
    ],
  },
  {
    slug: 'living-with-terminal-illness',
    name: 'Living with a terminal illness',
    description: 'When cure is off the table: understanding, choosing, living fully and putting comfort first.',
    kind: 'end_of_life',
    stages: [END_OF_LIFE],
    phases: [
      {
        name: 'Understanding the news',
        tasks: [
          { title: 'Ask the questions you actually have', description: 'How long, how will it go, what will help. Doctors answer what is asked. Ask.' },
          { title: 'Get a plain language summary in writing', description: 'What is happening and what to expect, readable on the bad days.' },
          { title: 'Choose who to tell and how', description: 'Your news, your order, your words. PareCare can carry the message so you tell it once.' },
        ],
      },
      {
        name: 'Choices and priorities',
        tasks: [
          { title: 'Talk about what matters most now', description: 'There is no right answer. Some want every treatment, some want time and comfort. Write it down in their words.' },
          { title: 'Meet the palliative care team', description: 'Palliative care means comfort and quality of life, not giving up. Meet them early, it adds good time.' },
          { title: 'Write the advance care plan', description: 'Wishes recorded and stored in Documents so everyone can find them.' },
          { title: 'Ask about clinical trials and second opinions', description: 'If wanted, now is the moment. The treating team can refer.' },
          { title: 'Sort the practical affairs', description: 'Will, power of attorney, accounts and passwords, so none of it steals time later.' },
        ],
      },
      {
        name: 'Living fully',
        tasks: [
          { title: 'Make the list of what you want to do', description: 'Big or tiny. The ocean at sunrise or chips on the pier. The list is the point.', milestone: true },
          { title: 'Do the first thing on the list', milestone: true },
          { title: 'Start the Memory Book', description: 'Photos, voice notes, letters and stories. It belongs to you now and to your people always.', milestone: true },
          { title: 'Keep the ordinary things', description: 'School, work, the market on Saturday. Ordinary life is allowed to continue.', milestone: true },
          { title: 'Say the important things', description: 'Thank you, I am sorry, I love you. Said, written or recorded.', milestone: true },
        ],
      },
      {
        name: 'Comfort first',
        tasks: [
          { title: 'Shift the goal to comfort with the team', description: 'When treatment stops helping, comfort becomes the treatment. Say it out loud together.' },
          { title: 'Choose where care happens from here', description: 'Home, hospice or hospital. The handover choices below carry this forward.' },
        ],
      },
    ],
    handovers: [
      { to: 'palliative-care-at-home', label: 'Comfort care at home' },
      { to: 'palliative-care-hospice', label: 'Comfort care in a hospice or hospital' },
    ],
  },
  {
    slug: 'palliative-care-at-home',
    name: 'Palliative care at home',
    description: 'Setting up comfort care where the person most wants to be.',
    kind: 'end_of_life',
    stages: [END_OF_LIFE],
    phases: [
      {
        name: 'Setting up care at home',
        tasks: [
          { title: 'Get the palliative home team in place', description: 'Community palliative services visit, advise and answer the phone at 3am. Register early.' },
          { title: 'Set up the room and the equipment', description: 'The bed, the chair, the commode, arranged before they are urgent.' },
        ],
      },
      {
        name: 'The team and the plan',
        tasks: [
          { title: 'Write the symptom plan with the team', description: 'What to give for pain, breathlessness and agitation, and when to call.' },
          { title: 'Roster the circle', description: 'Care, meals, nights and company, shared across everyone in PareCare.' },
        ],
      },
      {
        name: 'Day to day comfort',
        tasks: [
          { title: 'Log symptoms and what relieves them', description: 'The record lets the team tune the comfort.' },
          { title: 'Keep the good moments coming', description: 'The window bed, the music, the dog, the visitors who bring life in.', milestone: true },
        ],
      },
      {
        name: 'When things change',
        tasks: [
          { title: 'Know the signs of the final days', description: 'The team can describe what changes to expect, so it is not frightening when it comes.' },
        ],
      },
    ],
    handovers: [{ to: 'the-final-days', label: 'The final days are here' }],
  },
  {
    slug: 'palliative-care-hospice',
    name: 'Palliative care in a hospice or hospital',
    description: 'Choosing the place and making institutional care personal.',
    kind: 'end_of_life',
    stages: [END_OF_LIFE],
    phases: [
      {
        name: 'Choosing the place',
        tasks: [
          { title: 'Visit the options if time allows', description: 'Hospices differ. An hour walking one tells more than any brochure.' },
        ],
      },
      {
        name: 'Moving in',
        tasks: [
          { title: 'Bring the person’s world with them', description: 'Photos, music, their own blanket and pillow. The room should say their name.' },
          { title: 'Hand over the record and the wishes', description: 'The care record and the advance care directive, given to the team on day one.' },
        ],
      },
      {
        name: 'Day to day comfort',
        tasks: [
          { title: 'Set the visiting roster', description: 'Spread the circle so company is steady, not a crowd then a silence.' },
          { title: 'Keep the good moments coming', description: 'Familiar voices, favourite food when allowed, hands held.', milestone: true },
        ],
      },
      {
        name: 'When things change',
        tasks: [
          { title: 'Agree how the family is told of changes', description: 'Who the hospice calls and who fans the message out.' },
        ],
      },
    ],
    handovers: [{ to: 'the-final-days', label: 'The final days are here' }],
  },
  {
    slug: 'the-final-days',
    name: 'The final days',
    description: 'Short, gentle and practical. Every task here is optional.',
    kind: 'end_of_life',
    stages: [END_OF_LIFE],
    phases: [
      {
        name: 'Keeping them comfortable',
        tasks: [
          { title: 'Let the team manage the symptoms', description: 'Comfort is the whole goal now. Call about anything that looks like distress.' },
          { title: 'Care for the small things', description: 'Lips moistened, position changed, room calm, favourite music low.' },
        ],
      },
      {
        name: 'Who should be here',
        tasks: [
          { title: 'Call the people who need the chance', description: 'The ones who would regret missing goodbye. Call them now, not tomorrow.' },
        ],
      },
      {
        name: 'Saying goodbye',
        tasks: [
          { title: 'Say the important things', description: 'Hearing is thought to remain. Talk to them. Thank you, I love you, it is okay.', milestone: true },
        ],
      },
      {
        name: 'The death itself',
        tasks: [
          { title: 'Know who to call when it happens', description: 'The palliative team or doctor first. There is no rush and nothing you must do in the first hour except be there.' },
        ],
      },
    ],
    handovers: [{ to: 'after-a-death', label: 'After the death' }],
  },
  {
    slug: 'after-a-death',
    name: 'After a death',
    description: 'The practical steps and the grief, carried by the circle. The Memory Book keeps the person present.',
    kind: 'end_of_life',
    stages: [END_OF_LIFE],
    phases: [
      {
        name: 'The first days',
        tasks: [
          { title: 'Get the death certificate process started', description: 'The doctor or hospital begins it. The funeral director usually handles the rest.' },
          { title: 'Tell the people and the places', description: 'Family first, then employer, agencies and services. Share the load across the circle.' },
        ],
      },
      {
        name: 'The funeral and the formalities',
        tasks: [
          { title: 'Plan the farewell they would have wanted', description: 'Check the will and any wishes document first. They may have chosen already.' },
          { title: 'The farewell held', description: 'Record the day: who came, what was said, what was played.', milestone: true },
        ],
      },
      {
        name: 'The estate and the paperwork',
        tasks: [
          { title: 'Take the will to the executor', description: 'The executor starts the estate process. A solicitor can carry the weight of it.' },
          { title: 'Close and transfer the accounts', description: 'Banks, utilities, subscriptions and licences, one by one. Keep a list of what is done.' },
        ],
      },
      {
        name: 'Grief support',
        tasks: [
          { title: 'Let grief have its timetable', description: 'There is no schedule. Grief counselling and peer groups exist whenever they are wanted.' },
          { title: 'Mark the firsts together', description: 'First birthday, first holidays. Plan them so they land softly.' },
        ],
      },
      {
        name: 'Remembering',
        tasks: [
          { title: 'Keep the Memory Book open', description: 'The stories, photos and achievements stay. Add to them on the days that call for it.', milestone: true },
        ],
      },
    ],
  },
];

/**
 * Pet care journeys, seeded by migration 036. Kept separate from the human
 * catalogue above so pets are never suggested to people and people are
 * never suggested to pets. These carry no life stages: a pet's age arc does
 * not map onto the human age bands, so they are offered from the pet
 * onboarding and the journey library rather than by date of birth. Every
 * slug is prefixed `pet-` so each side can tell them apart. All of it is
 * ordinary editable data once seeded.
 */
export const PET_JOURNEY_TEMPLATES: CatalogueTemplate[] = [
  {
    slug: 'pet-welcome-new',
    name: 'Welcoming a new pet',
    description: 'Bringing a new pet home and helping them settle in over the first weeks.',
    kind: 'event',
    stages: [],
    phases: [
      {
        name: 'First days',
        tasks: [
          { title: 'Set up a safe space', description: 'A bed, food and water, and a toilet or litter spot they can always reach.' },
          { title: 'Book the first vet visit', description: 'A first health check, and advice on vaccinations and parasite prevention.', milestone: true },
          { title: 'Check the microchip is registered to you', description: 'If they are chipped, make sure your name and phone are on the registry.' },
        ],
      },
      {
        name: 'First weeks',
        tasks: [
          { title: 'Settle into a feeding and toilet routine', description: 'The same food, times and spots each day help a new pet feel safe.' },
          { title: 'Start gentle training and handling', description: 'Short, kind sessions. Reward what you want to see.' },
          { title: 'Introduce the household slowly', description: 'People and other pets, a little at a time, on their terms.' },
        ],
      },
      {
        name: 'Settled in',
        tasks: [
          { title: 'They are settled at home', description: 'Eating, sleeping and relaxed in their space.', milestone: true },
          { title: 'Plan ongoing vaccinations and prevention', description: 'Agree the schedule with your vet so nothing lapses.' },
        ],
      },
    ],
    handovers: [{ to: 'pet-routine-health', label: 'Settled in, start routine health care' }],
  },
  {
    slug: 'pet-first-year',
    name: "A pet's first year",
    description: 'Vaccinations, microchip, desexing and early training through the first year.',
    kind: 'life_stage',
    stages: [],
    phases: [
      {
        name: 'Vaccinations and microchip',
        tasks: [
          { title: 'Complete the first course of vaccinations', description: 'Your vet will set the timing over the first months.', milestone: true },
          { title: 'Microchip and register your details', description: 'A chip is only useful if the registry has your current contact details.' },
          { title: 'Start parasite prevention', description: 'Regular cover for worms, fleas and, where you live, ticks.' },
        ],
      },
      {
        name: 'Desexing and growing up',
        tasks: [
          { title: 'Talk to your vet about desexing', description: 'They will advise the right age for your pet.' },
          { title: 'They are desexed', description: 'Neutered or spayed, if that is your choice.', milestone: true },
          { title: 'Move to adult food at the right age', description: 'Change over gradually to avoid an upset stomach.' },
        ],
      },
      {
        name: 'Training and socialising',
        tasks: [
          { title: 'Teach basic handling and house habits', description: 'Calm handling, and the routines that make daily life easy.' },
          { title: 'Introduce new people, places and animals safely', description: 'Positive early experiences build a confident adult pet.' },
        ],
      },
    ],
    handovers: [{ to: 'pet-routine-health', label: 'First year done, start routine health care' }],
  },
  {
    slug: 'pet-routine-health',
    name: 'Keeping a pet healthy',
    description: 'The steady, year-round care that keeps an adult pet well.',
    kind: 'life_stage',
    stages: [],
    phases: [
      {
        name: 'Yearly check',
        tasks: [
          { title: 'Book the yearly health and vaccination check', description: 'A once-a-year visit catches problems early and keeps cover current.' },
          { title: 'Keep parasite prevention up to date', description: 'Worms, fleas and ticks, on the schedule your vet advised.' },
          { title: 'Check weight and body condition', description: 'A healthy weight prevents many later problems.' },
        ],
      },
      {
        name: 'Everyday care',
        tasks: [
          { title: 'Care for teeth and coat', description: 'Regular teeth cleaning and grooming, suited to your pet.' },
          { title: 'Keep a steady diet and exercise routine', description: 'The right amount of food and activity for their age and size.' },
          { title: 'Update the microchip when things change', description: 'A new home or phone number means a quick update to the registry.' },
        ],
      },
    ],
    handovers: [{ to: 'pet-senior', label: 'Getting older, start the senior care journey' }],
  },
  {
    slug: 'pet-senior',
    name: 'Caring for an older pet',
    description: 'Closer checks, comfort and mobility as a pet ages.',
    kind: 'life_stage',
    stages: [],
    phases: [
      {
        name: 'Senior wellness',
        tasks: [
          { title: 'Move to twice yearly vet checks', description: 'Older pets change faster, so see the vet more often.' },
          { title: 'Ask about senior blood tests and dental care', description: 'Early signs of common older-age conditions are worth catching.' },
          { title: 'Watch for changes in weight, thirst and toileting', description: 'Note anything new and tell your vet.' },
        ],
      },
      {
        name: 'Comfort and mobility',
        tasks: [
          { title: 'Make food, water and beds easy to reach', description: 'Short trips and soft resting places help stiff joints.' },
          { title: 'Add grip and ramps where they climb', description: 'Rugs on slippery floors, and steps or ramps to favourite spots.' },
          { title: 'Manage any pain with your vet', description: 'There is a lot that can be done to keep an older pet comfortable.' },
        ],
      },
    ],
    handovers: [{ to: 'pet-goodbye', label: 'When the time nears, start the goodbye journey' }],
  },
  {
    slug: 'pet-recovery',
    name: 'Recovering after illness or surgery',
    description: 'Nursing a pet back to health after an operation or an illness.',
    kind: 'event',
    stages: [],
    phases: [
      {
        name: 'Coming home',
        tasks: [
          { title: 'Follow the discharge and medicine instructions', description: 'Keep the sheet from the vet somewhere you will see it.' },
          { title: 'Set up a quiet, warm place to rest', description: 'Away from other pets, children and noise.' },
          { title: 'Know the signs to call the vet about', description: 'Ask what is normal and what is not before you leave the clinic.' },
        ],
      },
      {
        name: 'Healing',
        tasks: [
          { title: 'Give every medicine on time and record it', description: 'A simple log makes sure nothing is missed or doubled.' },
          { title: 'Keep to rest and any movement limits', description: 'Rest is part of the treatment, even when they seem better.' },
          { title: 'Go to the follow up check', description: 'The vet confirms healing is on track.', milestone: true },
        ],
      },
      {
        name: 'Back to normal',
        tasks: [
          { title: 'Return to normal food and activity as advised', description: 'Build back up gradually, at the pace your vet sets.' },
          { title: 'They are fully recovered', description: 'Back to themselves.', milestone: true },
        ],
      },
    ],
  },
  {
    slug: 'pet-goodbye',
    name: 'Saying goodbye to a pet',
    description: "Comfort, dignity and support through a pet's last days and after.",
    kind: 'end_of_life',
    stages: [],
    phases: [
      {
        name: 'Comfort care',
        tasks: [
          { title: 'Talk with your vet about quality of life', description: 'An honest conversation about good days and hard days.' },
          { title: 'Keep them comfortable and out of pain', description: 'Warmth, soft bedding, favourite foods and gentle company.' },
          { title: 'Decide what matters most for their last days', description: 'The people, places and comforts you want them to have.' },
        ],
      },
      {
        name: 'Letting go',
        tasks: [
          { title: 'Understand your options and what to expect', description: 'Your vet can explain the process kindly and fully.' },
          { title: 'Choose where and how', description: 'At home or at the clinic, whichever is gentler for your pet and family.' },
          { title: 'Decide about burial or cremation', description: 'There is no rush. Ask the clinic what they offer.' },
        ],
      },
      {
        name: 'Afterwards',
        tasks: [
          { title: 'Give the family time to grieve', description: 'Losing a pet is a real loss. Be gentle with everyone, including children.' },
          { title: 'Keep a memory of them', description: 'A photo, their name, a favourite story in the Memory Book.', milestone: true },
        ],
      },
    ],
  },
];
