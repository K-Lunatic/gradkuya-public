import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "졸업할KU야",
    short_name: "졸업할KU야",
    description: "건국대학교 GLOCAL 졸업 요건과 시간표를 한 번에 관리하세요.",
    start_url: "/",
    display: "standalone",
    background_color: "#f5f8f6",
    theme_color: "#006b4f",
    lang: "ko",
    orientation: "any",
    icons: [{ src: "/app-icon.svg", sizes: "any", type: "image/svg+xml", purpose: "any" }],
  };
}
