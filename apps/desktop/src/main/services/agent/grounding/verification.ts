/**
 * Verification Module
 * Handles postcondition verification after browser actions
 */

import type { WebContents } from 'electron'
import type {
  Condition,
  PageState,
  StateTransition,
  VerificationResult,
  SemanticAction,
  ActionResult,
  DOMChange
} from './types'

// ── State Capture ───────────────────────────────────────────────────────────

const JS_CAPTURE_PAGE_STATE = `
(function() {
  const getVisibleText = () => {
    const walker = document.createTreeWalker(
      document.body,
      NodeFilter.SHOW_TEXT,
      null,
      false
    );
    const texts = [];
    let node;
    while (node = walker.nextNode()) {
      const text = node.textContent.trim();
      if (text && node.parentElement?.offsetParent !== null) {
        texts.push(text);
      }
    }
    return texts.join(' ').slice(0, 5000);
  };

  const getFormValues = () => {
    const forms = {};
    document.querySelectorAll('input, select, textarea').forEach((el, i) => {
      const key = el.id || el.name || 'field_' + i;
      forms[key] = el.value || '';
    });
    return forms;
  };

  const getElementCounts = () => {
    return {
      buttons: document.querySelectorAll('button, [role="button"], input[type="submit"]').length,
      links: document.querySelectorAll('a[href]').length,
      inputs: document.querySelectorAll('input, textarea, select').length,
      images: document.querySelectorAll('img').length,
      modals: document.querySelectorAll('[role="dialog"], [role="alertdialog"], .modal, [class*="modal"]').length
    };
  };

  const getInteractiveElements = () => {
    const elements = [];
    const selectors = 'button, a[href], input, select, textarea, [role="button"], [role="link"], [onclick]';
    document.querySelectorAll(selectors).forEach((el, i) => {
      if (i >= 50) return;
      const rect = el.getBoundingClientRect();
      const isVisible = rect.width > 0 && rect.height > 0 && 
                        window.getComputedStyle(el).visibility !== 'hidden' &&
                        window.getComputedStyle(el).display !== 'none';
      if (!isVisible) return;
      
      elements.push({
        selector: el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className ? '.' + el.className.split(' ')[0] : ''),
        tagName: el.tagName.toLowerCase(),
        text: (el.textContent || '').trim().slice(0, 100),
        ariaLabel: el.getAttribute('aria-label') || '',
        isVisible: true,
        isInteractive: true,
        boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
      });
    });
    return elements;
  };

  return {
    url: window.location.href,
    title: document.title,
    timestamp: Date.now(),
    elementCounts: getElementCounts(),
    visibleText: getVisibleText(),
    formValues: getFormValues(),
    scrollPosition: { x: window.scrollX, y: window.scrollY },
    interactiveElements: getInteractiveElements()
  };
})()
`

export async function capturePageState(webContents: WebContents): Promise<PageState> {
  try {
    const state = await webContents.executeJavaScript(JS_CAPTURE_PAGE_STATE)
    return state as PageState
  } catch (error) {
    console.error('[Verification] Failed to capture page state:', error)
    return {
      url: '',
      title: '',
      timestamp: Date.now(),
      elementCounts: {},
      visibleText: '',
      formValues: {},
      scrollPosition: { x: 0, y: 0 },
      interactiveElements: []
    }
  }
}

// ── DOM Mutation Detection ──────────────────────────────────────────────────

const JS_DETECT_MUTATIONS = `
(function(preElements) {
  const mutations = [];
  const currentSelectors = new Set();
  
  document.querySelectorAll('button, a, input, [role="button"], [role="dialog"]').forEach(el => {
    const selector = el.id ? '#' + el.id : el.tagName.toLowerCase();
    currentSelectors.add(selector);
  });
  
  // Check for new elements
  currentSelectors.forEach(sel => {
    if (!preElements.includes(sel)) {
      mutations.push({ type: 'added', selector: sel });
    }
  });
  
  // Check for removed elements
  preElements.forEach(sel => {
    if (!currentSelectors.has(sel)) {
      mutations.push({ type: 'removed', selector: sel });
    }
  });
  
  return mutations;
})
`

export async function detectDOMMutations(
  webContents: WebContents,
  preElements: string[]
): Promise<DOMChange[]> {
  try {
    const mutations = await webContents.executeJavaScript(
      `${JS_DETECT_MUTATIONS}(${JSON.stringify(preElements)})`
    )
    return mutations as DOMChange[]
  } catch {
    return []
  }
}

