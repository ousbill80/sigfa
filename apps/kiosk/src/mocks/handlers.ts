/**
 * KIOSK-001 — mocks/handlers.ts
 * Handlers MSW 2.x pour les tests kiosque.
 */
import { http, HttpResponse } from "msw";
import type { ServiceItem } from "@/components/ServicesScreen";

/** Opération de démo (vue publique PublicOperation — SLA résolu). */
interface DemoOperation {
  id: string;
  code: string;
  name: string;
  slaMinutes: number;
  iconKey?: string;
}

/**
 * KIOSK-BORNE — Catalogue de démo calqué sur la borne BNI modèle :
 * 3 familles (Caisse · Moyen de paiement · Accueil / Conseiller client),
 * opérations DISTINCTES par famille. Codes conformes au contrat
 * (`^[A-Z0-9]{2,6}$`), `iconKey` aligné sur le jeu `ServiceIcon`.
 */
export const DEMO_OPERATIONS_BY_SERVICE: Readonly<Record<string, readonly DemoOperation[]>> = {
  // ── Caisse (SLA ~8 min) ──────────────────────────────────────────────────
  "svc-caisse": [
    { id: "op-retrait-especes", code: "RETESP", name: "Retrait espèces", slaMinutes: 8, iconKey: "withdrawal" },
    { id: "op-retrait-plus-5m", code: "RETP5M", name: "Retrait plus de 5 millions", slaMinutes: 8, iconKey: "withdrawal" },
    { id: "op-retrait-versement", code: "RETVER", name: "Retrait/Versement", slaMinutes: 8, iconKey: "withdrawal" },
    { id: "op-versement-moins-5m", code: "VERM5M", name: "Versement moins de 5 millions", slaMinutes: 8, iconKey: "deposit" },
    { id: "op-versement-plus-5m", code: "VERP5M", name: "Versement plus de 5 millions", slaMinutes: 8, iconKey: "deposit" },
    { id: "op-rechargement-carte-prepayee", code: "RECHCP", name: "Rechargement de carte prépayée", slaMinutes: 8, iconKey: "card" },
    { id: "op-paiement-divers", code: "PAIDIV", name: "Paiement divers", slaMinutes: 8, iconKey: "payment" },
    { id: "op-change", code: "CHANGE", name: "Change", slaMinutes: 8, iconKey: "exchange" },
    { id: "op-transfert-orange-money", code: "TRFOM", name: "Transfert Orange Money", slaMinutes: 8, iconKey: "transfer" },
    { id: "op-transfert-ria", code: "TRFRIA", name: "Transfert RIA", slaMinutes: 8, iconKey: "transfer" },
    { id: "op-transfert-moneygram", code: "TRFMG", name: "Transfert MoneyGram", slaMinutes: 8, iconKey: "transfer" },
  ],
  // ── Moyen de paiement (SLA ~10 min) ─────────────────────────────────────
  "svc-moyens-paiement": [
    { id: "op-demande-releve", code: "DEMREL", name: "Demande de relevé", slaMinutes: 10, iconKey: "statement" },
    { id: "op-retrait-cheque-effet", code: "RETCHQ", name: "Retrait chèque/effet", slaMinutes: 10, iconKey: "cheque" },
    { id: "op-remise-cheque-effet", code: "REMCHQ", name: "Remise chèque/effet", slaMinutes: 10, iconKey: "cheque" },
    { id: "op-opposition-carte-cheque", code: "OPPCC", name: "Demande d'opposition carte/chèque", slaMinutes: 10, iconKey: "opposition" },
    { id: "op-carte-prepayee", code: "CARTPP", name: "Carte prépayée", slaMinutes: 10, iconKey: "card" },
    { id: "op-retrait-carte-code", code: "RETCAR", name: "Retrait de carte/code", slaMinutes: 10, iconKey: "card" },
    { id: "op-demande-carte", code: "DEMCAR", name: "Demande de carte", slaMinutes: 10, iconKey: "card" },
    { id: "op-demande-chequier", code: "DEMCHQ", name: "Demande de chéquier", slaMinutes: 10, iconKey: "cheque" },
    { id: "op-virement", code: "VIR", name: "Virement", slaMinutes: 10, iconKey: "transfer" },
  ],
  // ── Accueil / Conseiller client (SLA ~15 min) ────────────────────────────
  "svc-conseiller": [
    { id: "op-ouverture-compte", code: "OUVCPT", name: "Ouverture de compte", slaMinutes: 15, iconKey: "account" },
    { id: "op-cloture-compte", code: "CLOCPT", name: "Clôture de compte", slaMinutes: 15, iconKey: "account" },
    { id: "op-demande-credit", code: "DEMCRE", name: "Demande de crédit", slaMinutes: 15, iconKey: "credit" },
    { id: "op-plan-epargne-pee", code: "PEE", name: "Plan Épargne / PEE", slaMinutes: 15, iconKey: "savings" },
    { id: "op-resiliation-plan-epargne", code: "RESPEE", name: "Demande de résiliation Plan Épargne PEL/PEE", slaMinutes: 15, iconKey: "savings" },
    { id: "op-souscription-autre-produit", code: "SOUSPR", name: "Souscription autre produit", slaMinutes: 15, iconKey: "contract" },
    { id: "op-depot-courriers", code: "DEPCOU", name: "Dépôt de courriers", slaMinutes: 15, iconKey: "mail" },
    { id: "op-demande-releve-solde", code: "DEMSOL", name: "Demande de relevé/solde", slaMinutes: 15, iconKey: "statement" },
    { id: "op-demande-informations", code: "DEMINF", name: "Demande d'informations", slaMinutes: 15, iconKey: "info" },
    { id: "op-reclamations", code: "RECLA", name: "Réclamations", slaMinutes: 15, iconKey: "complaint" },
  ],
};

