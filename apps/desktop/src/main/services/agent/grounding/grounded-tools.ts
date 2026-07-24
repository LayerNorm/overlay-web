/**
 * Grounded Browser Tools
 * Enhanced browser tools with full grounding pipeline integration
 */

import type { WebContents } from 'electron'
import { pruneDOMForTask, quickDOMScan, type QuickScanResult } from './dom-pruner'
import { sanitizeBodyText } from './dom-sanitizer'
import { checkAdversarialPatterns, hasActivePopup, findDismissButton } from './adversarial-filter'
import { generateFallbacks, executeClickWithFallbacks, executeTypeWithFallbacks } from './deterministic-fallback'
import { capturePageState, verifyPostconditions, inferPostconditions } from './verification'
import { validateStateTransition } from './temporal-consistency'
import { quickConfidenceCheck } from './confidence'
import { createSemanticAction } from './action-ontology'
import type { ElementCandidate, SemanticAction, PageState } from './types'

// ── Grounded Page Content ───────────────────────────────────────────────────

export interface GroundedPageContentResult {
  success: boolean
  url: string
  title: string
  bodyText: string
  elements: ElementCandidate[]
  pageInfo: QuickScanResult
  hasPopup: boolean
  dismissButton?: { selector: string; text: string }
  error?: string
}

export async function getGroundedPageContent(
  webContents: WebContents,
  taskIntent?: string
): Promise<GroundedPageContentResult> {
  try {
    // Quick scan for page structure
    const pageInfo = await quickDOMScan(webContents)

    // Check for popups
    const popup = await hasActivePopup(webContents)
    let dismissButton: { selector: string; text: string } | undefined

    if (popup) {
      const dismiss = await findDismissButton(webContents)
      if (dismiss.found && dismiss.selector) {
        dismissButton = { selector: dismiss.selector, text: dismiss.text || 'Close' }
      }
    }

    // Get pruned elements based on task intent
    const prunedDOM = await pruneDOMForTask(webContents, {
      taskIntent: taskIntent || 'browse page',
      maxElements: 100
    })

    // Get body text and sanitize it
    const rawBodyText = await webContents.executeJavaScript(`
      document.body.innerText.slice(0, 12000)
    `)
    const bodyText = sanitizeBodyText(rawBodyText, 8000)

    return {
      success: true,
      url: pageInfo.url,
      title: pageInfo.title,
      bodyText,
      elements: prunedDOM.elements,
      pageInfo,
      hasPopup: popup,
      dismissButton
    }
  } catch (error) {
    return {
      success: false,
      url: '',
      title: '',
      bodyText: '',
      elements: [],
      pageInfo: {
        url: '',
        title: '',
        hasForm: false,
        hasSearch: false,
        hasModal: false,
        hasNav: false,
        buttonCount: 0,
        linkCount: 0,
        inputCount: 0,
        landmarks: []
      },
      hasPopup: false,
      error: String(error)
    }
  }
}

// ── Grounded Click ──────────────────────────────────────────────────────────

export interface GroundedClickResult {
  success: boolean
  clicked: boolean
  method: 'primary' | 'fallback' | 'text'
  selector?: string
  usedFallback?: string
  confidence: number
  warnings: string[]
  verification?: {
    passed: boolean
    stateChanged: boolean
    failures?: string[]
  }
  error?: string
}

