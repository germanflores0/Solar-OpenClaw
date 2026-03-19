import { TaskConfig } from './types.js';
/**
 * Cache for agent tasks
 * Stores at ~/.openclaw/hooks/solar/tasks-{agentId}.json
 * Short TTL (30s) since tasks change frequently
 */
export declare class TaskCacheManager {
    private cacheDir;
    private ttl;
    constructor(ttl?: number);
    private getCachePath;
    get(agentId: string): Promise<TaskConfig[] | null>;
    set(agentId: string, tasks: TaskConfig[]): Promise<void>;
    /**
     * Get stale tasks (ignoring TTL) as fallback when API is unreachable
     */
    getStale(agentId: string): Promise<TaskConfig[] | null>;
    clear(agentId: string): Promise<void>;
}
