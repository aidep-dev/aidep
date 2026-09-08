import type { MetadataRoute } from "next";

const base = process.env.APP_URL ?? "https://aidep.dev";

export default function robots(): MetadataRoute.Robots {
  return {
    // llms.txt sends agents to /api/registry; the allow is listed first for
    // first-match parsers and is the longer rule for longest-match ones
    rules: { userAgent: "*", allow: ["/", "/api/registry"], disallow: ["/dashboard", "/api/"] },
    sitemap: `${base}/sitemap.xml`,
  };
}
