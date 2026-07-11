import 'server-only'

import type { KnowledgeSearchArgs, KnowledgeSearchRepository } from './KnowledgeSearchRepository'

export class KnowledgeSearchService {
  constructor(private readonly repository: KnowledgeSearchRepository) {}

  async hybridSearch(args: KnowledgeSearchArgs) {
    const query = args.query.trim()
    if (!query) throw new KnowledgeSearchServiceError('query is required', 400)
    if (query.length > 500) throw new KnowledgeSearchServiceError('query cannot exceed 500 characters', 400)
    return await this.repository.hybridSearch({ ...args, query })
  }
}

export class KnowledgeSearchServiceError extends Error {
  constructor(message: string, readonly statusCode: number) {
    super(message)
    this.name = 'KnowledgeSearchServiceError'
  }
}
