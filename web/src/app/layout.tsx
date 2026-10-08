import type { Metadata } from "next";
import { Geist_Mono, Instrument_Sans, Bricolage_Grotesque } from "next/font/google";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import { AuthProvider } from "@/components/auth/AuthProvider";
import "./globals.css";
import WebFailureReporter from '@/components/WebFailureReporter'

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Body and interface text.
const instrumentSans = Instrument_Sans({
  variable: "--font-instrument",
  subsets: ["latin", "latin-ext"],
  weight: ["400", "500", "600", "700"],
});

// Headlines, plan prices and app names.
const bricolage = Bricolage_Grotesque({
  variable: "--font-bricolage",
  subsets: ["latin", "latin-ext"],
  weight: ["500", "600", "700", "800"],
});

export const metadata: Metadata = {
  title: "VibeBuild - Describe Your App, We Build It",
  description:
    "Build fully functional web apps by describing what you want. AI-powered 5-phase pipeline generates, validates, and deploys your app in minutes.",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon-32x32.png", sizes: "32x32", type: "image/png" },
      { url: "/favicon-16x16.png", sizes: "16x16", type: "image/png" },
    ],
    apple: "/apple-touch-icon.png",
  },
  openGraph: {
    title: "VibeBuild - Describe Your App, We Build It",
    description:
      "Build fully functional web apps by describing what you want. AI-powered app builder.",
    siteName: "VibeBuild",
    type: "website",
  },
};

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  const locale = await getLocale();
  const messages = await getMessages();

  return (
    <html lang={locale} className="dark">
      <body
        className={`${geistMono.variable} ${instrumentSans.variable} ${bricolage.variable} antialiased bg-background text-foreground`}
      >
        <WebFailureReporter />
        <NextIntlClientProvider messages={messages}>
          <AuthProvider>{children}</AuthProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
