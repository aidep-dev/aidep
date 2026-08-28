import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // /replacements folded into the register on 2026-08-27; the lookup lives at /dead#check.
  redirects: async () => [{ source: "/replacements", destination: "/dead#check", permanent: true }],
};

export default nextConfig;
