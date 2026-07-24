/**
 * Deterministic Fallback Module
 * Generates robust selectors (XPath, strict CSS) for reliable action execution
 */

import type { WebContents } from 'electron'
import type { ElementCandidate, DeterministicFallback, FallbackType, SemanticAction } from './types'

// ── Selector Generation JavaScript ──────────────────────────────────────────

const JS_GENERATE_XPATH = `
(function(cssSelector) {
  const el = document.querySelector(cssSelector);
  if (!el) return null;
  
  function getXPath(element) {
    if (element.id) {
      return '//*[@id="' + element.id + '"]';
    }
    
    if (element === document.body) {
      return '/html/body';
    }
    
    let ix = 0;
    const siblings = element.parentNode ? element.parentNode.childNodes : [];
    
    for (let i = 0; i < siblings.length; i++) {
      const sibling = siblings[i];
      if (sibling === element) {
        const parentPath = element.parentNode ? getXPath(element.parentNode) : '';
        const tagName = element.tagName.toLowerCase();
        return parentPath + '/' + tagName + '[' + (ix + 1) + ']';
      }
      if (sibling.nodeType === 1 && sibling.tagName === element.tagName) {
        ix++;
      }
    }
    return '';
  }
  
  return getXPath(el);
})
`

const JS_GENERATE_STRICT_CSS = `
(function(cssSelector) {
  const el = document.querySelector(cssSelector);
  if (!el) return null;
  
  function getStrictSelector(element) {
    // If has ID, use it
    if (element.id) {
      return '#' + CSS.escape(element.id);
    }
    
    // Build selector with multiple attributes
    const tag = element.tagName.toLowerCase();
    const parts = [tag];
    
    // Add data-testid if present
    if (element.dataset.testid) {
      return '[data-testid="' + element.dataset.testid + '"]';
    }
    
    // Add name attribute for form elements
    if (element.name) {
      parts.push('[name="' + element.name + '"]');
    }
    
    // Add type for inputs
    if (element.type && tag === 'input') {
      parts.push('[type="' + element.type + '"]');
    }
    
    // Add aria-label if present
    const ariaLabel = element.getAttribute('aria-label');
    if (ariaLabel) {
      parts.push('[aria-label="' + ariaLabel.replace(/"/g, '\\\\"') + '"]');
    }
    
    // Add role if present
    const role = element.getAttribute('role');
    if (role) {
      parts.push('[role="' + role + '"]');
    }
    
    // Add first two classes if no other attributes
    if (parts.length === 1 && element.classList.length > 0) {
      const classes = Array.from(element.classList).slice(0, 2);
      classes.forEach(c => parts.push('.' + CSS.escape(c)));
    }
    
    let selector = parts.join('');
    
    // Check uniqueness
    if (document.querySelectorAll(selector).length > 1) {
      // Add nth-child
      const parent = element.parentElement;
      if (parent) {
        const siblings = Array.from(parent.children).filter(c => c.tagName === element.tagName);
        const idx = siblings.indexOf(element) + 1;
        selector += ':nth-of-type(' + idx + ')';
      }
    }
    
    return selector;
  }
  
  return getStrictSelector(el);
})
`

const JS_GENERATE_TEXT_SELECTOR = `
(function(cssSelector) {
  const el = document.querySelector(cssSelector);
  if (!el) return null;
  
  const text = (el.textContent || '').trim();
  if (!text || text.length > 50) return null;
  
  // Find all elements with this exact text
  const all = document.evaluate(
    '//*[normalize-space(text())="' + text.replace(/"/g, '\\\\"') + '"]',
    document,
    null,
    XPathResult.ORDERED_NODE_SNAPSHOT_TYPE,
    null
  );
  
  if (all.snapshotLength === 1) {
    return { type: 'exact', text };
  }
  
  // Try contains if exact match isn't unique
  const shortText = text.slice(0, 30);
  return { type: 'contains', text: shortText };
})
`

