/**
 * /design-preview — the SIGFA Design System v2 « Sérénité Premium » gallery.
 *
 * Renders every canonical component in all of its states, plus a full-size
 * kiosk TicketMoment (on `--night`) and a dashboard KpiTile. FR/EN togglable.
 * This is the surface the orchestrator opens in a browser and captures for
 * visual review. It touches no other web screen.
 *
 * @module app/design-preview/page
 */
"use client";

import { useState, type ReactElement } from "react";
import {
  Badge,
  BankThemeProvider,
  Button,
  Card,
  Dialog,
  EmptyState,
  Field,
  KpiTile,
  OfflineBanner,
  Skeleton,
  Stepper,
  TicketMoment,
  color,
} from "@sigfa/ui";

type Lang = "fr" | "en";

interface Copy {
  subtitle: string;
  langLabel: string;
  buttons: { title: string; desc: string };
  primary: string;
  secondary: string;
  ghost: string;
  danger: string;
  cards: { title: string; desc: string };
  cardStatic: string;
  cardInteractive: string;
  cardHint: string;
  fields: { title: string; desc: string };
  phone: string;
  phoneHint: string;
  email: string;
  emailError: string;
  locked: string;
  badges: { title: string; desc: string };
  open: string;
  busy: string;
  slaBreached: string;
  info: string;
  vip: string;
  theming: { title: string; desc: string };
  themeDefault: string;
  themeCallNext: string;
  themeVip: string;
  themeKpi: string;
  themeKpiDelta: string;
  feedback: { title: string; desc: string };
  offline: string;
  emptyTitle: string;
  emptyDesc: string;
  emptyAction: string;
  dialogOpen: string;
  dialogTitle: string;
  dialogBody: string;
  cancel: string;
  confirm: string;
  onboarding: { title: string; desc: string };
  steps: string[];
  kioskTitle: string;
  ticketEyebrow: string;
  ticketMessage: string;
  ticketSms: string;
  ticketVoice: string;
  dashTitle: string;
  kpiWait: string;
  kpiServed: string;
  kpiAbandon: string;
  kpiNps: string;
  deltaWait: string;
  deltaServed: string;
  deltaAbandon: string;
  deltaNps: string;
}

