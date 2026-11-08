import type { Metadata } from "next";
import localFont from "next/font/local";
import { site } from "@/lib/site";
import "./globals.css";

// Recursive 1.085 (Latin subset from Fontsource 5.3.0), instanced to the
// weight 400 to 900 and MONO axes with CASL 0, slnt 0, and CRSV 0.5 pinned.
// License in fonts/OFL.txt.
const recursive = localFont({
  src: "./fonts/recursive-latin-wght-mono.woff2",
  variable: "--font-recursive",
  weight: "400 900",
  display: "swap",
});

export const metadata: Metadata = {
  title: site.name,
  description: site.tagline,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${recursive.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
