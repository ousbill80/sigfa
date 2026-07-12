/**
 * use-admin-console.ts — admin console data workflow (WEB-006).
 *
 * Every call goes through the typed @sigfa/contracts clients against the mock
 * Prism, using ONLY routes that exist in the LAW:
 *  - Agencies CRUD  : core.yaml  GET/POST /agencies, PATCH/DELETE /agencies/{id}
 *  - Services CRUD  : core.yaml  GET/POST /services, PATCH /services/{id}
 *  - Counters CRUD  : core.yaml  GET/POST /counters, PATCH /counters/{id}
 *  - Agents import  : agents.yaml POST /agents/import (multipart, NOT
 *                     /agencies/{id}/agents/import — the story route does not
 *                     exist in the contract; API-009 canonical route is used)
 *  - Bank theme     : admin.yaml GET/PATCH /banks/{id}/theme
 *  - Agency hours   : admin.yaml GET/PATCH /agencies/{id}/hours
 *  - SMS templates  : admin.yaml GET/PATCH /banks/{id}/sms-templates
 *  - Thresholds     : admin.yaml GET/PATCH /banks/{id}/thresholds
 *  - Kiosk / QR     : admin.yaml POST /agencies/{id}/kiosk-access
 *
 * X-Idempotency-Key decision: the contract declares `IdempotencyKeyParam` ONLY
 * on critical mutations (POST /data/purge-phone, POST /tickets, /tickets/close,
 * /tickets/sync). NONE of the WEB-006 admin mutations declare it, so — the
 * contract being the law — this hook does NOT send X-Idempotency-Key on any
 * admin CRUD/config mutation. Sending an undeclared header would be an
 * off-contract request.
 * @module lib/use-admin-console
 */
"use client";

import { useCallback, useMemo, useState } from "react";
import { createSigfaClient } from "@sigfa/contracts";
import { toImportSummary, type ImportSummary } from "./agents-import";
import { translateApiError } from "./admin-errors";
import type { SmsEventType } from "./sms-template";

/** Typed core client (agencies/services/counters). */
export type CoreClient = ReturnType<typeof createSigfaClient<"core">>;
/** Typed admin client (theme/hours/sms-templates/thresholds/kiosk). */
export type AdminClient = ReturnType<typeof createSigfaClient<"admin">>;
/** Typed agents client (CSV import). */
export type AgentsClient = ReturnType<typeof createSigfaClient<"agents">>;

/** Fetch lifecycle for a console section. */
export type SectionLoad = "loading" | "ready" | "empty" | "error";

/** Connection status driving the offline lock on forms. */
export type AdminConnection = "connected" | "offline";

/** Result of a mutation attempt (drives inline error / success feedback). */
export interface MutationResult {
  ok: boolean;
  /** Human message (translated, never a raw code) on failure. */
  message?: string;
}

/**
 * An operation row (child of a service) as exposed by the admin console.
 * `slaMinutes === null` means the operation inherits the parent service SLA (D4).
 * There is NO priority field (D4).
 */
export interface OperationRow {
  id: string;
  serviceId: string;
  code: string;
  name: string;
  slaMinutes: number | null;
  displayOrder: number;
  isActive: boolean;
  iconKey?: string;
}

/** Create payload for an operation (serviceId comes from the path). */
export interface CreateOperationBody {
  code: string;
  name: string;
  slaMinutes?: number | null;
  displayOrder: number;
  isActive: boolean;
  iconKey?: string;
}

/** A service row (parent of operations) as exposed by the admin console. */
export interface ServiceRow {
  id: string;
  name: string;
  code?: string;
  slaMinutes: number;
  active: boolean;
  order: number;
}

/**
 * An agent profile row (subset) as exposed by the console for conseiller marking
 * (MODEL-WEB-B). Only the fields the conseiller form needs are surfaced; no PII
 * beyond what the AgentProfile contract already returns to AGENCY_DIRECTOR+.
 */
export interface AgentProfileRow {
  id: string;
  firstName?: string;
  lastName?: string;
  isRelationshipManager: boolean;
  displayName?: string;
  photoUrl?: string | null;
}

/**
 * Partial update payload for the conseiller fields of an agent (MODEL-WEB-B).
 * Maps 1:1 onto the additive fields of `UpdateAgentProfileRequest` (D5).
 */
export interface UpdateConseillerBody {
  isRelationshipManager: boolean;
  displayName?: string;
  photoUrl?: string | null;
}

/** Partial update payload for an operation. */
export interface UpdateOperationBody {
  code?: string;
  name?: string;
  slaMinutes?: number | null;
  displayOrder?: number;
  isActive?: boolean;
  iconKey?: string;
}

