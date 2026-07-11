/**
 * API health check utility.
 * @module lib/api-health
 */

/** Health check response */
export interface HealthStatus {
  ok: boolean;
  status?: string;
  error?: string;
}

/**
 * Checks if the API is available.
 * @param apiUrl - Base URL of the API
 * @returns Health status
 */
export async function checkApiHealth(apiUrl: string): Promise<HealthStatus> {
  try {
    const response = await fetch(`${apiUrl}/health`, {
      method: "GET",
      signal: AbortSignal.timeout(3000),
    });
    if (response.ok) {
      const data = (await response.json()) as { status?: string };
      return { ok: true, status: data.status ?? "ok" };
    }
    return { ok: false, error: `HTTP ${response.status}` };
  } catch (err) {
    return {
      ok: false,
      error: err instanceof Error ? err.message : "Unknown error",
    };
  }
}
