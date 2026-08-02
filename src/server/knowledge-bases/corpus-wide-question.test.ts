import assert from 'node:assert/strict'
import test from 'node:test'
import { isCorpusWideQuestion } from './KnowledgeBaseRetrievalService'

test('recognizes questions about the corpus itself', () => {
  for (const query of [
    'can you take me through what is in @Notes',
    'what is in Notes?',
    "what's inside this knowledge base",
    'what does this contain',
    'walk me through the syllabus base',
    'give me an overview',
    'give me a rundown of it',
    'list the sources',
    'list all documents',
    'how many documents are in here',
    'summarize everything in this base',
    'show me the table of contents',
  ]) {
    assert.equal(isCorpusWideQuestion(query), true, `should be corpus-wide: "${query}"`)
  }
})

test('does not misclassify ordinary factual questions', () => {
  for (const query of [
    'what is the refund window',
    'explain osmosis in plants',
    'how does the heart pump blood',
    'which enzymes break down starch',
    'define active transport',
    'compare aerobic and anaerobic respiration',
    'what are the deficiency diseases for vitamin D',
  ]) {
    assert.equal(isCorpusWideQuestion(query), false, `should be a content question: "${query}"`)
  }
})

test('is whitespace and case insensitive', () => {
  assert.equal(isCorpusWideQuestion('  TAKE   ME  THROUGH  IT  '), true)
  assert.equal(isCorpusWideQuestion(''), false)
  assert.equal(isCorpusWideQuestion('   '), false)
})
