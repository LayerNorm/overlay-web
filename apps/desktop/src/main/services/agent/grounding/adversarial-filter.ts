/**
 * Adversarial Filter Module
 * Detects and filters popup overlays, injected elements, and misleading UI patterns
 */

import type { WebContents } from 'electron'
import type { ElementCandidate, AdversarialFlag, AdversarialCheck } from './types'

// ── Adversarial Detection JavaScript ────────────────────────────────────────

const JS_CHECK_ELEMENT_ADVERSARIAL = `
(function(selector) {
  const el = document.querySelector(selector);
  if (!el) return { found: false };
  
  const rect = el.getBoundingClientRect();
  const style = window.getComputedStyle(el);
  const flags = [];
  
  // Check 1: High z-index overlay (potential popup/modal)
  const zIndex = parseInt(style.zIndex) || 0;
  if (zIndex > 9000 || style.position === 'fixed' && zIndex > 100) {
    flags.push('high_z_index_overlay');
  }
  
  // Check 2: Covers significant viewport area
  const viewportArea = window.innerWidth * window.innerHeight;
  const elArea = rect.width * rect.height;
  const coverageRatio = elArea / viewportArea;
  if (coverageRatio > 0.3 && (style.position === 'fixed' || style.position === 'absolute')) {
    flags.push('covers_primary_content');
  }
  
  // Check 3: Suspicious positioning (corners, edges)
  const isCornerPositioned = (
    (rect.right > window.innerWidth - 50 && rect.bottom > window.innerHeight - 50) ||
    (rect.left < 50 && rect.bottom > window.innerHeight - 50) ||
    (rect.right > window.innerWidth - 50 && rect.top < 50) ||
    (rect.left < 50 && rect.top < 50)
  ) && (style.position === 'fixed' || style.position === 'absolute');
  if (isCornerPositioned && zIndex > 10) {
    flags.push('suspicious_position');
  }
  
  // Check 4: Common popup/ad patterns in classes/ids
  const idClass = (el.id + ' ' + el.className).toLowerCase();
  const popupPatterns = [
    'popup', 'modal', 'overlay', 'banner', 'cookie', 'consent',
    'newsletter', 'subscribe', 'promo', 'ad-', 'ads-', 'advertisement',
    'interstitial', 'lightbox', 'dialog', 'toast', 'notification',
    'gdpr', 'privacy', 'accept', 'dismiss'
  ];
  const matchesPopupPattern = popupPatterns.some(p => idClass.includes(p));
  if (matchesPopupPattern) {
    flags.push('common_popup_pattern');
  }
  
  // Check 5: Has close/dismiss button (indicator of interruption)
  const hasCloseButton = el.querySelector('[class*="close"], [aria-label*="close"], [aria-label*="dismiss"], button:has(svg), .x-button') !== null;
  
  // Check 6: Text content suggests interruption
  const text = (el.textContent || '').toLowerCase();
  const interruptiveText = [
    'subscribe', 'sign up for', 'newsletter', 'don\\'t miss',
    'limited time', 'special offer', 'cookies', 'privacy policy',
    'we use cookies', 'accept all', 'reject all', 'manage preferences'
  ];
  const hasMisleadingText = interruptiveText.some(t => text.includes(t));
  if (hasMisleadingText && (matchesPopupPattern || hasCloseButton)) {
    flags.push('misleading_text');
  }
  
  return {
    found: true,
    flags,
    zIndex,
    position: style.position,
    coverageRatio,
    hasCloseButton,
    rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height }
  };
})
`

const JS_CHECK_RECENTLY_APPEARED = `
(function(selector, threshold) {
  // This requires mutation observer setup - simplified version
  // In production, we'd track DOM mutations over time
  const el = document.querySelector(selector);
  if (!el) return false;
  
  // Check if element has animation suggesting recent appearance
  const style = window.getComputedStyle(el);
  const hasAnimation = style.animation !== 'none' || style.transition !== 'none 0s ease 0s';
  
  // Check opacity transition (common for popups)
  const isTransitioning = parseFloat(style.opacity) < 1 && parseFloat(style.opacity) > 0;
  
  return hasAnimation || isTransitioning;
})
`

