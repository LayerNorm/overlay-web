/**
 * Grounding Layer Types
 * Core type definitions for browser agent grounding improvements
 */

// ── Element & Action Types ──────────────────────────────────────────────────

export interface ElementCandidate {
  selector: string
  tagName: string
  role?: string
  text?: string
  ariaLabel?: string
  placeholder?: string
  boundingBox?: BoundingBox
  isVisible: boolean
  isInteractive: boolean
  confidence: number
  attributes: Record<string, string>
}

export interface BoundingBox {
  x: number
  y: number
  width: number
  height: number
}

export type SemanticActionType =
  | 'submit_form'
  | 'navigate_link'
  | 'input_text'
  | 'toggle_control'
  | 'select_option'
  | 'open_menu'
  | 'close_modal'
  | 'scroll_to_section'
  | 'click_button'
  | 'hover_element'

export interface SemanticAction {
  type: SemanticActionType
  intent: string
  target: {
    role: string
    semanticLabel: string
    confidence: number
    selectors: string[]
    element?: ElementCandidate
  }
  params?: Record<string, unknown>
  validation?: ActionValidation
}

export interface ActionValidation {
  preconditions: Condition[]
  postconditions: Condition[]
}

// ── Verification Types ──────────────────────────────────────────────────────

export type ConditionType =
  | 'url_changed'
  | 'url_contains'
  | 'element_visible'
  | 'element_hidden'
  | 'element_exists'
  | 'text_contains'
  | 'text_not_contains'
  | 'dom_mutation'
  | 'attribute_changed'
  | 'count_changed'

export interface Condition {
  type: ConditionType
  selector?: string
  pattern?: string | RegExp
  expected?: unknown
  timeout?: number
}

export interface PageState {
  url: string
  title: string
  timestamp: number
  elementCounts: Record<string, number>
  visibleText: string
  formValues: Record<string, string>
  scrollPosition: { x: number; y: number }
  interactiveElements: ElementCandidate[]
}

export interface StateTransition {
  pre: PageState
  post: PageState
  duration: number
  mutations: DOMChange[]
}

export interface DOMChange {
  type: 'added' | 'removed' | 'modified'
  selector: string
  details?: string
}

export interface VerificationResult {
  passed: boolean
  condition: Condition
  actual?: unknown
  expected?: unknown
  error?: string
}

export interface ActionResult {
  success: boolean
  action: SemanticAction
  stateTransition?: StateTransition
  verificationResults?: VerificationResult[]
  failedConditions?: VerificationResult[]
  usedFallback?: string
  error?: string
  duration: number
}

// ── Confidence Types ────────────────────────────────────────────────────────

export interface ConfidenceFactor {
  name: string
  score: number
  weight: number
  reason?: string
}

export interface ConfidenceEstimate {
  overall: number
  factors: ConfidenceFactor[]
  recommendation: 'proceed' | 'verify' | 'ask_user' | 'explore_first'
}

// Balanced threshold as per user preference
export const CONFIDENCE_THRESHOLDS = {
  PROCEED: 0.7,
  VERIFY: 0.5,
  EXPLORE: 0.3
} as const

// ── Adversarial Types ───────────────────────────────────────────────────────

export type AdversarialFlag =
  | 'high_z_index_overlay'
  | 'recently_appeared'
  | 'covers_primary_content'
  | 'suspicious_position'
  | 'common_popup_pattern'
  | 'injected_element'
  | 'misleading_text'

export interface AdversarialCheck {
  element: ElementCandidate
  flags: AdversarialFlag[]
  riskScore: number
  recommendation: 'allow' | 'warn' | 'block'
  reason?: string
}

// ── DOM Pruning Types ───────────────────────────────────────────────────────

export interface DOMPruningConfig {
  taskIntent: string
  maxElements: number
  prioritySelectors?: string[]
  excludeSelectors?: string[]
  includeHidden?: boolean
}

export interface PrunedDOM {
  elements: ElementCandidate[]
  totalFound: number
  pruningStrategy: string
  relevanceScores: Map<string, number>
}

// ── Temporal Consistency Types ──────────────────────────────────────────────

export interface StateTransitionRule {
  id: string
  trigger: {
    actionType?: SemanticActionType
    targetPattern?: RegExp
    textPattern?: RegExp
  }
  expectedChanges: ExpectedChange[]
  timeout: number
}

export interface ExpectedChange {
  type: 'url' | 'dom_element' | 'page_text' | 'element_count' | 'form_value'
  expectation: 'changed' | 'contains' | 'removed' | 'added' | 'increased' | 'decreased'
  selector?: string
  pattern?: string | RegExp
}

export interface TransitionValidation {
  valid: boolean
  rule?: StateTransitionRule
  reason?: string
  suggestion?: string
}

// ── Fallback Types ──────────────────────────────────────────────────────────

export type FallbackType = 'xpath' | 'css_strict' | 'text_content' | 'aria'

export interface DeterministicFallback {
  type: FallbackType
  selector: string
  confidence: number
}

export interface FallbackChain {
  primary: SemanticAction
  fallbacks: DeterministicFallback[]
}

// ── Grounding Result ────────────────────────────────────────────────────────

export interface GroundingResult {
  action: SemanticAction
  confidence: ConfidenceEstimate
  adversarialCheck?: AdversarialCheck
  fallbacks: DeterministicFallback[]
  warnings: string[]
}
