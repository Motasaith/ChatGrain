/**
 * Keeps plan.html in step with PLAN.md.
 *
 * The page renders from, and the copy button hands over, one embedded copy of the
 * markdown. This splices the current file into that copy so the readable version
 * and the paste-able version can never disagree.
 */
import { readFileSync, writeFileSync } from "node:fs";

const md = readFileSync("PLAN.md", "utf8");

// Everything from the first numbered section onward is the brief itself; the
// lines above it are instructions about the brief and belong on the page's
// masthead instead.
const start = md.indexOf("## 0.");
if (start === -1) throw new Error("Could not find the first section heading");
const body = md.slice(start).trim();

if (body.includes("</script>")) throw new Error("Body would close the script tag early");

const html = readFileSync("plan.html", "utf8");
const open = '<script type="text/plain" id="src">';
const a = html.indexOf(open);
const b = html.indexOf("</script>", a);
if (a === -1 || b === -1) throw new Error("Could not find the embedded source block");

const next = html.slice(0, a + open.length) + "\n" + body + "\n" + html.slice(b);
writeFileSync("plan.html", next);

const sections = [...body.matchAll(/^## \d+\./gm)].length;
console.log(`synced: ${body.length.toLocaleString()} characters, ${sections} sections`);
