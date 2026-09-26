import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // This project can live inside the home directory, where Turbopack would
  // otherwise infer the wrong project root.
  turbopack: {
    root: process.cwd(),
  },
};

export default nextConfig;