const JS_GET_PAGE_OVERLAYS = `
(function() {
  const overlays = [];
  const fixedElements = document.querySelectorAll('[style*="position: fixed"], [style*="position:fixed"]');
  const highZElements = Array.from(document.querySelectorAll('*')).filter(el => {
    const z = parseInt(window.getComputedStyle(el).zIndex);
    return z > 1000;
  });
  
  const candidates = new Set([...fixedElements, ...highZElements]);
  
  candidates.forEach(el => {
    const rect = el.getBoundingClientRect();
    const style = window.getComputedStyle(el);
    
    if (rect.width < 50 || rect.height < 50) return;
    if (style.visibility === 'hidden' || style.display === 'none') return;
    
    const selector = el.id ? '#' + el.id : el.tagName.toLowerCase() + (el.className ? '.' + el.className.split(' ')[0] : '');
    
    overlays.push({
      selector,
      zIndex: parseInt(style.zIndex) || 0,
      position: style.position,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
      text: (el.textContent || '').slice(0, 100)
    });
  });
  
  return overlays.sort((a, b) => b.zIndex - a.zIndex).slice(0, 10);
})()
`

// ── Risk Calculation ────────────────────────────────────────────────────────

const FLAG_WEIGHTS: Record<AdversarialFlag, number> = {
  high_z_index_overlay: 0.3,
  recently_appeared: 0.25,
  covers_primary_content: 0.35,
  suspicious_position: 0.15,
  common_popup_pattern: 0.4,
  injected_element: 0.5,
  misleading_text: 0.25
}

function calculateRiskScore(flags: AdversarialFlag[]): number {
  if (flags.length === 0) return 0

  let score = 0
  for (const flag of flags) {
    score += FLAG_WEIGHTS[flag] || 0.1
  }

  // Cap at 1.0
  return Math.min(score, 1.0)
}

function getRecommendation(riskScore: number): 'allow' | 'warn' | 'block' {
  // Using "warn and proceed" as per user preference
  if (riskScore >= 0.8) return 'warn' // Changed from 'block' to 'warn'
  if (riskScore >= 0.4) return 'warn'
  return 'allow'
}

// ── Main Check Function ─────────────────────────────────────────────────────

export async function checkAdversarialPatterns(
  webContents: WebContents,
  element: ElementCandidate,
  _taskContext?: string // eslint-disable-line @typescript-eslint/no-unused-vars
): Promise<AdversarialCheck> {
  const flags: AdversarialFlag[] = []

  try {
    // Run adversarial detection JavaScript
    const result = await webContents.executeJavaScript(
      `${JS_CHECK_ELEMENT_ADVERSARIAL}('${element.selector.replace(/'/g, "\\'")}')`
    )

    if (!result.found) {
      return {
        element,
        flags: [],
        riskScore: 0,
        recommendation: 'allow'
      }
    }

    // Add detected flags
    flags.push(...(result.flags as AdversarialFlag[]))

    // Check if recently appeared
    const recentlyAppeared = await webContents.executeJavaScript(
      `${JS_CHECK_RECENTLY_APPEARED}('${element.selector.replace(/'/g, "\\'")}', 2000)`
    )
    if (recentlyAppeared) {
      flags.push('recently_appeared')
    }

    const riskScore = calculateRiskScore(flags)
    const recommendation = getRecommendation(riskScore)

    return {
      element,
      flags,
      riskScore,
      recommendation,
      reason:
        flags.length > 0 ? `Element triggered adversarial flags: ${flags.join(', ')}` : undefined
    }
  } catch (error) {
    console.error('[AdversarialFilter] Check failed:', error)
    return {
      element,
      flags: [],
      riskScore: 0,
      recommendation: 'allow'
    }
  }
}

// ── Batch Check for Multiple Elements ───────────────────────────────────────

