/**
 * useReportExport — export trigger + polling workflow (REP-003b).
 *
 * Consumes ONLY the REP-003 contract via the typed reporting client
 * (@sigfa/contracts). Two canonical routes, no invention:
 *   - GET /reports/export           → 202 + jobId (async generation)
 *   - GET /reports/export/{jobId}   → poll PENDING→PROCESSING→READY|FAILED,
 *                                     signed downloadUrl + expiresAt when READY
 * The hook drives the 5 surface states through a small phase machine
 * (idle/launching/polling/ready/failed/error) and stops polling on a terminal
 * status. Expired signed URLs are detected via reports-state.canDownload, which
 * flips the UI to a "restart export" affordance (never a dead link).
 * @module lib/use-report-export
 */
"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { createSigfaClient } from "@sigfa/contracts";
import {
  type ExportFormat,
  type ExportScope,
  type ExportJobStatus,
  canDownload,
} from "./reports-state";

/** Typed reporting client (export + benchmark routes live here). */
export type ReportingClient = ReturnType<typeof createSigfaClient<"reporting">>;

/** Phase of the export workflow (drives the 5 surface states). */
export type ExportPhase =
  | "idle"
  | "launching"
  | "polling"
  | "ready"
  | "failed"
  | "error";

/** Parameters of an export request. */
export interface ExportRequest {
  /** Output format. */
  format: ExportFormat;
  /** Export scope. */
  scope: ExportScope;
  /** ISO period (ex. "2026-07"). */
  period: string;
  /** Agency UUID (required when scope=agency). */
  agencyId?: string;
}

/** Live job snapshot exposed to the UI. */
export interface ExportJob {
  /** Job identifier returned by the 202. */
  jobId: string;
  /** Current lifecycle status. */
  status: ExportJobStatus;
  /** Signed download URL (present when READY). */
  downloadUrl: string | null;
  /** Signed URL expiry (present when READY). */
  expiresAt: string | null;
}

/** Options for {@link useReportExport}. */
export interface UseReportExportOptions {
  /** Typed reporting client. */
  reporting: ReportingClient;
  /** Poll interval in ms (default 1500). */
  pollIntervalMs?: number;
}

/** Result of {@link useReportExport}. */
export interface UseReportExportResult {
  /** Current workflow phase. */
  phase: ExportPhase;
  /** Current job snapshot (null before the first launch). */
  job: ExportJob | null;
  /** True when READY with a live (non-expired) signed URL. */
  downloadable: boolean;
  /** Launches an export (GET /reports/export) then starts polling. */
  launch: (request: ExportRequest) => Promise<void>;
  /** Resets to idle (clears the current job). */
  reset: () => void;
}

/** Reads a string field off an unknown JSON body. */
function str(body: unknown, key: string): string | null {
  if (body && typeof body === "object" && key in body) {
    const v = (body as Record<string, unknown>)[key];
    return typeof v === "string" ? v : null;
  }
  return null;
}

/** Coerces an unknown status into a valid ExportJobStatus (defaults PENDING). */
function toStatus(value: unknown): ExportJobStatus {
  return value === "PROCESSING" || value === "READY" || value === "FAILED"
    ? value
    : "PENDING";
}

/**
 * Export trigger + polling hook.
 * @param options - {@link UseReportExportOptions}.
 * @returns {@link UseReportExportResult}.
 */
export function useReportExport(options: UseReportExportOptions): UseReportExportResult {
  const { reporting, pollIntervalMs = 1500 } = options;
  const [phase, setPhase] = useState<ExportPhase>("idle");
  const [job, setJob] = useState<ExportJob | null>(null);

  // Timer + liveness guard so a late poll never mutates an unmounted/reset hook.
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const alive = useRef(true);

  const clearTimer = useCallback((): void => {
    if (timer.current) {
      clearTimeout(timer.current);
      timer.current = null;
    }
  }, []);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
      clearTimer();
    };
  }, [clearTimer]);

  const poll = useCallback(
    async (jobId: string): Promise<void> => {
      if (!alive.current) return;
      try {
        const res = await reporting.GET("/reports/export/{jobId}", {
          params: { path: { jobId } },
        });
        if (!alive.current) return;
        if (res.error || !res.data) {
          setPhase("error");
          return;
        }
        const status = toStatus(str(res.data, "status"));
        const next: ExportJob = {
          jobId,
          status,
          downloadUrl: str(res.data, "downloadUrl"),
          expiresAt: str(res.data, "expiresAt"),
        };
        setJob(next);

        if (status === "READY") {
          setPhase("ready");
          return;
        }
        if (status === "FAILED") {
          setPhase("failed");
          return;
        }
        // Still PENDING/PROCESSING → schedule the next poll.
        setPhase("polling");
        timer.current = setTimeout(() => void poll(jobId), pollIntervalMs);
      } catch {
        if (alive.current) setPhase("error");
      }
    },
    [reporting, pollIntervalMs],
  );

  const launch = useCallback(
    async (request: ExportRequest): Promise<void> => {
      clearTimer();
      setJob(null);
      setPhase("launching");
      try {
        const res = await reporting.GET("/reports/export", {
          params: {
            query: {
              format: request.format,
              scope: request.scope,
              period: request.period,
              ...(request.agencyId ? { agencyId: request.agencyId } : {}),
            },
          },
        });
        if (!alive.current) return;
        const jobId = res.data ? str(res.data, "jobId") : null;
        if (res.error || !jobId) {
          setPhase("error");
          return;
        }
        setJob({ jobId, status: "PENDING", downloadUrl: null, expiresAt: null });
        setPhase("polling");
        await poll(jobId);
      } catch {
        if (alive.current) setPhase("error");
      }
    },
    [reporting, clearTimer, poll],
  );

  const reset = useCallback((): void => {
    clearTimer();
    setJob(null);
    setPhase("idle");
  }, [clearTimer]);

  const downloadable = useMemo(
    () => (job ? canDownload(job.status, job.downloadUrl, job.expiresAt) : false),
    [job],
  );

  return useMemo(
    () => ({ phase, job, downloadable, launch, reset }),
    [phase, job, downloadable, launch, reset],
  );
}
