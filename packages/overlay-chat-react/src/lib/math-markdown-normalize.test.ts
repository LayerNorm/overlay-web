import test from 'node:test'
import assert from 'node:assert/strict'

import {
  promoteHeavyInlineMathToFlowBlocks,
  normalizeDoubleDollarMath,
  normalizeEscapedLatexDelimiters,
  normalizeBareBigONotation,
  normalizeBareLatexLines,
  normalizeAssistantMathMarkdown,
} from './math-markdown-normalize'

test('keeps clearance equations separate from the surrounding paragraph', () => {
  const input = String.raw`The target concentration is \(C_{target,total}=C_{target,unbound}/f_{u,p}\). The product is \(CL \times C_{target,total}\) and protein binding cancels out.`
  assert.equal(normalizeAssistantMathMarkdown(input), String.raw`The target concentration is $C_{target,total}=C_{target,unbound}/f_{u,p}$. The product is $CL \times C_{target,total}$ and protein binding cancels out.`)
})

test('does not promote a bare equation followed by prose into one display block', () => {
  const input = String.raw`CL = f_{u,p} \times CL_{int}. The product is independent of protein binding and this remains true at the target concentration.`
  assert.equal(normalizeAssistantMathMarkdown(input), input)
})

test('escaped inline delimiters allow nested parentheses and square brackets', () => {
  const input = String.raw`Use \(f(x) = [\alpha + g(x)]\) here.`
  assert.equal(normalizeAssistantMathMarkdown(input), String.raw`Use $f(x) = [\alpha + g(x)]$ here.`)
})

test('math normalization leaves code examples untouched', () => {
  for (const input of [
    'Use `\\(x^2\\)` literally.',
    '```tex\n\\[x^2\\]\n```',
    '~~~tex\n\\(f(x)\\)\n~~~',
    '```tex\n\\[unfinished\\]',
  ]) assert.equal(normalizeAssistantMathMarkdown(input), input)
})

test('promotes heavy one-line $$…$$ after prose to flow math fences', () => {
  const input = 'So R has the form $$\\begin{bmatrix} a \\end{bmatrix}$$ and more.'
  const out = promoteHeavyInlineMathToFlowBlocks(input)
  assert.match(out, /\n\n\$\$\n/)
  assert.match(out, /\n\$\$\n\n/)
  assert.ok(out.includes('\\begin{bmatrix}'))
})

test('does not rewrite normal flow math $$\n…\n$$', () => {
  const input = '$$\nL = x\n$$'
  assert.equal(promoteHeavyInlineMathToFlowBlocks(input), input)
})

test('leaves short inline $$…$$ alone', () => {
  const input = 'Lift ($$C_L$$) is fine.'
  assert.equal(promoteHeavyInlineMathToFlowBlocks(input), input)
})

test('converts short inline $$…$$ to standard inline math', () => {
  const input = 'Lift ($$C_L$$) is fine.'
  assert.equal(normalizeDoubleDollarMath(input), 'Lift ($C_L$) is fine.')
})

test('preserves standalone single-line dollar equations as display math', () => {
  for (const equation of [String.raw`h(x)=\sqrt{1+\left[\log(1+x)\right]^2}.`, 'E=mc^2', '2']) {
    const input = `Before.\n\n$$${equation}$$\n\nAfter.`
    const normalized = normalizeAssistantMathMarkdown(input).replace(/\n{3,}/g, '\n\n')
    assert.equal(normalized, `Before.\n\n$$\n${equation}\n$$\n\nAfter.`)
  }
})

test('does not promote compact dollar equations sharing a line with prose', () => {
  for (const input of ['$$x+y$$ is the sum.', 'The sum is $$x+y$$', 'Use $$x+y$$ and $$x-y$$ here.']) {
    assert.equal(normalizeAssistantMathMarkdown(input), input.replaceAll('$$', '$'))
  }
})

test('keeps heavy inline $$…$$ as display math fences', () => {
  const input = 'So R has the form $$\\begin{bmatrix} a \\\\ b \\end{bmatrix}$$ and more.'
  const out = normalizeDoubleDollarMath(input)
  assert.match(out, /\n\n\$\$\n/)
  assert.match(out, /\n\$\$\n\n/)
  assert.ok(out.includes('\\begin{bmatrix}'))
})

test('repairs stray double-dollar opener before a TeX atom', () => {
  const input = 'different $$\\Sigma estimates, different constraints'
  assert.equal(normalizeDoubleDollarMath(input), 'different $\\Sigma$ estimates, different constraints')
})

test('repairs stray double-dollar closer after a compact TeX expression', () => {
  const input = 'Factor the 4 \\times 4$$ matrix once via LU.'
  assert.equal(normalizeDoubleDollarMath(input), 'Factor the $4 \\times 4$ matrix once via LU.')
})

test('accepts escaped TeX delimiters from models', () => {
  assert.equal(normalizeEscapedLatexDelimiters('Use \\(x^2\\) here.'), 'Use $x^2$ here.')
  assert.equal(normalizeEscapedLatexDelimiters('Then \\[x^2\\]'), 'Then \n\n$$\nx^2\n$$\n\n')
})

