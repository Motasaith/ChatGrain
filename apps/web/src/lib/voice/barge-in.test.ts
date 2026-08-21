import { describe, expect, it } from "vitest";
import { isBargeIn } from "./session";

describe("isBargeIn", () => {
  it("abandons the turn when the caller talks over the agent", () => {
    expect(isBargeIn("speaking")).toBe(true);
  });

  // The bug this encodes: "thinking" used to count as an interruption. Speech
  // onset alone was enough - no words needed - so a cough or a passing car
  // during the pause cancelled the answer, and the call dropped back to
  // listening a second after the question having said nothing at all. The first
  // turn lost most often, because the speech model is still loading then and
  // the window is at its widest.
  it("does not treat noise during the pause as an interruption", () => {
    expect(isBargeIn("thinking")).toBe(false);
  });

  it("has nothing to cancel while already listening", () => {
    expect(isBargeIn("listening")).toBe(false);
  });
});
