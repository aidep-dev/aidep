import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  // /replacements folded into the register on 2026-08-27; the lookup lives at /dead#check.
  redirects: async () => [{ source: "/replacements", destination: "/dead#check", permanent: true }],
  // no CSP: the inline theme script in app/layout.tsx would need a nonce
  headers: async () => [
    {
      source: "/:path*",
      headers: [
        { key: "X-Content-Type-Options", value: "nosniff" },
        { key: "X-Frame-Options", value: "DENY" },
        { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      ],
    },
  ],
};

export default nextConfig;
