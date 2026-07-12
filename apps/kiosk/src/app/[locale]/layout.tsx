/**
 * KIOSK-001 — app/[locale]/layout.tsx
 * Layout principal avec next-intl pour les 4 langues.
 *
 * generateStaticParams requis par output:export pour les routes dynamiques [locale].
 * setRequestLocale requis pour éviter l'accès aux headers request en static export
 * (getLocale()/getMessages() utilisent les headers, incompatibles avec output:export).
 * Ref: https://next-intl.dev/docs/getting-started/app-router/with-i18n-routing
 */
import { NextIntlClientProvider } from "next-intl";
import { getMessages, setRequestLocale } from "next-intl/server";
import { routing } from "@/i18n/routing";
import { KioskSessionProvider } from "@/components/KioskSessionProvider";
// Worker MSW navigateur — DÉMARRÉ EN DÉVELOPPEMENT UNIQUEMENT (garde interne au
// composant). Inerte en production / Electron (static export).
import { MswProvider } from "@/components/MswProvider";
// Design system v2 « Sérénité Premium » — source unique @sigfa/ui.
// (design-tokens.css ré-importe @sigfa/ui/tokens.css + alias kiosque.)
import "@sigfa/ui/fonts.css";
import "@/lib/design-tokens.css";
import "@sigfa/ui/components.css";

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

/** Corresponds to Next.js LayoutProps — children + dynamic params */
export default async function LocaleLayout(props: {
  children: React.ReactNode;
  params: Promise<{ locale: string }>;
}) {
  const { children, params } = props;
  const { locale } = await params;
  // Requis pour static export : indique à next-intl la locale sans lire les headers
  setRequestLocale(locale);
  const messages = await getMessages();

  return (
    <html lang={locale}>
      <body
        style={{
          margin: 0,
          backgroundColor: "var(--surface-kiosk)",
          color: "var(--ink-inverse)",
          fontFamily: "var(--font-text)",
          WebkitFontSmoothing: "antialiased",
        }}
      >
        <NextIntlClientProvider locale={locale} messages={messages}>
          {/* MswProvider : en DEV + NEXT_PUBLIC_ENABLE_MSW=1, démarre le worker
              MSW pour peupler le parcours sans backend. Inerte en prod. */}
          <MswProvider>
            {/* S5 : session borne câblée au démarrage (KIOSK-001), re-créée à
                expiration, dégradée non bloquante en échec. */}
            <KioskSessionProvider>{children}</KioskSessionProvider>
          </MswProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
