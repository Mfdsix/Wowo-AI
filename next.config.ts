import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // pdfjs-dist (dipake pdf-parse) butuh dynamic import pdf.worker.mjs —
  // di-external biar gak dibundle Next & worker bisa di-resolve dari node_modules
  serverExternalPackages: ["pdf-parse", "pdfjs-dist"],
};

export default nextConfig;
