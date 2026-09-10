import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Minimal self-contained production server image (see
  // frontend/Dockerfile) -- the standalone output still requires public/
  // and .next/static to be copied in manually alongside it, which the
  // Dockerfile does explicitly (this is exactly where the MapLibre worker
  // assets under public/maplibre-gl/ would go missing if forgotten).
  output: "standalone",
};

export default nextConfig;
