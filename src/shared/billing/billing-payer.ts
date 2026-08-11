export type BillingSpendSubjectKind = 'member' | 'programmatic'

export type BillingSpendSubject = {
  id: string
  kind: BillingSpendSubjectKind
}

export type ResolvedBillingPayer =
  | {
      billingAccountId: string
      scope: 'personal'
      subject: BillingSpendSubject
      userId: string
    }
  | {
      billingAccountId: string
      scope: 'workspace'
      subject: BillingSpendSubject
      workspaceId: string
    }

export type BillingAccountSpendLimitRecord = {
  billingAccountId: string
  createdAt: number
  limitCents: number
  periodEnd: number
  periodStart: number
  reservedCents: number
  subject: BillingSpendSubject
  updatedAt: number
  usedCents: number
  version: number
}

export function assertBillingSpendSubject(subject: BillingSpendSubject): void {
  if (subject.kind !== 'member' && subject.kind !== 'programmatic') {
    throw new Error('billing_spend_subject_kind_invalid')
  }
  if (!subject.id.trim()) throw new Error('billing_spend_subject_id_required')
}
