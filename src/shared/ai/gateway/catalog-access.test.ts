import assert from 'node:assert/strict'
import { describe, it } from 'node:test'
import { shouldLoadGatewayModelCatalog } from './catalog-access'

describe('shouldLoadGatewayModelCatalog', () => {
  it('loads only for an authenticated, resolved, private app session', () => {
    assert.equal(shouldLoadGatewayModelCatalog({
      isAuthenticated: true,
      isAuthLoading: false,

    }), true)
  })

  for (const state of [
    { isAuthenticated: false, isAuthLoading: false,  },
    { isAuthenticated: true, isAuthLoading: true,  },
  ]) {
    it(`does not load for state ${JSON.stringify(state)}`, () => {
      assert.equal(shouldLoadGatewayModelCatalog(state), false)
    })
  }
})
