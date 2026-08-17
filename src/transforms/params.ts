/**
 * Removal of Anthropic sampling args (temperature/top_p/top_k) from
 * single-line literal forms: python kwarg `temperature=0.2`, JS property
 * `temperature: 0.2`, JSON-ish dict `"temperature": 0.2`. Computed or
 * multi-line values are reported as blocked and never touched.
 *
 * Only kwargs/props that actually sit inside a call or object literal are
 * removed: a standalone `temperature = 0.9` statement, a top-level annotation
 * `temperature: float = 0.9`, and any mention inside a comment are left alone
 * (removing them would orphan later uses or corrupt prose).
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

/** Index where a line comment begins (`#` or `//` outside a string), or the
 * line length when there is none. Quote-aware so a `#`/`//` inside a string
 * does not count. */
function codeEnd(line: string): number {
  let quote: string | null = null;
  for (let j = 0; j < line.length; j++) {
    const ch = line[j];
    if (quote !== null) {
      if (ch === "\\") {
        j++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "#") return j;
    if (ch === "/" && line[j + 1] === "/") return j;
  }
  return line.length;
}

/** Net bracket delta over the code part of `line` up to (not including)
 * `upto`, quote-aware. */
function intraDepth(line: string, upto: number): number {
  let d = 0;
  let quote: string | null = null;
  for (let j = 0; j < upto; j++) {
    const ch = line[j];
    if (quote !== null) {
      if (ch === "\\") {
        j++;
        continue;
      }
      if (ch === quote) quote = null;
      continue;
    }
    if (ch === '"' || ch === "'" || ch === "`") {
      quote = ch;
      continue;
    }
    if (ch === "(" || ch === "[" || ch === "{") d++;
    else if (ch === ")" || ch === "]" || ch === "}") d--;
  }
  return d;
}

/** Bracket depth at the start of each line, quote-reset per line (multi-line
 * strings are rare here and reset only ever biases toward NOT removing). */
function bracketDepths(lines: string[]): number[] {
  const starts: number[] = [];
  let depth = 0;
  for (const line of lines) {
    starts.push(depth);
    depth += intraDepth(line, codeEnd(line));
  }
  return starts;
}

/**
 * @param range optional set of 0-based line indices eligible for removal;
 *   when given, params outside those lines are never touched (used to scope a
 *   model-swap's param drop to the swapped call's own paren region).
 */
export function removeSamplingParams(
  content: string,
  params: string[],
  range?: Set<number>,
): SamplingRemoval {
  const lines = content.split("\n");
  const keep = lines.map(() => true);
  const startDepth = bracketDepths(lines);
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
      if (!keep[i]) continue;
      if (range !== undefined && !range.has(i)) continue;
      const cEnd = codeEnd(lines[i]);
      const found = occ.exec(lines[i]);
      occ.lastIndex = 0;
      // no match, or the only match is inside a comment
      if (found === null || found.index >= cEnd) continue;
      // only a real kwarg/prop lives at bracket depth > 0; a standalone
      // assignment or a top-level annotation sits at depth 0 and is left alone
      if (startDepth[i] + intraDepth(lines[i], found.index) <= 0) continue;
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