const JS_GENERATE_ARIA_SELECTOR = `
(function(cssSelector) {
  const el = document.querySelector(cssSelector);
  if (!el) return null;
  
  const selectors = [];
  
  // aria-label
  const ariaLabel = el.getAttribute('aria-label');
  if (ariaLabel) {
    selectors.push('[aria-label="' + ariaLabel.replace(/"/g, '\\\\"') + '"]');
  }
  
  // aria-labelledby
  const labelledBy = el.getAttribute('aria-labelledby');
  if (labelledBy) {
    selectors.push('[aria-labelledby="' + labelledBy + '"]');
  }
  
  // role + name combination
  const role = el.getAttribute('role');
  const name = el.getAttribute('name') || el.id;
  if (role && name) {
    selectors.push('[role="' + role + '"]' + (el.id ? '#' + el.id : '[name="' + name + '"]'));
  }
  
  // Return most specific selector
  return selectors.length > 0 ? selectors[0] : null;
})
`

// ── Fallback Generation ─────────────────────────────────────────────────────

export async function generateXPathFallback(
  webContents: WebContents,
  cssSelector: string
): Promise<DeterministicFallback | null> {
  try {
    const xpath = await webContents.executeJavaScript(
      `${JS_GENERATE_XPATH}('${cssSelector.replace(/'/g, "\\'")}')`
    )

    if (!xpath) return null

    return {
      type: 'xpath',
      selector: xpath,
      confidence: 0.9
    }
  } catch {
    return null
  }
}

export async function generateStrictCSSFallback(
  webContents: WebContents,
  cssSelector: string
): Promise<DeterministicFallback | null> {
  try {
    const strictCSS = await webContents.executeJavaScript(
      `${JS_GENERATE_STRICT_CSS}('${cssSelector.replace(/'/g, "\\'")}')`
    )

    if (!strictCSS) return null

    return {
      type: 'css_strict',
      selector: strictCSS,
      confidence: 0.85
    }
  } catch {
    return null
  }
}

export async function generateTextFallback(
  webContents: WebContents,
  cssSelector: string
): Promise<DeterministicFallback | null> {
  try {
    const result = await webContents.executeJavaScript(
      `${JS_GENERATE_TEXT_SELECTOR}('${cssSelector.replace(/'/g, "\\'")}')`
    )

    if (!result) return null

    const selector =
      result.type === 'exact'
        ? `//*[normalize-space(text())="${result.text}"]`
        : `//*[contains(text(), "${result.text}")]`

    return {
      type: 'text_content',
      selector,
      confidence: result.type === 'exact' ? 0.95 : 0.7
    }
  } catch {
    return null
  }
}

export async function generateAriaFallback(
  webContents: WebContents,
  cssSelector: string
): Promise<DeterministicFallback | null> {
  try {
    const ariaSelector = await webContents.executeJavaScript(
      `${JS_GENERATE_ARIA_SELECTOR}('${cssSelector.replace(/'/g, "\\'")}')`
    )

    if (!ariaSelector) return null

    return {
      type: 'aria',
      selector: ariaSelector,
      confidence: 0.9
    }
  } catch {
    return null
  }
}

// ── Generate All Fallbacks ──────────────────────────────────────────────────

export async function generateFallbacks(
  webContents: WebContents,
  element: ElementCandidate
): Promise<DeterministicFallback[]> {
  const fallbacks: DeterministicFallback[] = []

  // Generate fallbacks in parallel
  const [xpath, strictCSS, textFallback, ariaFallback] = await Promise.all([
    generateXPathFallback(webContents, element.selector),
    generateStrictCSSFallback(webContents, element.selector),
    generateTextFallback(webContents, element.selector),
    generateAriaFallback(webContents, element.selector)
  ])

  // Add in order of reliability
  if (ariaFallback) fallbacks.push(ariaFallback)
  if (textFallback) fallbacks.push(textFallback)
  if (strictCSS) fallbacks.push(strictCSS)
  if (xpath) fallbacks.push(xpath)

  // Sort by confidence
  fallbacks.sort((a, b) => b.confidence - a.confidence)

  return fallbacks
}

// ── Execute with Fallbacks ──────────────────────────────────────────────────

const JS_TRY_CLICK = `
(function(selector, type) {
  let el = null;
  
  if (type === 'xpath' || type === 'text_content') {
    const result = document.evaluate(
      selector,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    el = result.singleNodeValue;
  } else {
    el = document.querySelector(selector);
  }
  
  if (!el) return { success: false, error: 'Element not found' };
  
  try {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.click();
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
})
`

