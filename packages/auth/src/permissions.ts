import { createAccessControl } from "better-auth/plugins/access"
import { defaultStatements } from "better-auth/plugins/organization/access"

/**
 * Organization roles.
 *
 * `defaultStatements` is Better Auth's own resource/action matrix; the extra
 * `project` resource is what the platform needs on top of it. Each role is a
 * *subset* of `owner`, so a check written against `owner` never passes for a
 * lesser role by accident.
 */
const statement = {
  ...defaultStatements,
  project: ["create", "share", "update", "delete"],
} as const

export const ac = createAccessControl(statement)

export const member = ac.newRole({
  project: ["create"],
})

export const admin = ac.newRole({
  project: ["create", "update"],
})

export const owner = ac.newRole({
  project: ["create", "update", "delete"],
  organization: ["update", "delete"],
})

export { statement }
