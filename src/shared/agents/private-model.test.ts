import assert from 'node:assert/strict'
import test from 'node:test'
import { resolvePrivateModel, type ProviderModelList } from './private-model'

const anthropic: ProviderModelList = { provider: 'anthropic', models: [
  { id: 'claude-sonnet-4-5-20250929', name: 'Claude Sonnet 4.5' },
  { id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' },
  { id: 'claude-haiku-4-5-20251001', name: 'Claude Haiku 4.5' },
] }
const openrouter: ProviderModelList = { provider: 'openrouter', models: [
  { id: 'deepseek/deepseek-v4-pro', name: 'DeepSeek V4 Pro' },
  { id: 'anthropic/claude-sonnet-5.5', name: 'Claude Sonnet 5.5' },
] }

test('the provider key runs the agent model, matching catalog ids to provider ids', () => {
  assert.deepEqual(resolvePrivateModel('anthropic/claude-sonnet-5.5', 'anthropic', [anthropic]), { provider: 'anthropic', modelId: 'claude-sonnet-5-5' })
  assert.deepEqual(resolvePrivateModel('anthropic/claude-sonnet-4.5', 'anthropic', [anthropic]), { provider: 'anthropic', modelId: 'claude-sonnet-4-5-20250929' })
  assert.deepEqual(resolvePrivateModel('claude-haiku-4-5', 'anthropic', [anthropic]), { provider: 'anthropic', modelId: 'claude-haiku-4-5-20251001' })
})

test('OpenRouter runs models whose provider has no key, or that the provider key cannot', () => {
  assert.deepEqual(resolvePrivateModel('deepseek/deepseek-v4-pro', 'deepseek', [anthropic, openrouter]), { provider: 'openrouter', modelId: 'deepseek/deepseek-v4-pro' })
  assert.deepEqual(resolvePrivateModel('anthropic/claude-sonnet-5.5', 'anthropic', [openrouter]), { provider: 'openrouter', modelId: 'anthropic/claude-sonnet-5.5' })
})

test('a signed-in plan runs its provider’s models before any key', () => {
  const claude: ProviderModelList = { provider: 'claude', models: [{ id: 'claude-sonnet-5-5', name: 'Claude Sonnet 5.5' }] }
  const chatgpt: ProviderModelList = { provider: 'chatgpt', models: [{ id: 'gpt-5.5', name: 'GPT-5.5' }] }
  assert.deepEqual(resolvePrivateModel('anthropic/claude-sonnet-5.5', 'anthropic', [anthropic, openrouter, claude, chatgpt]), { provider: 'claude', modelId: 'claude-sonnet-5-5' })
  assert.deepEqual(resolvePrivateModel('openai/gpt-5.5', 'openai', [claude, chatgpt]), { provider: 'chatgpt', modelId: 'gpt-5.5' })
  // A plan that doesn't offer the model falls through to the keys.
  assert.deepEqual(resolvePrivateModel('anthropic/claude-sonnet-4.5', 'anthropic', [claude, anthropic]), { provider: 'anthropic', modelId: 'claude-sonnet-4-5-20250929' })
  // ChatGPT never runs an Anthropic model.
  assert.equal(resolvePrivateModel('anthropic/claude-opus-9', 'anthropic', [chatgpt]), null)
})

test('Overlay’s models run the agent model when nothing on this computer can, in a paid workspace', () => {
  assert.deepEqual(resolvePrivateModel('openai/gpt-6-astra', 'openai', [anthropic], { available: true }), { provider: 'overlay', modelId: 'openai/gpt-6-astra' })
  assert.deepEqual(resolvePrivateModel('anthropic/claude-sonnet-5.5', 'anthropic', [anthropic], { available: true }), { provider: 'anthropic', modelId: 'claude-sonnet-5-5' })
  assert.equal(resolvePrivateModel('openai/gpt-6-astra', 'openai', [anthropic], { available: false }), null)
})

test('no key that can run the agent model resolves to nothing', () => {
  assert.equal(resolvePrivateModel('openai/gpt-6-astra', 'openai', [anthropic]), null)
  assert.equal(resolvePrivateModel('anthropic/claude-opus-9', 'anthropic', [anthropic, openrouter]), null)
})
