/**
 * KIOSK-001 — app/[locale]/layout.tsx
 * Layout principal avec next-intl pour les 4 langues.
 */
import type { ReactNode } from "react";
import { NextIntlClientProvider } from "next-intl";
import { getMessages, getLocale } from "next-intl/server";
// CSS global importé depuis le root layout via globals.css
// (les fichiers CSS ne peuvent pas être importés avec des chemins relatifs parents)

interface LocaleLayoutProps {
  children: ReactNode;
}

export default async function LocaleLayout({ children }: LocaleLayoutProps) {
  const locale = await getLocale();
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
