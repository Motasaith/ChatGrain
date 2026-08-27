import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * The browser refuses `window.prompt` in some contexts and throws
 * "prompt() is not supported" when it does. That is not a warning in a console
 * somewhere - it is an uncaught error thrown at the moment a button is clicked,
 * so the control does nothing and the page shows a crash overlay. It reached
 * production behaviour in the admin dashboard, where every one of the new
 * controls asked for confirmation this way.
 *
 * `confirm` and `alert` are blocked in the same situations, so all three are
 * banned together rather than waiting to be caught one at a time.
 *
 * This is a source check rather than a rendering test because there is no DOM
 * environment configured here - and it is the better test regardless. What
 * matters is that nobody reintroduces the call, and that is a property of the
 * source, not of one component's behaviour.
 */

const ROOT = join(import.meta.dirname, "..");

function tsxFiles(dir: string): string[] {
  return readdirSync(dir).flatMap((entry) => {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) return tsxFiles(path);
    return path.endsWith(".tsx") ? [path] : [];
  });
}

describe("blocking browser dialogs", () => {
  const files = tsxFiles(ROOT);

  it("finds components to check", () => {
    // Guards the guard: a broken path would make every assertion below pass
    // against an empty list.
    expect(files.length).toBeGreaterThan(20);
  });

  it("is not used anywhere in a component", () => {
    const offenders = files.filter((file) => {
      const source = readFileSync(file, "utf8")
        // Comments name these functions when explaining why they are not used,
        // and prose is not a call.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "");
      return /\bwindow\.(prompt|confirm|alert)\s*\(/.test(source);
    });

    expect(
      offenders.map((file) => file.slice(ROOT.length + 1).replace(/\\/g, "/")),
    ).toEqual([]);
  });
});
