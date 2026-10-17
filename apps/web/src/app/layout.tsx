import type { Metadata, Viewport } from "next";
import { GeistSans } from "geist/font/sans";
import { IBM_Plex_Mono, Libre_Baskerville } from "next/font/google";
import { AppProviders } from "@/components/providers";
import "./globals.css";
import "./auth.css";

const libreBaskerville = Libre_Baskerville({
  subsets: ["latin"],
  weight: ["400", "700"],
  style: ["normal", "italic"],
  variable: "--font-libre-baskerville",
});

const ibmPlexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  weight: ["400", "500"],
  variable: "--font-ibm-plex-mono",
});

export const metadata: Metadata = {
  title: { default: "hale. — your family dashboard", template: "%s · hale." },
  description: "Stay close to your loved one through the conversations and memories they choose to share from Hale on Android.",
  robots: { index: false, follow: false },
};

export const viewport: Viewport = { width: "device-width", initialScale: 1, viewportFit: "cover", themeColor: "#FAF7F5" };

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html
      lang="en"
      data-scroll-behavior="smooth"
      className={`${GeistSans.variable} ${libreBaskerville.variable} ${ibmPlexMono.variable}`}
    >
      <body><AppProviders>{children}</AppProviders></body>
    </html>
  );
}