const COPY: Record<Lang, Copy> = {
  fr: {
    subtitle: "Système de design v2 · Sérénité Premium",
    langLabel: "Langue",
    buttons: { title: "Boutons", desc: "Quatre intentions, trois tailles, cinq états (repos, survol, pressé, focus clavier, désactivé)." },
    primary: "Appeler le suivant",
    secondary: "Transférer",
    ghost: "Ignorer",
    danger: "Clôturer le guichet",
    cards: { title: "Cartes & surfaces", desc: "Élévation douce, translation au survol pour les cartes interactives." },
    cardStatic: "Carte au repos",
    cardInteractive: "Carte interactive",
    cardHint: "Survolez ou tabulez jusqu'ici, puis Entrée.",
    fields: { title: "Champs", desc: "Repos beige, anneau de marque au focus, erreur en ligne sous le champ." },
    phone: "Numéro de téléphone",
    phoneHint: "Nous vous préviendrons par SMS.",
    email: "Adresse e-mail",
    emailError: "Adresse e-mail invalide.",
    locked: "Champ verrouillé",
    badges: { title: "Statuts", desc: "Le rouge est une pastille, jamais un fond plein." },
    open: "Ouvert",
    busy: "File chargée",
    slaBreached: "SLA dépassé",
    info: "Information",
    vip: "Client prioritaire",
    theming: {
      title: "Theming banque — un seul token, zéro effort",
      desc: "Chaque banque se brande avec SA couleur primaire. Le MÊME bloc de composants (Button/Card/Badge/KpiTile) est rendu sous 3 chartes via BankThemeProvider — la structure ne bouge pas, le contraste (--brand-contrast) reste ≥ 4.5:1 (WCAG AA, recalculé en JS).",
    },
    themeDefault: "Terracotta SIGFA (défaut)",
    themeCallNext: "Appeler le suivant",
    themeVip: "Client prioritaire",
    themeKpi: "Tickets servis",
    themeKpiDelta: "+12 % vs J-7",
    feedback: { title: "États de service", desc: "Hors-ligne doux, vide accueillant, chargement, dialogue." },
    offline: "Mode hors-ligne — reconnexion en cours.",
    emptyTitle: "Aucun ticket en attente",
    emptyDesc: "La file est vide. Profitez de ce moment de calme.",
    emptyAction: "Actualiser",
    dialogOpen: "Ouvrir le dialogue",
    dialogTitle: "Clôturer le guichet ?",
    dialogBody: "Les clients en attente seront redirigés vers un autre guichet. Cette action est réversible.",
    cancel: "Annuler",
    confirm: "Clôturer",
    onboarding: { title: "Onboarding", desc: "Parcours de configuration guidé." },
    steps: ["Banque", "Agence", "Services", "Terminé"],
    kioskTitle: "Kiosque — le Moment Ticket (fond nuit, halo or)",
    ticketEyebrow: "Votre ticket",
    ticketMessage: "Installez-vous confortablement. Nous vous appellerons très bientôt.",
    ticketSms: "Recevoir par SMS",
    ticketVoice: "Écouter l'annonce",
    dashTitle: "Dashboard — indicateurs (COMEX)",
    kpiWait: "Temps d'attente moyen",
    kpiServed: "Tickets servis aujourd'hui",
    kpiAbandon: "Taux d'abandon",
    kpiNps: "Satisfaction (NPS)",
    deltaWait: "-38 s vs J-7",
    deltaServed: "+12 % vs J-7",
    deltaAbandon: "+0,4 pt vs J-7",
    deltaNps: "+8 vs J-7",
  },
  en: {
    subtitle: "Design System v2 · Serene Premium",
    langLabel: "Language",
    buttons: { title: "Buttons", desc: "Four intents, three sizes, five states (rest, hover, pressed, keyboard focus, disabled)." },
    primary: "Call next",
    secondary: "Transfer",
    ghost: "Skip",
    danger: "Close counter",
    cards: { title: "Cards & surfaces", desc: "Soft elevation, lift on hover for interactive cards." },
    cardStatic: "Resting card",
    cardInteractive: "Interactive card",
    cardHint: "Hover, or tab here and press Enter.",
    fields: { title: "Fields", desc: "Beige at rest, brand focus ring, inline error under the field." },
    phone: "Phone number",
    phoneHint: "We will notify you by SMS.",
    email: "Email address",
    emailError: "Invalid email address.",
    locked: "Locked field",
    badges: { title: "Statuses", desc: "Red is a pill, never a solid fill." },
    open: "Open",
    busy: "Busy queue",
    slaBreached: "SLA breached",
    info: "Information",
    vip: "Priority client",
    theming: {
      title: "Bank theming — one token, zero effort",
      desc: "Each bank brands with ITS primary colour. The SAME component block (Button/Card/Badge/KpiTile) is rendered under 3 charters via BankThemeProvider — structure never changes and the contrast (--brand-contrast) stays ≥ 4.5:1 (WCAG AA, computed in JS).",
    },
    themeDefault: "SIGFA terracotta (default)",
    themeCallNext: "Call next",
    themeVip: "Priority client",
    themeKpi: "Tickets served",
    themeKpiDelta: "+12% vs 7d",
    feedback: { title: "Service states", desc: "Gentle offline, welcoming empty, loading, dialog." },
    offline: "Offline mode — reconnecting.",
    emptyTitle: "No ticket waiting",
    emptyDesc: "The queue is empty. Enjoy this calm moment.",
    emptyAction: "Refresh",
    dialogOpen: "Open dialog",
    dialogTitle: "Close this counter?",
    dialogBody: "Waiting clients will be redirected to another counter. This action can be undone.",
    cancel: "Cancel",
    confirm: "Close",
    onboarding: { title: "Onboarding", desc: "Guided setup journey." },
    steps: ["Bank", "Agency", "Services", "Done"],
    kioskTitle: "Kiosk — the Ticket Moment (night background, gold halo)",
    ticketEyebrow: "Your ticket",
    ticketMessage: "Make yourself comfortable. We will call you very soon.",
    ticketSms: "Get it by SMS",
    ticketVoice: "Play the announcement",
    dashTitle: "Dashboard — KPIs (COMEX)",
    kpiWait: "Average wait time",
    kpiServed: "Tickets served today",
    kpiAbandon: "Abandon rate",
    kpiNps: "Satisfaction (NPS)",
    deltaWait: "-38 s vs 7d",
    deltaServed: "+12 % vs 7d",
    deltaAbandon: "+0.4 pt vs 7d",
    deltaNps: "+8 vs 7d",
  },
};

