import fs from 'fs/promises';
import path from 'path';
import os from 'os';
/**
 * Cache for agent tasks
 * Stores at ~/.openclaw/hooks/solar/tasks-{agentId}.json
 * Short TTL (30s) since tasks change frequently
 */
export class TaskCacheManager {
    cacheDir;
    ttl;
    constructor(ttl = 30000) {
        this.cacheDir = path.join(os.homedir(), '.openclaw', 'hooks', 'solar');
        this.ttl = ttl;
    }
    getCachePath(agentId) {
        return path.join(this.cacheDir, `tasks-${agentId}.json`);
    }
    async get(agentId) {
        try {
            const data = await fs.readFile(this.getCachePath(agentId), 'utf-8');
            const entry = JSON.parse(data);
            if (Date.now() - entry.timestamp < this.ttl) {
                return entry.tasks;
            }
            return null;
        }
        catch {
            return null;
        }
    }
    async set(agentId, tasks) {
        try {
            await fs.mkdir(this.cacheDir, { recursive: true });
            const entry = { tasks, timestamp: Date.now() };
            await fs.writeFile(this.getCachePath(agentId), JSON.stringify(entry, null, 2), 'utf-8');
        }
        catch (error) {
            console.error('[TaskCache] Failed to write cache:', error);
        }
    }
    /**
     * Get stale tasks (ignoring TTL) as fallback when API is unreachable
     */
    async getStale(agentId) {
        try {
            const data = await fs.readFile(this.getCachePath(agentId), 'utf-8');
            const entry = JSON.parse(data);
            return entry.tasks;
        }
        catch {
            return null;
        }
    }
    async clear(agentId) {
        try {
            await fs.unlink(this.getCachePath(agentId));
        }
        catch {
            // Ignore if not exists
        }
    }
}
