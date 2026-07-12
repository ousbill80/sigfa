/**
 * i18n — FR labels base, extensible to 4 languages.
 * @module lib/i18n
 */

/** Supported locales */
export const SUPPORTED_LOCALES = ["fr", "dioula", "baoule", "en"] as const;
export type Locale = (typeof SUPPORTED_LOCALES)[number];

/** Navigation label keys */
export type NavKey =
  | "nav.dashboard"
  | "nav.admin"
  | "nav.agent"
  | "nav.audit"
  | "nav.logout"
  | "nav.manager"
  | "nav.home";

/** All translation keys */
export type TranslationKey =
  | NavKey
  | "auth.login"
  | "auth.email"
  | "auth.password"
  | "auth.submit"
  | "auth.error"
  | "error.service_unavailable"
  | "error.403"
  | "error.403_message"
  | "error.go_to_dashboard"
  | "offline.banner"
  | "loading"
  | "tv.title"
  | "tv.now_serving"
  | "tv.please_proceed"
  | "tv.recent_calls"
  | "tv.waiting"
  | "tv.empty"
  | "tv.offline"
  | "agent.current_ticket"
  | "agent.timer"
  | "agent.call_next"
  | "agent.finish"
  | "agent.transfer"
  | "agent.queue_empty"
  | "agent.error"
  | "agent.select_destination"
  | "manager.tma"
  | "manager.abandon"
  | "manager.nps"
  | "manager.queues_by_service"
  | "manager.agents_grid"
  | "manager.alerts"
  | "manager.empty"
  | "manager.acknowledge"
  | "manager.open"
  | "manager.paused"
  | "manager.vs_j7"
  | "network.title"
  | "network.ranking"
  | "network.map"
  | "network.alerts"
  | "network.overview"
  | "network.offline"
  | "network.empty"
  | "network.empty_cta"
  | "network.error"
  | "network.page"
  | "network.prev"
  | "network.next"
  | "network.agency_offline"
  | "comex.title"
  | "comex.nps"
  | "comex.tma"
  | "comex.volume"
  | "comex.vs_previous"
  | "comex.partial"
  | "comex.offline"
  | "comex.error"
  | "comex.tv_on"
  | "comex.tv_off"
  | "admin.title"
  | "admin.section.identity"
  | "admin.section.agencies"
  | "admin.section.services"
  | "admin.section.counters"
  | "admin.section.agents"
  | "admin.section.sms_templates"
  | "admin.section.thresholds"
  | "admin.section.onboarding"
  | "admin.forbidden"
  | "admin.offline"
  | "admin.error"
  | "admin.save"
  | "admin.cancel"
  | "admin.confirm"
  | "admin.brand_label"
  | "admin.brand_warning"
  | "admin.brand_corrected"
  | "admin.deactivate"
  | "admin.deactivate_tickets_title"
  | "admin.import_csv"
  | "admin.import_summary"
  | "admin.preview"
  | "admin.unknown_variable"
  | "admin.empty_agencies"
  | "admin.wizard_step"
  | "admin.wizard_next"
  | "admin.wizard_back"
  | "admin.wizard_generate_qr"
  | "admin.wizard_done";

/** Translation dictionary type */
export type TranslationDict = Record<TranslationKey, string>;