const SWATCHES: ReadonlyArray<{ name: string; token: keyof typeof color }> = [
  { name: "paper", token: "--paper" },
  { name: "surface-2", token: "--surface-2" },
  { name: "ink", token: "--ink" },
  { name: "brand", token: "--brand" },
  { name: "brand-strong", token: "--brand-strong" },
  { name: "forest", token: "--forest" },
  { name: "gold", token: "--gold" },
  { name: "night", token: "--night" },
  { name: "success", token: "--success" },
  { name: "warning", token: "--warning" },
  { name: "danger", token: "--danger" },
  { name: "info", token: "--info" },
];

/**
 * Demo bank charters for the « Theming banque » section. `brandColor: null`
 * is the untouched SIGFA default (no provider override). Each other entry is a
 * real tenant primary — proving the whole block re-themes from one hex.
 */
const DEMO_BANKS: ReadonlyArray<{
  key: string;
  name: string;
  brandColor: string | null;
}> = [
  { key: "sigfa", name: "SIGFA", brandColor: null },
  { key: "blue", name: "Banque Bleue", brandColor: "#1E5AA8" },
  { key: "green", name: "Banque Verte", brandColor: "#0B7A4B" },
  { key: "violet", name: "Banque Violette", brandColor: "#6B3FA0" },
];

const TYPE_SPECIMEN: ReadonlyArray<{ tag: string; size: string }> = [
  { tag: "display 76", size: "var(--display)" },
  { tag: "4xl 49", size: "var(--text-4xl)" },
  { tag: "2xl 31", size: "var(--text-2xl)" },
  { tag: "xl 25", size: "var(--text-xl)" },
  { tag: "lg 20", size: "var(--text-lg)" },
];

