import type { Metadata } from "next";
import { Geist, Geist_Mono, Inter, Noto_Sans_Devanagari, Space_Grotesk } from "next/font/google";
import "./globals.css";
import { AuthProvider } from "@/context/AuthContext";
import { DemoProvider } from "@/context/DemoContext";
import { I18nProvider } from "@/context/I18nContext";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Living Sky typography (scoped to .sky-root in globals.css)
const spaceGrotesk = Space_Grotesk({
  variable: "--font-sky-display",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-sky-body",
  subsets: ["latin"],
});

const notoDevanagari = Noto_Sans_Devanagari({
  variable: "--font-sky-deva",
  subsets: ["devanagari"],
  weight: ["400", "500", "600", "700"],
});

export const metadata: Metadata = {
  title: "WeatherGPT",
  description: "SIH 2026 — AI-powered weather assistant",
};

// AuthProvider initializes the browser Supabase client.  This layout must be
// rendered per request, rather than prerendered at build time, because build
// environments intentionally do not carry public deployment credentials.
export const dynamic = 'force-dynamic'

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${spaceGrotesk.variable} ${inter.variable} ${notoDevanagari.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <AuthProvider>
          <DemoProvider>
            <I18nProvider>{children}</I18nProvider>
          </DemoProvider>
        </AuthProvider>
      </body>
    </html>
  );
}