// ── Condition Verification ──────────────────────────────────────────────────

async function verifyCondition(
  webContents: WebContents,
  condition: Condition,
  preState: PageState,
  postState: PageState
): Promise<VerificationResult> {
  const { type, selector, pattern, expected } = condition

  try {
    switch (type) {
      case 'url_changed':
        return {
          passed: preState.url !== postState.url,
          condition,
          actual: postState.url,
          expected: 'URL should change'
        }

      case 'url_contains': {
        const urlMatch = postState.url.includes(pattern as string)
        return {
          passed: urlMatch,
          condition,
          actual: postState.url,
          expected: `URL should contain "${pattern}"`
        }
      }

      case 'element_visible': {
        const visible = await webContents.executeJavaScript(`
          (function() {
            const el = document.querySelector('${selector}');
            if (!el) return false;
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width > 0 && rect.height > 0 && 
                   style.visibility !== 'hidden' && 
                   style.display !== 'none';
          })()
        `)
        return {
          passed: visible === true,
          condition,
          actual: visible,
          expected: `Element "${selector}" should be visible`
        }
      }

      case 'element_hidden': {
        const hidden = await webContents.executeJavaScript(`
          (function() {
            const el = document.querySelector('${selector}');
            if (!el) return true;
            const rect = el.getBoundingClientRect();
            const style = window.getComputedStyle(el);
            return rect.width === 0 || rect.height === 0 || 
                   style.visibility === 'hidden' || 
                   style.display === 'none';
          })()
        `)
        return {
          passed: hidden === true,
          condition,
          actual: hidden,
          expected: `Element "${selector}" should be hidden`
        }
      }

      case 'element_exists': {
        const exists = await webContents.executeJavaScript(`
          document.querySelector('${selector}') !== null
        `)
        return {
          passed: exists === true,
          condition,
          actual: exists,
          expected: `Element "${selector}" should exist`
        }
      }

      case 'text_contains': {
        const patternStr = typeof pattern === 'string' ? pattern : pattern?.source
        const contains = postState.visibleText
          .toLowerCase()
          .includes(patternStr?.toLowerCase() || '')
        return {
          passed: contains,
          condition,
          actual: contains ? 'Text found' : 'Text not found',
          expected: `Page should contain text matching "${patternStr}"`
        }
      }

      case 'text_not_contains': {
        const patternStr = typeof pattern === 'string' ? pattern : pattern?.source
        const notContains = !postState.visibleText
          .toLowerCase()
          .includes(patternStr?.toLowerCase() || '')
        return {
          passed: notContains,
          condition,
          actual: notContains ? 'Text not found' : 'Text found',
          expected: `Page should NOT contain text matching "${patternStr}"`
        }
      }

      case 'count_changed': {
        const preCount = preState.elementCounts[selector || 'buttons'] || 0
        const postCount = postState.elementCounts[selector || 'buttons'] || 0
        return {
          passed: preCount !== postCount,
          condition,
          actual: `${preCount} → ${postCount}`,
          expected: `Count of "${selector}" should change`
        }
      }

      case 'attribute_changed': {
        const changed = await webContents.executeJavaScript(`
          (function() {
            const el = document.querySelector('${selector}');
            return el ? el.getAttribute('${expected}') : null;
          })()
        `)
        return {
          passed: changed !== null,
          condition,
          actual: changed,
          expected: `Attribute should change`
        }
      }

      case 'dom_mutation': {
        const preSelectors = preState.interactiveElements.map((e) => e.selector)
        const mutations = await detectDOMMutations(webContents, preSelectors)
        return {
          passed: mutations.length > 0,
          condition,
          actual: mutations.length > 0 ? `${mutations.length} mutations detected` : 'No mutations',
          expected: 'DOM should mutate'
        }
      }

      default:
        return {
          passed: false,
          condition,
          error: `Unknown condition type: ${type}`
        }
    }
  } catch (error) {
    return {
      passed: false,
      condition,
      error: `Verification error: ${error instanceof Error ? error.message : String(error)}`
    }
  }
}

// ── Main Verification Functions ─────────────────────────────────────────────

export interface VerificationConfig {
  conditions: Condition[]
  timeout?: number
  retryDelay?: number
  maxRetries?: number
}

