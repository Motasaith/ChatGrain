/**
 * What each release of this application is for.
 *
 * Compiled in rather than read from the markdown at request time, and that is a
 * deliberate trade. Parsing `RELEASE-*.md` on the server would keep one copy of
 * the text, but it would put the admin dashboard at the mercy of the deployment
 * layout - the documents live at the repository root, two levels above the
 * application, and a build that does not ship them would leave the panel empty
 * on production while working perfectly on a developer's machine. A summary
 * that is wrong on the only machine that matters is worse than one that has to
 * be kept in step by hand.
 *
 * What keeps it in step is `catalog.test.ts`, which fails when a release
 * document exists with no entry here.
 *
 * The documents remain the full account. This is the summary an administrator
 * needs to answer "what is running, what is it for, and where does a change
 * belong" without leaving the dashboard.
 */

export type ReleaseStatus =
  /** Tagged, fixed, and safe to return to. */
  | "stable"
  /** Deployed and still accepting changes. Not tagged. */
  | "open"
  /** Written down, not built. */
  | "planned";

export type Release = {
  version: string;
  status: ReleaseStatus;
  /** Released, for a stable one; last deployed, for an open one. */
  date: string;
  /** What reverting means: the commit to return to. */
  restorePoint: string;
  /** One sentence. What this release is about. */
  headline: string;
  /**
   * The subjects this release owns.
   *
   * Verbatim from each document's "where a change belongs" table, because that
   * is the question the panel exists to answer: a fix to the crawler belongs to
   * 0.4.0 however long ago that shipped, and putting it in the newest release
   * scatters one argument across two documents.
   */
  owns: string[];
  /** What was actually done. */
  highlights: string[];
  /** Stated rather than solved. Empty for a finished release. */
  unproven: string[];
  /** The full account. */
  document: string;
};

/**
 * Newest first.
 *
 * Kept in one array rather than split by status so that "which of these is
 * stable" is answered by reading the field, not by knowing which list to look
 * in.
 */
export const RELEASES: Release[] = [
  {
    version: "0.6.0",
    status: "open",
    date: "2026-09-01",
    restorePoint: "5df6866 — the last commit of 0.5.0",
    headline:
      "How the software looks and feels to use, rather than whether it works — the widget a visitor sees, and the dashboard a customer works in.",
    owns: [
      "How the widget and dashboard look and behave",
      "Accessibility, keyboard, focus, responsiveness",
      "The presentation of what the agent says — not its wording",
    ],
    highlights: [
      "The attribution line in the widget is a link, opening in a new tab so a visitor's conversation is not replaced by a marketing page.",
      "The Copy button on the install snippet confirms what it did, and works over plain HTTP where the clipboard API does not exist.",
    ],
    unproven: [
      "Nothing in this release has been deployed.",
      "The three releases before it each made something work rather than making it pleasant, so the arrears here are large and mostly still unmeasured.",
    ],
    document: "RELEASE-0.6.0.md",
  },
  {
    version: "0.5.0",
    status: "open",
    date: "2026-09-01",
    restorePoint: "f9144d3 — the last commit of 0.4.0",
    headline:
      "Operating other people's accounts: seeing what a customer sees, reproducing their fault, and fixing it without asking them to approve anything.",
    owns: [
      "The admin dashboard",
      "Impersonation and its three tiers",
      "Cross-account control over jobs, agents, sources and workspaces",
      "Per-workspace limits, and what things cost",
    ],
    highlights: [
      "Impersonation in three tiers — look, sandbox, or edit — where a sandbox lets you talk to a customer's agent and throws the conversation away afterwards.",
      "Editing sessions copy the configuration on the way in, so anything done can be undone on the way out, or rolled back days later from this dashboard.",
      "Stop a crawl, pause an agent, re-index a source, suspend or delete a workspace — per account, without restarting anything for anybody else.",
      "Per-workspace page limits and re-crawl floors, which used to be environment variables that applied to everyone.",
      "Usage counted per workspace per day, so 'which account is expensive' has an answer.",
      "Every administrator action, and every request made while impersonating, written into the audit trail of the account it affected.",
    ],
    unproven: [
      "No editing session has ever been run against a real workspace. The snapshot, diff and restore are tested against constructed data only.",
      "Re-indexing cannot be undone. Everything else in an editing session can.",
      "The restore is row by row, not one transaction, so a failure halfway leaves the configuration partly restored.",
      "Sandbox conversations are hidden by filters in four queries rather than by the schema, so a fifth query written later would show them.",
    ],
    document: "RELEASE-0.5.0.md",
  },
  {
    version: "0.4.0",
    status: "open",
    date: "2026-08-26",
    restorePoint: "a0d45bb — nine commits on the v0.3.0 tag",
    headline:
      "The machinery that builds the knowledge, and the honesty of what the agent says about it.",
    owns: [
      "Crawling, indexing, the worker and the queue",
      "Retrieval, evidence selection and the system prompt",
      "What the widget says, including refusals and citations",
    ],
    highlights: [
      "The worker survives its own restarts: a job resumes rather than starting over, and a deploy no longer burns a retry.",
      "Crawling asks before it indexes: URLs are discovered, reviewed and approved, so the page count stops climbing while somebody watches it.",
      "Sitemaps are tried first and the strategy is reported — 6,428 URLs in 22 seconds where link-walking reached 17,447 in two days without finishing.",
      "Crawler traps refused, and pages that need JavaScript detected with a switch to render them.",
      "The system prompt is layered, so a customer's own instructions cannot be used to talk the agent out of its limits.",
      "Answers decline honestly instead of inventing, and say what they could not find.",
    ],
    unproven: [
      "Retrieval still cannot surface a page that is the answer without looking like the question.",
      "A corpus cannot be counted — there is no way to ask how much of a site is actually indexed.",
      "Intermittent database disconnects seen during this release are still unexplained, and look like the hosted database rather than this code.",
    ],
    document: "RELEASE-0.4.0.md",
  },
  {
    version: "0.3.0",
    status: "stable",
    date: "2026-08-20",
    restorePoint: "the v0.3.0 tag",
    headline:
      "The first release where a question asked in the widget is known to travel the whole pipeline intact.",
    owns: ["The last fixed point. Nothing new belongs here."],
    highlights: [
      "Three separate faults meant the generation model was never reached at all; every answer users saw was assembled by a fallback that copied sentences out of the indexed text.",
      "Fixing that is the substance of the release — everything else follows from being able to reach the model.",
      "Provider selection asks each provider which model it actually serves, rather than assuming.",
    ],
    unproven: [],
    document: "VERSION.md",
  },
];

/** The one tagged release, which is what reverting ultimately means. */
export function stableRelease() {
  return RELEASES.find((release) => release.status === "stable") ?? null;
}

/**
 * Where a change belongs.
 *
 * Releases here are split by subject rather than by date, which is unusual
 * enough to be worth surfacing: a crawler fix made today still belongs to
 * 0.4.0, because that is where the reasoning about crawling lives. Splitting it
 * by when it happened would scatter one argument across two documents.
 */
export const RELEASE_ROUTING_NOTE =
  "Releases are split by subject, not by date. A crawler fix made today still belongs to 0.4.0, because that is where the reasoning about crawling lives.";
