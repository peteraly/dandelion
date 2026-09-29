import type { Metadata, Viewport } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getLocale, getMessages } from "next-intl/server";
import "./globals.css";

export const metadata: Metadata = {
  title: "Dandelion",
  description: "Menstrual-health supply pilot — Tanzania",
  manifest: "/manifest.webmanifest",
  applicationName: "Dandelion",
  appleWebApp: { capable: true, title: "Dandelion", statusBarStyle: "default" },
};

export const viewport: Viewport = {
  themeColor: "#7c3aed",
  width: "device-width",
  initialScale: 1,
  maximumScale: 1,
};

export default async function RootLayout({ children }: { children: React.ReactNode }) {
  const locale = await getLocale();
  // Only the namespaces client components translate themselves are sent to the browser.
  // Everything else is rendered on the server (smaller pages on 3G; no catalogue in public HTML).
  const messages = await getMessages();
  const clientMessages = { problems: messages.problems as Record<string, unknown> };
  return (
    <html lang={locale} className="h-full antialiased">
      <body className="min-h-full flex flex-col bg-stone-50 text-stone-900">
        <NextIntlClientProvider messages={clientMessages}>{children}</NextIntlClientProvider>
      </body>
    </html>
  );
}
