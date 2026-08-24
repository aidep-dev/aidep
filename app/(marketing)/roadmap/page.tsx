import { readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import { marked } from "marked";

/**
 * ROADMAP.md, rendered as-is from the repo root so the public page can never
 * drift from the committed one. Same renderer and styles as the handbook.
 */
export const dynamic = "force-static";

export const metadata: Metadata = {
  title: "Roadmap · aidep",
  description: "What aidep is doing and why, with dates. Public because it should be.",
};

export default async function RoadmapPage() {
  const body = await readFile(path.join(process.cwd(), "ROADMAP.md"), "utf8");
  return (
    <div className="mx-auto max-w-3xl px-6 pb-20 pt-16">
      {/* Content is authored by us and checked into this repo, never user input. */}
      <div className="handbook-prose" dangerouslySetInnerHTML={{ __html: await marked.parse(body) }} />
    </div>
  );
}
