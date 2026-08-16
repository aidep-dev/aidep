/**
 * Removal of Anthropic sampling args (temperature/top_p/top_k) from
 * single-line literal forms: python kwarg `temperature=0.2`, JS property
 * `temperature: 0.2`, JSON-ish dict `"temperature": 0.2`. Computed or
 * multi-line values are reported as blocked and never touched.
 */

export interface SamplingRemoval {
  content: string;
  /** 1-based line numbers in the input content */
  removed: Array<{ param: string; line: number }>;
  blocked: Array<{ param: string; line: number }>;
}

const VAL = String.raw`-?(?:\d+(?:\.\d+)?|\.\d+)`;

/**
 * `(["']?)temperature\1` covers py kwargs, JS props, and quoted dict keys in
 * one regex; the lookbehind keeps `cfg.temperature = x` assignments out and
 * `(?!=)` skips `==` comparisons.
 */
function keySrc(param: string): string {
  return String.raw`(?<![.\w$])(["']?)${param}\1\s*[:=](?!=)`;
}

export function removeSamplingParams(content: string, params: string[]): SamplingRemoval {
  const lines = content.split("\n");
  const keep = lines.map(() => true);
  const removed: SamplingRemoval["removed"] = [];
  const blocked: SamplingRemoval["blocked"] = [];

  for (const param of params) {
    const occ = new RegExp(keySrc(param));
    // arg preceded by a comma (mid/last position on a shared line)
    const leading = new RegExp(String.raw`,\s*${keySrc(param)}\s*${VAL}(?=\s*[,)\]}]|\s*$)`);
    // arg followed by a comma (first position, or an arg line of its own)
    const trailing = new RegExp(String.raw`${keySrc(param)}\s*${VAL}\s*,\s?`);
    // sole arg, or last arg whose separating comma sits on the line above
    const bare = new RegExp(String.raw`${keySrc(param)}\s*${VAL}(?=\s*[)\]}]|\s*$)`);

    for (let i = 0; i < lines.length; i++) {
      if (!keep[i] || !occ.test(lines[i])) continue;
      let line = lines[i];
      let usedBare = false;
      let hits = 0;
      for (;;) {
        if (leading.test(line)) line = line.replace(leading, "");
        else if (trailing.test(line)) line = line.replace(trailing, "");
        else if (bare.test(line)) {
          line = line.replace(bare, "");
          usedBare = true;
        } else break;
        hits++;
        if (!occ.test(line)) break;
      }
      if (hits > 0) {
        removed.push({ param, line: i + 1 });
        if (line.trim() === "") {
          keep[i] = false;
          if (usedBare) {
            // last-arg-on-its-own-line: the now-dangling comma is on the
            // closest kept line above
            for (let p = i - 1; p >= 0; p--) {
              if (!keep[p]) continue;
              lines[p] = lines[p].replace(/,\s*$/, "");
              break;
            }
          }
        } else {
          lines[i] = line;
        }
      }
      if (line.trim() !== "" && occ.test(line)) blocked.push({ param, line: i + 1 });
    }
  }

  return {
    content: lines.filter((_, i) => keep[i]).join("\n"),
    removed,
    blocked,
  };
}
