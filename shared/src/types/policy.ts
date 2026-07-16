// Customer policy entity (mirrors the `policies` table in the data model, R4).

import type { PolicyCategory, PolicyStatus } from './enums.js';
import type { Timestamp } from './common.js';

/** A stored customer policy record. */
export interface Policy {
  id: string;
  ownerId: string;
  familyMemberId?: string | null;
  category: PolicyCategory;
  title: string;
  provider: string;
  premiumAmount: number;
  premiumCurrency: string;
  sumInsured: number;
  storagePath: string;
  originalFilename: string;
  mimeType: string;
  status: PolicyStatus;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}

/** A named family member a policy can be assigned to (R6.6). */
export interface FamilyMember {
  id: string;
  ownerId: string;
  name: string;
  relation: string;
  createdAt: Timestamp;
  updatedAt: Timestamp;
}
