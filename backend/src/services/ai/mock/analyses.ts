// Deterministic, schema-valid PolicyAnalysis fixtures for the mock AI provider.
//
// Each builder returns a fully-populated PolicyAnalysis validated against
// `PolicyAnalysisSchema` from @policylens/shared, so the mock output is
// guaranteed to satisfy the same contract the real LLM adapters must meet (R3).
// The analyses intentionally mirror the bundled OCR samples so the whole
// pipeline stays coherent in Demo/Mock mode.

import { PolicyAnalysisSchema, type PolicyAnalysis } from '@policylens/shared';

/** Health-insurance analysis mirroring the SecureHealth sample document. */
function rawHealthAnalysis(): unknown {
  return {
    category: 'health',
    provider: 'SecureHealth General Insurance Co. Ltd.',
    premium: { amount: 12450, currency: 'INR' },
    sumInsured: 500000,
    coverage: [
      { type: 'In-patient Hospitalization', detail: 'Covered up to the Sum Insured for stays over 24 hours.', covered: true },
      { type: 'Pre-hospitalization', detail: 'Expenses 60 days before admission are covered.', covered: true },
      { type: 'Post-hospitalization', detail: 'Expenses 90 days after discharge are covered.', covered: true },
      { type: 'Day Care Procedures', detail: '540 listed day-care treatments covered.', covered: true },
      { type: 'Ambulance Charges', detail: 'Covered up to INR 2,000 per hospitalization.', covered: true },
      { type: 'Maternity', detail: 'Covered only after a 4-year waiting period, with sub-limits.', covered: true },
    ],
    exclusions: [
      { name: 'Cosmetic Surgery', explanation: 'Aesthetic or cosmetic procedures are not paid unless required to treat an accidental injury.' },
      { name: 'Self-inflicted Injury', explanation: 'Injuries from suicide attempts or intentional self-harm are excluded.' },
      { name: 'War and Nuclear Risks', explanation: 'Treatment linked to war, invasion, or nuclear contamination is excluded.' },
      { name: 'Routine Dental', explanation: 'Everyday dental care is excluded unless caused by an accident.' },
    ],
    waitingPeriods: [
      { duration: '30 days', appliesTo: 'All illnesses except accidental injury' },
      { duration: '3 years', appliesTo: 'Pre-existing diseases declared at inception' },
      { duration: '2 years', appliesTo: 'Specified ailments (cataract, hernia, joint replacement)' },
      { duration: '4 years', appliesTo: 'Maternity and newborn cover' },
    ],
    financialLimits: [
      { name: 'Room rent cap', value: 5000, unit: 'per day' },
      { name: 'ICU charges cap', value: 10000, unit: 'per day' },
      { name: 'Cataract sub-limit', value: 40000, unit: 'per eye' },
      { name: 'Maternity (normal delivery) sub-limit', value: 50000, unit: 'per delivery' },
    ],
    coPay: [{ percent: 20, condition: 'Applies to all claims when the insured is above 60 years of age' }],
    deductibles: [{ amount: 10000 }],
    hiddenClauses: [
      {
        clause: 'Proportionate deduction on room rent',
        risk: 'High',
        impact: 'Choosing a room above the eligible category reduces ALL associated charges proportionately, which can slash a claim payout well below actual costs.',
      },
      {
        clause: '4-year maternity waiting period',
        risk: 'Medium',
        impact: 'Maternity is only payable after four continuous years, so recently-purchased cover offers no maternity protection.',
      },
      {
        clause: 'Age-based 20% co-payment',
        risk: 'Medium',
        impact: 'Members above 60 must pay 20% of every claim out of pocket, materially raising the effective cost of a large hospitalization.',
      },
      {
        clause: 'AYUSH treatments excluded by default',
        risk: 'Low',
        impact: 'Ayurveda, Yoga, Unani, Siddha, and Homeopathy treatments are not covered unless a specific endorsement is added.',
      },
    ],
    recommendations: [
      { kind: 'gap', title: 'Add a super top-up cover', detail: 'The INR 5L sum insured may be inadequate for major surgery in metro hospitals; a super top-up raises cover cheaply.' },
      { kind: 'risk', title: 'Choose rooms within the rent cap', detail: 'Stay within the 1% room-rent limit to avoid proportionate deduction reducing the whole claim.' },
      { kind: 'gap', title: 'Consider a maternity-ready plan', detail: 'If planning a family soon, the 4-year wait makes this plan unsuitable for near-term maternity needs.' },
    ],
    healthScore: 64,
    notFound: [],
    partial: false,
  };
}

