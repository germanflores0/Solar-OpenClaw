import { AgentConfig } from './types.js';
/**
 * Sistema de cache para configuraciones de agentes
 * Guarda en ~/.openclaw/hooks/solar/cache-{agentId}.json
 */
export declare class CacheManager {
    private cacheDir;
    private ttl;
    constructor(ttl?: number);
    /**
     * Inicializa el directorio de cache
     */
    init(): Promise<void>;
    /**
     * Obtiene la ruta del archivo de cache para un agente
     */
    private getCachePath;
    /**
     * Obtiene la configuración del cache si es válida
     * @returns Config si existe y es válida, null si no
     */
    get(agentId: string): Promise<AgentConfig | null>;
    /**
     * Guarda la configuración en cache
     */
    set(agentId: string, config: AgentConfig): Promise<void>;
    /**
     * Obtiene una configuración antigua (sin validar TTL)
     * Útil como fallback cuando la API falla
     */
    getStale(agentId: string): Promise<AgentConfig | null>;
    /**
     * Elimina el cache de un agente
     */
    clear(agentId: string): Promise<void>;
    /**
     * Elimina todo el cache
     */
    clearAll(): Promise<void>;
}