/** French translations (base locale) */
export const FR: TranslationDict = {
  "nav.dashboard": "Tableau de bord",
  "nav.admin": "Administration",
  "nav.agent": "Guichet",
  "nav.audit": "Audit",
  "nav.logout": "Déconnexion",
  "nav.manager": "Gestion",
  "nav.home": "Accueil",
  "auth.login": "Connexion",
  "auth.email": "Adresse email",
  "auth.password": "Mot de passe",
  "auth.submit": "Se connecter",
  "auth.error": "Identifiants invalides",
  "error.service_unavailable": "Service indisponible",
  "error.403": "Accès refusé",
  "error.403_message": "Vous n'avez pas les droits pour accéder à cette page.",
  "error.go_to_dashboard": "Retour au tableau de bord",
  "offline.banner": "Mode hors ligne — données depuis le cache",
  loading: "Chargement…",
  "tv.title": "APPELS EN COURS",
  "tv.now_serving": "MAINTENANT SERVI",
  "tv.please_proceed": "Veuillez vous présenter au",
  "tv.recent_calls": "DERNIERS APPELÉS",
  "tv.waiting": "EN ATTENTE",
  "tv.empty": "Aucun appel en cours",
  "tv.offline": "Hors ligne — reconnexion…",
  "agent.current_ticket": "TICKET EN COURS",
  "agent.timer": "CHRONOMÈTRE",
  "agent.call_next": "APPELER LE SUIVANT",
  "agent.finish": "TERMINER",
  "agent.transfer": "TRANSFÉRER",
  "agent.queue_empty": "Aucun client en attente",
  "agent.error": "Une erreur est survenue, veuillez réessayer",
  "agent.select_destination": "Choisir un guichet de destination",
  "manager.tma": "TMA ACTUEL",
  "manager.abandon": "Taux d'abandon",
  "manager.nps": "NPS du jour",
  "manager.queues_by_service": "FILE PAR SERVICE",
  "manager.agents_grid": "GRILLE AGENTS",
  "manager.alerts": "ALERTES",
  "manager.empty": "Aucune donnée disponible pour le moment",
  "manager.acknowledge": "Acquitter",
  "manager.open": "Ouvrir",
  "manager.paused": "Suspendre",
  "manager.vs_j7": "vs J-7",
  "network.title": "DIRECTION RÉSEAU",
  "network.ranking": "CLASSEMENT AGENCES",
  "network.map": "CARTE DU RÉSEAU",
  "network.alerts": "ALERTES RÉSEAU",
  "network.overview": "SYNTHÈSE RÉSEAU",
  "network.offline": "Mode hors ligne — classement figé, resynchronisation à la reconnexion",
  "network.empty": "Aucune agence configurée pour votre banque",
  "network.empty_cta": "Créer la première agence",
  "network.error": "Impossible de charger le tableau de bord réseau. Veuillez réessayer.",
  "network.page": "Page",
  "network.prev": "Précédent",
  "network.next": "Suivant",
  "network.agency_offline": "Hors ligne",
  "comex.title": "PILOTAGE QUALITÉ — COMEX",
  "comex.nps": "NPS GLOBAL RÉSEAU",
  "comex.tma": "TMA MOYEN RÉSEAU",
  "comex.volume": "VOLUME CLIENTS SERVIS",
  "comex.vs_previous": "vs mois précédent",
  "comex.partial": "Données partielles",
  "comex.offline": "Hors ligne",
  "comex.error": "Impossible de charger le tableau de bord COMEX. Veuillez réessayer.",
  "comex.tv_on": "Activer le mode TV",
  "comex.tv_off": "Quitter le mode TV",
  "admin.title": "CONSOLE D'ADMINISTRATION",
  "admin.section.identity": "Identité banque",
  "admin.section.agencies": "Agences",
  "admin.section.services": "Services",
  "admin.section.counters": "Guichets",
  "admin.section.agents": "Agents",
  "admin.section.sms_templates": "Templates SMS",
  "admin.section.thresholds": "Seuils d'alerte",
  "admin.section.onboarding": "Onboarding agence",
  "admin.forbidden": "Vous n'avez pas les droits pour accéder à la console d'administration.",
  "admin.offline": "Connexion requise pour configurer",
  "admin.error": "Une erreur est survenue. Veuillez réessayer.",
  "admin.save": "Sauvegarder",
  "admin.cancel": "Annuler",
  "admin.confirm": "Confirmer",
  "admin.brand_label": "Couleur principale (--brand)",
  "admin.brand_warning": "Contraste insuffisant sur le fond clair (< 4,5:1).",
  "admin.brand_corrected": "Valeur corrigée appliquée",
  "admin.deactivate": "Désactiver",
  "admin.deactivate_tickets_title": "Tickets ouverts sur cette agence",
  "admin.import_csv": "Importer un CSV",
  "admin.import_summary": "Résumé de l'import",
  "admin.preview": "Aperçu",
  "admin.unknown_variable": "Variable non autorisée",
  "admin.empty_agencies": "Aucune agence configurée",
  "admin.wizard_step": "Étape",
  "admin.wizard_next": "Suivant",
  "admin.wizard_back": "Précédent",
  "admin.wizard_generate_qr": "Générer le QR d'installation",
  "admin.wizard_done": "Onboarding terminé",
};

