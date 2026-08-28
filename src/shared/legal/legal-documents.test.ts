import assert from 'node:assert/strict'
import test from 'node:test'
import {
  currentLegalAcceptancePayload,
  isCurrentLegalAcceptance,
  LEGAL_DOCUMENTS,
} from './legal-documents'

test('current legal acceptance payload is accepted', () => {
  assert.equal(isCurrentLegalAcceptance(currentLegalAcceptancePayload()), true)
})

test('rejects missing, stale, and unaccepted legal versions', () => {
  assert.equal(isCurrentLegalAcceptance({}), false)
  assert.equal(isCurrentLegalAcceptance({
    acceptedLegalTerms: false,
    termsVersion: LEGAL_DOCUMENTS.terms.version,
    privacyVersion: LEGAL_DOCUMENTS.privacy.version,
  }), false)
  assert.equal(isCurrentLegalAcceptance({
    acceptedLegalTerms: true,
    termsVersion: 'stale',
    privacyVersion: LEGAL_DOCUMENTS.privacy.version,
  }), false)
})