/** Motor-insurance analysis mirroring the DriveShield sample document. */
function rawMotorAnalysis(): unknown {
  return {
    category: 'motor',
    provider: 'DriveShield Motor Insurance Ltd.',
    premium: { amount: 22090, currency: 'INR' },
    sumInsured: 650000,
    coverage: [
      { type: 'Own Damage', detail: 'Accident, fire, or external damage covered up to IDV of INR 6,50,000.', covered: true },
      { type: 'Theft', detail: 'Total loss by theft covered up to IDV.', covered: true },
      { type: 'Third-Party Liability', detail: 'Legal liability for third-party injury, death, and property damage.', covered: true },
      { type: 'Owner-Driver Personal Accident', detail: 'Personal accident cover of INR 15,00,000 included.', covered: true },
      { type: 'Zero Depreciation', detail: 'Only covered when the add-on is explicitly opted.', covered: false },
    ],
    exclusions: [
      { name: 'Drunken Driving', explanation: 'Damage while driving under the influence of alcohol or drugs is not covered.' },
      { name: 'Invalid Licence', explanation: 'Claims are denied if the driver holds no valid driving licence at the time of loss.' },
      { name: 'Consequential Loss', explanation: 'Indirect losses and normal wear and tear are excluded.' },
    ],
    waitingPeriods: [],
    financialLimits: [{ name: "Insured's Declared Value (IDV)", value: 650000, unit: 'total' }],
    coPay: [{ percent: 15, condition: 'Betterment charges on replaced fibreglass and rubber parts' }],
    deductibles: [{ amount: 1000 }],
    hiddenClauses: [
      {
        clause: 'Depreciation grid on parts',
        risk: 'High',
        impact: 'Without zero-depreciation, payouts for plastic and metal parts are cut by the depreciation grid, leaving a large gap on newer cars.',
      },
      {
        clause: '48-hour claim intimation window',
        risk: 'Medium',
        impact: 'Claims not reported within 48 hours of the incident may be rejected, which is easy to miss after a stressful accident.',
      },
    ],
    recommendations: [
      { kind: 'gap', title: 'Add zero-depreciation cover', detail: 'For a 2022 vehicle, zero-dep prevents steep depreciation deductions on part replacements.' },
      { kind: 'risk', title: 'Report claims within 48 hours', detail: 'Set a reminder to intimate any incident immediately to avoid rejection on the intimation clause.' },
    ],
    healthScore: 72,
    notFound: [],
    partial: false,
  };
}

