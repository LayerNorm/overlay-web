/**
 * The workspace guest role was removed. Stored memberships and invitations may still say 'guest' until
 * migrations/removeGuestRole.ts has run, so such a row reads as a member. Delete this helper together with the schema
 * literal once the migration has run everywhere.
 */
export function withoutLegacyGuest<R extends string>(role: R): Exclude<R, 'guest'> | 'member' {
  return (role === 'guest' ? 'member' : role) as Exclude<R, 'guest'> | 'member'
}
