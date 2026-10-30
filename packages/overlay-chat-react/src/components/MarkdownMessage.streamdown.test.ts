import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { MarkdownMessage } from './MarkdownMessage'

function rendered(text: string, isStreaming = false): string {
  return renderToStaticMarkup(React.createElement(MarkdownMessage, {
    text, isStreaming, suppressTypingIndicator: true,
  }))
}

test('inline single-dollar math renders with KaTeX', () => {
  assert.match(rendered('Area is $\\pi r^2$ here.'), /class="katex"/)
  // Superscripts are raised by KaTeX inline styles, which the span override must keep.
  assert.match(rendered('Area is $\\pi r^2$ here.'), /style="top:-/)
})

test('block double-dollar math renders as display math', () => {
  assert.match(rendered('$$\nE = mc^2\n$$'), /katex-display/)
})

test('single-line dollar displays retain display semantics between prose paragraphs', () => {
  const text = String.raw`Before the equations.

$$h(x)=\sqrt{1+\left[\log(1+x)\right]^2}.$$

Between the equations.

$$E=mc^2$$

After the equations.`
  for (const streaming of [false, true]) {
    const html = rendered(text, streaming)
    assert.equal((html.match(/class="katex-display"/g) ?? []).length, 2)
    assert.doesNotMatch(html, /katex-error/)
    for (const prose of ['Before the equations.', 'Between the equations.', 'After the equations.']) {
      assert.ok(html.includes(`<p>${prose}</p>`))
    }
  }
})

test('long inline equations and multiple mixed delimiters preserve sentence boundaries', () => {
  const html = rendered(String.raw`Before \(E_j=\frac{\sum_{i=1}^{n}w_i(C_i-\bar C_j)^2}{\sqrt{1+\left(\frac{\sigma_j}{\mu_j}\right)^2}}\left[1+\log\left(1+\frac{T_j}{\tau_j}\right)\right]\) remains inside the sentence. Next \(AUC=\frac{D}{CL}\), $t_{1/2}=\frac{\ln 2}{k_e}$, and \(V_d=\frac{CL}{k_e}\) connect exposure and volume. End of paragraph.`)
  assert.equal((html.match(/class="katex"/g) ?? []).length, 4)
  assert.doesNotMatch(html, /katex-display|katex-error/)
  assert.match(html, /remains inside the sentence\. Next/)
  assert.match(html, /connect exposure and volume\. End of paragraph\.<\/p>/)
})

test('long displays, aligned derivations, cases and matrices render together', () => {
  const equations = [
    String.raw`\widehat{CL}_{j}=\frac{\displaystyle\sum_{i=1}^{N_j}\frac{w_{ij}\left[C_i(t_i)-C_i(t_{i-1})\right]}{\sqrt{1+\left(\frac{\sigma_{ij}}{\mu_j}\right)^2}}+\int_0^{T_j}\frac{f_{u,p,j}CL_{\mathrm{int},j}C_p(t)}{Q_{H,j}+f_{u,p,j}CL_{\mathrm{int},j}}\,dt}{\displaystyle\left[\sum_{i=1}^{N_j}w_{ij}\left(\frac{AUC_{ij}}{D_{ij}}\right)\right]^{1/2}+\frac{\lambda_j}{1+\frac{\alpha_j}{\beta_j+\sqrt{\gamma_j}}}}`,
    String.raw`\begin{aligned}\frac{dC}{dt}&=-k_eC,\\\ln\left(\frac{C(t)}{C_0}\right)&=-k_et,\\C(t)&=C_0e^{-k_et}.\end{aligned}`,
    String.raw`R(t)=\begin{cases}R_0(1-e^{-k_et}),&0\le t<T,\\R_0(1-e^{-k_eT})e^{-k_e(t-T)},&t\ge T.\end{cases}`,
    String.raw`\frac{d\mathbf{x}_j}{dt}=\begin{bmatrix}-(k_{10,j}+k_{12,j})&k_{21,j}\\k_{12,j}&-k_{21,j}\end{bmatrix}\begin{bmatrix}A_{1,j}\\A_{2,j}\end{bmatrix}`,
  ]
  const text = equations.map((equation, index) => `Equation ${index + 1}.\n\n$$${equation}$$\n\nEnd ${index + 1}.`).join('\n\n')
  const html = rendered(text)
  assert.equal((html.match(/class="katex-display"/g) ?? []).length, equations.length)
  assert.doesNotMatch(html, /katex-error/)
  for (const index of equations.keys()) {
    assert.ok(html.includes(`<p>End ${index + 1}.</p>`))
  }
})

test('clearance math stays inline without swallowing the explanatory sentence', () => {
  const html = rendered(String.raw`Protein binding cancels out. \(CL = f_u \times CL_{int}\), and \(C_{target,total} = C_{target,unbound}/f_u\). The product is independent of protein binding.`)
  assert.doesNotMatch(html, /katex-display|katex-error/)
  assert.match(html, /The product is independent of protein binding\./)
  assert.equal((html.match(/class="katex"/g) ?? []).length, 2)
})

test('numeric inline values render as math beside prose and currency', () => {
  const html = rendered(String.raw`The assay costs $5 and analysis costs $12.50. The fraction doubles to \(0.2\) while \(CL_{\text{int}}\) remains unchanged. The count is $42$.`)
  assert.equal((html.match(/class="katex"/g) ?? []).length, 3)
  assert.doesNotMatch(html, /katex-error|\$0\.2\$|\$42\$/)
  assert.match(html, /The assay costs \$5 and analysis costs \$12\.50/)
  assert.match(html, /remains unchanged\./)
})

test('a broken equation does not throw', () => {
  assert.doesNotThrow(() => rendered('Bad $\\frac{1}{$ math'))
})

test('unfinished escaped displays never expose internal link placeholders', () => {
  const prefix = 'Before the equation; keep this prose.\n\n'
  const chunks = [
    String.raw`\[
CL_H=\frac{Q_H f_{u,p}`,
    String.raw` CL_{\mathrm{int}}}{Q_H+f_{u,p}CL_{\mathrm{int}}}`,
    '\n\\]\n\nAfter the equation; ordinary prose.',
  ]
  let text = prefix
  for (const chunk of chunks) {
    text += chunk
    const html = rendered(text, true)
    assert.doesNotMatch(html, /streamdown:incomplete-link/)
    assert.match(html, /Before the equation; keep this prose\./)
  }
  for (const streaming of [true, false]) {
    const html = rendered(text, streaming)
    assert.match(html, /katex-display/)
    assert.doesNotMatch(html, /katex-error/)
    assert.match(html, /After the equation; ordinary prose\./)
  }
})

test('unfinished links retain their text and completed links retain their destination', () => {
  for (const text of ['Read [the guide', 'Read [the guide](', 'Read [the guide](https://example.com']) {
    const html = rendered(text, true)
    assert.match(html, /the guide/)
    assert.doesNotMatch(html, /streamdown:incomplete-link|href=/)
  }
  assert.match(rendered('Read [the guide](https://example.com).'), /href="https:\/\/example.com"/)
})

test('fenced code renders the shared Code Block', () => {
  assert.match(rendered('```python\na = 1\n```'), /data-slot="code-block"/)
})

test('unfinished emphasis is styled while streaming', () => {
  assert.match(rendered('Some **bold text', true), /<strong>bold text<\/strong>/)
})

test('mentions update when the same text renders with a different mention list', () => {
  const text = '@Maya Chen can you take this?'
  renderToStaticMarkup(React.createElement(MarkdownMessage, { text, isStreaming: false, mentions: [{ type: 'person', id: 'p_other', name: 'Sam Lee' }] }))
  const html = renderToStaticMarkup(React.createElement(MarkdownMessage, { text, isStreaming: false, mentions: [{ type: 'person', id: 'p_maya', name: 'Maya Chen' }] }))
  assert.doesNotMatch(html, /@Maya Chen/)
  assert.match(html, /Maya Chen<\/span>/)
})

test('completed paragraphs, code, and math keep the streaming block structure', () => {
  const text = '# Answer\n\nA **formatted** response.\n\n```python\na = 1\n```\n\nArea is $\\pi r^2$.'
  const streaming = rendered(text, true)
  const completed = rendered(text, false)
  assert.equal(completed, streaming)
  assert.doesNotMatch(completed, /Response complete|Completed/)
})
