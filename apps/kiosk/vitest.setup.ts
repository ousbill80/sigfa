/**
 * KIOSK-006 — Setup global des tests kiosk.
 * Fournit une implémentation IndexedDB en mémoire (fake-indexeddb) pour jsdom,
 * indispensable dès qu'un composant/hook touche Dexie (offline-first).
 */
import "fake-indexeddb/auto";
