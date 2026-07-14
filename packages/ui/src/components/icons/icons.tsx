/**
 * Composants dédiés du set d'icônes SIGFA (ICONS-001).
 *
 * Un composant nommé par icône (`IconTicket`, `IconGuichet`, ...) — sucre
 * typé au-dessus de {@link SigfaIcon} pour des usages explicites :
 *
 *   <IconTicket size="lg" />
 *   <IconImprimer title="Imprimer le ticket" />
 *
 * @module icons/icons
 */
import { type ReactNode } from "react";

import { SigfaIcon, type IconName, type SigfaIconProps } from "./SigfaIcon";

/** Props d'un composant d'icône dédié (le nom est fixé). */
export type IconProps = Omit<SigfaIconProps, "name">;

/** Fabrique le composant dédié d'une icône du set. */
function makeIcon(name: IconName, displayName: string) {
  function Icon(props: IconProps): ReactNode {
    return <SigfaIcon name={name} {...props} />;
  }
  Icon.displayName = displayName;
  return Icon;
}

/* ── Métier banque / file d'attente ──────────────────────────────────── */
export const IconTicket = makeIcon("ticket", "IconTicket");
export const IconGuichet = makeIcon("guichet", "IconGuichet");
export const IconFileAttente = makeIcon("file-attente", "IconFileAttente");
export const IconConseiller = makeIcon("conseiller", "IconConseiller");
export const IconDepot = makeIcon("depot", "IconDepot");
export const IconRetrait = makeIcon("retrait", "IconRetrait");
export const IconVirement = makeIcon("virement", "IconVirement");
export const IconChangeDevises = makeIcon(
  "change-devises",
  "IconChangeDevises",
);
export const IconCredit = makeIcon("credit", "IconCredit");
export const IconEpargne = makeIcon("epargne", "IconEpargne");
export const IconCompte = makeIcon("compte", "IconCompte");
export const IconCarteBancaire = makeIcon(
  "carte-bancaire",
  "IconCarteBancaire",
);
export const IconChequier = makeIcon("chequier", "IconChequier");
export const IconEntreprise = makeIcon("entreprise", "IconEntreprise");
export const IconInternational = makeIcon(
  "international",
  "IconInternational",
);

/* ── UI ──────────────────────────────────────────────────────────────── */
export const IconImprimer = makeIcon("imprimer", "IconImprimer");
export const IconAudio = makeIcon("audio", "IconAudio");
export const IconLangue = makeIcon("langue", "IconLangue");
export const IconAccessibilite = makeIcon(
  "accessibilite",
  "IconAccessibilite",
);
export const IconHorsLigne = makeIcon("hors-ligne", "IconHorsLigne");
export const IconValider = makeIcon("valider", "IconValider");
export const IconRetour = makeIcon("retour", "IconRetour");
export const IconInformation = makeIcon("information", "IconInformation");
export const IconAlerte = makeIcon("alerte", "IconAlerte");
export const IconHorloge = makeIcon("horloge", "IconHorloge");
export const IconStatistiques = makeIcon("statistiques", "IconStatistiques");
export const IconParametres = makeIcon("parametres", "IconParametres");
export const IconEtoile = makeIcon("etoile", "IconEtoile");
export const IconMicro = makeIcon("micro", "IconMicro");
export const IconChevron = makeIcon("chevron", "IconChevron");
export const IconTelephone = makeIcon("telephone", "IconTelephone");