export const handlers = [
  http.post("*/kiosk/session", () => {
    return HttpResponse.json(
      {
        accessToken: "eyJhbGciOiJIUzI1NiJ9.kioskPayload.sig",
        expiresIn: 43200,
        kioskId: "14141414-1414-4141-a141-141414141414",
        agencyId: "33333333-3333-4333-a333-333333333333",
      },
      { status: 201 }
    );
  }),
  // MODEL-KIOSK-A: GET /public/agencies/{agencyId}/operations?serviceId=
  // Liste des opérations actives d'UN service (SLA résolu) pour la grille borne.
  // Le handler FILTRE par `serviceId` : chaque famille reçoit SES opérations
  // (catalogue borne BNI ci-dessus), jamais celles d'une autre. `serviceId`
  // inconnu → liste vide (l'écran retombe sur la tuile-service). Le wildcard
  // `:agencyId` matche n'importe quel identifiant d'agence transmis par l'écran.
  http.get("*/public/agencies/:agencyId/operations", ({ request }) => {
    const serviceId = new URL(request.url).searchParams.get("serviceId") ?? "";
    return HttpResponse.json(
      { data: DEMO_OPERATIONS_BY_SERVICE[serviceId] ?? [] },
      { status: 200 }
    );
  }),
  // MODEL-KIOSK-B: GET /public/agencies/{agencyId}/relationship-managers
  // Liste NOMINATIVE (zéro PII) des conseillers actifs d'une agence, pour le
  // chemin « voir mon conseiller ». Démo : 3 conseillers réalistes — 2 avec une
  // photo LOCALE (aucune image réseau externe), 1 sans photo (rendu en initiales
  // côté écran). Le wildcard `:agencyId` matche l'agence transmise par l'écran.
  http.get("*/public/agencies/:agencyId/relationship-managers", () => {
    return HttpResponse.json(
      {
        data: [
          { id: "rm-kofi", displayName: "Kofi Aké", photoUrl: "/mock/rm/kofi.svg" },
          { id: "rm-awa", displayName: "Awa Diallo" },
          { id: "rm-yao", displayName: "Yao Kouassi", photoUrl: "/mock/rm/yao.svg" },
        ],
      },
      { status: 200 }
    );
  }),
  // KIOSK-004: POST /public/tickets handler
  http.post("*/public/tickets", () => {
    return HttpResponse.json(
      {
        trackingId: "TRK-00001",
        number: 7,
        displayNumber: "A007",
        position: 4,
        estimatedWaitMinutes: 12,
        queueLength: 10,
        serviceId: "svc-001",
        agencyId: "agt-001",
        channel: "KIOSK",
        createdAt: new Date().toISOString(),
        status: "WAITING",
      },
      { status: 201 }
    );
  }),
  // KIOSK-HOME: GET /public/banks/{id}/theme (CONTRACT-013 — route publique,
  // zéro PII). Projection du thème tenant pour l'écran de marque de l'accueil :
  // logo + couleurs appliquées + messages de bienvenue. Démo : logo servi par
  // un asset LOCAL (public/mock/bank/logo.svg) — aucune image réseau externe.
  // Le wildcard `:id` matche l'identifiant provisionné (NEXT_PUBLIC_BANK_ID).
  http.get("*/public/banks/:id/theme", () => {
    return HttpResponse.json(
      {
        logoUrl: "/mock/bank/logo.svg",
        appliedColors: {
          primary: "#003f7f",
          secondary: "#c79a3a",
          background: "#ffffff",
        },
        welcomeMessages: {
          fr: "Bienvenue à la BNCI",
          en: "Welcome to BNCI",
        },
      },
      { status: 200 }
    );
  }),
  // AUDIT-F21 (démo feedback) — GET /public/tickets/{trackingId} : ticket DONE
  // clos il y a 1 h → l'écran feedback est ÉLIGIBLE en démo (fenêtre < 24 h).
  // Ouvrir http://localhost:3002/fr/feedback?trackingId=TRK-00001 pour vérifier
  // visuellement la notation (« Plus tard ») et le merci (compte à rebours).
  http.get("*/public/tickets/:trackingId", ({ params }) => {
    return HttpResponse.json(
      {
        trackingId: String(params.trackingId),
        number: 7,
        displayNumber: "A007",
        position: 0,
        estimatedWaitMinutes: 0,
        queueLength: 10,
        serviceId: "svc-001",
        agencyId: "agt-001",
        channel: "KIOSK",
        status: "DONE",
        createdAt: new Date(Date.now() - 2 * 3600_000).toISOString(),
        closedAt: new Date(Date.now() - 3600_000).toISOString(),
      },
      { status: 200 }
    );
  }),
  // AUDIT-F21 (démo feedback) — POST /public/tickets/{trackingId}/feedback :
  // 201 → l'écran merci (compte à rebours + « Terminer ») est vérifiable en démo.
  http.post("*/public/tickets/:trackingId/feedback", () => {
    return HttpResponse.json(
      { success: true, message: "Merci pour votre avis !" },
      { status: 201 }
    );
  }),
];

