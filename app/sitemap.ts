import { readdir } from "node:fs/promises";
import path from "node:path";
import type { MetadataRoute } from "next";

const base = process.env.APP_URL ?? "https://aidep.dev";

export default async function sitemap(): Promise<MetadataRoute.Sitemap> {
  const handbook = (await readdir(path.join(process.cwd(), "handbook")))
    .filter((f) => f.endsWith(".md") && f !== "index.md")
    .map((f) => `/handbook/${f.replace(/\.md$/, "")}`);
  return ["/", "/pricing", "/security", "/dead", "/handbook", ...handbook].map((route) => ({
    url: `${base}${route}`,
  }));
}
