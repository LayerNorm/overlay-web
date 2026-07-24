/**
 * Confidence Estimation Module
 * Multi-factor confidence scoring for action execution decisions
 */

import type { WebContents } from 'electron'
import type {
  ElementCandidate,
  ConfidenceEstimate,
  ConfidenceFactor,
  SemanticAction
} from './types'

// Re-export thresholds
export { CONFIDENCE_THRESHOLDS } from './types'

// ── Confidence Factor Calculators ───────────────────────────────────────────

async function calculateSelectorUniqueness(
  webContents: WebContents,
  selector: string
): Promise<number> {
  try {
    const count = await webContents.executeJavaScript(`
      document.querySelectorAll('${selector.replace(/'/g, "\\'")}').length
    `)

    if (count === 1) return 1.0
    if (count === 0) return 0.0
    if (count <= 3) return 0.7
    if (count <= 10) return 0.4
    return 0.2
  } catch {
    return 0.5
  }
}

function calculateCandidateAgreement(candidates: ElementCandidate[]): number {
  if (candidates.length === 0) return 0
  if (candidates.length === 1) return 1.0

  // Check if top candidates have similar scores
  const topScore = candidates[0].confidence
  const secondScore = candidates[1]?.confidence || 0

  // Large gap between top and second = high agreement
  const gap = topScore - secondScore
  if (gap > 0.3) return 0.9
  if (gap > 0.15) return 0.7
  if (gap > 0.05) return 0.5
  return 0.3 // Multiple similar candidates = low agreement
}

function calculateSemanticMatch(action: SemanticAction): number {
  return action.target.confidence
}

function calculateVisibilityScore(element: ElementCandidate): number {
  if (!element.isVisible) return 0.2
  if (!element.boundingBox) return 0.6

  const { width, height, x, y } = element.boundingBox

  // Check if element is reasonably sized
  const hasGoodSize = width >= 20 && height >= 15 && width <= 800 && height <= 400

  // Check if element is in viewport (approximate)
  const inViewport = x >= 0 && y >= 0 && x < 1400 && y < 900

  if (hasGoodSize && inViewport) return 1.0
  if (hasGoodSize || inViewport) return 0.7
  return 0.4
}

function calculateInteractivityScore(element: ElementCandidate): number {
  if (!element.isInteractive) return 0.3

  // Boost for specific interactive roles
  const highConfidenceRoles = ['button', 'link', 'textbox', 'checkbox', 'radio', 'combobox']
  if (element.role && highConfidenceRoles.includes(element.role)) {
    return 1.0
  }

  // Boost for clickable tags
  const clickableTags = ['button', 'a', 'input', 'select', 'textarea']
  if (clickableTags.includes(element.tagName)) {
    return 0.9
  }

  return 0.6
}

function calculateTextClarity(element: ElementCandidate): number {
  const text = element.text || element.ariaLabel || ''

  if (!text) return 0.3

  // Good: Short, clear text
  if (text.length > 2 && text.length <= 30) return 1.0

  // Okay: Medium text
  if (text.length <= 60) return 0.8

  // Less clear: Long text
  if (text.length <= 100) return 0.6

  return 0.4
}

// ── Main Confidence Estimation ──────────────────────────────────────────────

export interface ConfidenceConfig {
  weights?: Partial<Record<string, number>>
  threshold?: number
}

const DEFAULT_WEIGHTS: Record<string, number> = {
  selector_uniqueness: 0.25,
  candidate_agreement: 0.2,
  semantic_match: 0.2,
  visibility: 0.15,
  interactivity: 0.1,
  text_clarity: 0.1
}

