/**
 * @file Root document shell, metadata, and application-wide font variables.
 *
 * This remains a Server Component. Interactive providers are deliberately
 * mounted at the workbench boundary so the document shell stays static.
 */

import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter } from "next/font/google";
import "./globals.css";
import { cn } from "@/lib/utils";

const geistHeading = Geist({
  subsets: ["latin"],
  variable: "--font-geist-heading",
});

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Resolve — Intent Ranking Workbench",
  description:
    "An inspectable agent that ranks competing task interpretations across conversational context.",
};

/** Renders the required HTML document and applies self-hosted font variables. */
export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={cn(
        "h-full antialiased",
        geistMono.variable,
        inter.variable,
        geistHeading.variable,
      )}
    >
      <body className="flex min-h-full flex-col font-sans">{children}</body>
    </html>
  );
}
