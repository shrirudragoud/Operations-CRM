import type { NextConfig } from "next";

// Security headers (docs/PRODUCTION_STANDARDS.md "Security"). The CSP allows the Supabase project for
// auth + data calls; everything else is same-origin. Next needs 'unsafe-inline' for its runtime
// styles/scripts unless nonces are wired up (tracked in docs/HANDOFF.md known gaps).
const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const supabaseWs = supabaseUrl.replace(/^https:/, "wss:");
// Voice mode: the browser opens a Gemini Live socket directly with a short-lived token (never the key).
const liveWs = (process.env.GEMINI_API_BASE || "https://generativelanguage.googleapis.com").replace(/\/+$/, "").replace(/^http/, "ws");
const isDev = process.env.NODE_ENV !== "production";

const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${supabaseUrl} https://lh3.googleusercontent.com`,
  "font-src 'self' data:",
  `connect-src 'self' ${supabaseUrl} ${supabaseWs} ${liveWs}`,
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const nextConfig: NextConfig = {
  // The e2e tests build a separate copy (NEXT_DIST_DIR=.next-e2e) against the local stack.
  distDir: process.env.NEXT_DIST_DIR ?? ".next",
  // The Docker image sets NEXT_OUTPUT=standalone for a small self-contained server (see Dockerfile).
  output: process.env.NEXT_OUTPUT === "standalone" ? "standalone" : undefined,
  // Every page is per-user and RLS-scoped, so pages render dynamically; Cache Components and
  // partial prefetching are off on purpose (docs/DECISIONS.md D13).
  cacheComponents: false,
  poweredByHeader: false,
  // Uploads arrive through Server Actions: HR papers are one file of up to 10 MB; a request reply can carry 5 (50 MB) plus fields.
  experimental: { serverActions: { bodySizeLimit: "52mb" } },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "Content-Security-Policy", value: csp },
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(self), geolocation=()" },
        ],
      },
    ];
  },
};

export default nextConfig;
