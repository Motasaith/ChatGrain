import { describe, expect, it } from "vitest";
import { wasFetched } from "./outcomes";

describe("wasFetched", () => {
  it("counts every outcome that required reading the page", () => {
    for (const outcome of ["indexed", "unchanged", "duplicate", "thin", "redirected"]) {
      expect(wasFetched(outcome), outcome).toBe(true);
    }
  });

  // The regression. Discovery records a URL's existence, not its contents, and
  // it stamps those rows with the job that found them. Counting "discovered" as
  // fetched made the approved crawl skip its whole list and fail outright.
  it("does not count a URL that was only discovered", () => {
    expect(wasFetched("discovered")).toBe(false);
  });

  // A failed fetch has to be retried, not treated as done.
  it("does not count a failure", () => {
    expect(wasFetched("failed")).toBe(false);
    expect(wasFetched("blocked")).toBe(false);
  });
});
