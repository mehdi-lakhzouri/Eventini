import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /**
   * Emits `.next/standalone` — a server carrying only the modules the build
   * actually traced, rather than the whole dependency tree.
   *
   * Required by `web/Dockerfile` (sprint-02 EVT-013). Without it the runtime
   * image needs every package in `dependencies` installed to run
   * `next start`, which is both far larger and a much wider attack surface.
   *
   * The standalone server deliberately does not include `public` or
   * `.next/static` — Next expects a CDN to serve them — so the Dockerfile
   * copies both in, which is what the output docs prescribe for serving them
   * from the container itself.
   */
  output: "standalone",

  /**
   * Drops the `X-Powered-By: Next.js` header. Naming the framework tells a
   * scanner which CVE list to try first and buys nothing in return. The
   * backend strips its equivalent through Helmet (EVT-009); this is the same
   * decision on the other side of the stack.
   */
  poweredByHeader: false,
};

export default nextConfig;
