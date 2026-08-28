import assert from 'node:assert/strict'
import test from 'node:test'
import { currentLegalAcceptancePayload } from '@/shared/legal/legal-documents'
import { LegalAcceptanceError, requireCurrentLegalAcceptance } from './legal-acceptance'

test('requires current terms and privacy versions', () => {
  assert.deepEqual(requireCurrentLegalAcceptance(currentLegalAcceptancePayload()), currentLegalAcceptancePayload())
  assert.throws(() => requireCurrentLegalAcceptance({ acceptedLegalTerms: true }), LegalAcceptanceError)
})
