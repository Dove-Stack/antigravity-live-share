import { defineConfig } from "blume";

export default defineConfig({
  title: "Antigravity Live Share",
  description:
    "Real-time collaborative development for the Antigravity IDE — sessions, presence, CRDT text sync, and a glassmorphism UI.",
  logo: {
    text: "Antigravity Live Share",
  },

  github: {
    owner: "Dove-Stack",
    repo: "antigravity-live-share",
  },

  theme: {
    accent: "purple",
    radius: "lg",
    background: {
      light: "#f4f4f5",
      dark: "#0b0a12",
    },
  },

  search: {
    provider: "orama",
  },

  seo: {
    og: { enabled: true },
    rss: { enabled: true, types: ["blog", "changelog"] },
    sitemap: true,
    robots: true,
    structuredData: true,
  },

  deployment: {
    output: "static",
    site: "https://dove-stack.github.io/antigravity-live-share",
  },

  i18n: {
    defaultLocale: "en",
    locales: [
      { code: "en", label: "English" },
      { code: "es", label: "Español" },
    ],
  },

  versions: {
    current: { label: "v0.1", badge: "Latest" },
    archived: [],
  },

  lastModified: true,
});
