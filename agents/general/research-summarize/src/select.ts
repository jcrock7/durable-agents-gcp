import type { SearchHit } from "./types.js";

/**
 * Pick up to `max` distinct articles from several result lists, taking each query's best hit
 * first, then each query's second hit, and so on, so every query contributes. Pure and
 * deterministic, so it is safe to call from workflow code.
 */
export function selectSources(resultsPerQuery: SearchHit[][], max: number): SearchHit[] {
  const chosen: SearchHit[] = [];
  const seen = new Set<string>();
  const depth = Math.max(0, ...resultsPerQuery.map((hits) => hits.length));
  for (let rank = 0; rank < depth && chosen.length < max; rank++) {
    for (const hits of resultsPerQuery) {
      const hit = hits[rank];
      if (!hit) continue;
      const key = hit.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      chosen.push(hit);
      if (chosen.length === max) break;
    }
  }
  return chosen;
}
