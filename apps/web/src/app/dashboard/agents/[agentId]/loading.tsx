/**
 * Shown while an agent is being loaded.
 *
 * Opening an agent takes a moment - the page gathers the agent, its sources,
 * the running job, its pinned answers and a preview token before it can render
 * anything - and until now that moment was completely silent. The card stayed
 * put, nothing moved, and a tester reported it as the application being stuck.
 * That is the correct reading: an interface that does not acknowledge a click
 * is indistinguishable from one that did not receive it.
 *
 * There is a `loading.tsx` at the dashboard level already, but it sits above
 * the whole section and describes a different shape. This one is placed on the
 * agent route itself so the boundary is the segment actually changing, and so
 * the skeleton resembles the studio rather than the list.
 *
 * The shape matters more than the animation. A skeleton laid out like the page
 * that follows makes the wait feel like loading; a generic spinner in the
 * middle of an empty area makes it feel like a stall, because nothing about it
 * says what is coming.
 */
export default function AgentStudioLoading() {
  return (
    <div aria-busy="true" aria-label="Loading agent" className="studio-skeleton">
      <div className="studio-skeleton-head">
        <i className="studio-skeleton-avatar" />
        <div>
          <i className="studio-skeleton-line is-short" />
          <i className="studio-skeleton-line is-name" />
        </div>
      </div>
      <div className="studio-skeleton-tabs">
        {/* Five, because the studio has five tabs and the row should not jump
            width when the real ones arrive. */}
        {[0, 1, 2, 3, 4].map((index) => (
          <i key={index} />
        ))}
      </div>
      <div className="studio-skeleton-panel">
        <i className="studio-skeleton-line is-title" />
        <i className="studio-skeleton-line" />
        <i className="studio-skeleton-line" />
        <i className="studio-skeleton-line is-short" />
      </div>
    </div>
  );
}