export async function filterAdversarialElements(
  webContents: WebContents,
  elements: ElementCandidate[],
  taskContext?: string
): Promise<{
  safe: ElementCandidate[]
  warned: AdversarialCheck[]
  blocked: AdversarialCheck[]
}> {
  const safe: ElementCandidate[] = []
  const warned: AdversarialCheck[] = []
  const blocked: AdversarialCheck[] = []

  for (const element of elements) {
    const check = await checkAdversarialPatterns(webContents, element, taskContext)

    switch (check.recommendation) {
      case 'allow':
        safe.push(element)
        break
      case 'warn':
        warned.push(check)
        safe.push(element) // Still include but with warning
        break
      case 'block':
        blocked.push(check)
        break
    }
  }

  if (warned.length > 0) {
    console.log(
      `[AdversarialFilter] Warning: ${warned.length} elements flagged as potentially adversarial`
    )
  }

  return { safe, warned, blocked }
}

// ── Get Current Page Overlays ───────────────────────────────────────────────

export interface PageOverlay {
  selector: string
  zIndex: number
  position: string
  rect: { x: number; y: number; width: number; height: number }
  text: string
}

export async function getPageOverlays(webContents: WebContents): Promise<PageOverlay[]> {
  try {
    return await webContents.executeJavaScript(JS_GET_PAGE_OVERLAYS)
  } catch (error) {
    console.error('[AdversarialFilter] Failed to get overlays:', error)
    return []
  }
}

// ── Detect if Page Has Active Popup ─────────────────────────────────────────

export async function hasActivePopup(webContents: WebContents): Promise<boolean> {
  try {
    const overlays = await getPageOverlays(webContents)

    for (const overlay of overlays) {
      // Check if overlay is large enough to be a popup
      const isLargeEnough = overlay.rect.width > 200 && overlay.rect.height > 100

      // Check if it's positioned prominently
      const isProminent =
        overlay.zIndex > 1000 ||
        (overlay.position === 'fixed' && overlay.rect.y < window.innerHeight / 2)

      if (isLargeEnough && isProminent) {
        return true
      }
    }

    return false
  } catch {
    return false
  }
}

// ── Suggest Dismissal Action for Popup ──────────────────────────────────────

const JS_FIND_DISMISS_BUTTON = `
(function() {
  // Look for common dismiss/close buttons
  const selectors = [
    '[aria-label*="close" i]',
    '[aria-label*="dismiss" i]',
    '[class*="close"]',
    '[class*="dismiss"]',
    'button:has(svg[class*="close"])',
    'button:has(svg[class*="x"])',
    '[role="dialog"] button:first-of-type',
    '.modal-close',
    '.popup-close'
  ];
  
  for (const sel of selectors) {
    try {
      const el = document.querySelector(sel);
      if (el && el.offsetParent !== null) {
        return {
          found: true,
          selector: el.id ? '#' + el.id : sel,
          text: (el.textContent || '').trim().slice(0, 50)
        };
      }
    } catch (e) {}
  }
  
  // Fallback: look for X or × character in buttons
  const buttons = document.querySelectorAll('button, [role="button"]');
  for (const btn of buttons) {
    const text = (btn.textContent || '').trim();
    if (text === '×' || text === 'X' || text === 'x' || text.toLowerCase() === 'close') {
      return {
        found: true,
        selector: btn.id ? '#' + btn.id : 'button',
        text
      };
    }
  }
  
  return { found: false };
})()
`

export async function findDismissButton(
  webContents: WebContents
): Promise<{ found: boolean; selector?: string; text?: string }> {
  try {
    return await webContents.executeJavaScript(JS_FIND_DISMISS_BUTTON)
  } catch {
    return { found: false }
  }
}

// ── Check if Element is Task-Relevant ───────────────────────────────────────

export function isElementTaskRelevant(element: ElementCandidate, taskIntent: string): boolean {
  const intentLower = taskIntent.toLowerCase()
  const elementText = [element.text, element.ariaLabel, element.placeholder]
    .filter(Boolean)
    .join(' ')
    .toLowerCase()

  // Check for keyword overlap
  const intentWords = intentLower.split(/\s+/).filter((w) => w.length > 2)
  const elementWords = new Set(elementText.split(/\s+/).filter((w) => w.length > 2))

  let matches = 0
  for (const word of intentWords) {
    for (const elWord of elementWords) {
      if (elWord.includes(word) || word.includes(elWord)) {
        matches++
        break
      }
    }
  }

  return matches >= Math.min(2, intentWords.length * 0.3)
}
