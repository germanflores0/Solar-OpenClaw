import { AgentConfig, PluginConfig } from './types.js';
/**
 * Cliente HTTP para obtener configuración de Solar
 */
export declare class ApiFetcher {
    private config;
    constructor(config: PluginConfig);
    /**
     * Obtiene la configuración de un agente desde la API
     * @throws Error si falla la petición o timeout
     */
    fetchAgentConfig(agentId: string): Promise<AgentConfig>;
    /**
     * Valida que la respuesta tenga la estructura esperada
     */
    private validateConfig;
    /**
     * Intenta obtener la configuración con retry and exponential backoff.
     * Uses fetchWithRetry for startup resilience (Railway services start independently).
     */
    fetchWithRetry(agentId: string, maxRetries?: number): Promise<AgentConfig>;
}
