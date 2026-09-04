import { describe, expect, it } from "vitest";
import { agentDisplayStatus } from "./display-status";

/**
 * What the status pill says.
 *
 * The stored enum has one value doing two jobs: a crawl that has found its
 * pages and is waiting for approval is stored as `training`, because there is
 * no other value for it. A tester read "training" about an agent that was
 * waiting for them and reported the crawl as stuck - correctly, from what the
 * screen said.
 */
describe("what an agent's state says on screen", () => {
  it("passes ordinary states through unchanged", () => {
    for (const status of ["draft", "training", "ready", "error", "paused"]) {
      expect(agentDisplayStatus(status)).toEqual({ label: status, tone: status });
    }
  });

  it("says a review is waiting rather than that work is happening", () => {
    expect(agentDisplayStatus("training", { awaitingReview: true })).toEqual({
      label: "needs review",
      tone: "review",
    });
  });

  /**
   * A pending review says nothing useful about an agent that is paused or has
   * failed - those describe something the approval will not change, and
   * overwriting them would hide the more important fact.
   */
  it("does not override a state the review cannot resolve", () => {
    expect(agentDisplayStatus("paused", { awaitingReview: true }).label).toBe(
      "paused",
    );
    expect(agentDisplayStatus("error", { awaitingReview: true }).label).toBe(
      "error",
    );
    expect(agentDisplayStatus("ready", { awaitingReview: true }).label).toBe(
      "ready",
    );
  });

  /**
   * The status arrives as a string from the database. An unrecognised value
   * must still produce a usable class name rather than `status-undefined`,
   * which styles as nothing at all and looks like a rendering fault.
   */
  it("falls back to a known tone for a value it does not recognise", () => {
    expect(agentDisplayStatus("archived")).toEqual({
      label: "archived",
      tone: "draft",
    });
  });
});
