/**
 * KIOSK-002 — useQueueStatus hook
 * Listens to Socket.io events `queue:updated` and returns queue status.
 * Returns { count, estimatedMinutes, isOffline }
 */
"use client";

import { useState, useEffect } from "react";

export interface QueueStatus {
  count: number | null;
  estimatedMinutes: number | null;
  isOffline: boolean;
}

export interface QueueUpdatedEvent {
  count: number;
  estimatedMinutes: number;
}

export function useQueueStatus(): QueueStatus {
  const [status, setStatus] = useState<QueueStatus>({
    count: null,
    estimatedMinutes: null,
    isOffline: false,
  });

  useEffect(() => {
    // Check online status
    const handleOnline = () => {
      setStatus((prev) => ({ ...prev, isOffline: false }));
    };
    const handleOffline = () => {
      setStatus((prev) => ({ ...prev, isOffline: true }));
    };

    setStatus((prev) => ({ ...prev, isOffline: !navigator.onLine }));

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    // Socket.io events are listened via a custom event on window
    // In real usage, a Socket.io client would emit these
    const handleQueueUpdated = (event: Event) => {
      const customEvent = event as CustomEvent<QueueUpdatedEvent>;
      setStatus({
        count: customEvent.detail.count,
        estimatedMinutes: customEvent.detail.estimatedMinutes,
        isOffline: !navigator.onLine,
      });
    };

    window.addEventListener("queue:updated", handleQueueUpdated);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
      window.removeEventListener("queue:updated", handleQueueUpdated);
    };
  }, []);

  return status;
}
