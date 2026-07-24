/**
 * DOM Pruning Module
 * Task-aware filtering of DOM elements to reduce attention dilution
 */

import type { WebContents } from 'electron'
import type { ElementCandidate, DOMPruningConfig, PrunedDOM } from './types'

// ── Element Extraction JavaScript ───────────────────────────────────────────

const JS_EXTRACT_ALL_ELEMENTS = `
(function(config) {
  const elements = [];
  const seen = new Set();
  
  // Priority selectors for interactive elements
  const interactiveSelectors = [
    'button', 'a[href]', 'input', 'select', 'textarea',
    '[role="button"]', '[role="link"]', '[role="menuitem"]',
    '[role="tab"]', '[role="checkbox"]', '[role="radio"]',
    '[onclick]', '[tabindex]:not([tabindex="-1"])'
  ];
  
  // Landmark selectors for structural context
  const landmarkSelectors = [
    'header', 'nav', 'main', 'aside', 'footer',
    '[role="banner"]', '[role="navigation"]', '[role="main"]',
    '[role="complementary"]', '[role="contentinfo"]',
    '[role="search"]', '[role="form"]'
  ];
  
  function getElementInfo(el, index) {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    
    // Skip hidden elements unless explicitly included
    const isVisible = rect.width > 0 && rect.height > 0 &&
                      style.visibility !== 'hidden' &&
                      style.display !== 'none' &&
                      style.opacity !== '0';
    
    if (!isVisible && !config.includeHidden) return null;
    
    // Generate stable selector: id > data-testid > data-cy > aria-label > tag+class
    let selector = '';
    if (el.id) {
      selector = '#' + CSS.escape(el.id);
    } else if (el.dataset.testid) {
      selector = '[data-testid="' + el.dataset.testid + '"]';
    } else if (el.dataset.cy) {
      selector = '[data-cy="' + el.dataset.cy + '"]';
    } else {
      const tag = el.tagName.toLowerCase();
      const ariaLbl = el.getAttribute('aria-label') || '';
      // Use aria-label as selector for interactive elements when it's concise
      if (ariaLbl && ariaLbl.length > 2 && ariaLbl.length < 60 &&
          el.matches('button, a, input, [role="button"], [role="link"]')) {
        selector = tag + '[aria-label="' + ariaLbl.replace(/"/g, '\\"') + '"]';
      } else {
        const classes = Array.from(el.classList).slice(0, 2).map(c => '.' + CSS.escape(c)).join('');
        selector = tag + classes;

        // Add nth-child if needed for uniqueness
        if (document.querySelectorAll(selector).length > 1) {
          const parent = el.parentElement;
          if (parent) {
            const siblings = Array.from(parent.children);
            const idx = siblings.indexOf(el) + 1;
            selector = tag + classes + ':nth-child(' + idx + ')';
          }
        }
      }
    }
    
    // Skip if we've seen this selector
    if (seen.has(selector)) return null;
    seen.add(selector);
    
    // Extract text content
    const textContent = (el.textContent || '').trim().slice(0, 200);
    const ariaLabel = el.getAttribute('aria-label') || '';
    const ariaDescribedBy = el.getAttribute('aria-describedby') || '';
    const ariaExpanded = el.getAttribute('aria-expanded') || '';
    const ariaSelected = el.getAttribute('aria-selected') || '';
    const ariaChecked = el.getAttribute('aria-checked') || '';
    const ariaDisabled = el.getAttribute('aria-disabled') || '';
    const placeholder = el.getAttribute('placeholder') || '';
    const title = el.getAttribute('title') || '';
    const alt = el.getAttribute('alt') || '';
    
    // Determine role
    const role = el.getAttribute('role') || 
                 (el.tagName === 'BUTTON' ? 'button' : 
                  el.tagName === 'A' ? 'link' :
                  el.tagName === 'INPUT' ? 'input' : '');
    
    return {
      selector,
      tagName: el.tagName.toLowerCase(),
      role,
      text: textContent,
      ariaLabel: ariaLabel || placeholder || title || alt,
      placeholder,
      boundingBox: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      isVisible,
      isInteractive: el.matches(interactiveSelectors.join(',')),
      confidence: 1.0,
      attributes: {
        id: el.id || '',
        class: el.className || '',
        type: el.getAttribute('type') || '',
        name: el.getAttribute('name') || '',
        href: el.getAttribute('href') || '',
        value: el.value || '',
        'data-testid': el.dataset.testid || '',
        'data-cy': el.dataset.cy || '',
        'aria-label': ariaLabel,
        'aria-describedby': ariaDescribedBy,
        'aria-expanded': ariaExpanded,
        'aria-selected': ariaSelected,
        'aria-checked': ariaChecked,
        'aria-disabled': ariaDisabled
      }
    };
  }
  
  // First pass: collect interactive elements
  interactiveSelectors.forEach(sel => {
    try {
      document.querySelectorAll(sel).forEach((el, i) => {
        if (elements.length >= config.maxElements * 2) return;
        const info = getElementInfo(el, elements.length);
        if (info) elements.push(info);
      });
    } catch (e) {}
  });
  
  // Second pass: collect landmark elements for context
  landmarkSelectors.forEach(sel => {
    try {
      document.querySelectorAll(sel).forEach(el => {
        if (elements.length >= config.maxElements * 2) return;
        const info = getElementInfo(el, elements.length);
        if (info) elements.push(info);
      });
    } catch (e) {}
  });
  
  return {
    elements,
    totalFound: elements.length,
    url: window.location.href,
    title: document.title
  };
})
`