/** Options for {@link useAdminConsole}. */
export interface UseAdminConsoleOptions {
  core: CoreClient;
  admin: AdminClient;
  agents: AgentsClient;
  /** The bank id (BANK_ADMIN scope) — theme/templates/thresholds. */
  bankId: string;
  /** The active agency id (agency scope) — hours/services/counters/kiosk. */
  agencyId: string;
}

/** Result of {@link useAdminConsole}. */
export interface UseAdminConsoleResult {
  connection: AdminConnection;
  setConnection: (s: AdminConnection) => void;
  /** Fetch the agency list (GET /agencies). */
  listAgencies: () => Promise<unknown[]>;
  /** Create an agency (POST /agencies). */
  createAgency: (body: { name: string; address?: string; phone?: string }) => Promise<MutationResult>;
  /** Update an agency (PATCH /agencies/{id}), incl. active:false to deactivate. */
  updateAgency: (id: string, body: { name?: string; active?: boolean }) => Promise<MutationResult>;
  /** Soft-delete an agency (DELETE /agencies/{id}); 409 → open-tickets message. */
  deleteAgency: (id: string) => Promise<MutationResult>;
  /** Create a service (POST /services). slaMinutes is required by the contract type (default 10). */
  createService: (body: { name: string; code?: string; slaMinutes: number; order?: number }) => Promise<MutationResult>;
  /** Update a service (PATCH /services/{id}). */
  updateService: (id: string, body: { slaMinutes?: number; active?: boolean; order?: number }) => Promise<MutationResult>;
  /** List the agency services (GET /services). */
  listServices: () => Promise<ServiceRow[]>;
  /** List a service's operations (GET /services/{serviceId}/operations). */
  listOperations: (serviceId: string) => Promise<OperationRow[]>;
  /** Create an operation under a service (POST /services/{serviceId}/operations). */
  createOperation: (serviceId: string, body: CreateOperationBody) => Promise<MutationResult>;
  /** Update an operation (PATCH /operations/{id}); slaMinutes:null re-inherits the service. */
  updateOperation: (id: string, body: UpdateOperationBody) => Promise<MutationResult>;
  /** Deactivate (soft-delete) an operation (DELETE /operations/{id}). */
  deleteOperation: (id: string) => Promise<MutationResult>;
  /** Create a counter (POST /counters). */
  createCounter: (body: { label: string; serviceIds?: string[] }) => Promise<MutationResult>;
  /** Import agents CSV (POST /agents/import, multipart). */
  importAgents: (file: File) => Promise<{ ok: boolean; summary?: ImportSummary; message?: string }>;
  /** Load an agent profile (GET /agents/{id}) for conseiller marking (MODEL-WEB-B). */
  getAgent: (id: string) => Promise<{ ok: boolean; agent?: AgentProfileRow; message?: string }>;
  /** Mark/unmark an agent as conseiller (PATCH /agents/{id}) (MODEL-WEB-B, D5). */
  markConseiller: (id: string, body: UpdateConseillerBody) => Promise<MutationResult>;
  /** Update bank SMS templates (PATCH /banks/{id}/sms-templates). */
  saveSmsTemplates: (templates: { type: SmsEventType; content: string }[]) => Promise<MutationResult>;
  /** Update bank thresholds (PATCH /banks/{id}/thresholds). */
  saveThresholds: (body: { queueCriticalThreshold?: number; agentInactivityMinutes?: number; noShowTimeoutMinutes?: number }) => Promise<MutationResult>;
  /** Update bank theme colours (PATCH /banks/{id}/theme). */
  saveThemeColors: (requestedColors: { primary: string; secondary: string; background: string }) => Promise<MutationResult>;
  /** Generate kiosk credentials + QR (POST /agencies/{id}/kiosk-access). */
  generateKioskAccess: (label?: string) => Promise<{ ok: boolean; qrCodeDataUrl?: string; message?: string }>;
}

/** Extracts a human message from an openapi-fetch error result. */
function humanError(error: unknown, response: Response | undefined): string {
  return translateApiError(error, response?.status === 409);
}

/**
 * Admin console workflow hook — all mutations go through the typed contract
 * clients on canonical routes only. Offline blocks every mutation up-front.
 * @param options - {@link UseAdminConsoleOptions}.
 * @returns {@link UseAdminConsoleResult}.
 */
