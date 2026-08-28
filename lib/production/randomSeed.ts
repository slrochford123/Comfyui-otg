import { randomInt } from "node:crypto";

const PRODUCTION_SEED_MAX_EXCLUSIVE = 2_147_483_648;
const PRODUCTION_SEED_SPAN = PRODUCTION_SEED_MAX_EXCLUSIVE - 1;

export function freshProductionSeed(): number {
  return randomInt(1, PRODUCTION_SEED_MAX_EXCLUSIVE);
}

function normalizeProductionSeed(value: number): number {
  const integer = Math.trunc(value);

  return (
    ((((integer - 1) % PRODUCTION_SEED_SPAN) + PRODUCTION_SEED_SPAN)
      % PRODUCTION_SEED_SPAN)
    + 1
  );
}

type SeedReference = {
  parent: Record<string, unknown>;
  key: string;
  value: number;
};

function isSeedKey(value: string) {
  const key = String(value || "").toLowerCase();

  return (
    key === "seed"
    || key === "noise_seed"
    || key === "random_seed"
    || /(^|_)seed$/.test(key)
  );
}

/**
 * Replaces workflow execution seeds with one fresh server-side base seed while
 * preserving the existing relative offsets between seed inputs.
 *
 * Example:
 *   old: 100, 101, 117
 *   new: N,   N+1, N+17
 *
 * Values are normalized into the positive signed-32-bit ComfyUI seed range.
 */
export function rewriteWorkflowSeedsPreservingOffsets(
  workflow: unknown,
): {
  seed: number | null;
  count: number;
} {
  const refs: SeedReference[] = [];
  const seen = new Set<object>();

  const visit = (value: unknown) => {
    if (!value || typeof value !== "object") return;

    if (seen.has(value as object)) return;
    seen.add(value as object);

    if (Array.isArray(value)) {
      value.forEach(visit);
      return;
    }

    const record = value as Record<string, unknown>;
    const inputs = record.inputs;

    if (
      inputs
      && typeof inputs === "object"
      && !Array.isArray(inputs)
    ) {
      const inputRecord = inputs as Record<string, unknown>;

      for (const [key, child] of Object.entries(inputRecord)) {
        if (
          isSeedKey(key)
          && (
            typeof child === "number"
            || typeof child === "string"
          )
        ) {
          const numeric = Number(child);

          if (Number.isFinite(numeric)) {
            refs.push({
              parent: inputRecord,
              key,
              value: Math.trunc(numeric),
            });
            continue;
          }
        }

        visit(child);
      }
    }

    for (const [key, child] of Object.entries(record)) {
      if (key === "inputs") continue;
      visit(child);
    }
  };

  visit(workflow);

  if (!refs.length) {
    return {
      seed: null,
      count: 0,
    };
  }

  const freshBase = freshProductionSeed();
  const originalBase = refs[0].value;

  refs.forEach((ref) => {
    const offset = ref.value - originalBase;

    ref.parent[ref.key] =
      normalizeProductionSeed(
        freshBase + offset,
      );
  });

  return {
    seed: freshBase,
    count: refs.length,
  };
}
