/**
 * KIOSK-001 — app/[locale]/layout.tsx
 * Layout principal avec next-intl pour les 4 langues.
 *
 * generateStaticParams requis par output:export pour les routes dynamiques [locale].
 * setRequestLocale requis pour éviter l'accès aux headers request en static export
 * (getLocale()/getMessages() utilisent les headers, incompatibles avec output:export).
 * Ref: https://next-intl.dev/docs/getting-started/app-router/with-i18n-routing
 */
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

interface LocaleLayoutProps {
  children: ReactNode;
  params: Promise<{ locale: string }>;
}

export default async function LocaleLayout({ children, params }: LocaleLayoutProps) {
  const { locale } = await params;
  // Requis pour static export : indique à next-intl la locale sans lire les headers
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body>
        <NextIntlClientProvider locale={locale} messages={messages}>
          {children}
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
