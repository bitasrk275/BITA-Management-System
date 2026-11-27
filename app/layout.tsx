import type { Metadata, Viewport } from "next";
import { Barlow, Barlow_Condensed, Geist_Mono } from "next/font/google";
import "./globals.css";

// Barlow comes from road and plant signage lettering: plain, readable at a glance (DESIGN.md).
const barlow = Barlow({ subsets: ["latin"], weight: ["400", "500", "600", "700"], variable: "--font-barlow" });
const barlowCondensed = Barlow_Condensed({ subsets: ["latin"], weight: ["600", "700"], variable: "--font-barlow-condensed" });
const geistMono = Geist_Mono({ subsets: ["latin"], variable: "--font-geist-mono" });

export const metadata: Metadata = {
  title: "BITA Business Management System",
  description: "Enquiries to payment for Bangalore Inspection & Testing Agency",
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#ffffff",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" className={`${barlow.variable} ${barlowCondensed.variable} ${geistMono.variable}`}>
      <body className="antialiased">{children}</body>
    </html>
  );
}
