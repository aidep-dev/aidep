#!/usr/bin/env node
import { existsSync } from "node:fs";
import { gunzipSync } from "node:zlib";
import { loadRegistry } from "../src/registry.ts";
import { loadLocalDir } from "../src/scanner/local.ts";
import { scanFiles } from "../src/scanner/scan.ts";
import { renderMarkdownReport } from "../src/scanner/report.ts";
import { untarToFiles } from "../src/scanner/tarball.ts";

const target = process.argv[2];
if (target === undefined || target === "") {
  console.error("usage: aidep <local-dir | owner/repo>");
  process.exit(1);
}

// Dev reads the sibling checkout; the published CLI reads the registry repo
// over https, so a stranger's machine needs nothing but this package.
const SIBLING_REGISTRY = "../aidep-registry/registry";
const PUBLISHED_REGISTRY = "https://raw.githubusercontent.com/aidep-dev/aidep-registry/master/registry";

const now = new Date().toISOString().slice(0, 10);
const rows = await loadRegistry(
  process.env.REGISTRY_SOURCE ?? (existsSync(SIBLING_REGISTRY) ? SIBLING_REGISTRY : PUBLISHED_REGISTRY),
);

if (existsSync(target)) {
  const files = await loadLocalDir(target);
  console.log(renderMarkdownReport(scanFiles(files, rows), { now, repoLabel: target }));
} else if (/^[\w.-]+\/[\w.-]+$/.test(target)) {
  const token = process.env.GITHUB_TOKEN;
  if (token === undefined || token === "") {
    console.error(`GITHUB_TOKEN is not set; it is required to fetch ${target} from GitHub.`);
    process.exit(1);
  }
  const res = await fetch(`https://api.github.com/repos/${target}/tarball`, {
    headers: { authorization: `Bearer ${token}`, "user-agent": "aidep-scan" },
  });
  if (!res.ok) {
    console.error(`GitHub tarball fetch failed for ${target}: ${res.status} ${res.statusText}`);
    process.exit(1);
  }
  let buf = Buffer.from(await res.arrayBuffer());
  // fetch only auto-decompresses when Content-Encoding is set; the tarball
  // body itself is gzip, so sniff the magic bytes before gunzipping
  if (buf[0] === 0x1f && buf[1] === 0x8b) buf = gunzipSync(buf);
  const files = untarToFiles(buf);
  console.log(renderMarkdownReport(scanFiles(files, rows), { now, repoLabel: target }));
} else {
  console.error(`"${target}" is neither an existing directory nor an owner/repo slug.`);
  process.exit(1);
}
