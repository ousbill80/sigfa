/**
 * useTvClock — client-only wall-clock ticking every second for the TV header.
 * @module lib/use-tv-clock
 */
"use client";

import { useEffect, useState } from "react";

/**
 * Formats a Date into a HH:MM:SS string (24h, zero-padded).
 * @param date - The date to format.
 * @returns The formatted clock string.
 */
export function formatClock(date: Date): string {
  const pad = (n: number): string => n.toString().padStart(2, "0");
  return `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

/**
 * Returns a live HH:MM:SS clock string, updated every second on the client.
 * Renders an empty string on the server to avoid hydration mismatch.
 * @returns The current clock string.
 */
export function useTvClock(): string {
  const [clock, setClock] = useState<string>("");

  useEffect(() => {
    setClock(formatClock(new Date()));
    const id = setInterval(() => setClock(formatClock(new Date())), 1000);
    return () => clearInterval(id);
  }, []);

  return clock;
}