/**
 * AUDIT-F24 — Fixture démo « affluence » (bannière file longue KIOSK-007).
 *
 * Les services de démo nominaux restent tous SOUS le seuil « file longue »
 * (30 min — `DEFAULT_LONG_QUEUE_THRESHOLD_MIN`) : la bannière d'affluence,
 * exigée par le gate 5 états, n'était JAMAIS vérifiable visuellement. Cette
 * fixture porte deux services au-dessus du seuil pour la déclencher.
 *
 * ACTIVATION (mode démo MSW uniquement — `NEXT_PUBLIC_ENABLE_MSW=1`) :
 *   NEXT_PUBLIC_ENABLE_MSW=1 pnpm --filter @sigfa/kiosk dev
 *   puis ouvrir http://localhost:3002/fr/services?demo=affluence
 * La page services substitue alors cette fixture aux services nominaux
 * (voir `app/[locale]/services/ServicesPageClient.tsx`). Le paramètre est
 * inerte hors mode démo : jamais actif sur une borne réelle.
 */
export const DEMO_AFFLUENCE_SERVICES: ServiceItem[] = [
  { id: "svc-1", name: "Dépôt", code: "deposit", estimatedMinutes: 35, isOpen: true },
  { id: "svc-2", name: "Retrait", code: "withdrawal", estimatedMinutes: 32, isOpen: true },
  { id: "svc-3", name: "Virement", code: "transfer", estimatedMinutes: 18, isOpen: true },
  { id: "svc-4", name: "Réclamation", code: "complaint", estimatedMinutes: 15, isOpen: true },
];
