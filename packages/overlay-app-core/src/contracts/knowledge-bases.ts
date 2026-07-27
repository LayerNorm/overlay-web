export const KNOWLEDGE_BASE_KINDS = ['personal', 'organization'] as const
export type KnowledgeBaseKind = (typeof KNOWLEDGE_BASE_KINDS)[number]

export const KNOWLEDGE_BASE_STATUSES = ['active', 'archived'] as const
export type KnowledgeBaseStatus = (typeof KNOWLEDGE_BASE_STATUSES)[number]

export const KNOWLEDGE_SOURCE_KINDS = ['file', 'note', 'memory', 'text'] as const
export type KnowledgeSourceKind = (typeof KNOWLEDGE_SOURCE_KINDS)[number]

export const KNOWLEDGE_SOURCE_STATUSES = [
  'pending',
  'extracting',
  'indexing',
  'ready',
  'failed',
  'deleting',
] as const
export type KnowledgeSourceStatus = (typeof KNOWLEDGE_SOURCE_STATUSES)[number]

export type KnowledgeBase = {
  id: string
  ownerUserId: string
  title: string
  description?: string
  kind: KnowledgeBaseKind
  status: KnowledgeBaseStatus
  createdBy?: string
  createdAt: number
  updatedAt: number
  archivedAt?: number
}

export type KnowledgeSource = {
  id: string
  ownerUserId: string
  kind: KnowledgeSourceKind
  sourceRef?: string
  title: string
  mimeType?: string
  contentHash?: string
  status: KnowledgeSourceStatus
  statusMessage?: string
  metadata: Record<string, unknown>
  createdBy?: string
  createdAt: number
  updatedAt: number
  deletedAt?: number
}

export type KnowledgeSourceVersion = {
  id: string
  sourceId: string
  version: number
  contentHash: string
  status: KnowledgeSourceStatus
  metadata: Record<string, unknown>
  createdAt: number
  updatedAt: number
}

export type KnowledgeBaseSource = {
  knowledgeBaseId: string
  sourceId: string
  addedBy?: string
  enabled: boolean
  createdAt: number
}

export type KnowledgeBaseConversation = {
  knowledgeBaseId: string
  conversationId: string
  createdBy?: string
  createdAt: number
}

export type ProjectKnowledgeBase = {
  knowledgeBaseId: string
  projectId: string
  attachedBy?: string
  createdAt: number
}

/**
 * How a turn's retrieval corpus is chosen when a project has attached bases and
 * the user may also name bases explicitly.
 *
 * - `project`: use only the project's attached bases.
 * - `selected`: use only the explicitly named bases, ignoring project defaults.
 * - `combined`: union of both.
 *
 * An explicit `@Knowledge` mention resolves to `selected`, so a mention narrows
 * scope rather than widening it.
 */
export const KNOWLEDGE_RETRIEVAL_MODES = ['project', 'selected', 'combined'] as const
export type KnowledgeRetrievalMode = (typeof KNOWLEDGE_RETRIEVAL_MODES)[number]

export const DEFAULT_KNOWLEDGE_RETRIEVAL_MODE: KnowledgeRetrievalMode = 'selected'

/** Upper bound on bases fused into a single turn, so retrieval latency stays bounded. */
export const MAX_KNOWLEDGE_BASES_PER_TURN = 8

export type CreateKnowledgeBaseInput = Pick<
  KnowledgeBase,
  'id' | 'ownerUserId' | 'title'
> & Partial<Pick<KnowledgeBase, 'description' | 'kind'>>
  & Pick<KnowledgeBase, 'createdBy'>

export type UpdateKnowledgeBaseInput = Pick<KnowledgeBase, 'id'> & Partial<Pick<
  KnowledgeBase,
  'title' | 'description' | 'kind'
>>

export type CreateKnowledgeSourceInput = Pick<
  KnowledgeSource,
  'id' | 'ownerUserId' | 'kind' | 'title'
> & Partial<Pick<
  KnowledgeSource,
  'sourceRef' | 'mimeType' | 'contentHash' | 'status' | 'statusMessage' | 'metadata' | 'createdBy'
