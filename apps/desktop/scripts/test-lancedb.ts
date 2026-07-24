/**
 * Standalone LanceDB test script
 * Run with: npx tsx scripts/test-lancedb.ts
 */

import * as lancedb from '@lancedb/lancedb'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

// Use transformers for embeddings
let pipeline: any
let embedder: any

const EMBEDDING_DIM = 384
const TEST_DB_PATH = path.join(os.tmpdir(), 'lancedb-test-' + Date.now())

interface DocumentEntry {
  id: string
  documentId: string
  chunkIndex: number
  content: string
  vector: number[]
  filename: string
  filepath: string
  mimeType: string
  folderId: string
  chatId: string
  pageNumber: number
  createdAt: number
}

async function initEmbedder(): Promise<void> {
  console.log('\n=== Initializing Embedder ===')
  const transformers = await import('@xenova/transformers')
  pipeline = transformers.pipeline

  // Use temp cache
  const cacheDir = path.join(os.tmpdir(), 'transformers-cache')
  transformers.env.cacheDir = cacheDir
  transformers.env.allowLocalModels = true
  transformers.env.allowRemoteModels = true

  console.log('Loading model: Xenova/multilingual-e5-small...')
  embedder = await pipeline('feature-extraction', 'Xenova/multilingual-e5-small', {
    quantized: true
  })
  console.log('✓ Embedder ready')
}

async function embed(text: string): Promise<number[]> {
  const prefixedText = `passage: ${text}`
  const output = await embedder(prefixedText, {
    pooling: 'mean',
    normalize: true
  })
  return Array.from(output.data)
}

async function embedBatch(texts: string[]): Promise<number[][]> {
  const prefixedTexts = texts.map((t) => `passage: ${t}`)
  const output = await embedder(prefixedTexts, {
    pooling: 'mean',
    normalize: true
  })
  // Split batch output into individual embeddings
  const embeddings: number[][] = []
  for (let i = 0; i < texts.length; i++) {
    const start = i * EMBEDDING_DIM
    const end = start + EMBEDDING_DIM
    embeddings.push(Array.from(output.data.slice(start, end)))
  }
  return embeddings
}

async function embedQuery(query: string): Promise<number[]> {
  const prefixedQuery = `query: ${query}`
  const output = await embedder(prefixedQuery, {
    pooling: 'mean',
    normalize: true
  })
  return Array.from(output.data)
}

async function testBasicOperations(): Promise<void> {
  console.log('\n=== Test 1: Basic LanceDB Operations ===')
  console.log('DB Path:', TEST_DB_PATH)

  const db = await lancedb.connect(TEST_DB_PATH)
  console.log('✓ Connected to LanceDB')

  // Create table with schema
  const schemaRecord: DocumentEntry = {
    id: '__schema__',
    documentId: '',
    chunkIndex: 0,
    content: '',
    vector: new Array(EMBEDDING_DIM).fill(0),
    filename: '',
    filepath: '',
    mimeType: '',
    folderId: '',
    chatId: '',
    pageNumber: 0,
    createdAt: 0
  }

  const table = await db.createTable('test_docs', [
    schemaRecord as unknown as Record<string, unknown>
  ])
  await table.delete('id = "__schema__"')
  console.log('✓ Created table')

  // Add test documents
  const testDocId = 'doc_test_123'
  const testChunks = [
    'This is about recursive language models and how they work.',
    'Language models can be self-steering and adapt to context.',
    'The paper discusses advances in neural network architectures.',
    'Deep learning has revolutionized natural language processing.',
    'Transformers are the foundation of modern language models.'
  ]

  console.log('\nAdding', testChunks.length, 'chunks...')
  const entries: DocumentEntry[] = []

  for (let i = 0; i < testChunks.length; i++) {
    const vector = await embed(testChunks[i])
    entries.push({
      id: `${testDocId}_chunk_${i}`,
      documentId: testDocId,
      chunkIndex: i,
      content: testChunks[i],
      vector,
      filename: 'test-document.pdf',
      filepath: '/path/to/test-document.pdf',
      mimeType: 'application/pdf',
      folderId: '',
      chatId: 'chat_abc',
      pageNumber: 1,
      createdAt: Date.now()
    })
  }

  await table.add(entries as unknown as Record<string, unknown>[])
  console.log('✓ Added entries')

  // Verify count
  const count = await table.countRows()
  console.log('Total rows:', count)

  // Test query without filter
  console.log('\n--- Query 1: All rows (no filter) ---')
  const allRows = await table.query().limit(10).toArray()
  console.log('Found:', allRows.length, 'rows')
  console.log(
    'DocumentIds:',
    allRows.map((r) => r.documentId)
  )

  // Test query with filter (unquoted)
  console.log('\n--- Query 2: Filter with unquoted column ---')
  try {
    const unquoted = await table.query().where(`documentId = '${testDocId}'`).limit(10).toArray()
    console.log('Found:', unquoted.length, 'rows')
  } catch (e) {
    console.log('Error:', (e as Error).message)
  }

  // Test query with filter (double quoted)
  console.log('\n--- Query 3: Filter with double-quoted column ---')
  try {
    const quoted = await table.query().where(`"documentId" = '${testDocId}'`).limit(10).toArray()
    console.log('Found:', quoted.length, 'rows')
  } catch (e) {
    console.log('Error:', (e as Error).message)
  }

  // Test manual filter approach
  console.log('\n--- Query 3b: Manual filter on results ---')
  const allForFilter = await table.query().limit(1000).toArray()
  const manualFiltered = allForFilter.filter((r) => r.documentId === testDocId)
  console.log('Found:', manualFiltered.length, 'rows (manual filter)')

  // Test using search with postFilter
  console.log('\n--- Query 3c: Using search with filter ---')
  try {
    const zeroVector = new Array(EMBEDDING_DIM).fill(0)
    const searchFiltered = await table
      .search(zeroVector)
      .where(`"documentId" = '${testDocId}'`)
      .limit(10)
      .toArray()
    console.log('Found:', searchFiltered.length, 'rows (search + where)')
  } catch (e) {
    console.log('Error:', (e as Error).message)
  }

  // Test semantic search
  console.log('\n--- Query 4: Semantic search ---')
  const queryVector = await embedQuery('what are recursive language models?')
  const searchResults = await table.search(queryVector).limit(3).toArray()
  console.log('Found:', searchResults.length, 'results')
  for (const r of searchResults) {
    console.log(`  - [${r._distance?.toFixed(4)}] ${(r.content as string).substring(0, 50)}...`)
  }

  await db.dropTable('test_docs')
  console.log('\n✓ Test 1 complete')
}