export async function estimateActionConfidence(
  webContents: WebContents,
  action: SemanticAction,
  candidates: ElementCandidate[],
  config: ConfidenceConfig = {}
): Promise<ConfidenceEstimate> {
  const weights = { ...DEFAULT_WEIGHTS, ...config.weights }
  const factors: ConfidenceFactor[] = []

  const element = action.target.element || candidates[0]

  // Factor 1: Selector uniqueness
  const selectorUniqueness = await calculateSelectorUniqueness(
    webContents,
    action.target.selectors[0]
  )
  factors.push({
    name: 'selector_uniqueness',
    score: selectorUniqueness,
    weight: weights.selector_uniqueness ?? 0.25,
    reason: selectorUniqueness === 1 ? 'Unique selector' : 'Multiple matches found'
  })

  // Factor 2: Candidate agreement
  const candidateAgreement = calculateCandidateAgreement(candidates)
  factors.push({
    name: 'candidate_agreement',
    score: candidateAgreement,
    weight: weights.candidate_agreement ?? 0.2,
    reason: candidateAgreement > 0.7 ? 'Clear top candidate' : 'Multiple similar candidates'
  })

  // Factor 3: Semantic match
  const semanticMatch = calculateSemanticMatch(action)
  factors.push({
    name: 'semantic_match',
    score: semanticMatch,
    weight: weights.semantic_match ?? 0.2,
    reason: semanticMatch > 0.7 ? 'Strong intent match' : 'Weak intent match'
  })

  // Factor 4: Visibility
  if (element) {
    const visibility = calculateVisibilityScore(element)
    factors.push({
      name: 'visibility',
      score: visibility,
      weight: weights.visibility ?? 0.15,
      reason: visibility > 0.7 ? 'Element clearly visible' : 'Visibility uncertain'
    })

    // Factor 5: Interactivity
    const interactivity = calculateInteractivityScore(element)
    factors.push({
      name: 'interactivity',
      score: interactivity,
      weight: weights.interactivity ?? 0.1,
      reason: interactivity > 0.7 ? 'Clearly interactive' : 'Interactivity uncertain'
    })

    // Factor 6: Text clarity
    const textClarity = calculateTextClarity(element)
    factors.push({
      name: 'text_clarity',
      score: textClarity,
      weight: weights.text_clarity ?? 0.1,
      reason: textClarity > 0.7 ? 'Clear element text' : 'Text unclear or missing'
    })
  }

  // Calculate weighted average
  let totalWeight = 0
  let weightedSum = 0

  for (const factor of factors) {
    weightedSum += factor.score * factor.weight
    totalWeight += factor.weight
  }

  const overall = totalWeight > 0 ? weightedSum / totalWeight : 0

  // Determine recommendation based on balanced threshold (0.7)
  const recommendation = getRecommendation(overall)

  return {
    overall,
    factors,
    recommendation
  }
}

function getRecommendation(confidence: number): ConfidenceEstimate['recommendation'] {
  // Using balanced thresholds as per user preference
  if (confidence >= 0.7) return 'proceed'
  if (confidence >= 0.5) return 'verify'
  if (confidence >= 0.3) return 'explore_first'
  return 'ask_user'
}

// ── Quick Confidence Check ──────────────────────────────────────────────────

export async function quickConfidenceCheck(
  webContents: WebContents,
  selector: string
): Promise<{ confident: boolean; score: number; reason: string }> {
  const uniqueness = await calculateSelectorUniqueness(webContents, selector)

  if (uniqueness === 1.0) {
    return {
      confident: true,
      score: 0.9,
      reason: 'Selector uniquely identifies element'
    }
  }

  if (uniqueness === 0) {
    return {
      confident: false,
      score: 0,
      reason: 'Selector matches no elements'
    }
  }

  if (uniqueness >= 0.7) {
    return {
      confident: true,
      score: 0.7,
      reason: 'Selector matches few elements'
    }
  }

  return {
    confident: false,
    score: uniqueness,
    reason: 'Selector matches multiple elements'
  }
}

// ── Confidence-Based Action Decision ────────────────────────────────────────

export interface ActionDecision {
  action: 'execute' | 'verify_first' | 'explore' | 'ask_user'
  confidence: ConfidenceEstimate
  warnings: string[]
}

export async function decideAction(
  webContents: WebContents,
  action: SemanticAction,
  candidates: ElementCandidate[]
): Promise<ActionDecision> {
  const confidence = await estimateActionConfidence(webContents, action, candidates)
  const warnings: string[] = []

  // Collect warnings from low-scoring factors
  for (const factor of confidence.factors) {
    if (factor.score < 0.5) {
      warnings.push(`Low ${factor.name.replace(/_/g, ' ')}: ${factor.reason}`)
    }
  }

  let actionDecision: ActionDecision['action']

  switch (confidence.recommendation) {
    case 'proceed':
      actionDecision = 'execute'
      break
    case 'verify':
      actionDecision = 'verify_first'
      break
    case 'explore_first':
      actionDecision = 'explore'
      break
    case 'ask_user':
    default:
      actionDecision = 'ask_user'
  }

  return {
    action: actionDecision,
    confidence,
    warnings
  }
}

// ── Confidence Logging ──────────────────────────────────────────────────────

export function logConfidence(estimate: ConfidenceEstimate, actionDescription: string): void {
  const emoji =
    estimate.recommendation === 'proceed'
      ? '✅'
      : estimate.recommendation === 'verify'
        ? '⚠️'
        : estimate.recommendation === 'explore_first'
          ? '🔍'
          : '❓'

  console.log(
    `[Confidence] ${emoji} ${actionDescription}: ${(estimate.overall * 100).toFixed(1)}% (${estimate.recommendation})`
  )

  for (const factor of estimate.factors) {
    const bar = '█'.repeat(Math.round(factor.score * 10)) + '░'.repeat(10 - Math.round(factor.score * 10))
    console.log(`  ${factor.name}: ${bar} ${(factor.score * 100).toFixed(0)}%`)
  }
}
