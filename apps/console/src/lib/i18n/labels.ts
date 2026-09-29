import { useTranslations } from "next-intl"

/** The namespaces whose keys are database values rather than UI copy. */
export type EnumNamespace = "Status" | "Trigger" | "Kind" | "Type" | "TaskType"

/**
 * Translates a stored enum value — a status, a trigger, a job kind.
 *
 * These come from the database, so the set of values is whatever the schema
 * and the writers allow, which is a wider set than the translations. A value
 * with no message renders as itself: a new status showing up as `queued` is
 * readable, whereas a missing-message error would blank the column and hide
 * the very value that was new.
 */
export function useEnumLabel(namespace: EnumNamespace) {
  const t = useTranslations(namespace)

  return (value: string) => {
    // The cast is what makes this safe at runtime rather than in the type
    // system: `has` is the check, and the call after it is the one that would
    // otherwise throw on an untranslated value.
    const key = value as Parameters<typeof t.has>[0]
    return t.has(key) ? t(key) : value
  }
}
