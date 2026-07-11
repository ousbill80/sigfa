// __tests__/mob-001-auth-service.test.tsx
// MOB-001: services auth — requestOtp et verifyOtp
import { requestOtp, verifyOtp } from '../src/services/auth';

// Override timers to speed up delay
jest.useFakeTimers();

describe('MOB-001: services auth — requestOtp et verifyOtp', () => {
  afterEach(() => {
    jest.clearAllTimers();
  });

  afterAll(() => {
    jest.useRealTimers();
  });

  test('requestOtp réussit avec un numéro valide', async () => {
    const promise = requestOtp('+2250102030405');
    jest.runAllTimers();
    await expect(promise).resolves.toBeUndefined();
  });

  test('requestOtp échoue avec un numéro trop court', async () => {
    await expect(requestOtp('123')).rejects.toThrow('Numéro de téléphone invalide');
  });

  test('requestOtp échoue avec un numéro vide', async () => {
    await expect(requestOtp('')).rejects.toThrow('Numéro de téléphone invalide');
  });

  test('verifyOtp retourne true avec le code correct 123456', async () => {
    const promise = verifyOtp('+2250102030405', '123456');
    jest.runAllTimers();
    await expect(promise).resolves.toBe(true);
  });

  test('verifyOtp retourne false avec un mauvais code', async () => {
    const promise = verifyOtp('+2250102030405', '999999');
    jest.runAllTimers();
    await expect(promise).resolves.toBe(false);
  });

  test('verifyOtp échoue avec un numéro trop court', async () => {
    await expect(verifyOtp('123', '123456')).rejects.toThrow('Numéro de téléphone invalide');
  });
});