async function testRemoveAndReAdd(): Promise<void> {
  console.log('\n=== Test 2: Working Solution with Manual Filter ===')

  const db = await lancedb.connect(TEST_DB_PATH)

  // Create table
  const schemaRecord: DocumentEntry = {
    id: '__schema__',
    documentId: '',
    chunkIndex: 0,
    content: '',
    vector: new Array(EMBEDDING_DIM).fill(0),
    filename: '',
    filepath: '',
    mimeType: '',
    folderId: '',
    chatId: '',
    pageNumber: 0,
    createdAt: 0
  }

  let table = await db.createTable('docs_index', [
    schemaRecord as unknown as Record<string, unknown>
  ])
  await table.delete('id = "__schema__"')

  const docId = 'doc_1e3b71e3d1b7'

  // Helper function that mimics what the app should do
  async function getDocumentChunks(targetDocId: string): Promise<Record<string, unknown>[]> {
    const allRows = await table.query().limit(10000).toArray()
    return allRows.filter((r) => r.documentId === targetDocId)
  }

  async function removeDocument(targetDocId: string): Promise<void> {
    // Get all rows, filter out the ones to delete, recreate table
    // This is a workaround since .delete() with where clause may have same bug
    const allRows = await table.query().limit(10000).toArray()
    const remaining = allRows.filter((r) => r.documentId !== targetDocId)

    // Drop and recreate with remaining data
    await db.dropTable('docs_index')
    if (remaining.length > 0) {
      table = await db.createTable('docs_index', remaining as Record<string, unknown>[])
    } else {
      table = await db.createTable('docs_index', [
        schemaRecord as unknown as Record<string, unknown>
      ])
      await table.delete('id = "__schema__"')
    }
    console.log(`Removed document ${targetDocId}, ${remaining.length} rows remaining`)
  }

  // Step 1: Add initial document
  console.log('\nStep 1: Adding initial document...')
  const entries: DocumentEntry[] = []
  for (let i = 0; i < 5; i++) {
    const vector = await embed(`Chunk ${i} content about AI and machine learning.`)
    entries.push({
      id: `${docId}_chunk_${i}`,
      documentId: docId,
      chunkIndex: i,
      content: `Chunk ${i} content about AI and machine learning.`,
      vector,
      filename: 'RecursiveLanguageModels.pdf',
      filepath: '/path/to/RecursiveLanguageModels.pdf',
      mimeType: 'application/pdf',
      folderId: '',
      chatId: '',
      pageNumber: 1,
      createdAt: Date.now()
    })
  }

  await table.add(entries as unknown as Record<string, unknown>[])
  console.log('Added', entries.length, 'chunks')

  // Query with manual filter
  console.log('\nQuerying with manual filter:')
  let results = await getDocumentChunks(docId)
  console.log('Found:', results.length, 'chunks ✓')

  // Step 2: Remove document using workaround
  console.log('\n\nStep 2: Removing document...')
  await removeDocument(docId)

  results = await getDocumentChunks(docId)
  console.log('After delete, found:', results.length, 'chunks (should be 0) ✓')

  // Step 3: Re-add document
  console.log('\n\nStep 3: Re-adding document...')
  const newEntries: DocumentEntry[] = []
  for (let i = 0; i < 5; i++) {
    const vector = await embed(`New chunk ${i} with updated content.`)
    newEntries.push({
      id: `${docId}_chunk_${i}`,
      documentId: docId,
      chunkIndex: i,
      content: `New chunk ${i} with updated content.`,
      vector,
      filename: 'RecursiveLanguageModels.pdf',
      filepath: '/path/to/RecursiveLanguageModels.pdf',
      mimeType: 'application/pdf',
      folderId: '',
      chatId: '',
      pageNumber: 1,
      createdAt: Date.now()
    })
  }

  await table.add(newEntries as unknown as Record<string, unknown>[])
  console.log('Added', newEntries.length, 'new chunks')

  // Step 4: Query again
  console.log('\n\nStep 4: Querying after re-add...')
  results = await getDocumentChunks(docId)
  console.log('Found:', results.length, 'chunks ✓')
  console.log('Content preview:', (results[0]?.content as string)?.substring(0, 40))

  await db.dropTable('docs_index')
  console.log('\n✓ Test 2 complete - Manual filter approach works!')
}

