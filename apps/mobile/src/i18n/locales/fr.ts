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
  // Ticket vivant (MOB-003)
  liveTicket: {
    yourTurn: 'Votre tour !',
    noActiveTicket: 'Aucun ticket actif',
    notFound: "Adressez-vous à l'accueil",
    personsBefore: 'personne(s) devant vous',
    updatedEvery30s: 'Mis à jour toutes les 30 secondes',
  },
  // Feedback (MOB-005)
  feedback: {
    title: 'Donner mon avis',
    commentLabel: 'Un mot à ajouter ? (facultatif)',
    commentPlaceholder: 'Votre commentaire...',
    submit: 'Donner mon avis',
    success: 'Merci pour votre retour !',
    alreadySubmitted: 'Vous avez déjà donné votre avis',
    windowExpired: 'La fenêtre de feedback est expirée',
    stars: 'Note',
    historyTitle: 'Historique de tickets',
    historyEmpty: 'Aucun ticket dans votre historique',
    badgeReminder: 'Donnez votre avis',
  },
  // Notifications (MOB-004)
  notifications: {
    twoPersonsAhead: 'Plus que 2 personnes devant vous — dirigez-vous vers l\'agence',
    twoPersonsWithTravel: 'Plus que 2 personnes devant vous — dirigez-vous vers l\'agence (trajet estimé : {travel} min)',
  },
} as const;

export type TranslationKeys = typeof fr;
