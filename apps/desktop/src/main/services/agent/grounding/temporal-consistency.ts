/**
 * Temporal Consistency Module
 * Validates that actions lead to expected state transitions
 */

import type { WebContents } from 'electron'
import type {
  StateTransitionRule,
  ExpectedChange,
  TransitionValidation,
  PageState,
  SemanticAction
} from './types'
import { capturePageState } from './verification'

// ── Common State Transition Rules ───────────────────────────────────────────

export const COMMON_TRANSITION_RULES: StateTransitionRule[] = [
  {
    id: 'add_to_cart',
    trigger: {
      actionType: 'click_button',
      textPattern: /add.to.cart|add.to.bag|buy.now/i
    },
    expectedChanges: [
      { type: 'element_count', expectation: 'increased', selector: '[class*="cart"]' },
      { type: 'page_text', expectation: 'contains', pattern: /added|cart|bag/i }
    ],
    timeout: 3000
  },
  {
    id: 'login_submit',
    trigger: {
      actionType: 'submit_form',
      textPattern: /log.?in|sign.?in|submit/i
    },
    expectedChanges: [
      { type: 'url', expectation: 'changed' },
      { type: 'page_text', expectation: 'contains', pattern: /welcome|dashboard|account|profile/i }
    ],
    timeout: 5000
  },
  {
    id: 'logout',
    trigger: {
      actionType: 'click_button',
      textPattern: /log.?out|sign.?out/i
    },
    expectedChanges: [
      { type: 'url', expectation: 'changed' },
      { type: 'page_text', expectation: 'contains', pattern: /logged.out|sign.in|log.in/i }
    ],
    timeout: 3000
  },
  {
    id: 'search_submit',
    trigger: {
      actionType: 'submit_form',
      textPattern: /search/i
    },
    expectedChanges: [
      { type: 'url', expectation: 'contains', pattern: 'search' },
      { type: 'dom_element', expectation: 'added', selector: '[class*="result"], [class*="search"]' }
    ],
    timeout: 5000
  },
  {
    id: 'navigation_link',
    trigger: {
      actionType: 'navigate_link'
    },
    expectedChanges: [{ type: 'url', expectation: 'changed' }],
    timeout: 5000
  },
  {
    id: 'modal_open',
    trigger: {
      textPattern: /open|show|view|expand/i
    },
    expectedChanges: [
      {
        type: 'dom_element',
        expectation: 'added',
        selector: '[role="dialog"], [role="alertdialog"], .modal, [class*="modal"]'
      }
    ],
    timeout: 2000
  },
  {
    id: 'modal_close',
    trigger: {
      textPattern: /close|dismiss|cancel|×|x/i
    },
    expectedChanges: [
      {
        type: 'dom_element',
        expectation: 'removed',
        selector: '[role="dialog"], [role="alertdialog"], .modal, [class*="modal"]'
      }
    ],
    timeout: 2000
  },
  {
    id: 'form_input',
    trigger: {
      actionType: 'input_text'
    },
    expectedChanges: [{ type: 'form_value', expectation: 'changed' }],
    timeout: 1000
  },
  {
    id: 'checkbox_toggle',
    trigger: {
      actionType: 'toggle_control'
    },
    expectedChanges: [{ type: 'dom_element', expectation: 'changed' }],
    timeout: 1000
  },
  {
    id: 'dropdown_select',
    trigger: {
      actionType: 'select_option'
    },
    expectedChanges: [{ type: 'form_value', expectation: 'changed' }],
    timeout: 1000
  }
]

// ── Rule Matching ───────────────────────────────────────────────────────────

export function findApplicableRules(
  action: SemanticAction,
  rules: StateTransitionRule[] = COMMON_TRANSITION_RULES
): StateTransitionRule[] {
  const applicable: StateTransitionRule[] = []

  for (const rule of rules) {
    let matches = true

    // Check action type
    if (rule.trigger.actionType && rule.trigger.actionType !== action.type) {
      matches = false
    }

    // Check target text pattern
    if (rule.trigger.textPattern && matches) {
      const targetText = [
        action.target.semanticLabel,
        action.intent,
        action.target.element?.text
      ]
        .filter(Boolean)
        .join(' ')

      if (!rule.trigger.textPattern.test(targetText)) {
        matches = false
      }
    }

    // Check target pattern
    if (rule.trigger.targetPattern && matches) {
      const selector = action.target.selectors[0] || ''
      if (!rule.trigger.targetPattern.test(selector)) {
        matches = false
      }
    }

    if (matches) {
      applicable.push(rule)
    }
  }

  return applicable
}

// ── Change Validation ───────────────────────────────────────────────────────

