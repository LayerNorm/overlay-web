import test from 'node:test'
import assert from 'node:assert/strict'

const {
  promoteHeavyInlineMathToFlowBlocks,
  normalizeDoubleDollarMath,
  normalizeEscapedLatexDelimiters,
  normalizeBareBigONotation,
  normalizeBareLatexLines,
  normalizeAssistantMathMarkdown,
} = (await import(new URL('./math-markdown-normalize.ts', import.meta.url).href)) as typeof import('./math-markdown-normalize')

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

test('leaves display math and lone currency dollars alone', () => {
  assert.equal(normalizeAssistantMathMarkdown('Lift $$C_L$$ is fine.'), 'Lift $C_L$ is fine.')
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
