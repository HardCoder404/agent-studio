export type Change = { path: string; kind: "added" | "removed" | "changed"; before?: unknown; after?: unknown };

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);

/** Deep diff of two JSON values. Arrays and primitives compare as whole values. */
export function diff(before: unknown, after: unknown, path = ""): Change[] {
  if (isObj(before) && isObj(after)) {
    const out: Change[] = [];
    for (const k of new Set([...Object.keys(before), ...Object.keys(after)])) {
      const p = path ? `${path}.${k}` : k;
      if (!(k in after)) out.push({ path: p, kind: "removed", before: before[k] });
      else if (!(k in before)) out.push({ path: p, kind: "added", after: after[k] });
      else out.push(...diff(before[k], after[k], p));
    }
    return out;
  }
  if (JSON.stringify(before) === JSON.stringify(after)) return [];
  return [{ path: path || "$", kind: "changed", before, after }];
}

/** Word-level diff of two strings for inline highlighting: returns [kind, text] runs. */
export function wordDiff(a: string, b: string): ["same" | "del" | "ins", string][] {
  const A = a.split(/(\s+)/), B = b.split(/(\s+)/);
  const n = A.length, m = B.length;
  const dp: number[][] = Array.from({ length: n + 1 }, () => new Array(m + 1).fill(0));
  for (let i = n - 1; i >= 0; i--) for (let j = m - 1; j >= 0; j--) dp[i][j] = A[i] === B[j] ? dp[i + 1][j + 1] + 1 : Math.max(dp[i + 1][j], dp[i][j + 1]);
  const out: ["same" | "del" | "ins", string][] = [];
  const push = (k: "same" | "del" | "ins", t: string) => {
    if (out.length && out[out.length - 1][0] === k) out[out.length - 1][1] += t;
    else out.push([k, t]);
  };
  let i = 0, j = 0;
  while (i < n && j < m) {
    if (A[i] === B[j]) { push("same", A[i]); i++; j++; }
    else if (dp[i + 1][j] >= dp[i][j + 1]) { push("del", A[i]); i++; }
    else { push("ins", B[j]); j++; }
  }
  while (i < n) push("del", A[i++]);
  while (j < m) push("ins", B[j++]);
  return out;
}
