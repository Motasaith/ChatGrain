import { CircleCheck, CircleDot, GitBranch } from "lucide-react";
import {
  RELEASES,
  RELEASE_ROUTING_NOTE,
  stableRelease,
  type Release,
} from "@/lib/releases/catalog";

/**
 * What is running, what each release is for, and where a change belongs.
 *
 * Three questions an administrator otherwise has to answer by reading four
 * markdown files in a repository they may not have checked out. The third is
 * the one that is genuinely hard to guess: releases here are split by subject
 * rather than by date, so a crawler fix made this week belongs to 0.4.0 and not
 * to whatever is newest.
 *
 * A server component with no state and no fetching. The content is compiled in,
 * so this cannot fail, cannot be slow, and cannot show a customer's dashboard
 * something it should not.
 */
export function ReleasePanel({ reportedVersion }: { reportedVersion: string }) {
  const stable = stableRelease();
  const open = RELEASES.filter((release) => release.status === "open");

  return (
    <section className="app-card release-card">
      <div className="app-card-head">
        <div>
          <h2>Versions</h2>
          <p>{RELEASE_ROUTING_NOTE}</p>
        </div>
        <GitBranch size={18} />
      </div>

      {/*
        The first thing to say, because it is the thing most likely to be
        misread. The health check reports the tagged version, which is neither
        of the releases actually doing the work - somebody who sees "0.3.0" on a
        server running 0.5.0 needs that explained here rather than discovered.
      */}
      <p className="release-lede">
        This build reports <b>{reportedVersion}</b>, the last tagged release.
        {open.length ? (
          <>
            {" "}
            {open.length === 1 ? "One release is" : `${open.length} releases are`}{" "}
            open on top of it —{" "}
            {open.map((release) => release.version).join(" and ")} — deployed and
            still accepting changes. Neither is tagged, so{" "}
            <b>{stable?.version}</b> remains the fixed point to return to.
          </>
        ) : null}
      </p>

      <div className="release-list">
        {RELEASES.map((release) => (
          <ReleaseEntry key={release.version} release={release} />
        ))}
      </div>
    </section>
  );
}

function ReleaseEntry({ release }: { release: Release }) {
  const stable = release.status === "stable";
  return (
    <article className={`release-entry is-${release.status}`}>
      <header>
        <h3>
          {stable ? <CircleCheck size={14} /> : <CircleDot size={14} />}
          {release.version}
        </h3>
        <i className={`status-pill status-${stable ? "ready" : "running"}`}>
          {release.status}
        </i>
        <time>{release.date}</time>
      </header>

      <p className="release-headline">{release.headline}</p>

      <div className="release-columns">
        <div>
          <h4>Owns</h4>
          <ul className="release-owns">
            {release.owns.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
        <div>
          <h4>What it did</h4>
          <ul>
            {release.highlights.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </div>
      </div>

      {/*
        Shown rather than tucked away. An open release with nothing admitted is
        one nobody has looked at honestly, and the whole reason these stay open
        is that the limitations are real.
      */}
      {release.unproven.length ? (
        <details className="release-unproven">
          <summary>
            {release.unproven.length} thing
            {release.unproven.length === 1 ? "" : "s"} stated rather than solved
          </summary>
          <ul>
            {release.unproven.map((item) => (
              <li key={item}>{item}</li>
            ))}
          </ul>
        </details>
      ) : null}

      <footer>
        <span>
          Revert to <code>{release.restorePoint}</code>
        </span>
        <code>{release.document}</code>
      </footer>
    </article>
  );
}
