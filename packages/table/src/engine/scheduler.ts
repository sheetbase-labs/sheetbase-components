export type DependencyGraph = ReadonlyMap<string, ReadonlySet<string>>;

export type RecalculationPlan = Readonly<{
  batches: readonly (readonly string[])[];
  cyclic: readonly string[];
}>;

/**
 * Produces stable Kahn layers for the requested dirty subgraph. Dependencies
 * outside the subgraph are already-clean inputs and do not need scheduling.
 */
export function planRecalculation(
  dirty: Iterable<string>,
  dependencies: DependencyGraph,
): RecalculationPlan {
  const requested = new Set(dirty);
  const remaining = new Map<string, number>();
  const consumers = new Map<string, string[]>();

  for (const address of requested) {
    let count = 0;
    for (const dependency of dependencies.get(address) ?? []) {
      if (!requested.has(dependency)) continue;
      count += 1;
      const next = consumers.get(dependency) ?? [];
      next.push(address);
      consumers.set(dependency, next);
    }
    remaining.set(address, count);
  }

  let ready = [...remaining]
    .filter(([, count]) => count === 0)
    .map(([address]) => address)
    .sort();
  const batches: string[][] = [];
  const scheduled = new Set<string>();

  while (ready.length) {
    const batch = ready;
    batches.push(batch);
    const next = new Set<string>();
    for (const address of batch) {
      scheduled.add(address);
      for (const consumer of consumers.get(address) ?? []) {
        const count = (remaining.get(consumer) ?? 0) - 1;
        remaining.set(consumer, count);
        if (count === 0) next.add(consumer);
      }
    }
    ready = [...next].sort();
  }

  return {
    batches,
    cyclic: [...requested].filter((address) => !scheduled.has(address)).sort(),
  };
}
