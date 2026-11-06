import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import { Analytics } from "@vercel/analytics/next";
import "./globals.css";
import { BugReportButton, FirstVisitTutorial, PwaControls } from "./pwa";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "졸업할KU야 · 졸업, 이제 확실하게",
  description: "건국대학교 GLOCAL 졸업 요건과 시간표를 한 번에 관리하세요.",
  applicationName: "졸업할KU야",
  manifest: "/manifest.webmanifest",
  appleWebApp: { capable: true, statusBarStyle: "default", title: "졸업할KU야" },
  formatDetection: { telephone: false },
};

export const viewport = {
  themeColor: "#006b4f",
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
  interactiveWidget: "resizes-content" as const,
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="ko"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col"><PwaControls /><FirstVisitTutorial /><BugReportButton />{children}<Analytics /></body>
    </html>
  );
}
