import type { Metadata } from "next";

import { AppShell } from "@/components/app-shell";
import { ThemeProvider } from "@/components/theme-provider";
import { TooltipProvider } from "@/components/ui/tooltip";

import "./globals.css";

/**
 * The deployed origin. `metadataBase` is what turns the generated
 * opengraph-image into an absolute URL — LinkedIn and Slack will not fetch a
 * relative one, so without this the card silently has no picture.
 */
const SITE = process.env.NEXT_PUBLIC_SITE_URL ?? "https://agentscore-sigma.vercel.app";

const DESCRIPTION =
  "Run agents against a live application and grade the state they leave behind.";

export const metadata: Metadata = {
  metadataBase: new URL(SITE),
  title: { default: "agentscore", template: "%s — agentscore" },
  description: DESCRIPTION,
  openGraph: {
    type: "website",
    url: SITE,
    siteName: "agentscore",
    title: "agentscore — an evaluation harness for computer-use agents",
    description: DESCRIPTION,
  },
  twitter: {
    card: "summary_large_image",
    title: "agentscore — an evaluation harness for computer-use agents",
    description: DESCRIPTION,
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider>
          <TooltipProvider delayDuration={200}>
            <AppShell>{children}</AppShell>
          </TooltipProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