test('wraps bare Big-O notation outside existing math', () => {
  const input = 'Costs O(n^3/3), then $O(n^2)$ and `O(n)`.'
  assert.equal(normalizeBareBigONotation(input), 'Costs $O(n^3/3)$, then $O(n^2)$ and `O(n)`.')
})

test('escapes currency amounts with slash-separated prose units', () => {
  const input = 'Charge $0.25 / seat / month. Since you lead with web and mobile, use a base $2-4 per user.'
  assert.equal(
    normalizeAssistantMathMarkdown(input),
    'Charge \\$0.25 / seat / month. Since you lead with web and mobile, use a base \\$2-4 per user.',
  )
})

test('keeps compact numeric equations as inline math', () => {
  const input = 'Use $2x + 1 = 5$ as the first equation.'
  assert.equal(normalizeAssistantMathMarkdown(input), input)
})

test('promotes raw matrix assignment lines to display math', () => {
  const input = 'where:\nL = \\begin{bmatrix} 1 & 0 \\\\ l_{21} & 1 \\end{bmatrix}, \\quad U = \\begin{bmatrix} u_{11} & u_{12} \\\\ 0 & u_{22} \\end{bmatrix}'
  const out = normalizeBareLatexLines(input)
  assert.match(out, /where:\n\n\$\$\nL = \\begin\{bmatrix\}/)
  assert.match(out, /\\quad U = \\begin\{bmatrix\}/)
  assert.match(out, /\n\$\$/)
})

test('promotes raw Doolittle formula tail after prose prefix', () => {
  const input = '2. The formulas: U_{i,j} = A_{i,j} - \\sum_{k=1}^{j-1} L_{i,k} U_{k,j} \\quad \\text{for } i \\le j'
  const out = normalizeBareLatexLines(input)
  assert.equal(
    out,
    '2. The formulas:\n\n$$\nU_{i,j} = A_{i,j} - \\sum_{k=1}^{j-1} L_{i,k} U_{k,j} \\quad \\text{for } i \\le j\n$$\n',
  )
})

test('consumes complete identifiers and nested suffix arguments', () => {
  const input = String.raw`The clearance: CL_{\text{int}} = \frac{a}{b}`
  const out = normalizeBareLatexLines(input)
  assert.equal(out, String.raw`The clearance:

$$
CL_{\text{int}} = \frac{a}{b}
$$
`)
})

test('does not backtrack through long suffix runs without an equation', () => {
  for (const input of [`A_${'!_'.repeat(400)}`, `A^${'!^'.repeat(400)}`]) {
    assert.equal(normalizeBareLatexLines(input), input)
  }
})

test('normalizeAssistantMathMarkdown runs delimiter + promotion', () => {
  const input = 'eq $$x + y$$'
  const out = normalizeAssistantMathMarkdown(input)
  assert.equal(out, 'eq $x + y$')
})

// Regression: finance examples with TeX commands inside must stay math, not be escaped as currency.
test('keeps TeX-heavy currency-looking math as math', () => {
  assert.equal(
    normalizeAssistantMathMarkdown('$1.1000 \\times 100{,}000 = \\$110{,}000$'),
    '$1.1000 \\times 100{,}000 = \\$110{,}000$',
  )
  assert.equal(
    normalizeAssistantMathMarkdown('$N = 1.1000 \\times 100{,}000 = \\$110{,}000$'),
    '$N = 1.1000 \\times 100{,}000 = \\$110{,}000$',
  )
})

// Regression: plain prose with currency/pseudo-math still gets escaped.
test('still escapes currency spans without TeX commands', () => {
  assert.equal(
    normalizeAssistantMathMarkdown('Charge $0.25 / seat / month. Use a base $2-4 per user.'),
    'Charge \\$0.25 / seat / month. Use a base \\$2-4 per user.',
  )
})

// Regression: pricing-table currency must survive KaTeX (see the Browserbase
// comparison — `$20/mo **— $100 …` paired across the row and ate spaces).
test('escapes slash-unit currency pairs in long table rows', () => {
  assert.equal(
    normalizeAssistantMathMarkdown(
      '| **Entry Paid** | **Developer $20/mo **— $100 browser hours (then $0.12/hr), 25 concurrent |',
    ),
    '| **Entry Paid** | **Developer \\$20/mo **— \\$100 browser hours (then $0.12/hr), 25 concurrent |',
  )
  assert.equal(
    normalizeAssistantMathMarkdown('credits from $5, browsers at $0.02/browser-hour'),
    'credits from \\$5, browsers at \\$0.02/browser-hour',
  )
  assert.equal(
    normalizeAssistantMathMarkdown('Price: $20/mo, $100 upfront.'),
    'Price: \\$20/mo, \\$100 upfront.',
  )
})

test('escapes currency pairs past the legacy 400-char cap and across newlines', () => {
  const longRow = `| Plan | ${'x'.repeat(420)} $20/mo $100 total |`
  assert.equal(
    normalizeAssistantMathMarkdown(longRow),
    `| Plan | ${'x'.repeat(420)} \\$20/mo \\$100 total |`,
  )
  assert.equal(
    normalizeAssistantMathMarkdown('Total $20 for setup\nplus $100 for support.'),
    'Total \\$20 for setup\nplus \\$100 for support.',
  )
})

