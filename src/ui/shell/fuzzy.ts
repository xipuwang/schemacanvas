/** Subsequence fuzzy score: -1 = no match; higher is better (consecutive runs and word starts win, shorter wins ties). */
export function fuzzyScore(query: string, text: string): number {
  const q = query.trim().toLowerCase();
  if (!q) return 0;
  const s = text.toLowerCase();
  let score = 0;
  let si = 0;
  let run = 0;
  for (const ch of q) {
    if (ch === ' ') continue;
    const at = s.indexOf(ch, si);
    if (at < 0) return -1;
    run = at === si && si > 0 ? run + 1 : 0;
    const wordStart = at === 0 || /[\s._\-/]/.test(s[at - 1]!);
    score += 10 + run * 6 + (wordStart ? 8 : 0) - Math.min(at - si, 8);
    si = at + 1;
  }
  const exact = s.includes(q) ? 40 : 0;
  return score + exact - Math.floor(s.length / 8);
}
