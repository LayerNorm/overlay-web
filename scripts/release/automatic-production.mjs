#!/usr/bin/env node
import assert from 'node:assert/strict'
import { main as promote } from './production-promote.mjs'

// Allow guarded main fetches without persisting the ephemeral Actions token.
assert.ok(process.env.GITHUB_TOKEN, 'An ephemeral Actions token is required')
process.env.GIT_CONFIG_COUNT = '1'
process.env.GIT_CONFIG_KEY_0 = 'http.https://github.com/.extraheader'
process.env.GIT_CONFIG_VALUE_0 = 'AUTHORIZATION: basic '
  + Buffer.from('x-access-token:' + process.env.GITHUB_TOKEN).toString('base64')
promote([process.env.GITHUB_SHA]).catch(() => {
  console.error('Production release failed; inspect saved promotion evidence.')
  process.exitCode = 1
})
