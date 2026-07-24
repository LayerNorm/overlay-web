/**
 * Grounding Layer
 * Central module for browser agent grounding improvements
 *
 * This module provides multi-layered grounding for reliable browser automation:
 * - Verification: Postcondition checking after actions
 * - DOM Pruning: Task-aware element filtering
 * - Temporal Consistency: State transition validation
 * - Adversarial Awareness: Popup and overlay detection
 * - Deterministic Fallback: Robust selector generation
 * - Action Ontology: Semantic action classification
 * - Confidence Estimation: Multi-factor confidence scoring
 */

// ── Type Exports ────────────────────────────────────────────────────────────

export type {
  ElementCandidate,
  BoundingBox,
  SemanticAction,
  SemanticActionType,
  ActionValidation,
  Condition,
  ConditionType,
  PageState,
  StateTransition,
  DOMChange,
  VerificationResult,
  ActionResult,
  ConfidenceFactor,
  ConfidenceEstimate,
  AdversarialFlag,
  AdversarialCheck,
  DOMPruningConfig,
  PrunedDOM,
  StateTransitionRule,
  ExpectedChange,
  TransitionValidation,
  FallbackType,
  DeterministicFallback,
  FallbackChain,
  GroundingResult
} from './types'

export { CONFIDENCE_THRESHOLDS } from './types'

// ── Verification Exports ────────────────────────────────────────────────────

export {
  capturePageState,
  detectDOMMutations,
  verifyPostconditions,
  executeWithVerification,
  inferPostconditions,
  waitForCondition,
  type VerificationConfig
} from './verification'

// ── DOM Pruning Exports ─────────────────────────────────────────────────────

export {
  pruneDOMForTask,
  quickDOMScan,
  findElementsByIntent,
  findBestMatch,
  type QuickScanResult
} from './dom-pruner'

// ── Temporal Consistency Exports ────────────────────────────────────────────

export {
  COMMON_TRANSITION_RULES,
  findApplicableRules,
  validateStateTransition,
  validateActionTransition,
  createTransitionRule
} from './temporal-consistency'

// ── Adversarial Filter Exports ──────────────────────────────────────────────

export {
  checkAdversarialPatterns,
  filterAdversarialElements,
  getPageOverlays,
  hasActivePopup,
  findDismissButton,
  isElementTaskRelevant,
  type PageOverlay
} from './adversarial-filter'

// ── Deterministic Fallback Exports ──────────────────────────────────────────

export {
  generateXPathFallback,
  generateStrictCSSFallback,
  generateTextFallback,
  generateAriaFallback,
  generateFallbacks,
  executeClickWithFallbacks,
  executeTypeWithFallbacks,
  executeActionWithFallbacks,
  type FallbackExecutionResult
} from './deterministic-fallback'

// ── Action Ontology Exports ─────────────────────────────────────────────────

export {
  classifyElement,
  generateSemanticLabel,
  createSemanticAction,
  parseIntent,
  findElementForIntent,
  validateActionPrerequisites
} from './action-ontology'

// ── Confidence Exports ──────────────────────────────────────────────────────

export {
  estimateActionConfidence,
  quickConfidenceCheck,
  decideAction,
  logConfidence,
  type ConfidenceConfig,
  type ActionDecision
} from './confidence'

// ── Grounded Action Execution ───────────────────────────────────────────────

import type { WebContents } from 'electron'
import type { SemanticAction, GroundingResult, ActionResult } from './types'
import { pruneDOMForTask } from './dom-pruner'
import { findElementForIntent } from './action-ontology'
import { checkAdversarialPatterns } from './adversarial-filter'
import { generateFallbacks } from './deterministic-fallback'
import { estimateActionConfidence, logConfidence } from './confidence'
import { executeWithVerification, inferPostconditions, capturePageState } from './verification'
import { validateStateTransition } from './temporal-consistency'

/**
 * Ground an intent to a verified action with full pipeline
 */