/** English translations */
export const EN: TranslationDict = {
  "nav.dashboard": "Dashboard",
  "nav.admin": "Administration",
  "nav.agent": "Counter",
  "nav.audit": "Audit",
  "nav.logout": "Logout",
  "nav.manager": "Management",
  "nav.home": "Home",
  "auth.login": "Login",
  "auth.email": "Email address",
  "auth.password": "Password",
  "auth.submit": "Sign in",
  "auth.error": "Invalid credentials",
  "error.service_unavailable": "Service unavailable",
  "error.403": "Access denied",
  "error.403_message": "You do not have permission to access this page.",
  "error.go_to_dashboard": "Back to dashboard",
  "offline.banner": "Offline mode — data from cache",
  loading: "Loading…",
  "tv.title": "NOW CALLING",
  "tv.now_serving": "NOW SERVING",
  "tv.please_proceed": "Please proceed to",
  "tv.recent_calls": "RECENTLY CALLED",
  "tv.waiting": "WAITING",
  "tv.empty": "No call in progress",
  "tv.offline": "Offline — reconnecting…",
  "agent.current_ticket": "CURRENT TICKET",
  "agent.timer": "TIMER",
  "agent.call_next": "CALL NEXT",
  "agent.finish": "FINISH",
  "agent.transfer": "TRANSFER",
  "agent.queue_empty": "No customer waiting",
  "agent.error": "An error occurred, please try again",
  "agent.select_destination": "Choose a destination counter",
  "manager.tma": "CURRENT AWT",
  "manager.abandon": "Abandonment rate",
  "manager.nps": "NPS today",
  "manager.queues_by_service": "QUEUE BY SERVICE",
  "manager.agents_grid": "AGENTS GRID",
  "manager.alerts": "ALERTS",
  "manager.empty": "No data available yet",
  "manager.acknowledge": "Acknowledge",
  "manager.open": "Open",
  "manager.paused": "Pause",
  "manager.vs_j7": "vs D-7",
  "network.title": "NETWORK DIRECTION",
  "network.ranking": "AGENCY RANKING",
  "network.map": "NETWORK MAP",
  "network.alerts": "NETWORK ALERTS",
  "network.overview": "NETWORK OVERVIEW",
  "network.offline": "Offline mode — ranking frozen, resync on reconnection",
  "network.empty": "No agency configured for your bank",
  "network.empty_cta": "Create the first agency",
  "network.error": "Unable to load the network dashboard. Please try again.",
  "network.page": "Page",
  "network.prev": "Previous",
  "network.next": "Next",
  "network.agency_offline": "Offline",
  "comex.title": "QUALITY STEERING — COMEX",
  "comex.nps": "NETWORK GLOBAL NPS",
  "comex.tma": "NETWORK AVERAGE AWT",
  "comex.volume": "CLIENTS SERVED VOLUME",
  "comex.vs_previous": "vs previous month",
  "comex.partial": "Partial data",
  "comex.offline": "Offline",
  "comex.error": "Unable to load the COMEX dashboard. Please try again.",
  "comex.tv_on": "Enable TV mode",
  "comex.tv_off": "Exit TV mode",
  "admin.title": "ADMINISTRATION CONSOLE",
  "admin.section.identity": "Bank identity",
  "admin.section.agencies": "Agencies",
  "admin.section.services": "Services",
  "admin.section.counters": "Counters",
  "admin.section.agents": "Agents",
  "admin.section.sms_templates": "SMS templates",
  "admin.section.thresholds": "Alert thresholds",
  "admin.section.onboarding": "Agency onboarding",
  "admin.forbidden": "You do not have permission to access the administration console.",
  "admin.offline": "Connection required to configure",
  "admin.error": "An error occurred. Please try again.",
  "admin.save": "Save",
  "admin.cancel": "Cancel",
  "admin.confirm": "Confirm",
  "admin.brand_label": "Primary color (--brand)",
  "admin.brand_warning": "Insufficient contrast on light surface (< 4.5:1).",
  "admin.brand_corrected": "Corrected value applied",
  "admin.deactivate": "Deactivate",
  "admin.deactivate_tickets_title": "Open tickets on this agency",
  "admin.import_csv": "Import CSV",
  "admin.import_summary": "Import summary",
  "admin.preview": "Preview",
  "admin.unknown_variable": "Variable not allowed",
  "admin.empty_agencies": "No agency configured",
  "admin.wizard_step": "Step",
  "admin.wizard_next": "Next",
  "admin.wizard_back": "Back",
  "admin.wizard_generate_qr": "Generate installation QR",
  "admin.wizard_done": "Onboarding complete",
};

