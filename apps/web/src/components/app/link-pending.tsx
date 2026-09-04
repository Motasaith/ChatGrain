"use client";

import { useLinkStatus } from "next/link";
import { ChevronRight, LoaderCircle } from "lucide-react";

/**
 * The chevron on a card, which becomes a spinner while that card is opening.
 *
 * Opening an agent takes a moment, and until now the only thing that happened
 * in that moment was nothing: the card did not move, no indicator appeared, and
 * a tester reported the application as stuck. An interface that does not
 * acknowledge a click is indistinguishable from one that never received it, and
 * the usual response is to click again.
 *
 * A route-level `loading.tsx` covers the destination, but it only appears once
 * the navigation is under way and it replaces the page the person is still
 * looking at. This covers the other half: the card they actually clicked says
 * so, immediately, and says which one - important when several cards sit side
 * by side and only one is loading.
 *
 * `useLinkStatus` must be called inside the `<Link>` whose state it reports, so
 * this is deliberately tiny. The cards themselves stay server components; only
 * the indicator is client code.
 */
export function LinkPending({ size = 17 }: { size?: number }) {
  const { pending } = useLinkStatus();
  return pending ? (
    <LoaderCircle
      aria-label="Opening"
      className="spin link-pending"
      size={size}
    />
  ) : (
    <ChevronRight size={size} />
  );
}
