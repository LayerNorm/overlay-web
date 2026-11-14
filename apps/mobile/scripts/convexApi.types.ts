import type { FunctionArgs } from 'convex/server'
import type { api } from '../services/convexApi'

type Assert<Condition extends true> = Condition
type IsAny<Value> = 0 extends (1 & Value) ? true : false
type Assignable<Expected, Actual extends Expected> = Actual
type ReactionArgs = FunctionArgs<typeof api.collaboration.rooms.setReaction>

export type GeneratedApiIsTyped = Assert<IsAny<typeof api> extends false ? true : false>
export type GeneratedArgsAreTyped = Assert<IsAny<ReactionArgs> extends false ? true : false>

// @ts-expect-error Nonexistent backend functions must not become callable.
export type MissingFunction = typeof api.collaboration.rooms.mobileFunctionThatDoesNotExist

// @ts-expect-error Argument names come from web validators.
export type WrongArgumentName = ReactionArgs['emojiName']

// @ts-expect-error Required arguments cannot be omitted.
export type MissingArgument = Assignable<ReactionArgs, Omit<ReactionArgs, 'emoji'>>

// @ts-expect-error Validator value types must not widen to any.
export type WrongArgumentType = Assignable<ReactionArgs['enabled'], string>
