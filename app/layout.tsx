import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({ variable: "--font-geist-sans", subsets: ["latin"] });
const geistMono = Geist_Mono({ variable: "--font-geist-mono", subsets: ["latin"] });

export const metadata: Metadata = {
  title: "ShopBot Check — East Bay Makers Club",
  description: "Visualize and validate ShopBot OpenSBP programs before they reach the machine.",
  icons: { icon: "/favicon.png", shortcut: "/favicon.png" },
  openGraph: {
    title: "ShopBot Check — East Bay Makers Club",
    description: "See the cut before the machine does.",
    type: "website",
    images: [{ url: "/og-shopbot-check.png", width: 1728, height: 910, alt: "ShopBot Check toolpath preflight" }],
  },
  twitter: {
    card: "summary_large_image",
    title: "ShopBot Check — East Bay Makers Club",
    description: "See the cut before the machine does.",
    images: ["/og-shopbot-check.png"],
  },
};

export const viewport: Viewport = {
  themeColor: "#090d0c",
  colorScheme: "dark",
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en">
      <body className={`${geistSans.variable} ${geistMono.variable}`}>{children}</body>
    </html>
  );
}
