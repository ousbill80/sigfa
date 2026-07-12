/**
 * Vitest setup for @sigfa/ui component tests.
 *
 * Registers jest-dom matchers and cleans the DOM between tests so state from
 * one component render never leaks into the next.
 *
 * @module test/setup
 */
import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});
