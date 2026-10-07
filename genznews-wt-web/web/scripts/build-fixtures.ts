import { readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { importOutputMd } from "../src/lib/fixtures/importOutputMd";
import type { Article } from "../src/lib/types";

const webDir = fileURLToPath(new URL("..", import.meta.url));
const outputDir = join(webDir, "..", "output");
const target = join(webDir, "src", "lib", "fixtures", "articles.json");

const articles: Article[] = [];
for (const dir of readdirSync(outputDir, { withFileTypes: true })) {
  if (!dir.isDirectory()) continue;
  for (const file of readdirSync(join(outputDir, dir.name)).sort()) {
    if (!file.endsWith(".md")) continue;
    const rel = `${dir.name}/${file}`;
    const article = importOutputMd(readFileSync(join(outputDir, dir.name, file), "utf8"), dir.name);
    if (!article) {
      console.warn(`skipped (could not parse): ${rel}`);
      continue;
    }
    articles.push(article);
  }
}

articles.sort((a, b) =>
  a.publishedAt !== b.publishedAt ? (a.publishedAt < b.publishedAt ? 1 : -1) : a.slug < b.slug ? -1 : 1,
);

writeFileSync(target, `${JSON.stringify(articles, null, 2)}\n`);
console.log(`wrote ${articles.length} articles to ${target}`);
