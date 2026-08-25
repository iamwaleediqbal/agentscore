import type { NextConfig } from "next";

const config: NextConfig = {
  // Served as-is rather than through Vercel's image optimizer. The files are
  // already small, and this keeps the deployment off a metered feature.
  images: { unoptimized: true },
  // Type and lint errors fail the build. A green deploy that skipped both is
  // not a signal, and this repo exists to be read as evidence.
  typescript: { ignoreBuildErrors: false },
  eslint: { ignoreDuringBuilds: false },
  // The dev overlay badge sits in the bottom-left corner of the viewport, which
  // is inside every screenshot the runner takes. Those screenshots are
  // committed and shown to visitors as evidence of a run, so a development
  // affordance must not appear in them.
  devIndicators: false,
};

export default config;