export async function verifyPostconditions(
  webContents: WebContents,
  config: VerificationConfig,
  preState: PageState,
  postState: PageState
): Promise<{
  allPassed: boolean
  results: VerificationResult[]
  failures: VerificationResult[]
}> {
  const results: VerificationResult[] = []
  const failures: VerificationResult[] = []

  for (const condition of config.conditions) {
    const result = await verifyCondition(webContents, condition, preState, postState)
    results.push(result)
    if (!result.passed) {
      failures.push(result)
    }
  }

  return {
    allPassed: failures.length === 0,
    results,
    failures
  }
}

export async function executeWithVerification(
  webContents: WebContents,
  action: SemanticAction,
  executeAction: () => Promise<{ success: boolean; error?: string }>,
  config: VerificationConfig
): Promise<ActionResult> {
  const startTime = Date.now()

  // 1. Capture pre-state
  const preState = await capturePageState(webContents)
  console.log('[Verification] Pre-state captured:', preState.url)

  // 2. Execute action
  const actionResult = await executeAction()
  if (!actionResult.success) {
    return {
      success: false,
      action,
      error: actionResult.error || 'Action execution failed',
      duration: Date.now() - startTime
    }
  }

  // 3. Wait for state to settle
  const settleDelay = config.retryDelay || 500
  await new Promise((resolve) => setTimeout(resolve, settleDelay))

  // 4. Capture post-state
  const postState = await capturePageState(webContents)
  console.log('[Verification] Post-state captured:', postState.url)

  // 5. Detect mutations
  const preSelectors = preState.interactiveElements.map((e) => e.selector)
  const mutations = await detectDOMMutations(webContents, preSelectors)

  // 6. Verify postconditions
  const verification = await verifyPostconditions(webContents, config, preState, postState)
  console.log(
    '[Verification] Results:',
    verification.allPassed ? 'PASSED' : `FAILED (${verification.failures.length} failures)`
  )

  // 7. Build state transition
  const stateTransition: StateTransition = {
    pre: preState,
    post: postState,
    duration: Date.now() - startTime,
    mutations
  }

  return {
    success: verification.allPassed,
    action,
    stateTransition,
    verificationResults: verification.results,
    failedConditions: verification.failures,
    duration: Date.now() - startTime
  }
}

// ── Utility: Infer postconditions from action type ──────────────────────────

export function inferPostconditions(action: SemanticAction): Condition[] {
  const conditions: Condition[] = []

  switch (action.type) {
    case 'submit_form':
      conditions.push({ type: 'url_changed', timeout: 5000 })
      conditions.push({ type: 'dom_mutation', timeout: 3000 })
      break

    case 'navigate_link':
      conditions.push({ type: 'url_changed', timeout: 5000 })
      break

    case 'click_button':
      conditions.push({ type: 'dom_mutation', timeout: 2000 })
      break

    case 'input_text':
      if (action.target.selectors[0]) {
        conditions.push({
          type: 'attribute_changed',
          selector: action.target.selectors[0],
          expected: 'value',
          timeout: 1000
        })
      }
      break

    case 'close_modal':
      if (action.target.selectors[0]) {
        conditions.push({
          type: 'element_hidden',
          selector: '[role="dialog"], [role="alertdialog"], .modal',
          timeout: 2000
        })
      }
      break

    case 'open_menu':
      conditions.push({ type: 'dom_mutation', timeout: 1000 })
      break

    case 'toggle_control':
      conditions.push({ type: 'dom_mutation', timeout: 1000 })
      break

    case 'select_option':
      conditions.push({ type: 'dom_mutation', timeout: 1000 })
      break

    default:
      conditions.push({ type: 'dom_mutation', timeout: 2000 })
  }

  return conditions
}

// ── Wait for condition with timeout ─────────────────────────────────────────

export async function waitForCondition(
  webContents: WebContents,
  condition: Condition,
  preState: PageState,
  timeout: number = 5000
): Promise<VerificationResult> {
  const startTime = Date.now()
  const pollInterval = 200

  while (Date.now() - startTime < timeout) {
    const postState = await capturePageState(webContents)
    const result = await verifyCondition(webContents, condition, preState, postState)

    if (result.passed) {
      return result
    }

    await new Promise((resolve) => setTimeout(resolve, pollInterval))
  }

  const finalState = await capturePageState(webContents)
  return verifyCondition(webContents, condition, preState, finalState)
}
