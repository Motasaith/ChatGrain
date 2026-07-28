import { createHash } from "node:crypto";
import { Readability } from "@mozilla/readability";
import * as cheerio from "cheerio";
import { JSDOM } from "jsdom";

export type ExtractedPage = {
  url: string;
  title: string;
  text: string;
  contentHash: string;
  links: string[];
  description?: string;
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
  const reader = new Readability(dom.window.document, {
    charThreshold: 120,
    keepClasses: false,
  });
  const article = reader.parse();
  const $ = cheerio.load(html);
  const fallback = $("main").text() || $("article").text() || $("body").text();
  const text = (article?.textContent || fallback)
    .replace(/\u00a0/g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/\n\s+/g, "\n")
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

  const title =
    article?.title?.trim() ||
    $("meta[property='og:title']").attr("content")?.trim() ||
    $("title").text().trim() ||
    pageUrl.pathname;

  return {
    url: pageUrl.href,
    title: title.slice(0, 300),
    text,
    contentHash: createHash("sha256").update(text).digest("hex"),
    links: [...links],
    description:
      article?.excerpt ??
      $("meta[name='description']").attr("content")?.trim(),
  };
}
