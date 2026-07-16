// Bundled sample policy documents for the mock OCR adapter (Demo/Mock mode).
//
// Each sample is a realistic, multi-page insurance policy wording covering the
// clause categories the analysis engine cares about: coverage, waiting periods,
// exclusions, financial sub-limits (room-rent / ICU caps), co-pay, and
// deductibles. The mock OCR adapter returns one of these deterministically so
// the rest of the pipeline (chunking, embedding, analysis) has real text to
// work with even when no OCR credentials are configured (R2, R Demo/Mock mode).

/** A bundled sample document: an ordered list of page texts. */
export interface SampleDocument {
  /** Category the sample represents. */
  category: 'health' | 'motor' | 'travel';
  /** Human-readable label. */
  label: string;
  /** Page texts in document order. */
  pages: string[];
}

/** Sample comprehensive health insurance policy. */
export const HEALTH_SAMPLE: SampleDocument = {
  category: 'health',
  label: 'SecureHealth Comprehensive Health Insurance',
  pages: [
    [
      'POLICY SCHEDULE',
      'Insurer: SecureHealth General Insurance Co. Ltd.',
      'Product: SecureHealth Comprehensive Individual Mediclaim',
      'Policy Number: SH-IND-2024-0098124',
      'Sum Insured: INR 5,00,000 (Five Lakh Rupees) per policy year.',
      'Annual Premium: INR 12,450 (inclusive of 18% GST).',
      'Policy Period: 12 months from the date of commencement.',
      'Insured: Primary member and dependents as listed in the proposal form.',
    ].join('\n'),
    [
      'SECTION 1 — COVERAGE AND BENEFITS',
      '1.1 In-patient Hospitalization: Covered up to the Sum Insured for medically necessary hospitalization exceeding 24 hours.',
      '1.2 Pre-hospitalization: Medical expenses incurred 60 days prior to admission are covered.',
      '1.3 Post-hospitalization: Medical expenses incurred 90 days after discharge are covered.',
      '1.4 Day Care Procedures: 540 listed day-care treatments are covered without the 24-hour requirement.',
      '1.5 Ambulance Charges: Covered up to INR 2,000 per hospitalization.',
      '1.6 Annual Health Check-up: Covered once per policy year at empanelled centres.',
      '1.7 Maternity Benefits: Covered after a waiting period (see Section 2), subject to sub-limits.',
    ].join('\n'),
    [
      'SECTION 2 — WAITING PERIODS',
      '2.1 Initial Waiting Period: A waiting period of 30 days applies to all illnesses except accidental injury.',
      '2.2 Pre-existing Diseases: A waiting period of 3 years applies to any pre-existing condition declared at inception.',
      '2.3 Specified Ailments: A waiting period of 2 years applies to cataract, hernia, joint replacement, and similar specified ailments.',
      '2.4 Maternity: A waiting period of 4 years applies to maternity and newborn cover.',
    ].join('\n'),
    [
      'SECTION 3 — EXCLUSIONS',
      '3.1 Cosmetic Surgery: Expenses for cosmetic or aesthetic treatment are excluded unless medically necessary due to accident.',
      '3.2 Self-inflicted Injury: Injuries arising from suicide attempts or intentional self-harm are not covered.',
      '3.3 War and Nuclear Risks: Treatment for conditions arising from war, invasion, or nuclear contamination is excluded.',
      '3.4 Non-allopathic Treatment: AYUSH treatments are excluded except where specifically covered by endorsement.',
      '3.5 Dental Treatment: Routine dental treatment is excluded unless arising from accidental injury.',
    ].join('\n'),
    [
      'SECTION 4 — FINANCIAL LIMITS AND CO-PAYMENT',
      '4.1 Room Rent Capping: Room rent is capped at 1% of the Sum Insured per day (INR 5,000 per day). ICU charges are capped at 2% of the Sum Insured per day (INR 10,000 per day).',
      '4.2 Proportionate Deduction: If a room above the eligible category is chosen, all associated charges are reduced proportionately.',
      '4.3 Co-payment: A mandatory co-payment of 20% applies to all claims where the insured is above 60 years of age.',
      '4.4 Deductible: A per-claim deductible of INR 10,000 applies to out-patient dental and vision claims.',
      '4.5 Disease-wise Sub-limits: Cataract is limited to INR 40,000 per eye; maternity (normal delivery) is limited to INR 50,000.',
    ].join('\n'),
  ],
};

