import type { Metadata } from "next";
import localFont from "next/font/local";
import { readOptionalConfig } from "@/lib/config";
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

// The icons and the social preview come from the files beside this layout: favicon.ico, icon.svg, apple-icon.png, opengraph-image.png, and twitter-image.png.
export const metadata: Metadata = {
  metadataBase: new URL(readOptionalConfig("APP_URL") ?? site.url),
  title: site.name,
  description: site.tagline,
  openGraph: { type: "website", siteName: site.name, title: `${site.name}. ${site.tagline}`, description: site.description },
  twitter: { card: "summary_large_image", title: `${site.name}. ${site.tagline}`, description: site.description },
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html lang="en" className={`${recursive.variable} h-full antialiased`}>
      <body className="min-h-full">{children}</body>
    </html>
  );
}