/** Dioula translations (Mandé language, Burkina Faso / Côte d'Ivoire) */
export const DIOULA: TranslationDict = {
  "nav.dashboard": "Tableau de bord",
  "nav.admin": "Kalanden",
  "nav.agent": "Guichet",
  "nav.audit": "Lajɛ",
  "nav.logout": "Bɔ",
  "nav.manager": "Talikɛla",
  "nav.home": "So",
  "auth.login": "Dòmini",
  "auth.email": "Email",
  "auth.password": "Gundo",
  "auth.submit": "Dòmini",
  "auth.error": "Tɔgɔ walima gundo tɛ ɲɛ",
  "error.service_unavailable": "Baara tɛ sɔrɔ",
  "error.403": "Sɔrɔ tɛ",
  "error.403_message": "I tɛ se ka don nin faan in na.",
  "error.go_to_dashboard": "Segin tableau de bord la",
  "offline.banner": "Internet tɛ sɔrɔ — kunnafoni bɔra cache la",
  loading: "A bɛ nɛgɛn…",
  "tv.title": "WELE MINNU BƐ KƐ",
  "tv.now_serving": "SISAN BƐ BAARA LA",
  "tv.please_proceed": "I ka taa",
  "tv.recent_calls": "WELE LABANW",
  "tv.waiting": "MAKƆNƆNI NA",
  "tv.empty": "Wele si tɛ kɛ",
  "tv.offline": "Internet tɛ — segin kan…",
  "agent.current_ticket": "TIKƐTI SISAN",
  "agent.timer": "WAATI",
  "agent.call_next": "NATA WELE",
  "agent.finish": "A BAN",
  "agent.transfer": "A YƐLƐMA",
  "agent.queue_empty": "Mɔgɔ si tɛ makɔnɔni na",
  "agent.error": "Fili dɔ kɛra, i ka segin",
  "agent.select_destination": "Guichet sugandi taayɔrɔ ye",
  "manager.tma": "MAKƆNƆNI WAATI",
  "manager.abandon": "Bilali hakɛ",
  "manager.nps": "Bi NPS",
  "manager.queues_by_service": "FILE BAARA KƆNƆ",
  "manager.agents_grid": "BAARAKƐLAW",
  "manager.alerts": "LASƆMINIW",
  "manager.empty": "Kunnafoni si tɛ yen fɔlɔ",
  "manager.acknowledge": "A jate",
  "manager.open": "A da wuli",
  "manager.paused": "A jɔ",
  "manager.vs_j7": "ka ɲɛsin J-7 ma",
  "network.title": "RÉSƆ ƝƐMƆGƆYA",
  "network.ranking": "AGENCE ƝƐSINALI",
  "network.map": "RÉSƆ KARTI",
  "network.alerts": "RÉSƆ LASƆMINIW",
  "network.overview": "RÉSƆ KUNAFONI",
  "network.offline": "Internet tɛ — ƝƐSINALI jɔlen, a bɛ segin i mako",
  "network.empty": "Agence si ma sigi i ka banki la fɔlɔ",
  "network.empty_cta": "Agence fɔlɔ da",
  "network.error": "Réso tableau tɛ se ka yɛlɛ. I ka segin.",
  "network.page": "Ɲɛ",
  "network.prev": "Kɔfɛ",
  "network.next": "Ɲɛfɛ",
  "network.agency_offline": "Hors ligne",
  "comex.title": "ƝUMANƝA LADILI — COMEX",
  "comex.nps": "RÉSƆ NPS",
  "comex.tma": "RÉSƆ MAKƆNƆNI WAATI",
  "comex.volume": "KILIYANW MINNU SƆRƆLA",
  "comex.vs_previous": "ka ɲɛsin kalo tɛmɛnen ma",
  "comex.partial": "Kunnafoni dama",
  "comex.offline": "Hors ligne",
  "comex.error": "COMEX tableau tɛ se ka yɛlɛ. I ka segin.",
  "comex.tv_on": "TV cogo daminɛ",
  "comex.tv_off": "TV cogo bɔ",
  "admin.title": "ƝƐMƆGƆYA KONSƆLI",
  "admin.section.identity": "Banki tɔgɔ",
  "admin.section.agencies": "Agencew",
  "admin.section.services": "Baaraw",
  "admin.section.counters": "Guichetw",
  "admin.section.agents": "Baarakɛlaw",
  "admin.section.sms_templates": "SMS modɛlw",
  "admin.section.thresholds": "Lasɔminɛ dan",
  "admin.section.onboarding": "Agence sigilan",
  "admin.forbidden": "I tɛ se ka don ɲɛmɔgɔya konsɔli la.",
  "admin.offline": "Internet ka kan walisa ka labɛn",
  "admin.error": "Fili dɔ kɛra. I ka segin.",
  "admin.save": "A mara",
  "admin.cancel": "A dabila",
  "admin.confirm": "A sɛmɛntiya",
  "admin.brand_label": "Kulɛri fɔlɔ (--brand)",
  "admin.brand_warning": "Contraste man ɲɛ fɔnbaga jɛlen kan (< 4,5:1).",
  "admin.brand_corrected": "Kulɛri ladilalen sɛmɛntiyalen",
  "admin.deactivate": "A jɔ",
  "admin.deactivate_tickets_title": "Tikɛti dayɛlɛlenw nin agence in kan",
  "admin.import_csv": "CSV don",
  "admin.import_summary": "Don kunnafoni",
  "admin.preview": "Filɛli",
  "admin.unknown_variable": "Variable tɛ sɔn",
  "admin.empty_agencies": "Agence si ma sigi",
  "admin.wizard_step": "Sen",
  "admin.wizard_next": "Ɲɛfɛ",
  "admin.wizard_back": "Kɔfɛ",
  "admin.wizard_generate_qr": "QR sigilan dilan",
  "admin.wizard_done": "Sigilan banna",
};

