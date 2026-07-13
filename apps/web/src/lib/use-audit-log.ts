/**
 * useAuditLog — read-only audit trail workflow (SEC-001b).
 *
 * Consumes ONLY GET /audit-logs from the admin contract (typed @sigfa/contracts
 * admin client, CONTRACT-005). NO mutation is ever issued — the Auditor surface
 * is strictly read-only (leçon SEC-F3-01). The server owns tenant scoping (RLS /
 * withTenant, SEC-002): the client makes NO client-side tenant filtering
 * assumption. Filters (entityType / entityId / actorId / from / to) and
 * pagination (page / limit) are forwarded to the server as contract query params.
 * Drives the 5 fetch states (loading / ready / empty / error) plus an offline flag.
 * @module lib/use-audit-log
 */
"use client";

import { useCallback, useMemo, useState } from "react";
import type { createSigfaClient } from "@sigfa/contracts";

/** Typed admin client (audit-logs lives in the admin module). */
export type AdminClient = ReturnType<typeof createSigfaClient<"admin">>;

/** Fetch lifecycle of the audit log. */
export type AuditLoad = "loading" | "ready" | "empty" | "error";

/** Audit filters (all optional) — mirror the CONTRACT-005 query params. */
export interface AuditFilters {
  /** Filter by entity type (ex. "ticket", "queue"). */
  entityType?: string;
  /** Filter by entity UUID. */
  entityId?: string;
  /** Filter by actor UUID. */
  actorId?: string;
  /** Range start (ISO 8601). */
  from?: string;
  /** Range end (ISO 8601). */
  to?: string;
}

/** A single audit entry as consumed by the screen (contract AuditEntry shape). */
export interface AuditEntryView {
  /** Actor (id, role, optional email). */
  actor: { id: string; role: string; email?: string };
  /** Action performed (ex. "PATCH /queues/:id"). */
  action: string;
  /** Entity type affected. */
  entityType: string;
  /** Entity identifier affected. */
  entityId: string;
  /** ISO 8601 timestamp (server clock). */
  timestamp: string;
  /** Actor IP (server-resolved XFF). */
  ip: string;
  /** Optional before/after diff. */
  diff?: Record<string, unknown>;
}

/** Options for {@link useAuditLog}. */
export interface UseAuditLogOptions {
  /** Typed admin client. */
  admin: AdminClient;
  /** Page size (contract 1..100, default 20). */
  limit?: number;
}

/** Result of {@link useAuditLog}. */
export interface UseAuditLogResult {
  /** Loaded entries for the current page. */
  entries: AuditEntryView[];
  /** Fetch lifecycle. */
  load: AuditLoad;
  /** Active filters. */
  filters: AuditFilters;
  /** Current page (1-based). */
  page: number;
  /** Total entries reported by the server. */
  total: number;
  /** Page size. */
  limit: number;
  /** Fetches a page for the given filters (defaults to current). */
  refresh: (next?: { filters?: AuditFilters; page?: number }) => Promise<void>;
}

/** Default page size (contract-valid). */
const DEFAULT_LIMIT = 20;

/** Raw entry shape as returned by the contract (defensive coercion source). */
interface RawAuditEntry {
  actor?: { id?: unknown; role?: unknown; email?: unknown };
  action?: unknown;
  entityType?: unknown;
  entityId?: unknown;
  timestamp?: unknown;
  ip?: unknown;
  diff?: unknown;
}

/** Coerces a raw contract entry into a view entry, or null if malformed. */
function toEntry(raw: RawAuditEntry): AuditEntryView | null {
  if (typeof raw.action !== "string") return null;
  const actor = raw.actor ?? {};
  return {
    actor: {
      id: typeof actor.id === "string" ? actor.id : "",
      role: typeof actor.role === "string" ? actor.role : "",
      ...(typeof actor.email === "string" ? { email: actor.email } : {}),
    },
    action: raw.action,
    entityType: typeof raw.entityType === "string" ? raw.entityType : "",
    entityId: typeof raw.entityId === "string" ? raw.entityId : "",
    timestamp: typeof raw.timestamp === "string" ? raw.timestamp : "",
    ip: typeof raw.ip === "string" ? raw.ip : "",
    ...(raw.diff && typeof raw.diff === "object"
      ? { diff: raw.diff as Record<string, unknown> }
      : {}),
  };
}

/** Drops empty-string filter values so they are not sent as blank params. */
function cleanFilters(filters: AuditFilters): AuditFilters {
  const out: AuditFilters = {};
  for (const [key, value] of Object.entries(filters)) {
    if (typeof value === "string" && value.trim().length > 0) {
      out[key as keyof AuditFilters] = value.trim();
    }
  }
  return out;
}

/**
 * Read-only audit-log hook (SEC-001b).
 * @param options - {@link UseAuditLogOptions}.
 * @returns {@link UseAuditLogResult}.
 */
export function useAuditLog(options: UseAuditLogOptions): UseAuditLogResult {
  const { admin } = options;
  const limit = options.limit ?? DEFAULT_LIMIT;
  const [entries, setEntries] = useState<AuditEntryView[]>([]);
  const [load, setLoad] = useState<AuditLoad>("loading");
  const [filters, setFilters] = useState<AuditFilters>({});
  const [page, setPage] = useState(1);
  const [total, setTotal] = useState(0);

  const refresh = useCallback(
    async (next?: { filters?: AuditFilters; page?: number }): Promise<void> => {
      const nextFilters = next?.filters ?? filters;
      const nextPage = next?.page ?? page;
      setFilters(nextFilters);
      setPage(nextPage);
      setLoad("loading");
      try {
        const res = await admin.GET("/audit-logs", {
          params: {
            query: { ...cleanFilters(nextFilters), page: nextPage, limit },
          },
        });
        if (res.error || !res.data) {
          setLoad("error");
          return;
        }
        const body = res.data as {
          data?: RawAuditEntry[];
          meta?: { total?: unknown };
        };
        const raw = Array.isArray(body.data) ? body.data : [];
        const mapped = raw
          .map(toEntry)
          .filter((e): e is AuditEntryView => e !== null);
        setEntries(mapped);
        setTotal(typeof body.meta?.total === "number" ? body.meta.total : mapped.length);
        setLoad(mapped.length === 0 ? "empty" : "ready");
      } catch {
        setLoad("error");
      }
    },
    [admin, filters, page, limit],
  );

  return useMemo(
    () => ({ entries, load, filters, page, total, limit, refresh }),
    [entries, load, filters, page, total, limit, refresh],
  );
}
