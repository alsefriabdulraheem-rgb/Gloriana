import type { Metadata, Viewport } from "next";
import Script from "next/script";
import "./globals.css";
import { getDict } from "@/lib/i18n";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";

export async function generateMetadata(): Promise<Metadata> {
  const { t, locale } = await getDict();
  return {
    metadataBase: new URL(APP_URL),
    title: { default: `${locale === "ar" ? "تريملي" : "TREMLY"} — ${t.tagline}`, template: `%s | ${locale === "ar" ? "تريملي TREMLY" : "TREMLY"}` },
    description: t.taglineSub,
    applicationName: "TREMLY",
    alternates: { canonical: "/" },
    openGraph: { type: "website", siteName: "TREMLY", locale: locale === "ar" ? "ar_SA" : "en_SA", title: "TREMLY", description: t.taglineSub },
    twitter: { card: "summary_large_image" },
    icons: { icon: "/icon.svg" },
  };
}

export const viewport: Viewport = { themeColor: "#5c264c", width: "device-width", initialScale: 1 };

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const { locale, dir } = await getDict();
  const ga = process.env.NEXT_PUBLIC_GA_ID;
  return (
    <html lang={locale} dir={dir}>
      <head>
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link rel="preconnect" href="https://fonts.gstatic.com" crossOrigin="" />
        <link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=IBM+Plex+Sans+Arabic:wght@400;500;600;700&family=Playfair+Display:wght@500;600;700&display=swap" />
      </head>
      <body className="min-h-screen antialiased">
        {children}
        {ga && (
          <>
            <Script src={`https://www.googletagmanager.com/gtag/js?id=${ga}`} strategy="afterInteractive" />
            <Script id="ga" strategy="afterInteractive">{`window.dataLayer=window.dataLayer||[];function gtag(){dataLayer.push(arguments)}gtag('js',new Date());gtag('config','${ga}',{anonymize_ip:true});`}</Script>
          </>
        )}
      </body>
    </html>
  );
}
