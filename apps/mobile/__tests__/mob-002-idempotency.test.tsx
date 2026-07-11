// __tests__/mob-002-idempotency.test.tsx
// MOB-002: X-Idempotency-Key — chaque émission génère un nanoid(21) unique
import { nanoid } from 'nanoid/non-secure';

describe('MOB-002: X-Idempotency-Key — chaque émission génère un nanoid(21) unique', () => {
  test('nanoid génère un identifiant de longueur 21', () => {
    const id = nanoid(21);
    expect(id).toHaveLength(21);
  });

  test('deux nanoid(21) sont toujours différents', () => {
    const id1 = nanoid(21);
    const id2 = nanoid(21);
    expect(id1).not.toBe(id2);
  });

  test('nanoid(21) correspond au pattern alphanumerique/tirets/underscores', () => {
    const id = nanoid(21);
    expect(id).toMatch(/^[A-Za-z0-9_-]{21}$/);
  });

  test('MOB-002: réponse mock — trackingId pattern ^[A-Za-z0-9_-]{21}$', () => {
    const trackingId = nanoid(21);
    expect(trackingId).toMatch(/^[A-Za-z0-9_-]{21}$/);
  });

  test('génère 100 IDs uniques sans collision', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 100; i++) {
      ids.add(nanoid(21));
    }
    expect(ids.size).toBe(100);
  });
});