/** Travel-insurance analysis mirroring the GlobeSafe sample document. */
function rawTravelAnalysis(): unknown {
  return {
    category: 'travel',
    provider: 'GlobeSafe Travel Assurance Ltd.',
    premium: { amount: 3150, currency: 'INR' },
    sumInsured: 100000,
    coverage: [
      { type: 'Emergency Medical Expenses', detail: 'Illness or injury abroad covered up to USD 100,000.', covered: true },
      { type: 'Trip Cancellation', detail: 'Non-refundable costs covered up to USD 1,000 for covered reasons.', covered: true },
      { type: 'Baggage Loss', detail: 'Checked-in baggage loss covered up to USD 1,000.', covered: true },
      { type: 'Passport Loss', detail: 'Duplicate passport cost covered up to USD 300.', covered: true },
      { type: 'Personal Liability', detail: 'Third-party liability abroad covered up to USD 200,000.', covered: true },
    ],
    exclusions: [
      { name: 'Pre-existing Conditions', explanation: 'Pre-existing medical conditions are excluded except in life-threatening emergencies.' },
      { name: 'Adventure Sports', explanation: 'Injuries from hazardous or adventure sports are excluded unless an add-on is bought.' },
      { name: 'Intoxication', explanation: 'Claims from alcohol or substance abuse are not covered.' },
      { name: 'Unattended Baggage', explanation: 'Baggage left unattended in a public place is not covered.' },
    ],
    waitingPeriods: [{ duration: '48 hours', appliesTo: 'Illness-related claims from departure' }],
    financialLimits: [
      { name: 'Out-patient dental sub-limit', value: 250, unit: 'USD' },
      { name: 'Baggage loss cap', value: 1000, unit: 'USD' },
    ],
    coPay: [{ percent: 10, condition: 'Applies to insured members above 70 years of age' }],
    deductibles: [{ amount: 100 }],
    hiddenClauses: [
      {
        clause: 'USA and Canada excluded from geography',
        risk: 'High',
        impact: 'The policy is void for the two most expensive healthcare destinations, so travel there is entirely uninsured under this plan.',
      },
      {
        clause: 'Pre-existing condition exclusion',
        risk: 'Medium',
        impact: 'Only life-threatening emergencies related to pre-existing conditions are considered, leaving routine flare-ups uncovered.',
      },
    ],
    recommendations: [
      { kind: 'gap', title: 'Buy a USA/Canada endorsement if needed', detail: 'If the trip may include the USA or Canada, this plan gives zero protection there.' },
      { kind: 'risk', title: 'Add the adventure-sports rider', detail: 'Planned skiing or trekking is excluded by default; add the rider before departure.' },
    ],
    healthScore: 78,
    notFound: [],
    partial: false,
  };
}

/**
 * Validate a raw analysis object and compute `riskFlagCount` deterministically
 * (the count of Medium/High hidden clauses), matching how the real pipeline
 * derives risk flags in code rather than from the LLM (R3.8).
 */
function finalize(raw: unknown): PolicyAnalysis {
  const analysis = PolicyAnalysisSchema.parse(raw);
  const riskFlagCount = analysis.hiddenClauses.filter(
    (c) => c.risk === 'High' || c.risk === 'Medium',
  ).length;
  return { ...analysis, riskFlagCount };
}

/** The three canned analyses keyed by category. */
export const MOCK_ANALYSES = {
  get health(): PolicyAnalysis {
    return finalize(rawHealthAnalysis());
  },
  get motor(): PolicyAnalysis {
    return finalize(rawMotorAnalysis());
  },
  get travel(): PolicyAnalysis {
    return finalize(rawTravelAnalysis());
  },
} as const;

/** Detect which canned analysis best fits the supplied policy text. */
export function detectAnalysis(text: string): PolicyAnalysis {
  const lower = text.toLowerCase();
  const score = {
    motor: count(lower, ['idv', 'own damage', 'third-party', 'vehicle', 'driving', 'depreciation']),
    travel: count(lower, ['trip', 'baggage', 'passport', 'overseas', 'travel', 'departure']),
    health: count(lower, ['hospitalization', 'room rent', 'maternity', 'sum insured', 'co-payment', 'pre-existing']),
  };
  if (score.motor > score.health && score.motor >= score.travel) return MOCK_ANALYSES.motor;
  if (score.travel > score.health && score.travel >= score.motor) return MOCK_ANALYSES.travel;
  return MOCK_ANALYSES.health;
}

/** Count how many of the given needles occur in the haystack. */
function count(haystack: string, needles: string[]): number {
  return needles.reduce((n, needle) => (haystack.includes(needle) ? n + 1 : n), 0);
}