test('leaves display math and lone currency dollars alone', () => {  assert.equal(normalizeAssistantMathMarkdown('Lift $$C_L$$ is fine.'), 'Lift $C_L$ is fine.')
  assert.equal(
    normalizeAssistantMathMarkdown('$$\nCost: $20 and $30\n$$'),
    '$$\nCost: \\$20 and \\$30\n$$',
  )
  assert.equal(normalizeAssistantMathMarkdown('It costs $20 flat.'), 'It costs $20 flat.')
  assert.equal(normalizeAssistantMathMarkdown('Use $2x + 1 = 5$ next.'), 'Use $2x + 1 = 5$ next.')
  assert.equal(normalizeAssistantMathMarkdown('Let $x$ vary.'), 'Let $x$ vary.')
})

// Regression: bare LaTeX in markdown table cells gets promoted.
test('promotes bare LaTeX inside markdown table cells', () => {
  const input = '| N | Notional | \\frac{110{,}000}{100} = \\$1{,}100$ |'
  const out = normalizeAssistantMathMarkdown(input)
  assert.equal(out, '| N | Notional | $\\frac{110{,}000}{100} = \\$1{,}100$ |')
})

// Regression: bare formula lines with command after equals get display fences.
test('promotes bare formula line with command after equals', () => {
  const input = '1\\% \\times 110{,}000 = \\$1{,}100$'
  const out = normalizeAssistantMathMarkdown(input)
  assert.equal(out, '\n\$$\n1\\% \\times 110{,}000 = \\$1{,}100\n$$\n')
})

// Regression: closing $$ glued to the equation line reflows onto its own line.
test('reflows display fences with glued closers', () => {
  const input = 'Standards:\n$$\ng = \\frac{a}{b} \\times 100$$\n\nAfter.'
  assert.equal(
    normalizeAssistantMathMarkdown(input),
    'Standards:\n$$\ng = \\frac{a}{b} \\times 100\n$$\n\nAfter.',
  )
})

// Regression: stray dollars inside display spans become literal or vanish;
// TeX grouping parens inside single-dollar spans are preserved.
test('repairs sloppy display math with stray dollars', () => {
  const input = 'Note:\n$$\ng_{x} = \\left$\\left(\\frac{a}{b}\\right)^4\n$$\nDone.'
  const out = normalizeAssistantMathMarkdown(input)
  assert.ok(!out.includes('$\\left('), `stray opener survives: ${out}`)
  assert.ok(out.includes('\\left(\\frac{a}{b}\\right)^4'), `grouping lost: ${out}`)
  assert.ok(out.startsWith('Note:\n$$'), `fences broken: ${out}`)
})

// Regression: hyphenated English words inside currency spans must not trip the
// subtraction heuristic — `pre-seed` and `18-month` are prose hyphens, and the
// span must escape instead of letting KaTeX eat the clause (including the
// closing `**`) as italic math.
test('escapes currency spans containing hyphenated words', () => {
  const input =
    '**How we justify $1M (not $500K / $1.4M):** Investors will call the mismatch. For SV pre-seed, frame $1M as 18-month runway to:'
  assert.equal(
    normalizeAssistantMathMarkdown(input),
    '**How we justify \\$1M (not \\$500K / \\$1.4M):** Investors will call the mismatch. For SV pre-seed, frame \\$1M as 18-month runway to:',
  )
  assert.equal(
    normalizeAssistantMathMarkdown('Priced at $5 per-seat vs $10 for enterprise.'),
    'Priced at \\$5 per-seat vs \\$10 for enterprise.',
  )
  assert.equal(
    normalizeAssistantMathMarkdown('Range $5-10 per user-month, up to $100 total.'),
    'Range \\$5-10 per user-month, up to \\$100 total.',
  )
})

// Real subtraction still counts as math: spaced minus and single-char operands.
test('keeps genuine minus expressions as math', () => {
  assert.equal(normalizeAssistantMathMarkdown('The equation $x - 1 = 0$ holds.'), 'The equation $x - 1 = 0$ holds.')
  assert.equal(normalizeAssistantMathMarkdown('Compute $a-b$ here.'), 'Compute $a-b$ here.')
})

test('long command-heavy LaTeX lines before $$ normalize in linear time', () => {
  const line = String.raw`S = -\frac{T}{2}\int d\tau\, d\sigma\, \partial_+ X^\mu \partial_- X^\nu \eta_{\mu\nu} \qquad \partial_\pm = \partial_\tau \pm \partial_\sigma`
  const started = performance.now()
  normalizeDoubleDollarMath(`${line} ${line}$$\n`)
  assert.ok(performance.now() - started < 250, 'normalization should not backtrack')
  assert.match(normalizeDoubleDollarMath('where \\alpha_1 = O(n^2)$$ is small'), /= \$O\(n\^2\)\$ is small/)
})