>>

export type UpdateKnowledgeSourceInput = Pick<KnowledgeSource, 'id'> & Partial<Pick<
  KnowledgeSource,
  'title' | 'mimeType' | 'contentHash' | 'status' | 'statusMessage' | 'metadata'
>>

export interface KnowledgeBaseRepository {
  create(input: CreateKnowledgeBaseInput): Promise<KnowledgeBase>
  get(id: string): Promise<KnowledgeBase | null>
  listAll(options?: { includeArchived?: boolean }): Promise<KnowledgeBase[]>
  listForOwner(ownerUserId: string, options?: { includeArchived?: boolean }): Promise<KnowledgeBase[]>
  update(input: UpdateKnowledgeBaseInput): Promise<KnowledgeBase | null>
  archive(id: string): Promise<boolean>
  remove(id: string): Promise<boolean>
}

export interface KnowledgeSourceRepository {
  create(input: CreateKnowledgeSourceInput): Promise<KnowledgeSource>
  get(id: string): Promise<KnowledgeSource | null>
  update(input: UpdateKnowledgeSourceInput): Promise<KnowledgeSource | null>
  markDeleted(id: string): Promise<boolean>
  createVersion(input: Omit<KnowledgeSourceVersion, 'createdAt' | 'updatedAt'>): Promise<KnowledgeSourceVersion>
  updateVersion(input: Pick<KnowledgeSourceVersion, 'id'> & Partial<Pick<
    KnowledgeSourceVersion,
    'status' | 'metadata'
  >>): Promise<KnowledgeSourceVersion | null>
  listVersions(sourceId: string): Promise<KnowledgeSourceVersion[]>
}

export interface KnowledgeBaseSourceRepository {
  add(input: Omit<KnowledgeBaseSource, 'createdAt'>): Promise<KnowledgeBaseSource>
  remove(input: Pick<KnowledgeBaseSource, 'knowledgeBaseId' | 'sourceId'>): Promise<boolean>
  setEnabled(input: Pick<KnowledgeBaseSource, 'knowledgeBaseId' | 'sourceId' | 'enabled'>): Promise<boolean>
  listForBase(knowledgeBaseId: string): Promise<KnowledgeBaseSource[]>
  listBasesForSource(sourceId: string): Promise<KnowledgeBaseSource[]>
}

export interface KnowledgeBaseConversationRepository {
  attach(input: Omit<KnowledgeBaseConversation, 'createdAt'>): Promise<KnowledgeBaseConversation>
  /** Detaches every base from the conversation. */
  detach(conversationId: string): Promise<boolean>
  /** Detaches a single base, leaving any other attachments in place. */
  detachOne(input: Pick<KnowledgeBaseConversation, 'conversationId' | 'knowledgeBaseId'>): Promise<boolean>
  /**
   * @deprecated A conversation may have many bases. Prefer {@link listForConversation}.
   * Retained so callers mid-rollout keep working; returns the oldest attachment.
   */
  getForConversation(conversationId: string): Promise<KnowledgeBaseConversation | null>
  listForConversation(conversationId: string): Promise<KnowledgeBaseConversation[]>
  listForBase(knowledgeBaseId: string): Promise<KnowledgeBaseConversation[]>
}

export interface ProjectKnowledgeBaseRepository {
  attach(input: Omit<ProjectKnowledgeBase, 'createdAt'>): Promise<ProjectKnowledgeBase>
  detach(input: Pick<ProjectKnowledgeBase, 'projectId' | 'knowledgeBaseId'>): Promise<boolean>
  detachAll(projectId: string): Promise<boolean>
  listForProject(projectId: string): Promise<ProjectKnowledgeBase[]>
  listForBase(knowledgeBaseId: string): Promise<ProjectKnowledgeBase[]>
}

export interface KnowledgeBaseRepositories {
  bases: KnowledgeBaseRepository
  sources: KnowledgeSourceRepository
  memberships: KnowledgeBaseSourceRepository
  conversations: KnowledgeBaseConversationRepository
  projects: ProjectKnowledgeBaseRepository
}
