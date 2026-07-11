// fr.ts — Locale français (langue par défaut)
export const fr = {
  // Auth
  auth: {
    title: 'Connexion',
    phoneLabel: 'Numéro de téléphone',
    phonePlaceholder: '+225 XX XX XX XX XX',
    sendOtp: 'Envoyer le code',
    otpLabel: 'Code de vérification',
    otpPlaceholder: '6 chiffres',
    verifyOtp: 'Vérifier',
    uemoa_consent: "J'accepte le traitement de mes données conformément à la réglementation UEMOA",
    uemoa_required: 'Le consentement UEMOA est requis pour continuer',
  },
  // Navigation
  nav: {
    home: 'Accueil',
    newTicket: 'Nouveau ticket',
    myTicket: 'Mon ticket',
  },
  // Ticket
  ticket: {
    title: 'Prise de ticket',
    step1Title: 'Choisissez votre service',
    step2Title: 'Confirmation',
    step3Title: 'Votre ticket',
    agency: 'Agence',
    service: 'Service',
    confirm: 'Confirmer',
    next: 'Suivant',
    back: 'Retour',
    trackingId: 'Numéro de suivi',
    displayNumber: 'Numéro d\'appel',
    estimatedWait: 'Attente estimée',
    position: 'Position dans la file',
  },
  // États écran
  screen: {
    loading: 'Chargement...',
    error: 'Une erreur est survenue',
    empty: 'Aucun élément',
    offline: 'Hors ligne',
    retry: 'Réessayer',
  },
  // Offline
  offline: {
    badge: 'Hors ligne',
    queued: 'Ticket en attente de synchronisation',
  },
} as const;

export type TranslationKeys = typeof fr;