async function testRealDatabase(): Promise<void> {
  console.log('\n=== Test 3: Check Real App Database ===')

  const homeDir = os.homedir()
  const appDbPath = path.join(homeDir, 'Library/Application Support/overlay/documents.lance')

  if (!fs.existsSync(appDbPath)) {
    console.log('App database not found at:', appDbPath)
    return
  }

  console.log('Found app database at:', appDbPath)

  try {
    const db = await lancedb.connect(appDbPath)
    const tables = await db.tableNames()
    console.log('Tables:', tables)

    if (tables.includes('documents_index')) {
      const table = await db.openTable('documents_index')

      const count = await table.countRows()
      console.log('Total rows in documents_index:', count)

      const schema = await table.schema()
      console.log(
        'Schema fields:',
        schema.fields.map((f) => f.name)
      )

      console.log('\nSample rows:')
      const sample = await table.query().limit(5).toArray()
      for (const row of sample) {
        console.log(
          `  - documentId: ${row.documentId}, content: ${(row.content as string).substring(0, 40)}...`
        )
      }

      // Get unique documentIds
      const allRows = await table.query().limit(10000).toArray()
      const uniqueDocIds = [...new Set(allRows.map((r) => r.documentId as string))]
      console.log('\nUnique document IDs:', uniqueDocIds.length)
      console.log('IDs:', uniqueDocIds.slice(0, 10))

      // Test query for a known document
      if (uniqueDocIds.length > 0) {
        const testId = uniqueDocIds[0]
        console.log(`\nTesting query for documentId: ${testId}`)

        console.log('Unquoted where:')
        try {
          const r1 = await table.query().where(`documentId = '${testId}'`).limit(5).toArray()
          console.log('  Found:', r1.length)
        } catch (e) {
          console.log('  Error:', (e as Error).message)
        }

        console.log('Double-quoted where:')
        try {
          const r2 = await table.query().where(`"documentId" = '${testId}'`).limit(5).toArray()
          console.log('  Found:', r2.length)
        } catch (e) {
          console.log('  Error:', (e as Error).message)
        }

        console.log('Manual filter:')
        const manual = allRows.filter((r) => r.documentId === testId)
        console.log('  Found:', manual.length)
      }
    }
  } catch (e) {
    console.log('Error accessing database:', (e as Error).message)
  }

  console.log('\n✓ Test 3 complete')
}

