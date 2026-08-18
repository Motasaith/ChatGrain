import * as cheerio from "cheerio";

/**
 * HTML read from an uploaded file, with the block boundaries a reader sees.
 *
 * `.text()` concatenates text nodes with no separator, so a heading runs
 * straight into the paragraph under it and adjacent list items weld into one
 * unsearchable token. The crawler was fixed for this; uploads went through a
 * second copy of the same mistake.
 */
export function htmlToText(html: string) {
  const $ = cheerio.load(html);
  $("script,style,noscript,nav,footer,form,aside").remove();
  const root = $("main").length
    ? $("main")
    : $("article").length
      ? $("article")
      : $("body");
  root.find("br").replaceWith("\n");
  root
    .find(
      "p,div,section,article,header,h1,h2,h3,h4,h5,h6,li,tr,pre,blockquote,dd,dt,figcaption",
    )
    .each((_, element) => {
      // Both ends: appending alone leaves an inline sibling before the block
      // welded to it, so "<span>2</span><h3>Title</h3>" became "2Title".
      $(element).prepend("\n").append("\n");
    });
  root.find("td,th").each((_, element) => {
    $(element).append(" | ");
  });
  return $.text()
    .replace(/ /g, " ")
    .replace(/[ \t]+/g, " ")
    .replace(/ \| *\n/g, "\n")
    .replace(/[ \t]*\n[ \t]*/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
