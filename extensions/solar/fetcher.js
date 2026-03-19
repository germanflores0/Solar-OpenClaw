import { fetchWithRetry } from './retry.js';
/**
 * Cliente HTTP para obtener configuración de Solar
 */
export class ApiFetcher {
    config;
    constructor(config) {
        this.config = config;
    }
    /**
     * Obtiene la configuración de un agente desde la API
     * @throws Error si falla la petición o timeout
     */
    async fetchAgentConfig(agentId) {
        const url = `${this.config.apiUrl}/agents/${agentId}/config`;
        // Crear AbortController para timeout
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
        try {
            const response = await fetch(url, {
                method: 'GET',
                headers: {
                    'Authorization': `Bearer ${this.config.token}`,
                    'Content-Type': 'application/json',
                },
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                throw new Error(`API returned ${response.status}: ${response.statusText}`);
            }
            const data = await response.json();
            // Validar estructura básica
            this.validateConfig(data);
            return data;
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error(`API request timeout after ${this.config.timeoutMs}ms`);
            }
            throw error;
        }
    }
    /**
     * Valida que la respuesta tenga la estructura esperada
     */
    validateConfig(data) {
        if (!data.agentId || typeof data.agentId !== 'string') {
            throw new Error('Invalid config: missing agentId');
        }
        if (!Array.isArray(data.skills)) {
            throw new Error('Invalid config: skills must be an array');
        }
        if (!Array.isArray(data.knowledgeBase)) {
            throw new Error('Invalid config: knowledgeBase must be an array');
        }
        // Validar cada skill
        for (const skill of data.skills) {
            if (!skill.id || !skill.name || !skill.content) {
                throw new Error('Invalid skill: missing required fields (id, name, content)');
            }
            // Validar tamaño del contenido (máximo 20KB)
            if (skill.content.length > 20000) {
                console.warn(`[Fetcher] Skill ${skill.id} exceeds 20KB, may be truncated by OpenClaw`);
            }
            if (!skill.description) {
                console.warn(`[Fetcher] Skill ${skill.id} missing description, hybrid mode unavailable`);
            }
        }
    }
    /**
     * Intenta obtener la configuración con retry and exponential backoff.
     * Uses fetchWithRetry for startup resilience (Railway services start independently).
     */
    async fetchWithRetry(agentId, maxRetries = 1) {
        const url = `${this.config.apiUrl}/agents/${agentId}/config`;
        const response = await fetchWithRetry(url, {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${this.config.token}`,
                'Content-Type': 'application/json',
            },
        }, maxRetries + 1, // +1 because fetchWithRetry counts attempts, not retries
        2000);
        if (!response.ok) {
            throw new Error(`API returned ${response.status}: ${response.statusText}`);
        }
        const data = await response.json();
        this.validateConfig(data);
        return data;
    }
}