// ── Relevance Scoring ───────────────────────────────────────────────────────

interface ScoringWeights {
  textMatch: number
  roleMatch: number
  visibility: number
  interactivity: number
  position: number
}

const DEFAULT_WEIGHTS: ScoringWeights = {
  textMatch: 0.4,
  roleMatch: 0.2,
  visibility: 0.15,
  interactivity: 0.15,
  position: 0.1
}

function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter((t) => t.length > 1)
}

function calculateTextSimilarity(elementText: string, intentTokens: string[]): number {
  if (!elementText || intentTokens.length === 0) return 0

  const elementTokens = new Set(tokenize(elementText))
  let matches = 0

  for (const token of intentTokens) {
    for (const elToken of elementTokens) {
      if (elToken.includes(token) || token.includes(elToken)) {
        matches++
        break
      }
    }
  }

  return matches / intentTokens.length
}

function inferTargetRole(intent: string): string[] {
  const intentLower = intent.toLowerCase()
  const roles: string[] = []

  if (/click|press|tap|submit|button/i.test(intentLower)) {
    roles.push('button', 'link')
  }
  if (/type|enter|input|fill|search/i.test(intentLower)) {
    roles.push('input', 'textbox', 'searchbox')
  }
  if (/select|choose|pick|dropdown/i.test(intentLower)) {
    roles.push('select', 'listbox', 'combobox')
  }
  if (/check|toggle|enable|disable/i.test(intentLower)) {
    roles.push('checkbox', 'switch')
  }
  if (/navigate|go to|open|link/i.test(intentLower)) {
    roles.push('link', 'navigation')
  }
  if (/menu|dropdown/i.test(intentLower)) {
    roles.push('menu', 'menuitem')
  }

  return roles.length > 0 ? roles : ['button', 'link', 'input']
}

function scoreElement(
  element: ElementCandidate,
  intentTokens: string[],
  targetRoles: string[],
  weights: ScoringWeights = DEFAULT_WEIGHTS
): number {
  let score = 0

  // Text match score
  const allText = [element.text, element.ariaLabel, element.placeholder]
    .filter(Boolean)
    .join(' ')
  const textScore = calculateTextSimilarity(allText, intentTokens)
  score += textScore * weights.textMatch

  // Role match score
  const roleScore = targetRoles.includes(element.role || '') ? 1 : 0.3
  score += roleScore * weights.roleMatch

  // Visibility score
  const visibilityScore = element.isVisible ? 1 : 0.2
  score += visibilityScore * weights.visibility

  // Interactivity score
  const interactivityScore = element.isInteractive ? 1 : 0.3
  score += interactivityScore * weights.interactivity

  // Position score (elements in viewport score higher)
  const inViewport =
    element.boundingBox &&
    element.boundingBox.y >= 0 &&
    element.boundingBox.y < 800 &&
    element.boundingBox.x >= 0 &&
    element.boundingBox.x < 1200
  const positionScore = inViewport ? 1 : 0.5
  score += positionScore * weights.position

  return score
}

// ── Main Pruning Function ───────────────────────────────────────────────────