async function testSearchRetrieval(): Promise<void> {
  console.log('\n=== Test 4: Search Retrieval Quality ===')

  const db = await lancedb.connect(TEST_DB_PATH)

  const schemaRecord: DocumentEntry = {
    id: '__schema__',
    documentId: '',
    chunkIndex: 0,
    content: '',
    vector: new Array(EMBEDDING_DIM).fill(0),
    filename: '',
    filepath: '',
    mimeType: '',
    folderId: '',
    chatId: '',
    pageNumber: 0,
    createdAt: 0
  }

  const table = await db.createTable('search_test', [
    schemaRecord as unknown as Record<string, unknown>
  ])
  await table.delete('id = "__schema__"')

  // Add diverse documents
  const documents = [
    {
      id: 'doc_ml',
      chunks: [
        'Machine learning is a subset of artificial intelligence that enables systems to learn from data.',
        'Neural networks are inspired by biological neural networks in animal brains.',
        'Deep learning uses multiple layers of neural networks for complex pattern recognition.'
      ]
    },
    {
      id: 'doc_rlm',
      chunks: [
        'Recursive language models process text by recursively applying transformations.',
        'Self-steering language models can adapt their processing based on input context.',
        'Modern LLMs like GPT-4 use transformer architectures with attention mechanisms.'
      ]
    },
    {
      id: 'doc_recipe',
      chunks: [
        'To make chocolate cake, combine flour, sugar, cocoa powder, and eggs.',
        'Baking requires precise measurements and temperature control.',
        'Desserts should be cooled before serving for best texture.'
      ]
    }
  ]

  console.log('Adding documents...')
  for (const doc of documents) {
    const entries: DocumentEntry[] = []
    for (let i = 0; i < doc.chunks.length; i++) {
      const vector = await embed(doc.chunks[i])
      entries.push({
        id: `${doc.id}_chunk_${i}`,
        documentId: doc.id,
        chunkIndex: i,
        content: doc.chunks[i],
        vector,
        filename: `${doc.id}.pdf`,
        filepath: `/path/to/${doc.id}.pdf`,
        mimeType: 'application/pdf',
        folderId: '',
        chatId: '',
        pageNumber: 1,
        createdAt: Date.now()
      })
    }
    await table.add(entries as unknown as Record<string, unknown>[])
    console.log(`  Added ${doc.id}: ${doc.chunks.length} chunks`)
  }

  // Test searches
  const queries = [
    'what is this document about?',
    'recursive language models',
    'how to bake a cake',
    'neural network architecture',
    'self-steering AI systems'
  ]

  console.log('\nSearch Results:')
  for (const query of queries) {
    console.log(`\nQuery: "${query}"`)
    const queryVector = await embedQuery(query)
    const results = await table.search(queryVector).limit(3).toArray()

    for (const r of results) {
      const distance = (r._distance as number) || 0
      const similarity = 1 - distance
      const docId = r.documentId as string
      const content = (r.content as string).substring(0, 60)
      console.log(`  [${similarity.toFixed(3)}] [${docId}] ${content}...`)
    }
  }

  await db.dropTable('search_test')
  console.log('\n✓ Test 4 complete')
}

async function testBatchEmbeddingPerformance(): Promise<void> {
  console.log('\n=== Test 5: Batch Embedding Performance ===')

  // Simulate a document with many chunks
  const numChunks = 50
  const chunks: string[] = []
  for (let i = 0; i < numChunks; i++) {
    chunks.push(
      `This is chunk ${i} of a document about artificial intelligence and machine learning. ` +
        `It contains information about neural networks, deep learning, and natural language processing. ` +
        `The content varies slightly to simulate real document chunks with different information.`
    )
  }

  // Test 1: One-at-a-time embedding
  console.log(`\nEmbedding ${numChunks} chunks ONE AT A TIME...`)
  const startSeq = Date.now()
  const seqVectors: number[][] = []
  for (const chunk of chunks) {
    const vec = await embed(chunk)
    seqVectors.push(vec)
  }
  const seqTime = Date.now() - startSeq
  console.log(`  Sequential time: ${seqTime}ms (${(seqTime / numChunks).toFixed(1)}ms per chunk)`)

  // Test 2: Batch embedding
  console.log(`\nEmbedding ${numChunks} chunks in BATCH...`)
  const startBatch = Date.now()
  const batchVectors = await embedBatch(chunks)
  const batchTime = Date.now() - startBatch
  console.log(`  Batch time: ${batchTime}ms (${(batchTime / numChunks).toFixed(1)}ms per chunk)`)

  // Compare
  const speedup = seqTime / batchTime
  console.log(`\n  Speedup: ${speedup.toFixed(2)}x faster with batch`)

  // Verify vectors are the same
  let allMatch = true
  for (let i = 0; i < numChunks; i++) {
    const seqVec = seqVectors[i]
    const batchVec = batchVectors[i]
    for (let j = 0; j < EMBEDDING_DIM; j++) {
      if (Math.abs(seqVec[j] - batchVec[j]) > 0.0001) {
        allMatch = false
        break
      }
    }
  }
  console.log(`  Vectors match: ${allMatch ? '✓' : '✗'}`)

  console.log('\n✓ Test 5 complete')
}

