/**
 * Fetch with exponential backoff retry.
 * Used for Solar API calls that may fail during startup (Railway services start independently).
 */
export declare function fetchWithRetry(url: string, options: RequestInit, maxRetries?: number, initialDelayMs?: number): Promise<Response>;
/**
 * Reads MEMORY.md from the agent workspace and POSTs it to Solar API.
 * Best-effort: failures are logged but never thrown.
 *
 * NOTE: The backend POST /api/agents/:id/memory endpoint does not exist yet.
 * This function is ready for when it's implemented (TODO: add POST endpoint to API).
 */
export declare function syncMemoryToSolar(agentId: string, workspacePath: string, apiUrl: string, token: string): Promise<void>;