/** Sample private car (motor) insurance policy. */
export const MOTOR_SAMPLE: SampleDocument = {
  category: 'motor',
  label: 'DriveShield Private Car Package Policy',
  pages: [
    [
      'POLICY SCHEDULE',
      'Insurer: DriveShield Motor Insurance Ltd.',
      'Product: DriveShield Private Car Package Policy',
      'Policy Number: DS-PVT-2024-556231',
      "Insured's Declared Value (IDV): INR 6,50,000.",
      'Own Damage Premium: INR 14,200. Third-Party Premium: INR 7,890.',
      'Total Annual Premium: INR 22,090 (inclusive of GST).',
      'Vehicle: Mid-size hatchback, 2022 make, petrol.',
    ].join('\n'),
    [
      'SECTION 1 — COVERAGE',
      '1.1 Own Damage: Loss or damage to the insured vehicle by accident, fire, or external means is covered up to IDV.',
      '1.2 Theft: Total loss due to theft of the vehicle is covered up to IDV.',
      '1.3 Third-Party Liability: Legal liability for third-party death, bodily injury, and property damage is covered as per the Motor Vehicles Act.',
      '1.4 Personal Accident Cover: Owner-driver personal accident cover of INR 15,00,000 is included.',
      '1.5 Add-ons: Zero-depreciation and engine protection are covered where opted (see endorsements).',
    ].join('\n'),
    [
      'SECTION 2 — WAITING AND CLAIM CONDITIONS',
      '2.1 There is no waiting period; cover commences from the policy start date.',
      '2.2 Claims must be intimated within 48 hours of the incident.',
      '2.3 An FIR is mandatory for theft and third-party injury claims.',
    ].join('\n'),
    [
      'SECTION 3 — EXCLUSIONS',
      '3.1 Drunken Driving: Damage while driving under the influence of alcohol or drugs is excluded.',
      '3.2 Invalid License: Loss when the driver holds no valid driving licence is excluded.',
      '3.3 Consequential Loss: Indirect or consequential losses and normal wear and tear are excluded.',
      '3.4 Contractual Liability: Any contractual liability is excluded.',
    ].join('\n'),
    [
      'SECTION 4 — DEDUCTIBLES AND DEPRECIATION',
      '4.1 Compulsory Deductible: A compulsory deductible of INR 1,000 applies to every own-damage claim.',
      '4.2 Depreciation: Depreciation is applied on parts as per the standard grid unless zero-depreciation is opted.',
      '4.3 Betterment Charges: A co-payment of 15% applies to the cost of replaced fibreglass and rubber parts.',
    ].join('\n'),
  ],
};

/** Sample overseas travel insurance policy. */
export const TRAVEL_SAMPLE: SampleDocument = {
  category: 'travel',
  label: 'GlobeSafe Overseas Travel Insurance',
  pages: [
    [
      'POLICY SCHEDULE',
      'Insurer: GlobeSafe Travel Assurance Ltd.',
      'Product: GlobeSafe Single-Trip Overseas Travel Insurance',
      'Policy Number: GS-TRV-2024-778452',
      'Sum Insured (Medical): USD 100,000.',
      'Premium: INR 3,150 for a 30-day trip.',
      'Geographical Scope: Worldwide excluding USA and Canada.',
    ].join('\n'),
    [
      'SECTION 1 — COVERAGE',
      '1.1 Emergency Medical Expenses: Covered up to USD 100,000 for illness or injury sustained abroad.',
      '1.2 Trip Cancellation: Non-refundable costs are covered up to USD 1,000 for covered reasons.',
      '1.3 Baggage Loss: Checked-in baggage loss is covered up to USD 1,000.',
      '1.4 Passport Loss: Cost of obtaining a duplicate passport is covered up to USD 300.',
      '1.5 Personal Liability: Third-party liability abroad is covered up to USD 200,000.',
    ].join('\n'),
    [
      'SECTION 2 — WAITING PERIODS AND CONDITIONS',
      '2.1 A waiting period of 48 hours from departure applies to illness-related claims.',
      '2.2 Claims must be intimated to the 24x7 assistance desk before treatment where practicable.',
    ].join('\n'),
    [
      'SECTION 3 — EXCLUSIONS',
      '3.1 Pre-existing Conditions: Treatment of pre-existing medical conditions is excluded except life-threatening emergencies.',
      '3.2 Adventure Sports: Injuries from hazardous or adventure sports are excluded unless an add-on is purchased.',
      '3.3 Intoxication: Claims arising from alcohol or substance abuse are excluded.',
      '3.4 Unattended Baggage: Loss of baggage left unattended in a public place is excluded.',
    ].join('\n'),
    [
      'SECTION 4 — FINANCIAL LIMITS AND CO-PAYMENT',
      '4.1 Deductible: A deductible of USD 100 applies to each medical claim.',
      '4.2 Sub-limit: Out-patient dental treatment abroad is limited to USD 250.',
      '4.3 Co-payment: A co-payment of 10% applies to insured members above 70 years of age.',
    ].join('\n'),
  ],
};

/** All bundled samples in a stable order. */
export const SAMPLE_DOCUMENTS: readonly SampleDocument[] = [
  HEALTH_SAMPLE,
  MOTOR_SAMPLE,
  TRAVEL_SAMPLE,
];