export async function groundedClick(
  webContents: WebContents,
  target: string,
  options: {
    taskIntent?: string
    verify?: boolean
    checkAdversarial?: boolean
  } = {}
): Promise<GroundedClickResult> {
  const { verify = true, checkAdversarial = true } = options
  const warnings: string[] = []

  try {
    // 1. Quick confidence check on selector
    const selectorConfidence = await quickConfidenceCheck(webContents, target)

    // 2. Try to find element and create semantic action
    let element: ElementCandidate | null = null
    let action: SemanticAction | null = null

    // Try as CSS selector first
    const elementExists = await webContents.executeJavaScript(`
      document.querySelector('${target.replace(/'/g, "\\'")}') !== null
    `)

    if (elementExists) {
      // Get element info
      const elementInfo = await webContents.executeJavaScript(`
        (function() {
          const el = document.querySelector('${target.replace(/'/g, "\\'")}');
          if (!el) return null;
          const rect = el.getBoundingClientRect();
          return {
            selector: '${target.replace(/'/g, "\\'")}',
            tagName: el.tagName.toLowerCase(),
            role: el.getAttribute('role') || '',
            text: (el.textContent || '').trim().slice(0, 100),
            ariaLabel: el.getAttribute('aria-label') || '',
            boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
            isVisible: rect.width > 0 && rect.height > 0,
            isInteractive: true,
            confidence: 1,
            attributes: {}
          };
        })()
      `)

      if (elementInfo) {
        element = elementInfo
        action = createSemanticAction(elementInfo, options.taskIntent || `click ${target}`)
      }
    }

    // 3. Check adversarial patterns if element found
    if (element !== null && checkAdversarial) {
      const adversarialCheck = await checkAdversarialPatterns(webContents, element)
      if (adversarialCheck.recommendation === 'warn') {
        warnings.push(`Adversarial warning: ${adversarialCheck.flags.join(', ')}`)
      }
    }

    // 4. Capture pre-state for verification
    let preState: PageState | null = null
    if (verify) {
      preState = await capturePageState(webContents)
    }

    // 5. Generate fallbacks
    const fallbacks = element !== null ? await generateFallbacks(webContents, element) : []

    // 6. Execute click with fallbacks
    const clickResult = await executeClickWithFallbacks(webContents, target, fallbacks)

    // 7. Verify if requested
    let verification: GroundedClickResult['verification']
    if (verify && preState && action) {
      await new Promise((r) => setTimeout(r, 500)) // Wait for state to settle

      const postState = await capturePageState(webContents)
      const postconditions = inferPostconditions(action)

      const verifyResult = await verifyPostconditions(
        webContents,
        { conditions: postconditions },
        preState,
        postState
      )

      // Also check temporal consistency
      const temporalCheck = await validateStateTransition(webContents, action, preState, postState)

      if (!temporalCheck.valid && temporalCheck.reason) {
        warnings.push(`Temporal: ${temporalCheck.reason}`)
      }

      verification = {
        passed: verifyResult.allPassed,
        stateChanged: preState.url !== postState.url || verifyResult.results.length > 0,
        failures: verifyResult.failures.map(
          (f) => `${f.condition.type}: ${f.error || 'not met'}`
        )
      }
    }

    return {
      success: clickResult.success,
      clicked: clickResult.success,
      method: clickResult.usedFallback ? 'fallback' : 'primary',
      selector: clickResult.selector || target,
      usedFallback: clickResult.usedFallback,
      confidence: selectorConfidence.score,
      warnings,
      verification,
      error: clickResult.error
    }
  } catch (error) {
    return {
      success: false,
      clicked: false,
      method: 'primary',
      confidence: 0,
      warnings,
      error: String(error)
    }
  }
}

// ── Grounded Type ───────────────────────────────────────────────────────────

export interface GroundedTypeResult {
  success: boolean
  typed: boolean
  selector?: string
  usedFallback?: string
  confidence: number
  warnings: string[]
  verification?: {
    passed: boolean
    valueSet: boolean
  }
  error?: string
}

