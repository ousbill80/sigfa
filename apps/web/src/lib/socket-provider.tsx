/**
 * SocketProvider — INACTIVE stub (activated in RT-001).
 * @module lib/socket-provider
 */
"use client";

import React, { createContext, useContext, type ReactElement } from "react";

/** Socket context shape */
export interface SocketContextValue {
  /** Whether the socket is connected (always false until RT-001) */
  connected: boolean;
  /** Socket status */
  status: "inactive" | "connecting" | "connected" | "error";
}

const SocketContext = createContext<SocketContextValue>({
  connected: false,
  status: "inactive",
});

/**
 * SocketProvider — wraps the app with socket context.
 * Socket connection is INACTIVE until RT-001 is implemented.
 */
export function SocketProvider({ children }: { children: React.ReactNode }): ReactElement {
  // RT-001: activate real socket connection here
  const value: SocketContextValue = {
    connected: false,
    status: "inactive",
  };

  return <SocketContext.Provider value={value}>{children}</SocketContext.Provider>;
}

/**
 * Hook to access socket context.
 * @returns The socket context value
 */
export function useSocket(): SocketContextValue {
  return useContext(SocketContext);
}
