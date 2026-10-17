import { defineConfig } from "astro/config";

// SITE_URL feeds canonical and og:url. Set it in Vercel once the custom domain is attached.
export default defineConfig({
  site: process.env.SITE_URL ?? "https://mccoydid.dev",
});