export async function groundIntent(
  webContents: WebContents,
  intent: string,
  options: {
    maxCandidates?: number
    logConfidence?: boolean
  } = {}
): Promise<GroundingResult | null> {
  const { maxCandidates = 10, logConfidence: shouldLog = true } = options
  const warnings: string[] = []

  // 1. Prune DOM for task-relevant elements
  const prunedDOM = await pruneDOMForTask(webContents, {
    taskIntent: intent,
    maxElements: maxCandidates
  })

  if (prunedDOM.elements.length === 0) {
    console.log('[Grounding] No elements found for intent:', intent)
    return null
  }

  // 2. Find best element for intent
  const match = await findElementForIntent(webContents, intent, prunedDOM.elements)

  if (!match) {
    console.log('[Grounding] No matching element for intent:', intent)
    return null
  }

  const { element, action } = match

  // 3. Check for adversarial patterns (warn and proceed)
  const adversarialCheck = await checkAdversarialPatterns(webContents, element, intent)

  if (adversarialCheck.recommendation === 'warn') {
    warnings.push(`Adversarial warning: ${adversarialCheck.reason}`)
    console.log('[Grounding] ⚠️ Adversarial warning:', adversarialCheck.flags.join(', '))
  }

  // 4. Generate fallback selectors
  const fallbacks = await generateFallbacks(webContents, element)

  // 5. Estimate confidence
  const confidence = await estimateActionConfidence(webContents, action, prunedDOM.elements)

  if (shouldLog) {
    logConfidence(confidence, `${action.type}: ${action.target.semanticLabel}`)
  }

  // Add warnings for low confidence
  if (confidence.overall < 0.5) {
    warnings.push(`Low confidence: ${(confidence.overall * 100).toFixed(0)}%`)
  }

  return {
    action,
    confidence,
    adversarialCheck,
    fallbacks,
    warnings
  }
}

/**
 * Execute a grounded action with full verification pipeline
 */
export async function executeGroundedAction(
  webContents: WebContents,
  groundingResult: GroundingResult,
  executeAction: (selector: string) => Promise<{ success: boolean; error?: string }>
): Promise<ActionResult> {
  const { action, fallbacks } = groundingResult
  const startTime = Date.now()

  // Capture pre-state
  const preState = await capturePageState(webContents)

  // Build verification config from inferred postconditions
  const postconditions = inferPostconditions(action)

  // Execute with verification
  const result = await executeWithVerification(
    webContents,
    action,
    async () => {
      // Try primary selector first
      const primaryResult = await executeAction(action.target.selectors[0])
      if (primaryResult.success) return primaryResult

      // Try fallbacks
      for (const fallback of fallbacks) {
        const fallbackResult = await executeAction(fallback.selector)
        if (fallbackResult.success) {
          return { success: true, usedFallback: fallback.type }
        }
      }

      return { success: false, error: 'All selectors failed' }
    },
    {
      conditions: postconditions,
      timeout: 5000,
      retryDelay: 500
    }
  )

  // Validate temporal consistency
  if (result.stateTransition) {
    const temporalValidation = await validateStateTransition(
      webContents,
      action,
      preState,
      result.stateTransition.post
    )

    if (!temporalValidation.valid) {
      console.log('[Grounding] ⚠️ Temporal consistency warning:', temporalValidation.reason)

      // Add suggestion if available
      if (temporalValidation.suggestion) {
        result.error = result.error
          ? `${result.error}. ${temporalValidation.suggestion}`
          : temporalValidation.suggestion
      }
    }
  }

  return {
    ...result,
    duration: Date.now() - startTime
  }
}

/**
 * Quick grounding for simple actions (lower overhead)
 */
export async function quickGround(
  _webContents: WebContents, // Reserved for future element validation
  selector: string,
  actionType: SemanticAction['type'] = 'click_button'
): Promise<SemanticAction> {
  // Create minimal semantic action from selector
  return {
    type: actionType,
    intent: `Interact with ${selector}`,
    target: {
      role: 'element',
      semanticLabel: selector,
      confidence: 0.5,
      selectors: [selector]
    }
  }
}
