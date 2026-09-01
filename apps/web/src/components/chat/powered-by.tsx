/**
 * The attribution line at the foot of the widget.
 *
 * One component because there were two identical copies of this markup - the
 * real widget and the homepage's demonstration of it - and they had already
 * drifted apart once by the time either was linked.
 *
 * **It links out, in a new tab.** The widget renders inside an iframe on
 * somebody else's website: a same-tab navigation would replace the *chat panel*
 * with our homepage while leaving the customer's page around it untouched,
 * which looks like the widget has broken rather than like a link was followed.
 * The visitor is also mid-conversation, and taking that away to show them a
 * marketing page is not a trade they agreed to.
 *
 * `rel="noopener noreferrer"`: `noopener` because a page opened with
 * `target="_blank"` can otherwise reach back through `window.opener` and
 * navigate the page that opened it, and `noreferrer` because the customer's
 * site should not be told which of their visitors clicked.
 *
 * The destination is the product's own site, not this installation's URL. This
 * is attribution - "the thing you are talking to is ChatGrain" - and it means
 * the same thing whoever is hosting it.
 */
export function PoweredBy() {
  return (
    <footer>
      Powered by{" "}
      <a
        className="powered-by-link"
        href="https://chatgrain.com"
        rel="noopener noreferrer"
        target="_blank"
      >
        ChatGrain
      </a>
    </footer>
  );
}
