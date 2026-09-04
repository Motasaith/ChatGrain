/**
 * What an agent's state should say on screen.
 *
 * The stored status has five values - draft, training, ready, error, paused -
 * and one of them is doing two jobs. A crawl that has found its pages and is
 * waiting for somebody to approve them is stored as `training`, because there
 * is no other value for it, so the interface says "training" about an agent
 * that is not training and will not train until the person reading that word
 * does something.
 *
 * A tester read it exactly as written: the crawl looked stuck. It was not
 * stuck, it was waiting for them.
 *
 * Fixed here rather than in the database on purpose. Adding a value to the
 * status enum means a migration, and in Postgres a new enum value cannot be
 * added and used in the same transaction - a trap this project has already
 * fallen into once. Nothing about the stored state is wrong; only the word
 * chosen to describe it was, and that is a presentation decision.
 */

export type AgentDisplayStatus = {
  label: string;
  /** Which status-pill palette to use. */
  tone: "draft" | "training" | "ready" | "error" | "paused" | "review";
};

export function agentDisplayStatus(
  status: string,
  { awaitingReview = false }: { awaitingReview?: boolean } = {},
): AgentDisplayStatus {
  // Only meaningful against "training": an agent that is paused or has failed
  // is describing something the review does not change.
  if (awaitingReview && status === "training") {
    return { label: "needs review", tone: "review" };
  }
  return {
    label: status,
    tone: (["draft", "training", "ready", "error", "paused"].includes(status)
      ? status
      : "draft") as AgentDisplayStatus["tone"],
  };
}