export async function groundedType(
  webContents: WebContents,
  text: string,
  selector?: string,
  options: {
    submit?: boolean
    verify?: boolean
  } = {}
): Promise<GroundedTypeResult> {
  const { submit = false, verify = true } = options
  const warnings: string[] = []

  try {
    // 1. Find target input
    const targetSelector =
      selector ||
      'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([disabled]), textarea'

    // 2. Get element info
    const elementInfo = await webContents.executeJavaScript(`
      (function() {
        const el = document.querySelector('${targetSelector.replace(/'/g, "\\'")}');
        if (!el) return null;
        const rect = el.getBoundingClientRect();
        return {
          selector: '${targetSelector.replace(/'/g, "\\'")}',
          tagName: el.tagName.toLowerCase(),
          role: 'textbox',
          text: '',
          ariaLabel: el.getAttribute('aria-label') || el.getAttribute('placeholder') || '',
          boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
          isVisible: rect.width > 0 && rect.height > 0,
          isInteractive: true,
          confidence: 1,
          attributes: { type: el.type || 'text' }
        };
      })()
    `)

    if (!elementInfo) {
      return {
        success: false,
        typed: false,
        confidence: 0,
        warnings: ['No input element found'],
        error: 'No input element found'
      }
    }

    // 3. Generate fallbacks
    const element = elementInfo as ElementCandidate
    const fallbacks = await generateFallbacks(webContents, element)

    // 4. Capture pre-state
    let preValue = ''
    if (verify) {
      preValue = await webContents.executeJavaScript(`
        (document.querySelector('${targetSelector.replace(/'/g, "\\'")}') || {}).value || ''
      `)
    }

    // 5. Execute type with fallbacks
    const typeResult = await executeTypeWithFallbacks(
      webContents,
      targetSelector,
      text,
      fallbacks
    )

    // 6. Submit if requested
    if (submit && typeResult.success) {
      await webContents.executeJavaScript(`
        (function() {
          const el = document.querySelector('${targetSelector.replace(/'/g, "\\'")}');
          if (el) {
            el.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', code: 'Enter', bubbles: true }));
          }
        })()
      `)
    }

    // 7. Verify
    let verification: GroundedTypeResult['verification']
    if (verify) {
      await new Promise((r) => setTimeout(r, 200))

      const postValue = await webContents.executeJavaScript(`
        (document.querySelector('${targetSelector.replace(/'/g, "\\'")}') || {}).value || ''
      `)

      verification = {
        passed: postValue === text,
        valueSet: postValue !== preValue
      }
    }

    return {
      success: typeResult.success,
      typed: typeResult.success,
      selector: typeResult.selector || targetSelector,
      usedFallback: typeResult.usedFallback,
      confidence: 0.8, // Reasonable confidence for form inputs
      warnings,
      verification,
      error: typeResult.error
    }
  } catch (error) {
    return {
      success: false,
      typed: false,
      confidence: 0,
      warnings,
      error: String(error)
    }
  }
}

// ── Format Results for Agent ────────────────────────────────────────────────

export function formatPageContentForAgent(result: GroundedPageContentResult): string {
  if (!result.success) {
    return JSON.stringify({ success: false, error: result.error })
  }

  const elements = result.elements.map((el) => {
    const entry: Record<string, unknown> = {
      tag: el.tagName,
      text: el.text?.slice(0, 120) || el.ariaLabel?.slice(0, 120),
      selector: el.selector,
      role: el.role,
      confidence: el.confidence.toFixed(2)
    }
    // Include key aria attributes when present
    const ariaLabel = el.attributes?.['aria-label']
    const ariaExpanded = el.attributes?.['aria-expanded']
    const ariaChecked = el.attributes?.['aria-checked']
    const testId = el.attributes?.['data-testid']
    if (ariaLabel) entry.ariaLabel = ariaLabel
    if (ariaExpanded) entry.ariaExpanded = ariaExpanded
    if (ariaChecked) entry.ariaChecked = ariaChecked
    if (testId) entry.testId = testId
    return entry
  })

  const output: Record<string, unknown> = {
    url: result.url,
    title: result.title,
    bodyText: result.bodyText.slice(0, 6000),
    elements,
    pageInfo: {
      hasForm: result.pageInfo.hasForm,
      hasSearch: result.pageInfo.hasSearch,
      hasModal: result.pageInfo.hasModal,
      buttonCount: result.pageInfo.buttonCount,
      linkCount: result.pageInfo.linkCount,
      inputCount: result.pageInfo.inputCount
    }
  }

  if (result.hasPopup) {
    output.warning = 'Popup/modal detected on page'
    if (result.dismissButton) {
      output.dismissPopup = result.dismissButton
    }
  }

  return JSON.stringify(output)
}

export function formatClickResultForAgent(result: GroundedClickResult): string {
  const output: Record<string, unknown> = {
    success: result.success,
    clicked: result.clicked,
    method: result.method
  }

  if (result.usedFallback) {
    output.usedFallback = result.usedFallback
  }

  if (result.warnings.length > 0) {
    output.warnings = result.warnings
  }

  if (result.verification) {
    output.verification = result.verification
  }

  if (result.error) {
    output.error = result.error
  }

  return JSON.stringify(output)
}

export function formatTypeResultForAgent(result: GroundedTypeResult): string {
  const output: Record<string, unknown> = {
    success: result.success,
    typed: result.typed
  }

  if (result.usedFallback) {
    output.usedFallback = result.usedFallback
  }

  if (result.warnings.length > 0) {
    output.warnings = result.warnings
  }

  if (result.verification) {
    output.verification = result.verification
  }

  if (result.error) {
    output.error = result.error
  }

  return JSON.stringify(output)
}
