/** "1 condition", "2 conditions" — a count with its noun agreed. */
export function countLabel(count: number, singular: string, plural = `${singular}s`): string {
  return `${count.toLocaleString()} ${count === 1 ? singular : plural}`;
}

/** The search topbar's tree summary: "1 condition · 1 group · flat query". */
export function treeSummary(conditions: number, groups: number, flattened: boolean): string {
  return `${countLabel(conditions, "condition")} · ${countLabel(groups, "group")} · ${flattened ? "flat" : "tree"} query`;
}
