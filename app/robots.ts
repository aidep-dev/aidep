import type { MetadataRoute } from "next";

const base = process.env.APP_URL ?? "https://aidep.dev";

export default function robots(): MetadataRoute.Robots {
  return {
    rules: { userAgent: "*", allow: "/", disallow: ["/dashboard", "/api/"] },
    sitemap: `${base}/sitemap.xml`,
  };
}