async function validateChange(
  webContents: WebContents,
  change: ExpectedChange,
  preState: PageState,
  postState: PageState
): Promise<{ passed: boolean; reason?: string }> {
  switch (change.type) {
    case 'url': {
      if (change.expectation === 'changed') {
        const passed = preState.url !== postState.url
        return {
          passed,
          reason: passed ? undefined : 'URL did not change'
        }
      }
      if (change.expectation === 'contains' && change.pattern) {
        const patternStr = typeof change.pattern === 'string' ? change.pattern : change.pattern.source
        const passed = postState.url.includes(patternStr)
        return {
          passed,
          reason: passed ? undefined : `URL does not contain "${patternStr}"`
        }
      }
      return { passed: true }
    }

    case 'dom_element': {
      if (!change.selector) return { passed: true }

      const elementExists = await webContents.executeJavaScript(`
        document.querySelector('${change.selector}') !== null
      `)

      if (change.expectation === 'added') {
        return {
          passed: elementExists === true,
          reason: elementExists ? undefined : `Element "${change.selector}" was not added`
        }
      }
      if (change.expectation === 'removed') {
        return {
          passed: elementExists === false,
          reason: !elementExists ? undefined : `Element "${change.selector}" was not removed`
        }
      }
      if (change.expectation === 'changed') {
        // Check if the element's attributes or content changed
        return { passed: true }
      }
      return { passed: true }
    }

    case 'page_text': {
      if (!change.pattern) return { passed: true }

      const patternStr = typeof change.pattern === 'string' ? change.pattern : change.pattern.source
      const regex = typeof change.pattern === 'string' ? new RegExp(change.pattern, 'i') : change.pattern

      if (change.expectation === 'contains') {
        const passed = regex.test(postState.visibleText)
        return {
          passed,
          reason: passed ? undefined : `Page text does not contain pattern "${patternStr}"`
        }
      }
      return { passed: true }
    }

    case 'element_count': {
      const selector = change.selector || 'buttons'
      const preCount = preState.elementCounts[selector] || 0
      const postCount = postState.elementCounts[selector] || 0

      if (change.expectation === 'increased') {
        const passed = postCount > preCount
        return {
          passed,
          reason: passed ? undefined : `Element count did not increase (${preCount} → ${postCount})`
        }
      }
      if (change.expectation === 'decreased') {
        const passed = postCount < preCount
        return {
          passed,
          reason: passed ? undefined : `Element count did not decrease (${preCount} → ${postCount})`
        }
      }
      if (change.expectation === 'changed') {
        const passed = preCount !== postCount
        return {
          passed,
          reason: passed ? undefined : `Element count did not change (${preCount})`
        }
      }
      return { passed: true }
    }

    case 'form_value': {
      if (change.expectation === 'changed') {
        const preValues = JSON.stringify(preState.formValues)
        const postValues = JSON.stringify(postState.formValues)
        const passed = preValues !== postValues
        return {
          passed,
          reason: passed ? undefined : 'Form values did not change'
        }
      }
      return { passed: true }
    }

    default:
      return { passed: true }
  }
}

// ── Main Validation Function ────────────────────────────────────────────────

export async function validateStateTransition(
  webContents: WebContents,
  action: SemanticAction,
  preState: PageState,
  postState: PageState,
  rules: StateTransitionRule[] = COMMON_TRANSITION_RULES
): Promise<TransitionValidation> {
  const applicableRules = findApplicableRules(action, rules)

  if (applicableRules.length === 0) {
    // No specific rules apply, transition is valid by default
    return { valid: true }
  }

  // Check each applicable rule
  for (const rule of applicableRules) {
    let anyChangePassed = false
    const failures: string[] = []

    for (const change of rule.expectedChanges) {
      const result = await validateChange(webContents, change, preState, postState)

      if (result.passed) {
        anyChangePassed = true
        break // At least one expected change passed
      } else if (result.reason) {
        failures.push(result.reason)
      }
    }

    // Rule passes if ANY of the expected changes occurred (OR logic)
    if (!anyChangePassed && failures.length > 0) {
      return {
        valid: false,
        rule,
        reason: failures.join('; '),
        suggestion: inferSuggestion(rule, failures)
      }
    }
  }

  return { valid: true }
}

// ── Suggestion Inference ────────────────────────────────────────────────────

function inferSuggestion(rule: StateTransitionRule, failures: string[]): string {
  switch (rule.id) {
    case 'add_to_cart':
      return 'The item may not have been added to cart. Try scrolling to find the cart icon or check for error messages.'

    case 'login_submit':
      return 'Login may have failed. Check for error messages on the page or verify credentials.'

    case 'search_submit':
      return 'Search may not have executed. Try pressing Enter or clicking the search button explicitly.'

    case 'navigation_link':
      return 'Navigation may have failed. The link might open in a new tab or require JavaScript to execute.'

    case 'modal_close':
      return 'Modal may still be open. Try clicking the background overlay or pressing Escape.'

    default:
      return `Expected state transition did not occur. ${failures[0] || 'Verify the action completed successfully.'}`
  }
}

// ── Convenience: Validate with auto state capture ───────────────────────────

export async function validateActionTransition(
  webContents: WebContents,
  action: SemanticAction,
  executeAction: () => Promise<void>,
  timeout: number = 3000
): Promise<TransitionValidation> {
  // Capture pre-state
  const preState = await capturePageState(webContents)

  // Execute action
  await executeAction()

  // Wait for state to settle
  await new Promise((resolve) => setTimeout(resolve, Math.min(timeout, 1000)))

  // Capture post-state
  const postState = await capturePageState(webContents)

  // Validate transition
  return validateStateTransition(webContents, action, preState, postState)
}

// ── Add custom rules ────────────────────────────────────────────────────────

export function createTransitionRule(
  id: string,
  trigger: StateTransitionRule['trigger'],
  expectedChanges: ExpectedChange[],
  timeout: number = 3000
): StateTransitionRule {
  return { id, trigger, expectedChanges, timeout }
}
