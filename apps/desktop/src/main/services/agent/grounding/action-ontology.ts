/**
 * Action Ontology Module
 * Maps DOM elements to semantic action types for structured action abstractions
 */

import type { WebContents } from 'electron'
import type { ElementCandidate, SemanticAction, SemanticActionType } from './types'
import { inferPostconditions } from './verification'

// ── Element Classification Rules ────────────────────────────────────────────

interface ClassificationRule {
  actionType: SemanticActionType
  tagPatterns: string[]
  rolePatterns: string[]
  textPatterns: RegExp[]
  attributePatterns: Record<string, RegExp>[]
  priority: number
}

const CLASSIFICATION_RULES: ClassificationRule[] = [
  {
    actionType: 'submit_form',
    tagPatterns: ['button[type="submit"]', 'input[type="submit"]'],
    rolePatterns: ['button'],
    textPatterns: [/submit|send|save|confirm|continue|next|proceed/i],
    attributePatterns: [{ type: /submit/i }],
    priority: 10
  },
  {
    actionType: 'navigate_link',
    tagPatterns: ['a[href]'],
    rolePatterns: ['link'],
    textPatterns: [/go to|visit|open|view|see more|read more|learn more/i],
    attributePatterns: [{ href: /.+/ }],
    priority: 8
  },
  {
    actionType: 'input_text',
    tagPatterns: ['input[type="text"]', 'input[type="email"]', 'input[type="password"]', 'textarea'],
    rolePatterns: ['textbox', 'searchbox'],
    textPatterns: [],
    attributePatterns: [{ type: /text|email|password|search|tel|url/i }],
    priority: 9
  },
  {
    actionType: 'toggle_control',
    tagPatterns: ['input[type="checkbox"]', 'input[type="radio"]'],
    rolePatterns: ['checkbox', 'radio', 'switch'],
    textPatterns: [/toggle|enable|disable|turn on|turn off/i],
    attributePatterns: [{ type: /checkbox|radio/i }],
    priority: 7
  },
  {
    actionType: 'select_option',
    tagPatterns: ['select', 'option'],
    rolePatterns: ['listbox', 'combobox', 'option'],
    textPatterns: [/select|choose|pick/i],
    attributePatterns: [],
    priority: 7
  },
  {
    actionType: 'open_menu',
    tagPatterns: ['button[aria-haspopup]', '[aria-expanded]'],
    rolePatterns: ['menu', 'menubutton'],
    textPatterns: [/menu|more|options|settings|\.\.\./i],
    attributePatterns: [{ 'aria-haspopup': /true|menu/i }],
    priority: 6
  },
  {
    actionType: 'close_modal',
    tagPatterns: ['button[aria-label*="close"]', '[class*="close"]'],
    rolePatterns: ['button'],
    textPatterns: [/close|dismiss|cancel|×|✕|x/i],
    attributePatterns: [{ 'aria-label': /close|dismiss/i }],
    priority: 8
  },
  {
    actionType: 'scroll_to_section',
    tagPatterns: ['a[href^="#"]'],
    rolePatterns: ['link'],
    textPatterns: [/scroll|jump to|go to section/i],
    attributePatterns: [{ href: /^#/ }],
    priority: 5
  },
  {
    actionType: 'click_button',
    tagPatterns: ['button', '[role="button"]'],
    rolePatterns: ['button'],
    textPatterns: [/click|tap|press|add|remove|delete|edit|update|create/i],
    attributePatterns: [],
    priority: 5
  },
  {
    actionType: 'hover_element',
    tagPatterns: ['[data-tooltip]', '[title]'],
    rolePatterns: [],
    textPatterns: [/hover|tooltip/i],
    attributePatterns: [{ 'data-tooltip': /.+/ }, { title: /.+/ }],
    priority: 3
  }
]

// ── Element Classification ──────────────────────────────────────────────────

function matchesPattern(element: ElementCandidate, rule: ClassificationRule): number {
  let score = 0

  // Check tag patterns
  for (const pattern of rule.tagPatterns) {
    const tagMatch = pattern.split('[')[0]
    if (element.tagName === tagMatch || element.selector.includes(pattern)) {
      score += 0.3
      break
    }
  }

  // Check role patterns
  if (element.role && rule.rolePatterns.includes(element.role)) {
    score += 0.25
  }

  // Check text patterns
  const elementText = [element.text, element.ariaLabel, element.placeholder]
    .filter(Boolean)
    .join(' ')
  for (const pattern of rule.textPatterns) {
    if (pattern.test(elementText)) {
      score += 0.25
      break
    }
  }

  // Check attribute patterns
  for (const attrPattern of rule.attributePatterns) {
    for (const [attr, regex] of Object.entries(attrPattern)) {
      const attrValue = element.attributes[attr]
      if (attrValue && regex.test(attrValue)) {
        score += 0.2
        break
      }
    }
  }

  return score
}

export function classifyElement(element: ElementCandidate): {
  actionType: SemanticActionType
  confidence: number
} {
  let bestMatch: { actionType: SemanticActionType; score: number } = {
    actionType: 'click_button',
    score: 0
  }

  for (const rule of CLASSIFICATION_RULES) {
    const score = matchesPattern(element, rule)
    const adjustedScore = score * (rule.priority / 10)

    if (adjustedScore > bestMatch.score) {
      bestMatch = { actionType: rule.actionType, score: adjustedScore }
    }
  }

  return {
    actionType: bestMatch.actionType,
    confidence: Math.min(bestMatch.score, 1.0)
  }
}

// ── Semantic Label Generation ───────────────────────────────────────────────

export function generateSemanticLabel(element: ElementCandidate): string {
  // Priority order for label generation
  const candidates = [
    element.ariaLabel,
    element.text?.slice(0, 50),
    element.placeholder,
    element.attributes.title,
    element.attributes.alt,
    element.attributes.name,
    element.attributes.id
  ].filter(Boolean)

  if (candidates.length > 0) {
    return candidates[0] as string
  }

  // Fallback to role + tag
  return `${element.role || element.tagName} element`
}

// ── Create Semantic Action from Element ─────────────────────────────────────

export function createSemanticAction(
  element: ElementCandidate,
  intent: string,
  params?: Record<string, unknown>
): SemanticAction {
  const { actionType, confidence } = classifyElement(element)
  const semanticLabel = generateSemanticLabel(element)

  const action: SemanticAction = {
    type: actionType,
    intent,
    target: {
      role: element.role || element.tagName,
      semanticLabel,
      confidence,
      selectors: [element.selector],
      element
    },
    params
  }

  // Infer validation rules
  const postconditions = inferPostconditions(action)
  if (postconditions.length > 0) {
    action.validation = {
      preconditions: [],
      postconditions
    }
  }

  return action
}

// ── Intent to Action Mapping ────────────────────────────────────────────────

interface IntentPattern {
  pattern: RegExp
  actionType: SemanticActionType
  extractParams?: (match: RegExpMatchArray) => Record<string, unknown>
}

const INTENT_PATTERNS: IntentPattern[] = [
  {
    pattern: /click\s+(?:on\s+)?(?:the\s+)?["']?(.+?)["']?\s*(?:button|link)?/i,
    actionType: 'click_button',
    extractParams: (match) => ({ targetText: match[1] })
  },
  {
    pattern: /type\s+["'](.+?)["']\s+(?:in|into)\s+(?:the\s+)?(.+)/i,
    actionType: 'input_text',
    extractParams: (match) => ({ text: match[1], targetField: match[2] })
  },
  {
    pattern: /enter\s+["']?(.+?)["']?\s+(?:in|into)\s+(?:the\s+)?(.+)/i,
    actionType: 'input_text',
    extractParams: (match) => ({ text: match[1], targetField: match[2] })
  },
  {
    pattern: /search\s+(?:for\s+)?["']?(.+?)["']?/i,
    actionType: 'input_text',
    extractParams: (match) => ({ text: match[1], isSearch: true })
  },
  {
    pattern: /navigate\s+to\s+(.+)/i,
    actionType: 'navigate_link',
    extractParams: (match) => ({ destination: match[1] })
  },
  {
    pattern: /go\s+to\s+(.+)/i,
    actionType: 'navigate_link',
    extractParams: (match) => ({ destination: match[1] })
  },
  {
    pattern: /select\s+["']?(.+?)["']?\s+(?:from|in)\s+(?:the\s+)?(.+)/i,
    actionType: 'select_option',
    extractParams: (match) => ({ option: match[1], dropdown: match[2] })
  },
  {
    pattern: /check\s+(?:the\s+)?(.+)\s+checkbox/i,
    actionType: 'toggle_control',
    extractParams: (match) => ({ target: match[1], checked: true })
  },
  {
    pattern: /uncheck\s+(?:the\s+)?(.+)\s+checkbox/i,
    actionType: 'toggle_control',
    extractParams: (match) => ({ target: match[1], checked: false })
  },
  {
    pattern: /close\s+(?:the\s+)?(?:modal|popup|dialog|overlay)/i,
    actionType: 'close_modal'
  },
  {
    pattern: /submit\s+(?:the\s+)?(?:form)?/i,
    actionType: 'submit_form'
  },
  {
    pattern: /scroll\s+(?:down|up|to)/i,
    actionType: 'scroll_to_section'
  }
]

export function parseIntent(intent: string): {
  actionType: SemanticActionType
  params: Record<string, unknown>
  confidence: number
} {
  for (const { pattern, actionType, extractParams } of INTENT_PATTERNS) {
    const match = intent.match(pattern)
    if (match) {
      return {
        actionType,
        params: extractParams ? extractParams(match) : {},
        confidence: 0.8
      }
    }
  }

  // Default fallback
  return {
    actionType: 'click_button',
    params: { rawIntent: intent },
    confidence: 0.3
  }
}

// ── Find Best Element for Intent ────────────────────────────────────────────

export async function findElementForIntent(
  _webContents: WebContents, // Reserved for future DOM queries
  intent: string,
  candidates: ElementCandidate[]
): Promise<{ element: ElementCandidate; action: SemanticAction } | null> {
  if (candidates.length === 0) return null

  const { actionType, params } = parseIntent(intent)

  // Score each candidate based on intent match
  const scored = candidates.map((element) => {
    const { actionType: elemType, confidence: typeConfidence } = classifyElement(element)
    const elementText = [element.text, element.ariaLabel].filter(Boolean).join(' ').toLowerCase()
    const intentLower = intent.toLowerCase()

    let score = element.confidence

    // Boost if action types match
    if (elemType === actionType) {
      score += 0.3
    }

    // Boost if text matches intent keywords
    const intentWords = intentLower.split(/\s+/).filter((w) => w.length > 2)
    for (const word of intentWords) {
      if (elementText.includes(word)) {
        score += 0.15
      }
    }

    // Boost if element is interactive and visible
    if (element.isInteractive) score += 0.1
    if (element.isVisible) score += 0.1

    return { element, score: Math.min(score, 1.0), typeConfidence }
  })

  // Sort by score
  scored.sort((a, b) => b.score - a.score)

  const best = scored[0]
  if (best.score < 0.3) return null

  const action = createSemanticAction(best.element, intent, params)
  action.type = actionType // Override with parsed intent type

  return { element: best.element, action }
}

// ── Action Validation ───────────────────────────────────────────────────────

export function validateActionPrerequisites(
  action: SemanticAction,
  pageState: { hasForm: boolean; hasModal: boolean; url: string }
): { valid: boolean; reason?: string } {
  switch (action.type) {
    case 'submit_form':
      if (!pageState.hasForm) {
        return { valid: false, reason: 'No form found on page' }
      }
      break

    case 'close_modal':
      if (!pageState.hasModal) {
        return { valid: false, reason: 'No modal/dialog found on page' }
      }
      break

    case 'input_text':
      if (!action.params?.text && !action.params?.targetField) {
        return { valid: false, reason: 'No text or target field specified' }
      }
      break
  }

  return { valid: true }
}