export async function pruneDOMForTask(
  webContents: WebContents,
  config: DOMPruningConfig
): Promise<PrunedDOM> {
  const { taskIntent, maxElements = 50, prioritySelectors, excludeSelectors } = config

  // 1. Extract all interactive elements
  const extractConfig = {
    maxElements: maxElements * 3,
    includeHidden: config.includeHidden || false,
    prioritySelectors: prioritySelectors || [],
    excludeSelectors: excludeSelectors || []
  }

  let rawResult: { elements: ElementCandidate[]; totalFound: number }
  try {
    rawResult = await webContents.executeJavaScript(
      `${JS_EXTRACT_ALL_ELEMENTS}(${JSON.stringify(extractConfig)})`
    )
  } catch (error) {
    console.error('[DOMPruner] Failed to extract elements:', error)
    return {
      elements: [],
      totalFound: 0,
      pruningStrategy: 'error',
      relevanceScores: new Map()
    }
  }

  // 2. Filter excluded selectors
  let elements = rawResult.elements
  if (excludeSelectors && excludeSelectors.length > 0) {
    elements = elements.filter(
      (el) => !excludeSelectors.some((exc) => el.selector.includes(exc))
    )
  }

  // 3. Score elements based on task intent
  const intentTokens = tokenize(taskIntent)
  const targetRoles = inferTargetRole(taskIntent)
  const relevanceScores = new Map<string, number>()

  for (const element of elements) {
    const score = scoreElement(element, intentTokens, targetRoles)
    relevanceScores.set(element.selector, score)
    element.confidence = score
  }

  // 4. Sort by relevance score
  elements.sort((a, b) => {
    const scoreA = relevanceScores.get(a.selector) || 0
    const scoreB = relevanceScores.get(b.selector) || 0
    return scoreB - scoreA
  })

  // 5. Take top-k elements
  const prunedElements = elements.slice(0, maxElements)

  console.log(
    `[DOMPruner] Pruned ${rawResult.totalFound} → ${prunedElements.length} elements for intent: "${taskIntent.slice(0, 50)}..."`
  )

  return {
    elements: prunedElements,
    totalFound: rawResult.totalFound,
    pruningStrategy: 'task_relevance',
    relevanceScores
  }
}

// ── Quick DOM Scan (lightweight) ────────────────────────────────────────────

const JS_QUICK_SCAN = `
(function() {
  const result = {
    url: window.location.href,
    title: document.title,
    hasForm: document.querySelector('form') !== null,
    hasSearch: document.querySelector('input[type="search"], [role="search"]') !== null,
    hasModal: document.querySelector('[role="dialog"], .modal, [class*="modal"]') !== null,
    hasNav: document.querySelector('nav, [role="navigation"]') !== null,
    buttonCount: document.querySelectorAll('button, [role="button"]').length,
    linkCount: document.querySelectorAll('a[href]').length,
    inputCount: document.querySelectorAll('input, textarea, select').length,
    landmarks: []
  };
  
  // Quick landmark scan
  const landmarks = document.querySelectorAll('header, nav, main, aside, footer, [role="banner"], [role="navigation"], [role="main"]');
  landmarks.forEach(l => {
    result.landmarks.push({
      tag: l.tagName.toLowerCase(),
      role: l.getAttribute('role') || '',
      id: l.id || ''
    });
  });
  
  return result;
})()
`

export interface QuickScanResult {
  url: string
  title: string
  hasForm: boolean
  hasSearch: boolean
  hasModal: boolean
  hasNav: boolean
  buttonCount: number
  linkCount: number
  inputCount: number
  landmarks: Array<{ tag: string; role: string; id: string }>
}

export async function quickDOMScan(webContents: WebContents): Promise<QuickScanResult> {
  try {
    return await webContents.executeJavaScript(JS_QUICK_SCAN)
  } catch (error) {
    console.error('[DOMPruner] Quick scan failed:', error)
    return {
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
    }
  }
}

// ── Find Elements by Intent ─────────────────────────────────────────────────

export async function findElementsByIntent(
  webContents: WebContents,
  intent: string,
  maxResults: number = 5
): Promise<ElementCandidate[]> {
  const result = await pruneDOMForTask(webContents, {
    taskIntent: intent,
    maxElements: maxResults * 2
  })

  // Return top candidates above threshold
  const threshold = 0.3
  return result.elements
    .filter((el) => el.confidence >= threshold)
    .slice(0, maxResults)
}

// ── Find Best Match ─────────────────────────────────────────────────────────

export async function findBestMatch(
  webContents: WebContents,
  intent: string
): Promise<ElementCandidate | null> {
  const candidates = await findElementsByIntent(webContents, intent, 3)

  if (candidates.length === 0) {
    return null
  }

  // Return highest confidence match
  return candidates[0]
}
