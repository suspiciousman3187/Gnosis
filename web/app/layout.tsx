import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import NextTopLoader from 'nextjs-toploader';
import PageTransition from '@/components/PageTransition';
import DialogHost from '@/components/DialogHost';
import TooltipHost from '@/components/TooltipHost';
import SiteFooter from '@/components/SiteFooter';
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "GNOSIS",
  description: "Encounter tracking and analytics for Final Fantasy XI.",
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en" data-theme="gnosis">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <NextTopLoader color="#f0c062" shadow="0 0 10px #f0c062,0 0 5px #f5d088" showSpinner={false} />
        <div className="styx-bg" />
        <PageTransition>{children}</PageTransition>
        <SiteFooter />
        <DialogHost />
        <TooltipHost />
      </body>
    </html>
  );
}
