import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * Clock and randomness read during a client component's first render.
 *
 * `useState(() => expiresAt - Date.now())` looks harmless and is not. The
 * initialiser runs once on the server while the HTML is produced and again in
 * the browser during hydration, and between those two moments time passes - so
 * the server writes "26" into the markup, the client computes "25", React finds
 * they disagree and throws the whole tree away to render it again.
 *
 * It is a bad failure to be left to find by hand. Nothing warns at build time,
 * the page still works, and the error only appears when somebody happens to
 * open the component during the second where the two answers differ. The
 * impersonation banner carried exactly this for the whole of its life before
 * anyone saw it.
 *
 * The rule: a value that depends on *now* has no correct server rendering, so
 * it must start as null and be filled in by an effect after mount.
 */

const ROOT = join(import.meta.dirname, "..");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

/**
 * The text inside each `useState(...)` call.
 *
 * Not named for what it scans for: a function whose name begins with "use" is
 * read by the lint rules as a React hook, and calling one in a loop is an
 * error.
 *
 * Counts parentheses rather than matching a regex, because the argument is
 * usually an arrow function and `useState\([^)]*\)` stops at the `)` of `() =>`
 * - which is before the interesting part and would pass everything.
 *
 * The opening is matched with a pattern rather than a literal so that
 * `useState<number>(Date.now())` is scanned too. A guard that a type annotation
 * is enough to slip past is worse than no guard, because it is trusted.
 */
function stateInitialisers(source: string) {
  const found: string[] = [];
  const opening = /\buseState\s*(<[^(]*>)?\s*\(/g;
  let match: RegExpExecArray | null;
  while ((match = opening.exec(source))) {
    const open = match.index + match[0].length - 1;
    let depth = 0;
    let index = open;
    for (; index < source.length; index += 1) {
      if (source[index] === "(") depth += 1;
      else if (source[index] === ")") {
        depth -= 1;
        if (depth === 0) break;
      }
    }
    found.push(source.slice(open + 1, index));
    opening.lastIndex = index + 1;
  }
  return found;
}

describe("hydration safety", () => {
  const files = tsxFiles(join(ROOT, "..")).filter((file) =>
    readFileSync(file, "utf8").startsWith('"use client"'),
  );

  it("finds client components to check", () => {
    // Guards the guard: a broken path or a changed directive would make the
    // assertion below pass against an empty list.
    expect(files.length).toBeGreaterThan(10);
  });

  it("does not seed state from the clock or from randomness", () => {
    const offenders: string[] = [];
    for (const file of files) {
      const source = readFileSync(file, "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      for (const argument of stateInitialisers(source)) {
        if (/\bDate\.now\(\)|\bMath\.random\(\)|new Date\(\)/.test(argument)) {
          offenders.push(
            `${file.slice(ROOT.length + 1).replace(/\\/g, "/")}: useState(${argument.trim().slice(0, 60)})`,
          );
        }
      }
    }
    expect(offenders).toEqual([]);
  });
});
