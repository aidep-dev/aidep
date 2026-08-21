import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { marked } from "marked";

const DIR = path.join(process.cwd(), "handbook");

type Front = { title: string; order: number; body: string };
type Page = Front & { slug: string };

/**
 * Front matter here is ours and hand-written, so this reads the two keys the
 * pages actually use rather than pulling in a YAML parser for them.
 */
function parse(raw: string): Front {
  const match = /^---\n([\s\S]*?)\n---\n/.exec(raw);
  if (match === null) return { title: "Handbook", order: 99, body: raw };
  const front = match[1];
  const title = /^title:\s*(.+)$/m.exec(front)?.[1]?.trim() ?? "Handbook";
  const order = Number(/^order:\s*(\d+)$/m.exec(front)?.[1] ?? 99);
  return { title, order, body: raw.slice(match[0].length) };
}

async function loadAll(): Promise<Page[]> {
  const files = (await readdir(DIR)).filter((f) => f.endsWith(".md"));
  const pages = await Promise.all(
    files.map(async (file) => ({
      slug: file === "index.md" ? "" : file.replace(/\.md$/, ""),
      ...parse(await readFile(path.join(DIR, file), "utf8")),
    })),
  );
  return pages.sort((a, b) => a.order - b.order);
}

async function load(slug: string): Promise<Page | undefined> {
  return (await loadAll()).find((p) => p.slug === slug);
}

function slugOf(params: { slug?: string[] }): string {
  return params.slug?.join("/") ?? "";
}

export async function generateStaticParams() {
  const pages = await loadAll();
  return pages.map((p) => ({ slug: p.slug === "" ? [] : [p.slug] }));
}

export async function generateMetadata({ params }: PageProps<"/handbook/[[...slug]]">): Promise<Metadata> {
  const page = await load(slugOf(await params));
  if (page === undefined) return {};
  return {
    title: `${page.title} · aidep handbook`,
    description: "How aidep works, who it is for, what it promises, and what it costs to run.",
  };
}

export default async function HandbookPage({ params }: PageProps<"/handbook/[[...slug]]">) {
  const slug = slugOf(await params);
  const [page, all] = await Promise.all([load(slug), loadAll()]);
  if (page === undefined) notFound();

  return (
    <div className="mx-auto max-w-3xl px-6 pb-20 pt-16">
      <nav className="label flex flex-wrap gap-x-6 gap-y-2 border-b border-rule pb-4">
        {all.map((p) => (
          <Link
            key={p.slug}
            href={p.slug === "" ? "/handbook" : `/handbook/${p.slug}`}
            aria-current={p.slug === slug ? "page" : undefined}
            className={p.slug === slug ? "text-ink" : "text-ink-muted hover:text-ink"}
          >
            {p.title}
          </Link>
        ))}
      </nav>

      {/* Content is authored by us and checked into this repo, never user input. */}
      <div
        className="handbook-prose mt-10"
        dangerouslySetInnerHTML={{ __html: await marked.parse(page.body) }}
      />
    </div>
  );
}
