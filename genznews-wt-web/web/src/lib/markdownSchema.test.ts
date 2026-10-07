import rehypeRaw from "rehype-raw";
import rehypeStringify from "rehype-stringify";
import remarkParse from "remark-parse";
import remarkRehype from "remark-rehype";
import { unified } from "unified";
import { describe, expect, test } from "vitest";
import { sanitizePlugins, sanitizeSchema } from "./markdownSchema";

const HOSTILE = [
  "Hi <script>alert(1)</script> there.",
  "",
  '<img src="x" onerror="alert(2)">',
  "",
  '<p onclick="alert(3)" style="color:red">styled</p><style>body{display:none}</style>',
  "",
  '<a href="javascript:alert(4)">raw js</a> <a href="https://ok.example/a">raw ok</a>',
  "",
  "[md js](javascript:alert(5)) [md data](data:text/html,x) [md mail](mailto:a@b.c) [rel](/about)",
  "",
  "![pixel](https://tracker.example/p.gif)",
].join("\n");

// No react-markdown defences here: raw HTML is parsed into elements and no URL
// transform runs, so anything removed below was removed by the sanitize step.
function render(plugins = sanitizePlugins): string {
  return String(
    unified()
      .use(remarkParse)
      .use(remarkRehype, { allowDangerousHtml: true })
      .use(rehypeRaw)
      .use(plugins)
      .use(rehypeStringify)
      .processSync(HOSTILE),
  );
}

describe("markdown sanitize schema", () => {
  test("allows only http, https and mailto hrefs", () => {
    expect(sanitizeSchema.protocols).toEqual({ href: ["http", "https", "mailto"] });
  });

  test("has no image elements or image attributes", () => {
    for (const tag of ["img", "picture", "source"]) expect(sanitizeSchema.tagNames).not.toContain(tag);
    expect(sanitizeSchema.attributes).not.toHaveProperty("img");
  });

  test("strips script and style content", () => {
    expect(sanitizeSchema.strip).toEqual(expect.arrayContaining(["script", "style"]));
  });

  test("the sanitize step alone removes scripts, images, handlers, styles and unsafe links", () => {
    const html = render();
    expect(html).not.toMatch(/<script|alert\(1\)/);
    expect(html).not.toMatch(/<img|tracker\.example/);
    expect(html).not.toMatch(/onerror|onclick/);
    expect(html).not.toMatch(/<style|style=|display:none/);
    expect(html).not.toMatch(/javascript:|data:text/i);
    expect(html).toContain('href="https://ok.example/a"');
    expect(html).toContain('href="mailto:a@b.c"');
    expect(html).toContain('href="/about"');
  });

  test("control: without the sanitize step the same pipeline lets the attacks through", () => {
    const html = render([]);
    expect(html).toMatch(/<script>/);
    expect(html).toMatch(/onerror=/);
    expect(html).toMatch(/javascript:/);
  });
});
