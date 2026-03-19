import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
/**
 * Fetch with exponential backoff retry.
 * Used for Solar API calls that may fail during startup (Railway services start independently).
 */
export async function fetchWithRetry(url, options, maxRetries = 10, initialDelayMs = 2000) {
    let lastError;
    for (let attempt = 0; attempt < maxRetries; attempt++) {
        try {
            const response = await fetch(url, {
                ...options,
                signal: AbortSignal.timeout(30000),
            });
            return response;
        }
        catch (error) {
            lastError = error;
            const delay = initialDelayMs * Math.pow(2, Math.min(attempt, 5));
            console.warn(`[Solar] Retry ${attempt + 1}/${maxRetries} in ${delay}ms: ${lastError.message}`);
            await new Promise(resolve => setTimeout(resolve, delay));
        }
    }
    throw lastError ?? new Error('Max retries exceeded');
}
/**
 * Reads MEMORY.md from the agent workspace and POSTs it to Solar API.
 * Best-effort: failures are logged but never thrown.
 *
 * NOTE: The backend POST /api/agents/:id/memory endpoint does not exist yet.
 * This function is ready for when it's implemented (TODO: add POST endpoint to API).
 */
export async function syncMemoryToSolar(agentId, workspacePath, apiUrl, token) {
    try {
        const memoryPath = join(workspacePath, 'MEMORY.md');
        if (!existsSync(memoryPath))
            return;
        const content = readFileSync(memoryPath, 'utf-8');
        if (!content.trim())
            return;
        await fetchWithRetry(`${apiUrl}/api/agents/${agentId}/memory`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${token}`,
            },
            body: JSON.stringify({ fileName: 'MEMORY.md', content }),
        }, 3, // only 3 retries for memory sync
        1000);
        console.log(`[Solar] Memory synced for agent ${agentId}`);
    }
    catch (error) {
        console.error(`[Solar] Memory sync failed:`, error);
        // Don't throw -- memory sync is best-effort
    }
}