async function testAsyncEmbeddingWithYield(): Promise<void> {
  console.log('\n=== Test 6: Async Embedding with Event Loop Yield ===')

  const numChunks = 30
  const chunks: string[] = []
  for (let i = 0; i < numChunks; i++) {
    chunks.push(`Document chunk ${i} with content about technology and science.`)
  }

  // Helper to yield to event loop
  const yieldToEventLoop = (): Promise<void> =>
    new Promise((resolve) => setImmediate(resolve))

  // Test embedding with periodic yields to prevent UI blocking
  console.log(`\nEmbedding ${numChunks} chunks with event loop yields...`)
  const BATCH_SIZE = 10
  const startTime = Date.now()
  const vectors: number[][] = []

  for (let i = 0; i < chunks.length; i += BATCH_SIZE) {
    const batch = chunks.slice(i, i + BATCH_SIZE)
    console.log(`  Processing batch ${Math.floor(i / BATCH_SIZE) + 1}/${Math.ceil(chunks.length / BATCH_SIZE)}...`)

    // Embed this batch
    const batchVectors = await embedBatch(batch)
    vectors.push(...batchVectors)

    // Yield to event loop after each batch
    await yieldToEventLoop()
  }

  const totalTime = Date.now() - startTime
  console.log(`\n  Total time: ${totalTime}ms for ${numChunks} chunks`)
  console.log(`  Vectors generated: ${vectors.length}`)
  console.log(`  Strategy: Batch size ${BATCH_SIZE} with event loop yields`)

  console.log('\n✓ Test 6 complete - This approach prevents UI blocking!')
}

async function testContextSizeLimits(): Promise<void> {
  console.log('\n=== Test 7: Context Size & Token Estimation ===')

  // Rough token estimation (1 token ≈ 4 chars for English)
  const estimateTokens = (text: string): number => Math.ceil(text.length / 4)

  // Simulate document chunks of varying sizes
  const chunks = [
    'Short chunk about AI.',
    'This is a medium-length chunk that discusses machine learning algorithms and their applications in modern software systems.',
    'This is a longer chunk that goes into detail about neural network architectures, including convolutional neural networks (CNNs) for image processing, recurrent neural networks (RNNs) for sequence data, and transformer models that have revolutionized natural language processing. These architectures each have their strengths and are chosen based on the specific requirements of the task at hand.',
    'Another substantial chunk covering the history and evolution of artificial intelligence from its inception in the 1950s through the AI winters and into the current era of deep learning and large language models.',
    'Brief note on data preprocessing.'
  ]

  console.log('\nChunk analysis:')
  let totalTokens = 0
  for (let i = 0; i < chunks.length; i++) {
    const tokens = estimateTokens(chunks[i])
    totalTokens += tokens
    console.log(`  Chunk ${i}: ${tokens} tokens (${chunks[i].length} chars)`)
  }
  console.log(`  TOTAL: ${totalTokens} tokens`)

  // Test different limits
  const TOKEN_LIMITS = [500, 1000, 2000, 4000]

  for (const limit of TOKEN_LIMITS) {
    console.log(`\nWith ${limit} token limit:`)
    const selected: string[] = []
    let currentTokens = 0

    for (const chunk of chunks) {
      const chunkTokens = estimateTokens(chunk)
      if (currentTokens + chunkTokens <= limit) {
        selected.push(chunk)
        currentTokens += chunkTokens
      }
    }

    console.log(`  Selected: ${selected.length}/${chunks.length} chunks`)
    console.log(`  Tokens used: ${currentTokens}/${limit}`)
  }

  console.log('\n✓ Test 7 complete')
}

async function main(): Promise<void> {
  console.log('╔══════════════════════════════════════════════════════════════╗')
  console.log('║          LanceDB & Embedding Test Suite                      ║')
  console.log('╚══════════════════════════════════════════════════════════════╝')

  try {
    await initEmbedder()
    await testBasicOperations()
    await testRemoveAndReAdd()
    await testRealDatabase()
    await testSearchRetrieval()
    await testBatchEmbeddingPerformance()
    await testAsyncEmbeddingWithYield()
    await testContextSizeLimits()

    console.log('\n\n════════════════════════════════════════════════════════════════')
    console.log('                    ALL TESTS COMPLETE')
    console.log('════════════════════════════════════════════════════════════════')

    // Cleanup
    if (fs.existsSync(TEST_DB_PATH)) {
      fs.rmSync(TEST_DB_PATH, { recursive: true })
    }
  } catch (error) {
    console.error('\n❌ Test failed:', error)
    process.exit(1)
  }
}

main()
