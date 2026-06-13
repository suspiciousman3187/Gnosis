import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* /r/<id> used to rewrite into a static Vite SPA in public/r/. It's now a
     proper Next.js route at app/r/[id]/page.tsx so it shares the main app's
     layout + NavBar + auth - no rewrite needed. */
};

export default nextConfig;
