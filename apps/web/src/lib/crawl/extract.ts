import { createHash } from "node:crypto";
import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";
import { decodeHTML } from "entities";
import { JSDOM } from "jsdom";

/**
 * Removes entities that survive HTML parsing.
 *
 * Extraction already decodes once, so anything left is double-encoded in the
 * source (`&amp;amp;`), which is common on sites that escape user content on
 * the way in and again on the way out. Left alone it reaches the index and the
 * model verbatim, and answers end up containing literal "&amp;".
 */
function decodeResidualEntities(value: string) {
  return /&(?:[a-z][a-z0-9]{1,31}|#\d{1,7}|#x[\da-f]{1,6});/i.test(value)
    ? decodeHTML(value)
    : value;
}

export type ExtractedPage = {
  url: string;
  title: string;
  text: string;
  contentHash: string;
  links: string[];
  description?: string;
  publishedAt?: string;
};

export type SiteBrand = {
  name: string;
  logoUrl?: string;
  iconUrl?: string;
  primaryColor: string;
};

export function isSoftNotFound(html: string) {
  const $ = cheerio.load(html);
  const title =
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("title").text().trim();
  return /^(?:404(?:\s+error)?|not found|page not found)(?:\s*[|—–-]|$)/i.test(
    title,
  );
}

function absoluteUrl(value: string | undefined, base: URL) {
  if (!value) return undefined;
  try {
    const url = new URL(value, base);
    return ["http:", "https:"].includes(url.protocol) ? url.href : undefined;
  } catch {
    return undefined;
  }
}

function colorDistance(hex: string) {
  const channels = hex
    .slice(1)
    .match(/.{2}/g)
    ?.map((part) => Number.parseInt(part, 16));
  return channels?.length === 3
    ? Math.max(...channels) - Math.min(...channels)
    : 0;
}

function normalizedHex(value: string) {
  const match = value.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
  if (!match) return undefined;
  const hex =
    match[1].length === 3
      ? [...match[1]].map((channel) => channel.repeat(2)).join("")
      : match[1];
  return `#${hex.toLowerCase()}`;
}

function inlineSvgLogo(
  $: cheerio.CheerioAPI,
  siteName: string | undefined,
) {
  const nameTerms =
    siteName?.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
  const candidates = $("svg")
    .toArray()
    .map((element) => {
      const item = $(element);
      const parent = item.closest("a, header, nav, [class*='brand'], [class*='logo']");
      const label = [
        item.attr("aria-label"),
        item.attr("title"),
        item.attr("id"),
        item.attr("class"),
        parent.attr("aria-label"),
        parent.attr("class"),
        parent.attr("id"),
        parent.text().slice(0, 120),
      ]
        .filter(Boolean)
        .join(" ")
        .toLowerCase();
      let score = /logo|brand/.test(label) ? 10 : 0;
      if (nameTerms.some((term) => label.includes(term))) score += 6;
      if (item.parents("header, nav").length) score += 3;
      if (item.parents("a").length) score += 1;
      return { element, score };
    })
    .filter((candidate) => candidate.score >= 6)
    .sort((a, b) => b.score - a.score);
  const candidate = candidates[0]?.element;
  if (!candidate) return undefined;

  const source = $.html(candidate);
  if (!source || source.length > 40_000) return undefined;
  const sanitized = cheerio.load(source, { xmlMode: true });
  sanitized("script, foreignObject, iframe, object, embed").remove();
  sanitized("*").each((_, element) => {
    if (!("attribs" in element)) return;
    for (const [name, value] of Object.entries(element.attribs)) {
      if (/^on/i.test(name)) sanitized(element).removeAttr(name);
      if (
        /^(?:href|xlink:href)$/i.test(name) &&
        value &&
        !value.startsWith("#")
      ) {
        sanitized(element).removeAttr(name);
      }
    }
  });
  const svg = sanitized("svg").first();
  svg.attr("xmlns", "http://www.w3.org/2000/svg");
  const output = sanitized.xml(svg);
  if (!output || output.length > 40_000) return undefined;
  return `data:image/svg+xml;base64,${Buffer.from(output).toString("base64")}`;
}

export function extractBrand(html: string, pageUrl: URL): SiteBrand {
  const $ = cheerio.load(html);
  const title = $("meta[property='og:site_name']").attr("content")?.trim();
  const fallbackTitle = $("title")
    .text()
    .split(/[|–—-]/)[0]
    .trim();
  const siteName =
    title ||
    fallbackTitle ||
    pageUrl.hostname.replace(/^www\./, "");
  const logo = $("img")
    .toArray()
    .find((element) => {
      const item = $(element);
      return /logo|brand/i.test(
        `${item.attr("class")} ${item.attr("id")} ${item.attr("alt")} ${item.attr("data-testid")}`,
      );
    });
  const logoSource = logo
    ? $(logo).attr("src") ||
      $(logo).attr("data-src") ||
      $(logo).attr("srcset")?.split(",")[0]?.trim().split(/\s+/)[0]
    : undefined;
  const icon =
    $("link[rel='apple-touch-icon']").first().attr("href") ??
    $("link[rel~='icon'][type='image/svg+xml']").first().attr("href") ??
    $("link[rel~='icon'][href$='.svg']").first().attr("href") ??
    $("link[rel~='icon']").first().attr("href");
  const logoUrl =
    absoluteUrl(logoSource, pageUrl) ??
    inlineSvgLogo($, siteName);
  const iconUrl =
    absoluteUrl(icon, pageUrl) ??
    absoluteUrl("/favicon.ico", pageUrl);

  const theme = normalizedHex(
    $("meta[name='theme-color']").attr("content") ?? "",
  );
  const colors = html.match(/#[0-9a-f]{3}(?:[0-9a-f]{3})?\b/gi) ?? [];
  const counts = new Map<string, number>();
  for (const raw of colors) {
    const color = normalizedHex(raw);
    if (!color) continue;
    if (
      colorDistance(color) > 35 &&
      !["#ffffff", "#000000", "#f5f5f5"].includes(color)
    ) {
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
  }
  const frequent = [...counts.entries()].sort((a, b) => b[1] - a[1])[0]?.[0];

  return {
    name: siteName,
    logoUrl,
    iconUrl,
    primaryColor:
      theme ?? frequent ?? "#177e51",
  };
}

/**
 * Elements that end a line of prose. `textContent` ignores layout entirely, so
 * a step card renders as "2See it instantlyOur client-side parser reads..." -
 * three separate blocks welded into one unsearchable string. That text is what
 * gets embedded, keyword-indexed and shown to the model, so the damage is not
 * cosmetic: "EML" inside `<li>EML</li><li>MSG</li>` becomes the token
 * "EMLMSGMBOX", which no query for "EML" can ever match.
 */
const BLOCK_TAGS = new Set([
  "address", "article", "aside", "blockquote", "details", "dd", "div", "dl",
  "dt", "fieldset", "figcaption", "figure", "footer", "form", "h1", "h2", "h3",
  "h4", "h5", "h6", "header", "hgroup", "hr", "li", "main", "nav", "ol", "p",
  "pre", "section", "summary", "table", "tbody", "tfoot", "thead", "tr", "ul",
]);

/** Cells sit side by side, so they need a separator that is not a line break. */
const CELL_TAGS = new Set(["td", "th"]);

/** Never contributes visible text, and its contents are not prose. */
const SKIPPED_TAGS = new Set(["script", "style", "noscript", "template"]);

/**
 * Serialises an element the way a reader sees it rather than the way the DOM
 * stores it. jsdom implements no `innerText`, so the block boundaries have to
 * be reinstated by hand.
 */
export function blockText(root: Element): string {
  let out = "";
  const append = (value: string) => {
    if (!value) return;
    // Nested blocks emit a newline per level, so separators are collapsed
    // rather than stacked. Two survive, because `chunkText` splits on the blank
    // line; a third would only ever be a nesting artefact.
    if (value === "\n" && /\n[ \t]*\n[ \t]*$/.test(out)) return;
    if (value === " | " && (!out || /[\n|]\s*$/.test(out))) return;
    out += value;
  };
  const walk = (node: Node) => {
    if (node.nodeType === 3) {
      out += node.nodeValue ?? "";
      return;
    }
    if (node.nodeType !== 1) return;
    const element = node as Element;
    const tag = element.tagName.toLowerCase();
    if (SKIPPED_TAGS.has(tag)) return;
    if (tag === "br") {
      append("\n");
      return;
    }
    const block = BLOCK_TAGS.has(tag);
    if (block) append("\n");
    else if (CELL_TAGS.has(tag)) append(" | ");
    for (const child of element.childNodes) walk(child);
    if (block) append("\n");
  };
  walk(root);
  return out;
}

/**
 * Share of the page Readability must keep before its result is trusted.
 *
 * Readability is tuned for prose articles. On pages built from cards, grids or
 * tabbed panels - product specs, calculator explainers, documentation - it
 * keeps the single largest block and discards the rest, so a rich page indexes
 * at a fraction of its real content and the agent cannot answer from sections
 * that are plainly on screen.
 */
const READABILITY_MIN_SHARE = 0.55;

/**
 * Picks between Readability's article text and a whole-page reading.
 *
 * The whole-page text comes from a document that already had scripts, nav,
 * footers, asides and forms removed, so falling back to it costs a little
 * boilerplate and recovers whole sections that would otherwise be missing.
 */
export function chooseExtraction(readable: string, wholePage: string) {
  if (!readable) return wholePage;
  if (!wholePage) return readable;
  return readable.length >= wholePage.length * READABILITY_MIN_SHARE
    ? readable
    : wholePage;
}

export function extractPage(html: string, pageUrl: URL): ExtractedPage {
  const dom = new JSDOM(html, { url: pageUrl.href });
  const document = dom.window.document;
  document
    .querySelectorAll(
      [
        "script",
        "style",
        "noscript",
        "nav",
        "footer",
        "form",
        "aside",
        "sup.reference",
        ".mw-editsection",
        ".mw-references-wrap",
        ".reflist",
        ".references",
        ".navbox",
        ".catlinks",
        "[role='navigation']",
      ].join(","),
    )
    .forEach((element) => element.remove());
  for (const heading of document.querySelectorAll("h2, h3")) {
    if (
      /^(references|bibliography|external links|further reading|notes|citations)$/i.test(
        heading.textContent?.replace(/\[.*?]/g, "").trim() ?? "",
      )
    ) {
      let sibling = heading.nextElementSibling;
      while (sibling && sibling.tagName !== heading.tagName) {
        const next = sibling.nextElementSibling;
        sibling.remove();
        sibling = next;
      }
      heading.remove();
    }
  }
  // Read before Readability runs. `parse()` is destructive: it rewrites the
  // document down to the article it chose, so anything read from `document`
  // afterwards is Readability's own output wearing the whole page's name.
  // That made `chooseExtraction` compare a value against itself and always
  // keep the article - on a card grid or a category hub, around a fifth of the
  // page. The fallback that exists to recover those sections could never fire.
  //
  // Taken from the stripped document rather than the raw HTML, so the fuller
  // reading is already free of nav, footer, aside, form and script text.
  const wholePage = document.body ? blockText(document.body).trim() : "";
  const reader = new Readability(dom.window.document, {
    charThreshold: 120,
    keepClasses: false,
  });
  const article = reader.parse();
  const $ = cheerio.load(html);
  // Readability returns `textContent` too, so its output needs the same repair.
  const readable = article?.content
    ? blockText(
        new JSDOM(`<body>${article.content}</body>`).window.document.body,
      ).trim()
    : (article?.textContent?.trim() ?? "");
  const text = decodeResidualEntities(chooseExtraction(readable, wholePage))
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    // Trims each line without eating the blank line between paragraphs: `\s`
    // matches `\n`, so the old `\n\s+` collapsed every paragraph break and left
    // the chunker with a single undifferentiated block.
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();

  const links = new Set<string>();
  $("a[href]").each((_, element) => {
    const value = absoluteUrl($(element).attr("href"), pageUrl);
    if (!value) return;
    const url = new URL(value);
    url.hash = "";
    for (const key of [...url.searchParams.keys()]) {
      if (/^(utm_|fbclid|gclid|ref$)/i.test(key)) {
        url.searchParams.delete(key);
      }
    }
    links.add(url.href);
  });

  // Titles are surfaced directly in citations and answers, so they need the
  // same treatment as the body text.
  const title = decodeResidualEntities(
    article?.title?.trim() ||
      $("meta[property='og:title']").attr("content")?.trim() ||
      $("title").text().trim() ||
      pageUrl.pathname,
  );
  const publishedValue =
    $("meta[property='article:published_time']").attr("content") ??
    $("meta[name='date']").attr("content") ??
    $("meta[name='publish-date']").attr("content") ??
    $("time[datetime]").first().attr("datetime");
  const publishedDate = publishedValue
    ? new Date(publishedValue)
    : undefined;

  return {
    url: pageUrl.href,
    title: title.slice(0, 300),
    text,
    contentHash: createHash("sha256").update(text).digest("hex"),
    links: [...links],
    description: decodeResidualEntities(
      article?.excerpt ??
        $("meta[name='description']").attr("content")?.trim() ??
        "",
    ) || undefined,
    publishedAt:
      publishedDate && !Number.isNaN(publishedDate.getTime())
        ? publishedDate.toISOString()
        : undefined,
  };
}