export function useAdminConsole(options: UseAdminConsoleOptions): UseAdminConsoleResult {
  const { core, admin, agents, bankId, agencyId } = options;
  const [connection, setConnectionState] = useState<AdminConnection>("connected");

  const setConnection = useCallback((s: AdminConnection): void => {
    setConnectionState(s);
  }, []);

  /** Offline guard shared by every mutation (WEB-006 offline state). */
  const offlineGuard = useCallback((): MutationResult | null => {
    return connection === "offline"
      ? { ok: false, message: "Connexion requise pour configurer" }
      : null;
  }, [connection]);

  const listAgencies = useCallback(async (): Promise<unknown[]> => {
    const { data, error } = await core.GET("/agencies", { params: { query: {} } });
    if (error || !data) return [];
    const list = (data as { data?: unknown[] }).data;
    return Array.isArray(list) ? list : [];
  }, [core]);

  const createAgency = useCallback<UseAdminConsoleResult["createAgency"]>(
    async (body) => {
      const blocked = offlineGuard();
      if (blocked) return blocked;
      const { error, response } = await core.POST("/agencies", { body });
      return error ? { ok: false, message: humanError(error, response) } : { ok: true };
    },
    [core, offlineGuard],
  );

  const updateAgency = useCallback<UseAdminConsoleResult["updateAgency"]>(
    async (id, body) => {
      const blocked = offlineGuard();
      if (blocked) return blocked;
      const { error, response } = await core.PATCH("/agencies/{id}", { params: { path: { id } }, body });
      return error ? { ok: false, message: humanError(error, response) } : { ok: true };
    },
    [core, offlineGuard],
  );

  const deleteAgency = useCallback<UseAdminConsoleResult["deleteAgency"]>(
    async (id) => {
      const blocked = offlineGuard();
      if (blocked) return blocked;
      const { error, response } = await core.DELETE("/agencies/{id}", { params: { path: { id } } });
      return error ? { ok: false, message: humanError(error, response) } : { ok: true };
    },
    [core, offlineGuard],
  );

  const createService = useCallback<UseAdminConsoleResult["createService"]>(
    async (body) => {
      const blocked = offlineGuard();
      if (blocked) return blocked;
      const { error, response } = await core.POST("/services", { body });
      return error ? { ok: false, message: humanError(error, response) } : { ok: true };
    },
    [core, offlineGuard],
  );

  const updateService = useCallback<UseAdminConsoleResult["updateService"]>(
    async (id, body) => {
      const blocked = offlineGuard();
      if (blocked) return blocked;
      const { error, response } = await core.PATCH("/services/{id}", { params: { path: { id } }, body });
      return error ? { ok: false, message: humanError(error, response) } : { ok: true };
    },
    [core, offlineGuard],
  );

  const listServices = useCallback<UseAdminConsoleResult["listServices"]>(async () => {
    const { data, error } = await core.GET("/services", { params: { query: {} } });
    if (error || !data) return [];
    const list = (data as { data?: unknown[] }).data;
    return Array.isArray(list) ? (list as ServiceRow[]) : [];
  }, [core]);

  const listOperations = useCallback<UseAdminConsoleResult["listOperations"]>(
    async (serviceId) => {
      const { data, error } = await core.GET("/services/{serviceId}/operations", {
        params: { path: { serviceId }, query: {} },
      });
      if (error || !data) return [];
      const list = (data as { data?: unknown[] }).data;
      return Array.isArray(list) ? (list as OperationRow[]) : [];
    },
    [core],
  );

  const createOperation = useCallback<UseAdminConsoleResult["createOperation"]>(
    async (serviceId, body) => {
      const blocked = offlineGuard();
      if (blocked) return blocked;
      const { error, response } = await core.POST("/services/{serviceId}/operations", {
        params: { path: { serviceId } },
        body,
      });
      return error ? { ok: false, message: humanError(error, response) } : { ok: true };
    },
    [core, offlineGuard],
  );

  const updateOperation = useCallback<UseAdminConsoleResult["updateOperation"]>(
    async (id, body) => {
      const blocked = offlineGuard();
      if (blocked) return blocked;
      const { error, response } = await core.PATCH("/operations/{id}", {
        params: { path: { id } },
        body,
      });
      return error ? { ok: false, message: humanError(error, response) } : { ok: true };
    },
    [core, offlineGuard],
  );

  const deleteOperation = useCallback<UseAdminConsoleResult["deleteOperation"]>(
    async (id) => {
      const blocked = offlineGuard();
      if (blocked) return blocked;
      const { error, response } = await core.DELETE("/operations/{id}", {
        params: { path: { id } },
      });
      return error ? { ok: false, message: humanError(error, response) } : { ok: true };
    },
    [core, offlineGuard],
  );

  const createCounter = useCallback<UseAdminConsoleResult["createCounter"]>(
    async (body) => {
      const blocked = offlineGuard();
      if (blocked) return blocked;
      const { error, response } = await core.POST("/counters", { body });
      return error ? { ok: false, message: humanError(error, response) } : { ok: true };
    },
    [core, offlineGuard],
  );

  const importAgents = useCallback<UseAdminConsoleResult["importAgents"]>(
    async (file) => {
      if (connection === "offline") return { ok: false, message: "Connexion requise pour configurer" };
      const form = new FormData();
      form.append("file", file);
      // Multipart body — openapi-fetch forwards FormData as-is.
      const { data, error, response } = await agents.POST("/agents/import", {
        body: form as unknown as { file: string },
      });
      if (error) return { ok: false, message: humanError(error, response) };
      return { ok: true, summary: toImportSummary(data) };
    },
    [agents, connection],
  );

  const getAgent = useCallback<UseAdminConsoleResult["getAgent"]>(
    async (id) => {
      const { data, error, response } = await agents.GET("/agents/{id}", {
        params: { path: { id } },
      });
      if (error || !data) return { ok: false, message: humanError(error, response) };
      const a = data as {
        id: string;
        firstName?: string;
        lastName?: string;
        isRelationshipManager?: boolean;
        displayName?: string;
        photoUrl?: string | null;
      };
      return {
        ok: true,
        agent: {
          id: a.id,
          firstName: a.firstName,
          lastName: a.lastName,
          isRelationshipManager: a.isRelationshipManager ?? false,
          displayName: a.displayName,
          photoUrl: a.photoUrl,
        },
      };
    },
    [agents],
  );

  const markConseiller = useCallback<UseAdminConsoleResult["markConseiller"]>(
    async (id, body) => {
      const blocked = offlineGuard();
      if (blocked) return blocked;
      const { error, response } = await agents.PATCH("/agents/{id}", {
        params: { path: { id } },
        body,
      });
      return error ? { ok: false, message: humanError(error, response) } : { ok: true };
    },
    [agents, offlineGuard],
  );

  const saveSmsTemplates = useCallback<UseAdminConsoleResult["saveSmsTemplates"]>(
    async (templates) => {
      const blocked = offlineGuard();
      if (blocked) return blocked;
      const { error, response } = await admin.PATCH("/banks/{id}/sms-templates", {
        params: { path: { id: bankId } },
        body: { templates },
      });
      return error ? { ok: false, message: humanError(error, response) } : { ok: true };
    },
    [admin, bankId, offlineGuard],
  );

  const saveThresholds = useCallback<UseAdminConsoleResult["saveThresholds"]>(
    async (body) => {
      const blocked = offlineGuard();
      if (blocked) return blocked;
      const { error, response } = await admin.PATCH("/banks/{id}/thresholds", {
        params: { path: { id: bankId } },
        body,
      });
      return error ? { ok: false, message: humanError(error, response) } : { ok: true };
    },
    [admin, bankId, offlineGuard],
  );

  const saveThemeColors = useCallback<UseAdminConsoleResult["saveThemeColors"]>(
    async (requestedColors) => {
      const blocked = offlineGuard();
      if (blocked) return blocked;
      const { error, response } = await admin.PATCH("/banks/{id}/theme", {
        params: { path: { id: bankId } },
        body: { requestedColors },
      });
      return error ? { ok: false, message: humanError(error, response) } : { ok: true };
    },
    [admin, bankId, offlineGuard],
  );

  const generateKioskAccess = useCallback<UseAdminConsoleResult["generateKioskAccess"]>(
    async (label) => {
      if (connection === "offline") return { ok: false, message: "Connexion requise pour configurer" };
      const { data, error, response } = await admin.POST("/agencies/{id}/kiosk-access", {
        params: { path: { id: agencyId } },
        body: label ? { label } : {},
      });
      if (error) return { ok: false, message: humanError(error, response) };
      const qr = (data as { qrCodeDataUrl?: string } | undefined)?.qrCodeDataUrl;
      return { ok: true, qrCodeDataUrl: typeof qr === "string" ? qr : undefined };
    },
    [admin, agencyId, connection],
  );

  return useMemo(
    () => ({
      connection,
      setConnection,
      listAgencies,
      createAgency,
      updateAgency,
      deleteAgency,
      createService,
      updateService,
      listServices,
      listOperations,
      createOperation,
      updateOperation,
      deleteOperation,
      createCounter,
      importAgents,
      getAgent,
      markConseiller,
      saveSmsTemplates,
      saveThresholds,
      saveThemeColors,
      generateKioskAccess,
    }),
    [
      connection,
      setConnection,
      listAgencies,
      createAgency,
      updateAgency,
      deleteAgency,
      createService,
      updateService,
      listServices,
      listOperations,
      createOperation,
      updateOperation,
      deleteOperation,
      createCounter,
      importAgents,
      getAgent,
      markConseiller,
      saveSmsTemplates,
      saveThresholds,
      saveThemeColors,
      generateKioskAccess,
    ],
  );
}
