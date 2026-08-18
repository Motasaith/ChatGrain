import { describe, expect, it } from "vitest";
import { htmlToText } from "./html-text";
import { uploadKindFor } from "./upload-kinds";

describe("uploaded HTML", () => {
  it("keeps adjacent blocks from welding into one token", () => {
    // The same defect the crawler had: `.text()` concatenates text nodes with
    // no separator, so a heading runs straight into the paragraph under it.
    const text = htmlToText(
      `<html><body><main>
         <div class="step"><span>2</span><h3>See it instantly</h3>
           <p>Our parser reads the message on your device.</p></div>
       </main></body></html>`,
    );
    expect(text).not.toContain("instantlyOur");
    expect(text).not.toContain("2See");
    expect(text).toContain("See it instantly");
  });

  it("keeps list items and table cells separately searchable", () => {
    const text = htmlToText(
      `<html><body><main>
         <ul><li>EML</li><li>MSG</li><li>MBOX</li></ul>
         <table><tr><td>HEIC</td><td>Yes</td></tr></table>
       </main></body></html>`,
    );
    expect(text).not.toMatch(/EMLMSG|MSGMBOX|HEICYes/);
    for (const format of ["EML", "MSG", "MBOX", "HEIC"]) {
      expect(text).toMatch(
        new RegExp(`(?:^|[^A-Za-z])${format}(?:[^A-Za-z]|$)`),
      );
    }
  });

  it("drops page chrome that answers nothing", () => {
    const text = htmlToText(
      `<html><body><nav>Home Pricing</nav><main><p>Refunds take thirty days.</p></main><footer>Copyright</footer></body></html>`,
    );
    expect(text).toContain("Refunds take thirty days.");
    expect(text).not.toContain("Home Pricing");
    expect(text).not.toContain("Copyright");
  });
});

describe("upload kinds", () => {
  it("routes each supported extension to a parser", () => {
    expect(uploadKindFor("report.pdf")).toBe("pdf");
    expect(uploadKindFor("Book1.XLSX")).toBe("spreadsheet");
    expect(uploadKindFor("data.csv")).toBe("csv");
    expect(uploadKindFor("notes.md")).toBe("text");
    expect(uploadKindFor("page.html")).toBe("html");
  });

  it("refuses anything with no parser", () => {
    // Reaching the worker with an unreadable file would turn a clear upload
    // error into a failed job the operator has to go and read.
    expect(uploadKindFor("drawing.dwg")).toBeNull();
    expect(uploadKindFor("archive.zip")).toBeNull();
    expect(uploadKindFor("noextension")).toBeNull();
  });
});
