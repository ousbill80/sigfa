// auth.ts — MOB-001
// Service d'authentification OTP mock
// Code fixe : 123456 (dev/test uniquement)

const MOCK_OTP = '123456';

// Simule un délai réseau
function delay(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/**
 * Demande l'envoi d'un OTP par SMS.
 * En développement : le code est toujours 123456.
 */
export async function requestOtp(phone: string): Promise<void> {
  if (!phone || phone.length < 8) {
    throw new Error('Numéro de téléphone invalide');
  }
  await delay(300); // Simule latence réseau
}

/**
 * Vérifie le code OTP entré par l'utilisateur.
 * Mock: retourne true si code === '123456'.
 */
export async function verifyOtp(phone: string, code: string): Promise<boolean> {
  if (!phone || phone.length < 8) {
    throw new Error('Numéro de téléphone invalide');
  }
  await delay(300); // Simule latence réseau
  return code === MOCK_OTP;
}
