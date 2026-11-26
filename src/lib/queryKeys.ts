/**
 * Keys that exist outside any Collabo scope. Everything inside a Collabo (members, tasks,
 * task details) is keyed through `useProjectKeys()` so a member's cache and an
 * administrator's view of the same Collabo stay apart.
 */
export const queryKeys = {
  project: ['project'] as const,
}
