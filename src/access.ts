import type { Access, Where } from 'payload'

/**
 * The default write rule (since 2026-11-11): the signed-in user belongs to the admin collection (`admin.user` in the
 * Payload config). Accounts from any other auth collection, nobody signed in, and a config with no admin collection
 * to compare with are all refused.
 */
export const adminUsersOnly: Access = ({ req }) => {
  const collection = (req.user as { collection?: unknown } | null | undefined)?.collection
  const adminCollection = req.payload?.config?.admin?.user
  return typeof adminCollection === 'string' && adminCollection !== '' && collection === adminCollection
}

/** A query Payload can apply: a plain object with at least one key. An empty one would match every event, so it's not one. */
export const asWhere = (v: unknown): Where | null => {
  if (v === null || typeof v !== 'object' || Array.isArray(v)) return null
  const proto = Object.getPrototypeOf(v)
  return (proto === Object.prototype || proto === null) && Object.keys(v).length > 0 ? (v as Where) : null
}

/**
 * What a write rule's answer allows: `true` (everything), a query (only events inside it), or `null` (nothing).
 * Only an exact `true` or a real query counts; any other answer, a thrown or rejected error included, is nothing.
 */
export async function writeScope(rule: Access, args: Parameters<Access>[0]): Promise<true | Where | null> {
  try {
    const answer = await rule(args)
    return answer === true ? true : asWhere(answer)
  } catch {
    return null
  }
}

/** The write rule as handed to Payload: `true`, a real query, or `false`. Never a truthy stand-in, never a throw. */
export const strictWrite =
  (rule: Access): Access =>
  async (args) =>
    (await writeScope(rule, args)) ?? false