function IconInbox(): ReactElement {
  return (
    <svg width="28" height="28" viewBox="0 0 24 24" fill="none" aria-hidden="true">
      <path
        d="M3 12h4l2 3h6l2-3h4M5 5h14a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z"
        stroke="currentColor"
        strokeWidth="1.7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/**
 * The SAME component block, re-themed per bank. Rendered inside a
 * `BankThemeProvider` so every `var(--brand*)` inside picks up the tenant hex
 * while the SIGFA structure stays identical.
 */
function BankChart({
  name,
  brandColor,
  t,
}: {
  name: string;
  brandColor: string | null;
  t: Copy;
}): ReactElement {
  const label = brandColor == null ? t.themeDefault : name;
  const body = (
    <Card>
      <div className="dp-bankchart__head">
        <span className="dp-bankchart__name">{label}</span>
        <Badge tone="brand">{t.themeVip}</Badge>
      </div>
      <div className="dp-row" style={{ gap: "var(--space-3)" }}>
        <Button variant="primary">{t.themeCallNext}</Button>
        <Button variant="secondary">{t.secondary}</Button>
      </div>
      <KpiTile
        label={t.themeKpi}
        value="1 284"
        delta={t.themeKpiDelta}
        trend="up"
      />
    </Card>
  );

  return brandColor == null ? (
    body
  ) : (
    <BankThemeProvider brandColor={brandColor}>{body}</BankThemeProvider>
  );
}

export default function DesignPreviewPage(): ReactElement {
  const [lang, setLang] = useState<Lang>("fr");
  const [dialogOpen, setDialogOpen] = useState(false);
  const t = COPY[lang];

  return (
    <div className="dp-root">
      <header className="dp-header">
        <div className="dp-header__brand">
          <span className="dp-header__mark">S</span>
          <div>
            <div className="dp-header__title">SIGFA</div>
            <div className="dp-header__sub">{t.subtitle}</div>
          </div>
        </div>
        <div className="dp-lang" role="group" aria-label={t.langLabel}>
          {(["fr", "en"] as const).map((l) => (
            <button
              key={l}
              type="button"
              className="dp-lang__btn"
              aria-pressed={lang === l}
              onClick={() => setLang(l)}
            >
              {l.toUpperCase()}
            </button>
          ))}
        </div>
      </header>

      <main className="dp-main">
        {/* Palette + type */}
        <section className="dp-section">
          <div className="dp-section__head">
            <span className="dp-section__eyebrow">Fondation</span>
            <h2 className="dp-section__title">Palette « Or & Forêt » + typographie</h2>
            <p className="dp-section__desc">
              Base chaude (papier ivoire), marque terracotta, forêt & or.
              Titres « Clash Display », texte « General Sans » (auto-hébergés).
            </p>
          </div>
          <div className="dp-swatches">
            {SWATCHES.map((s) => (
              <div className="dp-swatch" key={s.name}>
                <div
                  className="dp-swatch__chip"
                  style={{ background: `var(${s.token})` }}
                />
                <div className="dp-swatch__meta">
                  <div className="dp-swatch__name">{s.name}</div>
                  <div className="dp-swatch__hex">{color[s.token]}</div>
                </div>
              </div>
            ))}
          </div>
          <div className="dp-type">
            {TYPE_SPECIMEN.map((row) => (
              <div className="dp-type__row" key={row.tag}>
                <span className="dp-type__tag">{row.tag}</span>
                <span className="dp-type__sample" style={{ fontSize: row.size }}>
                  Sérénité
                </span>
              </div>
            ))}
          </div>
        </section>

        {/* Buttons */}
        <section className="dp-section">
          <div className="dp-section__head">
            <span className="dp-section__eyebrow">Composant</span>
            <h2 className="dp-section__title">{t.buttons.title}</h2>
            <p className="dp-section__desc">{t.buttons.desc}</p>
          </div>
          <div className="dp-stack">
            <span className="dp-label">Variantes</span>
            <div className="dp-row">
              <Button variant="primary">{t.primary}</Button>
              <Button variant="secondary">{t.secondary}</Button>
              <Button variant="ghost">{t.ghost}</Button>
              <Button variant="danger">{t.danger}</Button>
            </div>
            <span className="dp-label">Désactivé</span>
            <div className="dp-row">
              <Button variant="primary" disabled>
                {t.primary}
              </Button>
              <Button variant="secondary" disabled>
                {t.secondary}
              </Button>
              <Button variant="danger" disabled>
                {t.danger}
              </Button>
            </div>
            <span className="dp-label">Tailles (dense · md · kiosque ≥72px)</span>
            <div className="dp-row">
              <Button size="dense">{t.secondary}</Button>
              <Button size="md">{t.secondary}</Button>
              <Button size="kiosk">{t.primary}</Button>
            </div>
          </div>
        </section>

        {/* Cards */}
        <section className="dp-section">
          <div className="dp-section__head">
            <span className="dp-section__eyebrow">Composant</span>
            <h2 className="dp-section__title">{t.cards.title}</h2>
            <p className="dp-section__desc">{t.cards.desc}</p>
          </div>
          <div className="dp-grid dp-grid--2">
            <Card>
              <strong>{t.cardStatic}</strong>
              <p style={{ color: "var(--ink-soft)", marginTop: "var(--space-2)" }}>
                surface-1 · r-lg · shadow-1
              </p>
            </Card>
            <Card interactive onActivate={() => undefined}>
              <strong>{t.cardInteractive}</strong>
              <p style={{ color: "var(--ink-soft)", marginTop: "var(--space-2)" }}>
                {t.cardHint}
              </p>
            </Card>
          </div>
        </section>

        {/* Fields */}
        <section className="dp-section">
          <div className="dp-section__head">
            <span className="dp-section__eyebrow">Composant</span>
            <h2 className="dp-section__title">{t.fields.title}</h2>
            <p className="dp-section__desc">{t.fields.desc}</p>
          </div>
          <div className="dp-grid dp-grid--2">
            <Field
              label={t.phone}
              hint={t.phoneHint}
              placeholder="+225 07 00 00 00 00"
              required
            />
            <Field
              label={t.email}
              defaultValue="awa@@sigfa"
              error={t.emailError}
            />
            <Field label={t.locked} defaultValue="—" disabled />
            <Field label={t.phone} kiosk placeholder="07 00 00 00 00" />
          </div>
        </section>

        {/* Badges */}
        <section className="dp-section">
          <div className="dp-section__head">
            <span className="dp-section__eyebrow">Composant</span>
            <h2 className="dp-section__title">{t.badges.title}</h2>
            <p className="dp-section__desc">{t.badges.desc}</p>
          </div>
          <div className="dp-row">
            <Badge tone="success" dot>
              {t.open}
            </Badge>
            <Badge tone="warning" dot>
              {t.busy}
            </Badge>
            <Badge tone="danger" dot>
              {t.slaBreached}
            </Badge>
            <Badge tone="info" dot>
              {t.info}
            </Badge>
            <Badge tone="brand">{t.vip}</Badge>
          </div>
        </section>

        {/* Bank theming — the same block under 3 bank charters */}
        <section className="dp-section">
          <div className="dp-section__head">
            <span className="dp-section__eyebrow">Multi-tenant</span>
            <h2 className="dp-section__title">{t.theming.title}</h2>
            <p className="dp-section__desc">{t.theming.desc}</p>
          </div>
          <div className="dp-grid dp-grid--2">
            {DEMO_BANKS.map((bank) => (
              <BankChart
                key={bank.key}
                name={bank.name}
                brandColor={bank.brandColor}
                t={t}
              />
            ))}
          </div>
        </section>

        {/* Service states */}
        <section className="dp-section">
          <div className="dp-section__head">
            <span className="dp-section__eyebrow">États</span>
            <h2 className="dp-section__title">{t.feedback.title}</h2>
            <p className="dp-section__desc">{t.feedback.desc}</p>
          </div>
          <OfflineBanner message={t.offline} />
          <div className="dp-grid dp-grid--2">
            <Card>
              <span className="dp-label">Chargement</span>
              <div
                className="dp-stack"
                style={{ marginTop: "var(--space-3)" }}
              >
                <Skeleton height="1.25rem" width="60%" />
                <Skeleton height="1rem" />
                <Skeleton height="1rem" width="80%" />
              </div>
            </Card>
            <Card>
              <EmptyState
                icon={<IconInbox />}
                title={t.emptyTitle}
                description={t.emptyDesc}
                action={<Button variant="secondary">{t.emptyAction}</Button>}
              />
            </Card>
          </div>
          <div className="dp-row">
            <Button variant="danger" onClick={() => setDialogOpen(true)}>
              {t.dialogOpen}
            </Button>
          </div>
          <Dialog
            open={dialogOpen}
            onClose={() => setDialogOpen(false)}
            title={t.dialogTitle}
            actions={
              <>
                <Button
                  variant="secondary"
                  onClick={() => setDialogOpen(false)}
                >
                  {t.cancel}
                </Button>
                <Button variant="primary" onClick={() => setDialogOpen(false)}>
                  {t.confirm}
                </Button>
              </>
            }
          >
            {t.dialogBody}
          </Dialog>
        </section>

        {/* Onboarding */}
        <section className="dp-section">
          <div className="dp-section__head">
            <span className="dp-section__eyebrow">Composant</span>
            <h2 className="dp-section__title">{t.onboarding.title}</h2>
            <p className="dp-section__desc">{t.onboarding.desc}</p>
          </div>
          <Card>
            <Stepper steps={t.steps} current={2} />
          </Card>
        </section>

        {/* Dashboard KPIs */}
        <section className="dp-section">
          <div className="dp-section__head">
            <span className="dp-section__eyebrow">Surface</span>
            <h2 className="dp-section__title">{t.dashTitle}</h2>
          </div>
          <div className="dp-grid">
            <KpiTile
              label={t.kpiWait}
              value="4 min 12"
              delta={t.deltaWait}
              trend="up"
            />
            <KpiTile
              label={t.kpiServed}
              value="1 284"
              delta={t.deltaServed}
              trend="up"
            />
            <KpiTile
              label={t.kpiAbandon}
              value="3,1 %"
              delta={t.deltaAbandon}
              trend="down"
            />
            <KpiTile
              label={t.kpiNps}
              value="72"
              delta={t.deltaNps}
              trend="up"
            />
          </div>
        </section>

        {/* Kiosk hero (dark) */}
        <section className="dp-section">
          <div className="dp-section__head">
            <span className="dp-section__eyebrow">Surface · Kiosque</span>
            <h2 className="dp-section__title">{t.kioskTitle}</h2>
          </div>
          <div className="dp-dark">
            <TicketMoment
              eyebrow={t.ticketEyebrow}
              ticketNumber="B-042"
              message={t.ticketMessage}
              actions={
                <>
                  <Button size="kiosk" variant="primary">
                    {t.ticketSms}
                  </Button>
                  <Button size="kiosk" variant="secondary">
                    {t.ticketVoice}
                  </Button>
                </>
              }
            />
          </div>
        </section>
      </main>
    </div>
  );
}
