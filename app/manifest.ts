import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "Dandelion",
    short_name: "Dandelion",
    description: "Menstrual-health supply pilot",
    start_url: "/home",
    display: "standalone",
    background_color: "#fafaf9",
    theme_color: "#7c3aed",
    lang: "sw",
    icons: [
      { src: "/icons/icon-192.svg", sizes: "192x192", type: "image/svg+xml", purpose: "any" },
      { src: "/icons/icon-512.svg", sizes: "512x512", type: "image/svg+xml", purpose: "any" },
    ],
  };
}
