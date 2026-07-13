/**
 * i18n — FR labels base, EN translation. Two locales only (FR/EN).
 * @module lib/i18n
 */

/** Supported locales */
export const SUPPORTED_LOCALES = ["fr", "en"] as const;
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
  | "tv.welcome"
  | "tv.queue_in_progress"
  | "tv.ad.account.title"
  | "tv.ad.account.subtitle"
  | "tv.ad.credit.title"
  | "tv.ad.credit.subtitle"
  | "tv.ad.app.title"
  | "tv.ad.app.subtitle"
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
  | "admin.wizard_done"
  | "admin.operations.title"
  | "admin.operations.add"
  | "admin.operations.empty"
  | "admin.operations.code"
  | "admin.operations.name"
  | "admin.operations.sla"
  | "admin.operations.sla_placeholder"
  | "admin.operations.sla_inherited"
  | "admin.operations.display_order"
  | "admin.operations.icon_key"
  | "admin.operations.active"
  | "admin.operations.inactive"
  | "admin.operations.edit"
  | "admin.operations.deactivate"
  | "admin.operations.manage"
  | "admin.conseiller.title"
  | "admin.conseiller.intro"
  | "admin.conseiller.agent_id"
  | "admin.conseiller.load"
  | "admin.conseiller.toggle"
  | "admin.conseiller.display_name"
  | "admin.conseiller.display_name_hint"
  | "admin.conseiller.photo_url"
  | "admin.conseiller.photo_url_hint"
  | "admin.conseiller.kiosk_notice"
  | "admin.conseiller.saved"
  | "admin.conseiller.marked"
  | "admin.conseiller.unmarked"
  | "reports.title"
  | "reports.forbidden"
  | "reports.export.title"
  | "reports.export.subtitle"
  | "reports.export.format"
  | "reports.export.format.pdf"
  | "reports.export.format.xlsx"
  | "reports.export.format.json"
  | "reports.export.scope"
  | "reports.export.scope.agency"
  | "reports.export.scope.network"
  | "reports.export.period"
  | "reports.export.launch"
  | "reports.export.status.pending"
  | "reports.export.status.processing"
  | "reports.export.status.ready"
  | "reports.export.status.failed"
  | "reports.export.download"
  | "reports.export.expired"
  | "reports.export.retry"
  | "reports.export.error"
  | "reports.export.offline"
  | "reports.export.empty"
  | "reports.benchmark.title"
  | "reports.benchmark.subtitle"
  | "reports.benchmark.sort"
  | "reports.benchmark.col.rank"
  | "reports.benchmark.col.agency"
  | "reports.benchmark.col.status"
  | "reports.benchmark.status.vert"
  | "reports.benchmark.status.orange"
  | "reports.benchmark.status.rouge"
  | "reports.benchmark.status.na"
  | "reports.benchmark.empty"
  | "reports.benchmark.error"
  | "reports.benchmark.offline"
  | "reports.kpi.tauxSLA"
  | "reports.kpi.tma"
  | "reports.kpi.tmt"
  | "reports.kpi.tts"
  | "reports.kpi.tauxAbandon"
  | "reports.kpi.nps"
  | "reports.kpi.occupation"
  | "audit.title"
  | "audit.subtitle"
  | "audit.filter.entityType"
  | "audit.filter.entityId"
  | "audit.filter.actorId"
  | "audit.filter.from"
  | "audit.filter.to"
  | "audit.filter.apply"
  | "audit.filter.reset"
  | "audit.col.timestamp"
  | "audit.col.actor"
  | "audit.col.action"
  | "audit.col.entity"
  | "audit.col.ip"
  | "audit.col.diff"
  | "audit.diff.before"
  | "audit.diff.after"
  | "audit.diff.none"
  | "audit.pagination.prev"
  | "audit.pagination.next"
  | "audit.pagination.page"
  | "audit.loading"
  | "audit.empty"
  | "audit.error"
  | "audit.offline"
  // IA-005 — AI insights surfaces (own namespace)
  | "ai.title"
  | "ai.subtitle"
  | "ai.forecast.title"
  | "ai.forecast.peak"
  | "ai.forecast.drivers"
  | "ai.forecast.factors"
  | "ai.forecast.confidence"
  | "ai.lowconf.flag"
  | "ai.staffing.title"
  | "ai.advisory.notice"
  | "ai.anomalies.title"
  | "ai.anomalies.subtitle"
  | "ai.anomaly.evidence"
  | "ai.anomaly.metric"
  | "ai.anomaly.threshold"
  | "ai.anomaly.window"
  | "ai.anomaly.sample"
  | "ai.anomaly.type.QUEUE_STUCK"
  | "ai.anomaly.type.AGENT_INACTIVE_PATTERN"
  | "ai.anomaly.type.SLA_SYSTEMIC"
  | "ai.anomaly.status.open"
  | "ai.anomaly.status.acked"
  | "ai.anomaly.status.resolved"
  | "ai.feedback.title"
  | "ai.feedback.score"
  | "ai.feedback.components"
  | "ai.feedback.sentiment"
  | "ai.feedback.positive"
  | "ai.feedback.neutral"
  | "ai.feedback.negative"
  | "ai.feedback.insufficient_sample"
  | "ai.comex.title"
  | "ai.comex.expected_load"
  | "ai.comex.atrisk"
  | "ai.comex.open_anomalies"
  | "ai.comex.level.ok"
  | "ai.comex.level.watch"
  | "ai.comex.level.risk"
  | "ai.state.loading"
  | "ai.state.empty"
  | "ai.state.error"
  | "ai.state.offline"
  | "ai.insufficient.title"
  | "ai.insufficient.progress"
  | "ai.insufficient.hint"
  // NET-001 — Super Admin network console (own namespace)
  | "netAdmin.title"
  | "netAdmin.subtitle"
  | "netAdmin.guarantee"
  | "netAdmin.read_only"
  | "netAdmin.synthesis.title"
  | "netAdmin.synthesis.banks"
  | "netAdmin.synthesis.agencies"
  | "netAdmin.synthesis.kiosks_online"
  | "netAdmin.synthesis.kiosks_offline"
  | "netAdmin.synthesis.muted_rate"
  | "netAdmin.synthesis.open_incidents"
  | "netAdmin.synthesis.tickets"
  | "netAdmin.banks.title"
  | "netAdmin.col.bank"
  | "netAdmin.col.agencies"
  | "netAdmin.col.kiosks"
  | "netAdmin.col.tickets"
  | "netAdmin.col.uptime"
  | "netAdmin.col.health"
  | "netAdmin.kiosks_split"
  | "netAdmin.health.vert"
  | "netAdmin.health.orange"
  | "netAdmin.health.rouge"
  | "netAdmin.health.na"
  | "netAdmin.forbidden"
  | "netAdmin.refresh"
  | "netAdmin.loading"
  | "netAdmin.empty"
  | "netAdmin.error"
  | "netAdmin.offline"
  | "netAdmin.reconnect"
  // ADM-003b — supervision bornes (namespace propre admSuper.*)
  | "admSuper.title"
  | "admSuper.subtitle"
  | "admSuper.view.agency"
  | "admSuper.view.network"
  | "admSuper.alerts_active"
  | "admSuper.status.online"
  | "admSuper.status.degraded"
  | "admSuper.status.silent"
  | "admSuper.status.never_seen"
  | "admSuper.silent_label"
  | "admSuper.kiosk_label"
  | "admSuper.agency_label"
  | "admSuper.id_meta"
  | "admSuper.last_seen"
  | "admSuper.never_seen_hint"
  | "admSuper.count.online"
  | "admSuper.count.degraded"
  | "admSuper.count.silent"
  | "admSuper.count.never_seen"
  | "admSuper.count.kiosks"
  | "admSuper.network.agencies"
  | "admSuper.network.no_silent"
  | "admSuper.loading"
  | "admSuper.empty"
  | "admSuper.empty_cta"
  | "admSuper.error"
  | "admSuper.stale"
  | "admSuper.offline";

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
  "tv.welcome": "Bienvenue",
  "tv.queue_in_progress": "File d'attente en cours",
  "tv.ad.account.title": "Ouvrez un compte en 10 minutes",
  "tv.ad.account.subtitle": "Sans frais de dossier, directement en agence.",
  "tv.ad.credit.title": "Crédit auto à taux préférentiel",
  "tv.ad.credit.subtitle": "Financez votre véhicule en toute sérénité.",
  "tv.ad.app.title": "Votre banque dans la poche",
  "tv.ad.app.subtitle": "Découvrez la nouvelle application mobile.",
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
  "admin.operations.title": "Opérations",
  "admin.operations.add": "Ajouter une opération",
  "admin.operations.empty": "Aucune opération configurée pour ce service.",
  "admin.operations.code": "Code",
  "admin.operations.name": "Nom",
  "admin.operations.sla": "SLA (min)",
  "admin.operations.sla_placeholder": "Hérite du service",
  "admin.operations.sla_inherited": "Hérite du SLA du service",
  "admin.operations.display_order": "Ordre d'affichage",
  "admin.operations.icon_key": "Icône (clé)",
  "admin.operations.active": "Active",
  "admin.operations.inactive": "Inactive",
  "admin.operations.edit": "Modifier",
  "admin.operations.deactivate": "Désactiver",
  "admin.operations.manage": "Gérer les opérations",
  "admin.conseiller.title": "Marquer un conseiller",
  "admin.conseiller.intro":
    "Marquez un agent comme conseiller clientèle. Son nom public et sa photo apparaîtront sur la borne.",
  "admin.conseiller.agent_id": "Identifiant de l'agent",
  "admin.conseiller.load": "Charger le profil",
  "admin.conseiller.toggle": "Agent conseiller clientèle",
  "admin.conseiller.display_name": "Nom public (affiché en borne)",
  "admin.conseiller.display_name_hint":
    "Requis pour un conseiller. Ce nom apparaît sur la borne (ex. « Kofi A. »).",
  "admin.conseiller.photo_url": "Photo (URL, optionnel)",
  "admin.conseiller.photo_url_hint": "Optionnel — apparaît sur la borne à côté du nom.",
  "admin.conseiller.kiosk_notice":
    "Le nom public et la photo apparaissent sur la borne, dans la liste des conseillers.",
  "admin.conseiller.saved": "Profil conseiller enregistré.",
  "admin.conseiller.marked": "Conseiller",
  "admin.conseiller.unmarked": "Non conseiller",
  "reports.title": "RAPPORTS & BENCHMARKING",
  "reports.forbidden":
    "Vous n'avez pas les droits pour accéder aux rapports et au benchmarking.",
  "reports.export.title": "EXPORT DE RAPPORT",
  "reports.export.subtitle": "Générez un rapport au format PDF, Excel ou JSON.",
  "reports.export.format": "Format",
  "reports.export.format.pdf": "PDF",
  "reports.export.format.xlsx": "Excel",
  "reports.export.format.json": "JSON",
  "reports.export.scope": "Périmètre",
  "reports.export.scope.agency": "Agence",
  "reports.export.scope.network": "Réseau",
  "reports.export.period": "Période",
  "reports.export.launch": "Lancer l'export",
  "reports.export.status.pending": "En file d'attente…",
  "reports.export.status.processing": "Génération en cours…",
  "reports.export.status.ready": "Rapport prêt",
  "reports.export.status.failed": "Échec de la génération",
  "reports.export.download": "Télécharger le rapport",
  "reports.export.expired": "Le lien de téléchargement a expiré.",
  "reports.export.retry": "Relancer l'export",
  "reports.export.error": "Impossible de lancer l'export. Veuillez réessayer.",
  "reports.export.offline": "Connexion requise pour générer un export.",
  "reports.export.empty": "Aucun export lancé pour le moment.",
  "reports.benchmark.title": "BENCHMARKING INTER-AGENCES",
  "reports.benchmark.subtitle": "Classement des agences par KPI de tri.",
  "reports.benchmark.sort": "Trier par",
  "reports.benchmark.col.rank": "Rang",
  "reports.benchmark.col.agency": "Agence",
  "reports.benchmark.col.status": "Statut",
  "reports.benchmark.status.vert": "Vert",
  "reports.benchmark.status.orange": "Orange",
  "reports.benchmark.status.rouge": "Rouge",
  "reports.benchmark.status.na": "N/A",
  "reports.benchmark.empty": "Aucune agence à classer sur cette période.",
  "reports.benchmark.error": "Impossible de charger le benchmarking. Veuillez réessayer.",
  "reports.benchmark.offline": "Mode hors ligne — classement figé.",
  "reports.kpi.tauxSLA": "Taux SLA",
  "reports.kpi.tma": "TMA",
  "reports.kpi.tmt": "TMT",
  "reports.kpi.tts": "TTS",
  "reports.kpi.tauxAbandon": "Taux d'abandon",
  "reports.kpi.nps": "NPS",
  "reports.kpi.occupation": "Occupation",
  "audit.title": "Journal d'audit",
  "audit.subtitle": "Consultation en lecture seule des évènements de sécurité et de configuration.",
  "audit.filter.entityType": "Type d'entité",
  "audit.filter.entityId": "Identifiant d'entité",
  "audit.filter.actorId": "Identifiant de l'acteur",
  "audit.filter.from": "Du",
  "audit.filter.to": "Au",
  "audit.filter.apply": "Filtrer",
  "audit.filter.reset": "Réinitialiser",
  "audit.col.timestamp": "Horodatage",
  "audit.col.actor": "Acteur",
  "audit.col.action": "Action",
  "audit.col.entity": "Entité",
  "audit.col.ip": "Adresse IP",
  "audit.col.diff": "Modifications",
  "audit.diff.before": "Avant",
  "audit.diff.after": "Après",
  "audit.diff.none": "—",
  "audit.pagination.prev": "Précédent",
  "audit.pagination.next": "Suivant",
  "audit.pagination.page": "Page",
  "audit.loading": "Chargement du journal d'audit…",
  "audit.empty": "Aucun évènement pour ces critères.",
  "audit.error": "Impossible de charger le journal d'audit. Réessayez.",
  "audit.offline": "Hors ligne — le journal affiché peut ne pas être à jour.",
  "ai.title": "INSIGHTS IA — DIRECTION",
  "ai.subtitle": "Prédictions et explications. L'humain reste décideur.",
  "ai.forecast.title": "PRÉVISION D'AFFLUENCE",
  "ai.forecast.peak": "Pic attendu",
  "ai.forecast.drivers": "Facteurs explicatifs",
  "ai.forecast.factors": "Contexte du jour",
  "ai.forecast.confidence": "Confiance",
  "ai.lowconf.flag": "Confiance faible — à interpréter avec précaution",
  "ai.staffing.title": "RECOMMANDATIONS DE STAFFING",
  "ai.advisory.notice":
    "Recommandations consultatives : elles éclairent la décision, jamais exécutées automatiquement.",
  "ai.anomalies.title": "ANOMALIES DÉTECTÉES",
  "ai.anomalies.subtitle": "Motifs agrégés sur fenêtre glissante — distincts des alertes instantanées.",
  "ai.anomaly.evidence": "Preuves",
  "ai.anomaly.metric": "Métrique",
  "ai.anomaly.threshold": "Seuil",
  "ai.anomaly.window": "Fenêtre",
  "ai.anomaly.sample": "Échantillon",
  "ai.anomaly.type.QUEUE_STUCK": "File bloquée",
  "ai.anomaly.type.AGENT_INACTIVE_PATTERN": "Motif d'inactivité",
  "ai.anomaly.type.SLA_SYSTEMIC": "SLA systémique",
  "ai.anomaly.status.open": "Ouverte",
  "ai.anomaly.status.acked": "Acquittée",
  "ai.anomaly.status.resolved": "Résolue",
  "ai.feedback.title": "QUALITÉ DES FEEDBACKS",
  "ai.feedback.score": "Score qualité",
  "ai.feedback.components": "Décomposition",
  "ai.feedback.sentiment": "Sentiments",
  "ai.feedback.positive": "Positif",
  "ai.feedback.neutral": "Neutre",
  "ai.feedback.negative": "Négatif",
  "ai.feedback.insufficient_sample": "Échantillon insuffisant — score non publié",
  "ai.comex.title": "COMEX — SYNTHÈSE PRÉDICTIVE",
  "ai.comex.expected_load": "Charge attendue réseau",
  "ai.comex.atrisk": "Agences à risque",
  "ai.comex.open_anomalies": "Anomalies ouvertes",
  "ai.comex.level.ok": "Réseau serein",
  "ai.comex.level.watch": "Vigilance",
  "ai.comex.level.risk": "Risque",
  "ai.state.loading": "Calcul des prédictions…",
  "ai.state.empty": "Aucune donnée IA disponible pour le moment.",
  "ai.state.error": "Impossible de charger les insights IA. Veuillez réessayer.",
  "ai.state.offline": "Hors ligne — insights depuis le cache",
  "ai.insufficient.title": "Prédictions bientôt disponibles",
  "ai.insufficient.progress": "jours d'historique collectés",
  "ai.insufficient.hint":
    "Les prédictions s'activent après 90 jours de données. Le compteur progresse chaque jour.",
  "netAdmin.title": "SUPERVISION RÉSEAU — SUPER ADMIN",
  "netAdmin.subtitle": "Pilotage cross-tenant du parc — lecture seule.",
  "netAdmin.guarantee": "Agrégat réseau — aucune donnée client",
  "netAdmin.read_only": "Console en lecture seule — aucune action sur les données d'une banque.",
  "netAdmin.synthesis.title": "SYNTHÈSE RÉSEAU",
  "netAdmin.synthesis.banks": "Banques",
  "netAdmin.synthesis.agencies": "Agences",
  "netAdmin.synthesis.kiosks_online": "Bornes en ligne",
  "netAdmin.synthesis.kiosks_offline": "Bornes hors ligne",
  "netAdmin.synthesis.muted_rate": "Taux de bornes muettes",
  "netAdmin.synthesis.open_incidents": "Incidents ouverts",
  "netAdmin.synthesis.tickets": "Tickets agrégés",
  "netAdmin.banks.title": "VUE PAR BANQUE",
  "netAdmin.col.bank": "Banque",
  "netAdmin.col.agencies": "Agences",
  "netAdmin.col.kiosks": "Bornes (en ligne / hors ligne)",
  "netAdmin.col.tickets": "Tickets",
  "netAdmin.col.uptime": "Disponibilité",
  "netAdmin.col.health": "Santé",
  "netAdmin.kiosks_split": "en ligne / hors ligne",
  "netAdmin.health.vert": "Vert",
  "netAdmin.health.orange": "Orange",
  "netAdmin.health.rouge": "Rouge",
  "netAdmin.health.na": "N/A",
  "netAdmin.forbidden": "Console réservée au Super Admin plateforme.",
  "netAdmin.refresh": "Rafraîchir",
  "netAdmin.loading": "Chargement de la supervision réseau…",
  "netAdmin.empty": "Aucune banque dans le réseau pour le moment.",
  "netAdmin.error": "Impossible de charger la supervision réseau. Veuillez réessayer.",
  "netAdmin.offline": "Hors ligne — agrégats figés, resynchronisation à la reconnexion.",
  "netAdmin.reconnect": "Se reconnecter",
  // ADM-003b — supervision bornes
  "admSuper.title": "Supervision des bornes",
  "admSuper.subtitle": "État de santé des bornes en temps réel",
  "admSuper.view.agency": "Vue agence",
  "admSuper.view.network": "Vue réseau",
  "admSuper.alerts_active": "alertes actives",
  "admSuper.status.online": "En ligne",
  "admSuper.status.degraded": "Dégradée",
  "admSuper.status.silent": "Muette",
  "admSuper.status.never_seen": "Jamais vue",
  "admSuper.silent_label": "Borne muette",
  "admSuper.kiosk_label": "Borne",
  "admSuper.agency_label": "Agence",
  "admSuper.id_meta": "Identifiant",
  "admSuper.last_seen": "Dernier signe",
  "admSuper.never_seen_hint": "Installation non finalisée",
  "admSuper.count.online": "En ligne",
  "admSuper.count.degraded": "Dégradées",
  "admSuper.count.silent": "Muettes",
  "admSuper.count.never_seen": "Jamais vues",
  "admSuper.count.kiosks": "Bornes",
  "admSuper.network.agencies": "Agences avec bornes muettes",
  "admSuper.network.no_silent": "Aucune agence en alerte — toutes les bornes répondent",
  "admSuper.loading": "Chargement de la supervision…",
  "admSuper.empty": "Aucune borne enregistrée — provisionnez depuis l'onboarding",
  "admSuper.empty_cta": "Ouvrir l'onboarding",
  "admSuper.error": "Impossible de charger la supervision des bornes. Veuillez réessayer.",
  "admSuper.stale": "Supervision indisponible — affichage du dernier état connu",
  "admSuper.offline": "Mode hors ligne — resynchronisation à la reconnexion",
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
  "tv.welcome": "Welcome",
  "tv.queue_in_progress": "Queue in progress",
  "tv.ad.account.title": "Open an account in 10 minutes",
  "tv.ad.account.subtitle": "No processing fees, right at the branch.",
  "tv.ad.credit.title": "Car loan at a preferential rate",
  "tv.ad.credit.subtitle": "Finance your vehicle with peace of mind.",
  "tv.ad.app.title": "Your bank in your pocket",
  "tv.ad.app.subtitle": "Discover the new mobile app.",
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
  "admin.operations.title": "Operations",
  "admin.operations.add": "Add an operation",
  "admin.operations.empty": "No operation configured for this service.",
  "admin.operations.code": "Code",
  "admin.operations.name": "Name",
  "admin.operations.sla": "SLA (min)",
  "admin.operations.sla_placeholder": "Inherits from service",
  "admin.operations.sla_inherited": "Inherits the service SLA",
  "admin.operations.display_order": "Display order",
  "admin.operations.icon_key": "Icon (key)",
  "admin.operations.active": "Active",
  "admin.operations.inactive": "Inactive",
  "admin.operations.edit": "Edit",
  "admin.operations.deactivate": "Deactivate",
  "admin.operations.manage": "Manage operations",
  "admin.conseiller.title": "Mark a relationship manager",
  "admin.conseiller.intro":
    "Mark an agent as a relationship manager. Their public name and photo will appear on the kiosk.",
  "admin.conseiller.agent_id": "Agent identifier",
  "admin.conseiller.load": "Load profile",
  "admin.conseiller.toggle": "Relationship manager",
  "admin.conseiller.display_name": "Public name (shown on kiosk)",
  "admin.conseiller.display_name_hint":
    "Required for a relationship manager. Shown on the kiosk (e.g. “Kofi A.”).",
  "admin.conseiller.photo_url": "Photo (URL, optional)",
  "admin.conseiller.photo_url_hint": "Optional — shown on the kiosk next to the name.",
  "admin.conseiller.kiosk_notice":
    "The public name and photo appear on the kiosk, in the relationship managers list.",
  "admin.conseiller.saved": "Relationship manager profile saved.",
  "admin.conseiller.marked": "Relationship manager",
  "admin.conseiller.unmarked": "Not a manager",
  "reports.title": "REPORTS & BENCHMARKING",
  "reports.forbidden": "You do not have permission to access reports and benchmarking.",
  "reports.export.title": "REPORT EXPORT",
  "reports.export.subtitle": "Generate a report as PDF, Excel or JSON.",
  "reports.export.format": "Format",
  "reports.export.format.pdf": "PDF",
  "reports.export.format.xlsx": "Excel",
  "reports.export.format.json": "JSON",
  "reports.export.scope": "Scope",
  "reports.export.scope.agency": "Agency",
  "reports.export.scope.network": "Network",
  "reports.export.period": "Period",
  "reports.export.launch": "Start export",
  "reports.export.status.pending": "Queued…",
  "reports.export.status.processing": "Generating…",
  "reports.export.status.ready": "Report ready",
  "reports.export.status.failed": "Generation failed",
  "reports.export.download": "Download report",
  "reports.export.expired": "The download link has expired.",
  "reports.export.retry": "Restart export",
  "reports.export.error": "Unable to start the export. Please try again.",
  "reports.export.offline": "Connection required to generate an export.",
  "reports.export.empty": "No export started yet.",
  "reports.benchmark.title": "INTER-AGENCY BENCHMARKING",
  "reports.benchmark.subtitle": "Agency ranking by sort KPI.",
  "reports.benchmark.sort": "Sort by",
  "reports.benchmark.col.rank": "Rank",
  "reports.benchmark.col.agency": "Agency",
  "reports.benchmark.col.status": "Status",
  "reports.benchmark.status.vert": "Green",
  "reports.benchmark.status.orange": "Orange",
  "reports.benchmark.status.rouge": "Red",
  "reports.benchmark.status.na": "N/A",
  "reports.benchmark.empty": "No agency to rank for this period.",
  "reports.benchmark.error": "Unable to load benchmarking. Please try again.",
  "reports.benchmark.offline": "Offline mode — ranking frozen.",
  "reports.kpi.tauxSLA": "SLA rate",
  "reports.kpi.tma": "AWT",
  "reports.kpi.tmt": "AHT",
  "reports.kpi.tts": "ATS",
  "reports.kpi.tauxAbandon": "Abandonment rate",
  "reports.kpi.nps": "NPS",
  "reports.kpi.occupation": "Occupancy",
  "audit.title": "Audit log",
  "audit.subtitle": "Read-only view of security and configuration events.",
  "audit.filter.entityType": "Entity type",
  "audit.filter.entityId": "Entity ID",
  "audit.filter.actorId": "Actor ID",
  "audit.filter.from": "From",
  "audit.filter.to": "To",
  "audit.filter.apply": "Filter",
  "audit.filter.reset": "Reset",
  "audit.col.timestamp": "Timestamp",
  "audit.col.actor": "Actor",
  "audit.col.action": "Action",
  "audit.col.entity": "Entity",
  "audit.col.ip": "IP address",
  "audit.col.diff": "Changes",
  "audit.diff.before": "Before",
  "audit.diff.after": "After",
  "audit.diff.none": "—",
  "audit.pagination.prev": "Previous",
  "audit.pagination.next": "Next",
  "audit.pagination.page": "Page",
  "audit.loading": "Loading audit log…",
  "audit.empty": "No events for these filters.",
  "audit.error": "Unable to load the audit log. Please retry.",
  "audit.offline": "Offline — the displayed log may be out of date.",
  "ai.title": "AI INSIGHTS — DIRECTION",
  "ai.subtitle": "Predictions and explanations. The human stays in charge.",
  "ai.forecast.title": "FOOTFALL FORECAST",
  "ai.forecast.peak": "Expected peak",
  "ai.forecast.drivers": "Explaining drivers",
  "ai.forecast.factors": "Today's context",
  "ai.forecast.confidence": "Confidence",
  "ai.lowconf.flag": "Low confidence — interpret with caution",
  "ai.staffing.title": "STAFFING RECOMMENDATIONS",
  "ai.advisory.notice":
    "Advisory recommendations: they inform the decision, never executed automatically.",
  "ai.anomalies.title": "DETECTED ANOMALIES",
  "ai.anomalies.subtitle": "Aggregated patterns over a sliding window — distinct from instant alerts.",
  "ai.anomaly.evidence": "Evidence",
  "ai.anomaly.metric": "Metric",
  "ai.anomaly.threshold": "Threshold",
  "ai.anomaly.window": "Window",
  "ai.anomaly.sample": "Sample",
  "ai.anomaly.type.QUEUE_STUCK": "Queue stuck",
  "ai.anomaly.type.AGENT_INACTIVE_PATTERN": "Inactivity pattern",
  "ai.anomaly.type.SLA_SYSTEMIC": "Systemic SLA",
  "ai.anomaly.status.open": "Open",
  "ai.anomaly.status.acked": "Acknowledged",
  "ai.anomaly.status.resolved": "Resolved",
  "ai.feedback.title": "FEEDBACK QUALITY",
  "ai.feedback.score": "Quality score",
  "ai.feedback.components": "Decomposition",
  "ai.feedback.sentiment": "Sentiment",
  "ai.feedback.positive": "Positive",
  "ai.feedback.neutral": "Neutral",
  "ai.feedback.negative": "Negative",
  "ai.feedback.insufficient_sample": "Insufficient sample — score not published",
  "ai.comex.title": "COMEX — PREDICTIVE SYNTHESIS",
  "ai.comex.expected_load": "Expected network load",
  "ai.comex.atrisk": "Agencies at risk",
  "ai.comex.open_anomalies": "Open anomalies",
  "ai.comex.level.ok": "Network calm",
  "ai.comex.level.watch": "Watch",
  "ai.comex.level.risk": "Risk",
  "ai.state.loading": "Computing predictions…",
  "ai.state.empty": "No AI data available yet.",
  "ai.state.error": "Unable to load AI insights. Please try again.",
  "ai.state.offline": "Offline — insights from cache",
  "ai.insufficient.title": "Predictions coming soon",
  "ai.insufficient.progress": "days of history collected",
  "ai.insufficient.hint":
    "Predictions activate after 90 days of data. The counter progresses each day.",
  "netAdmin.title": "NETWORK SUPERVISION — SUPER ADMIN",
  "netAdmin.subtitle": "Cross-tenant fleet steering — read-only.",
  "netAdmin.guarantee": "Network aggregate — no customer data",
  "netAdmin.read_only": "Read-only console — no action on any bank's data.",
  "netAdmin.synthesis.title": "NETWORK SYNTHESIS",
  "netAdmin.synthesis.banks": "Banks",
  "netAdmin.synthesis.agencies": "Agencies",
  "netAdmin.synthesis.kiosks_online": "Kiosks online",
  "netAdmin.synthesis.kiosks_offline": "Kiosks offline",
  "netAdmin.synthesis.muted_rate": "Muted kiosk rate",
  "netAdmin.synthesis.open_incidents": "Open incidents",
  "netAdmin.synthesis.tickets": "Aggregated tickets",
  "netAdmin.banks.title": "PER-BANK VIEW",
  "netAdmin.col.bank": "Bank",
  "netAdmin.col.agencies": "Agencies",
  "netAdmin.col.kiosks": "Kiosks (online / offline)",
  "netAdmin.col.tickets": "Tickets",
  "netAdmin.col.uptime": "Uptime",
  "netAdmin.col.health": "Health",
  "netAdmin.kiosks_split": "online / offline",
  "netAdmin.health.vert": "Green",
  "netAdmin.health.orange": "Orange",
  "netAdmin.health.rouge": "Red",
  "netAdmin.health.na": "N/A",
  "netAdmin.forbidden": "Console restricted to the platform Super Admin.",
  "netAdmin.refresh": "Refresh",
  "netAdmin.loading": "Loading network supervision…",
  "netAdmin.empty": "No bank in the network yet.",
  "netAdmin.error": "Unable to load network supervision. Please try again.",
  "netAdmin.offline": "Offline — aggregates frozen, resync on reconnection.",
  "netAdmin.reconnect": "Reconnect",
  // ADM-003b — kiosk supervision
  "admSuper.title": "Kiosk supervision",
  "admSuper.subtitle": "Kiosk health status in real time",
  "admSuper.view.agency": "Agency view",
  "admSuper.view.network": "Network view",
  "admSuper.alerts_active": "active alerts",
  "admSuper.status.online": "Online",
  "admSuper.status.degraded": "Degraded",
  "admSuper.status.silent": "Silent",
  "admSuper.status.never_seen": "Never seen",
  "admSuper.silent_label": "Silent kiosk",
  "admSuper.kiosk_label": "Kiosk",
  "admSuper.agency_label": "Agency",
  "admSuper.id_meta": "Identifier",
  "admSuper.last_seen": "Last seen",
  "admSuper.never_seen_hint": "Installation not finalised",
  "admSuper.count.online": "Online",
  "admSuper.count.degraded": "Degraded",
  "admSuper.count.silent": "Silent",
  "admSuper.count.never_seen": "Never seen",
  "admSuper.count.kiosks": "Kiosks",
  "admSuper.network.agencies": "Agencies with silent kiosks",
  "admSuper.network.no_silent": "No agency in alert — every kiosk is responding",
  "admSuper.loading": "Loading supervision…",
  "admSuper.empty": "No kiosk registered — provision one from onboarding",
  "admSuper.empty_cta": "Open onboarding",
  "admSuper.error": "Unable to load kiosk supervision. Please try again.",
  "admSuper.stale": "Supervision unavailable — showing last known state",
  "admSuper.offline": "Offline mode — resync on reconnection",
};

/** All locales map */
export const LOCALES: Record<Locale, TranslationDict> = {
  fr: FR,
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
