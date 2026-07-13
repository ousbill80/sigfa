/**
 * Kiosk supervision client shell (ADM-003b) — S3.
 *
 * apiBase / agencyId / role arrive as PROPS from the server component (proxy
 * /api/rt + verified JWT claims in real mode; Prism mock + fixture otherwise).
 * The shell:
 *   - reads GET /agencies/{id}/kiosks/status via the typed admin client
 *     (CANONICAL route — never an invented one) and maps it to the hook fetcher;
 *   - opens a real socket.io connection in `real` mode (join:agency +
 *     kiosk:silent / kiosk:recovered / kiosk:status) so the screen is live, and
 *     falls back to the hook's short poll in mock mode;
 *   - exposes the network view only to BANK_ADMIN+ (agency directors get the
 *     agency view only). Route-level RBAC (AGENT / AUDITOR → 403) is enforced by
 *     the middleware (WEB-001).
 * @module app/admin/kiosks/kiosks-page-client
 */
"use client";

import { useEffect, useMemo, useState, type ReactElement } from "react";
import { io, type Socket } from "socket.io-client";
import { createSigfaClient } from "@sigfa/contracts";
import { KioskSupervision } from "@/components/admin/kiosk-supervision";
import {
  useKioskSupervision,
  type RawKioskEntry,
  type SupervisionSocket,
} from "@/lib/use-kiosk-supervision";
import type { Locale } from "@/lib/i18n";
import type { Role } from "@/lib/roles";

/** Roles allowed to see the network (cross-agency) view. */
const NETWORK_ROLES: readonly Role[] = ["SUPER_ADMIN", "BANK_ADMIN"];

/** Props derived server-side (S3). */
export interface KiosksPageClientProps {
  /** API base: /api/rt in real mode, Prism mock otherwise. */
  apiBase: string;
  /** Agency UUID (verified JWT scope, or mock fixture). */
  agencyId: string;
  /** RBAC role of the verified JWT. */
  role: Role;
  /** True in realtime mode (opens the socket). */
  realtime: boolean;
  /** Socket origin (real mode). */
  socketUrl?: string;
  /** Verified JWT (socket handshake) — never exposed to other client code. */
  token?: string;
  /** Active locale. */
  locale?: Locale;
}

/**
 * Kiosk supervision client shell.
 * @param props - {@link KiosksPageClientProps}.
 * @returns The supervision element.
 */
export function KiosksPageClient({
  apiBase,
  agencyId,
  role,
  realtime,
  socketUrl,
  token,
  locale = "fr",
}: KiosksPageClientProps): ReactElement {
  const admin = useMemo(() => createSigfaClient("admin", apiBase), [apiBase]);
  const [socket, setSocket] = useState<SupervisionSocket | null>(null);

  const fetchStatus = useMemo(
    () => async (): Promise<RawKioskEntry[] | null> => {
      const res = await admin.GET("/agencies/{id}/kiosks/status", {
        params: { path: { id: agencyId } },
      });
      if (res.error || !res.data) return null;
      const body = res.data as { kiosks?: RawKioskEntry[] };
      return Array.isArray(body.kiosks) ? body.kiosks : [];
    },
    [admin, agencyId],
  );

  // Real mode: open the socket, join the agency room. Mock mode: hook polls.
  useEffect(() => {
    if (!realtime) return;
    const url = socketUrl ?? apiBase;
    const s: Socket = io(url, {
      auth: token ? { token } : {},
      reconnectionAttempts: 3,
      transports: ["websocket", "polling"],
      autoConnect: true,
    });
    s.on("connect", () => {
      s.emit("join:agency", { agencyId });
    });
    setSocket(s as unknown as SupervisionSocket);
    return () => {
      s.removeAllListeners();
      s.disconnect();
      setSocket(null);
    };
  }, [realtime, socketUrl, apiBase, token, agencyId]);

  const { state, load } = useKioskSupervision({ fetchStatus, socket });

  return (
    <KioskSupervision
      state={state}
      load={load}
      locale={locale}
      networkEnabled={NETWORK_ROLES.includes(role)}
    />
  );
}