/** Baoulé translations (Akan language, Côte d'Ivoire) */
export const BAOULE: TranslationDict = {
  "nav.dashboard": "Tableau de bord",
  "nav.admin": "Nzuɛ'n",
  "nav.agent": "Guichet",
  "nav.audit": "Nian",
  "nav.logout": "Fite",
  "nav.manager": "Nzuɛ'n",
  "nav.home": "Fie",
  "auth.login": "Wlu",
  "auth.email": "Email",
  "auth.password": "Nzɔnzɔn",
  "auth.submit": "Wlu",
  "auth.error": "Ɲanmiɛn su gua'n timan",
  "error.service_unavailable": "Sɛɛvisi'n nianman",
  "error.403": "Wlu kpɛ'n nianman",
  "error.403_message": "Amun wunman ase ka fie sɔ'n nun.",
  "error.go_to_dashboard": "Sɛ kɔ tableau de bord'n su",
  "offline.banner": "Internet nianman — ɔ fa cache su ninnge'n",
  loading: "Ɔ nian…",
  "tv.title": "BE FLƐ WA'N",
  "tv.now_serving": "KƐ BE DI JUNMAN'N",
  "tv.please_proceed": "Ko",
  "tv.recent_calls": "BE FLƐLI'N MUN",
  "tv.waiting": "BE MINDƐ",
  "tv.empty": "Flɛli fi nunman",
  "tv.offline": "Internet nianman — sɛ kɔ…",
  "agent.current_ticket": "TIKƐ KƐ'N",
  "agent.timer": "BLƐ'N",
  "agent.call_next": "FLƐ KUN'N",
  "agent.finish": "WIE",
  "agent.transfer": "FA KƆ",
  "agent.queue_empty": "Sran fi nunman be mindɛ",
  "agent.error": "Sa kpa'n juman, sɛ i ekun",
  "agent.select_destination": "Fa guichet nga be kɔ'n",
  "manager.tma": "MINDƐ BLƐ'N",
  "manager.abandon": "Yaci hakɛ'n",
  "manager.nps": "NPS andɛ",
  "manager.queues_by_service": "FILE JUNMAN'N NUN",
  "manager.agents_grid": "JUNMANFUƐ'N MUN",
  "manager.alerts": "AFƆTUƐ'N MUN",
  "manager.empty": "Ninnge fi nunman ekun",
  "manager.acknowledge": "Sie i nzɔliɛ",
  "manager.open": "Tike",
  "manager.paused": "Jran",
  "manager.vs_j7": "nin J-7",
  "network.title": "RÉSO SIESIE'N",
  "network.ranking": "AGENCE'N BE NGUAN'N",
  "network.map": "RÉSO KARTI'N",
  "network.alerts": "RÉSO AFƆTUƐ'N MUN",
  "network.overview": "RÉSO NDƐ'N",
  "network.offline": "Internet nianman — nguan'n jran, sɛ kɔ kɛ be sa'n",
  "network.empty": "Agence fi nunman ɔ banki'n su ekun",
  "network.empty_cta": "Yi agence klikli'n",
  "network.error": "Réso tableau'n kwlá nianman. Sɛ i ekun.",
  "network.page": "Bue'n",
  "network.prev": "Sin",
  "network.next": "Ɲrun",
  "network.agency_offline": "Hors ligne",
  "comex.title": "NGUAN NIANLƐ — COMEX",
  "comex.nps": "RÉSO NPS",
  "comex.tma": "RÉSO MINDƐ BLƐ'N",
  "comex.volume": "SRAN NGA BE DILI'N",
  "comex.vs_previous": "nin anglo laa'n",
  "comex.partial": "Ndɛ wie",
  "comex.offline": "Hors ligne",
  "comex.error": "COMEX tableau'n kwlá nianman. Sɛ i ekun.",
  "comex.tv_on": "TV atin'n bo i bo",
  "comex.tv_off": "Fite TV atin'n nun",
  "admin.title": "SIESIE KONSƆLI",
  "admin.section.identity": "Banki dunman",
  "admin.section.agencies": "Agencew",
  "admin.section.services": "Junman'n mun",
  "admin.section.counters": "Guichetw",
  "admin.section.agents": "Junmanfuɛ'n mun",
  "admin.section.sms_templates": "SMS modɛl'n mun",
  "admin.section.thresholds": "Afɔtuɛ dan",
  "admin.section.onboarding": "Agence sielɛ",
  "admin.forbidden": "Amun wunman ase ka wlu siesie konsɔli'n nun.",
  "admin.offline": "Internet'n ti cinnjin naan be siesie",
  "admin.error": "Sa kpa'n juman. Sɛ i ekun.",
  "admin.save": "Sie i",
  "admin.cancel": "Yaci",
  "admin.confirm": "Kle kɛ ɔ ti su",
  "admin.brand_label": "Kulɛ klikli'n (--brand)",
  "admin.brand_warning": "Contraste'n timan kpa fɔnbaga ufue'n su (< 4,5:1).",
  "admin.brand_corrected": "Kulɛ nga be siesie'n be fa su",
  "admin.deactivate": "Jran i",
  "admin.deactivate_tickets_title": "Tikɛ nga be tike'n agence nga su",
  "admin.import_csv": "CSV wlɛ",
  "admin.import_summary": "Wlɛ ndɛ'n",
  "admin.preview": "Nian",
  "admin.unknown_variable": "Variable'n nunman",
  "admin.empty_agencies": "Agence fi nunman",
  "admin.wizard_step": "Ajrɛ",
  "admin.wizard_next": "Ɲrun",
  "admin.wizard_back": "Sin",
  "admin.wizard_generate_qr": "Yi QR sielɛ'n",
  "admin.wizard_done": "Sielɛ'n wieli",
};

/** All locales map */
export const LOCALES: Record<Locale, TranslationDict> = {
  fr: FR,
  dioula: DIOULA,
  baoule: BAOULE,
  en: EN,
};

/**
 * Gets a translation for a key in the given locale.
 * Falls back to French if key not found.
 * @param key - Translation key
 * @param locale - Target locale (default: "fr")
 * @returns Translated string
 */
export function t(key: TranslationKey, locale: Locale = "fr"): string {
  return LOCALES[locale][key] ?? FR[key] ?? key;
}
