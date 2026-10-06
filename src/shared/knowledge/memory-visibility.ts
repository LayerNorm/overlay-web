import { isAgentMemoryOwnerId } from '../agents/agent-memory'

/**
 * Who a new memory is for when nobody said. A person's memory (a preference, a fact about them) is theirs: another
 * member of the workspace must not be able to recall it just because an assistant saved it in a chat. An agent's
 * memory is workspace knowledge by design (`agent-memory.ts`), so it stays shared. An explicit choice always wins.
 * Memories from before this rule have no value stored and still read as shared; only new ones are affected.
 */
export function defaultMemoryVisibility(ownerId: string): 'owner' | undefined {
  return isAgentMemoryOwnerId(ownerId) ? undefined : 'owner'
}
