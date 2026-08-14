import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldLoadGatewayModelCatalog } from './catalog-access'

describe('shouldLoadGatewayModelCatalog', () => {
  it('loads only for an authenticated, resolved, private app session', () => {
    assert.equal(shouldLoadGatewayModelCatalog({
      isAuthenticated: true,
      isAuthLoading: false,
      isPublicShowcase: false,
    }), true)
  })

  for (const state of [
    { isAuthenticated: false, isAuthLoading: false, isPublicShowcase: false },
    { isAuthenticated: true, isAuthLoading: true, isPublicShowcase: false },
    { isAuthenticated: true, isAuthLoading: false, isPublicShowcase: true },
  ]) {
    it(`does not load for state ${JSON.stringify(state)}`, () => {
      assert.equal(shouldLoadGatewayModelCatalog(state), false)
    })
  }
})