const JS_TRY_TYPE = `
(function(selector, type, text) {
  let el = null;
  
  if (type === 'xpath' || type === 'text_content') {
    const result = document.evaluate(
      selector,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null
    );
    el = result.singleNodeValue;
  } else {
    el = document.querySelector(selector);
  }
  
  if (!el) return { success: false, error: 'Element not found' };
  
  try {
    el.scrollIntoView({ behavior: 'smooth', block: 'center' });
    el.focus();
    el.value = text;
    el.dispatchEvent(new Event('input', { bubbles: true }));
    el.dispatchEvent(new Event('change', { bubbles: true }));
    return { success: true };
  } catch (e) {
    return { success: false, error: e.message };
  }
})
`

export interface FallbackExecutionResult {
  success: boolean
  usedFallback?: FallbackType
  selector?: string
  error?: string
  attempts: number
}

export async function executeClickWithFallbacks(
  webContents: WebContents,
  primarySelector: string,
  fallbacks: DeterministicFallback[]
): Promise<FallbackExecutionResult> {
  let attempts = 0

  // Try primary selector first
  attempts++
  try {
    const primaryResult = await webContents.executeJavaScript(
      `${JS_TRY_CLICK}('${primarySelector.replace(/'/g, "\\'")}', 'css')`
    )
    if (primaryResult.success) {
      return { success: true, attempts }
    }
  } catch {
    // Continue to fallbacks
  }

  // Try each fallback
  for (const fallback of fallbacks) {
    attempts++
    try {
      const result = await webContents.executeJavaScript(
        `${JS_TRY_CLICK}('${fallback.selector.replace(/'/g, "\\'")}', '${fallback.type}')`
      )
      if (result.success) {
        console.log(`[Fallback] Click succeeded with ${fallback.type}: ${fallback.selector}`)
        return {
          success: true,
          usedFallback: fallback.type,
          selector: fallback.selector,
          attempts
        }
      }
    } catch {
      // Continue to next fallback
    }
  }

  return {
    success: false,
    error: 'All fallbacks exhausted',
    attempts
  }
}

export async function executeTypeWithFallbacks(
  webContents: WebContents,
  primarySelector: string,
  text: string,
  fallbacks: DeterministicFallback[]
): Promise<FallbackExecutionResult> {
  let attempts = 0

  // Try primary selector first
  attempts++
  try {
    const primaryResult = await webContents.executeJavaScript(
      `${JS_TRY_TYPE}('${primarySelector.replace(/'/g, "\\'")}', 'css', '${text.replace(/'/g, "\\'")}')`
    )
    if (primaryResult.success) {
      return { success: true, attempts }
    }
  } catch {
    // Continue to fallbacks
  }

  // Try each fallback
  for (const fallback of fallbacks) {
    attempts++
    try {
      const result = await webContents.executeJavaScript(
        `${JS_TRY_TYPE}('${fallback.selector.replace(/'/g, "\\'")}', '${fallback.type}', '${text.replace(/'/g, "\\'")}')`
      )
      if (result.success) {
        console.log(`[Fallback] Type succeeded with ${fallback.type}: ${fallback.selector}`)
        return {
          success: true,
          usedFallback: fallback.type,
          selector: fallback.selector,
          attempts
        }
      }
    } catch {
      // Continue to next fallback
    }
  }

  return {
    success: false,
    error: 'All fallbacks exhausted',
    attempts
  }
}

// ── Action Execution with Automatic Fallback Generation ────────────────────

export async function executeActionWithFallbacks(
  webContents: WebContents,
  action: SemanticAction,
  actionFn: (selector: string) => Promise<{ success: boolean; error?: string }>
): Promise<FallbackExecutionResult> {
  const primarySelector = action.target.selectors[0]
  let attempts = 0

  // Try primary selector
  attempts++
  const primaryResult = await actionFn(primarySelector)
  if (primaryResult.success) {
    return { success: true, attempts }
  }

  // Generate fallbacks
  const element: ElementCandidate = {
    selector: primarySelector,
    tagName: '',
    isVisible: true,
    isInteractive: true,
    confidence: action.target.confidence,
    attributes: {}
  }

  const fallbacks = await generateFallbacks(webContents, element)

  // Try fallbacks
  for (const fallback of fallbacks) {
    attempts++
    const result = await actionFn(fallback.selector)
    if (result.success) {
      return {
        success: true,
        usedFallback: fallback.type,
        selector: fallback.selector,
        attempts
      }
    }
  }

  return {
    success: false,
    error: 'All fallbacks exhausted',
    attempts
  }
}
