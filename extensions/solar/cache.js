import fs from 'fs/promises';
import path from 'path';
import os from 'os';
/**
 * Sistema de cache para configuraciones de agentes
 * Guarda en ~/.openclaw/hooks/solar/cache-{agentId}.json
 */
export class CacheManager {
    cacheDir;
    ttl;
    constructor(ttl = 600000) {
        this.cacheDir = path.join(os.homedir(), '.openclaw', 'hooks', 'solar');
        this.ttl = ttl;
    }
    /**
     * Inicializa el directorio de cache
     */
    async init() {
        try {
            await fs.mkdir(this.cacheDir, { recursive: true });
        }
        catch (error) {
            console.error('[Cache] Failed to create cache directory:', error);
        }
    }
    /**
     * Obtiene la ruta del archivo de cache para un agente
     */
    getCachePath(agentId) {
        return path.join(this.cacheDir, `cache-${agentId}.json`);
    }
    /**
     * Obtiene la configuración del cache si es válida
     * @returns Config si existe y es válida, null si no
     */
    async get(agentId) {
        try {
            const cachePath = this.getCachePath(agentId);
            const data = await fs.readFile(cachePath, 'utf-8');
            const entry = JSON.parse(data);
            // Verificar si el cache es válido (no expirado)
            const now = Date.now();
            const age = now - entry.timestamp;
            if (age < this.ttl) {
                return entry.config;
            }
            // Cache expirado
            return null;
        }
        catch (error) {
            // Archivo no existe o error al leer
            return null;
        }
    }
    /**
     * Guarda la configuración en cache
     */
    async set(agentId, config) {
        try {
            await this.init(); // Asegurar que el directorio existe
            const cachePath = this.getCachePath(agentId);
            const entry = {
                config,
                timestamp: Date.now(),
            };
            await fs.writeFile(cachePath, JSON.stringify(entry, null, 2), 'utf-8');
        }
        catch (error) {
            console.error('[Cache] Failed to write cache:', error);
        }
    }
    /**
     * Obtiene una configuración antigua (sin validar TTL)
     * Útil como fallback cuando la API falla
     */
    async getStale(agentId) {
        try {
            const cachePath = this.getCachePath(agentId);
            const data = await fs.readFile(cachePath, 'utf-8');
            const entry = JSON.parse(data);
            return entry.config;
        }
        catch (error) {
            return null;
        }
    }
    /**
     * Elimina el cache de un agente
     */
    async clear(agentId) {
        try {
            const cachePath = this.getCachePath(agentId);
            await fs.unlink(cachePath);
        }
        catch (error) {
            // Ignorar si no existe
        }
    }
    /**
     * Elimina todo el cache
     */
    async clearAll() {
        try {
            const files = await fs.readdir(this.cacheDir);
            await Promise.all(files
                .filter(f => f.startsWith('cache-') && f.endsWith('.json'))
                .map(f => fs.unlink(path.join(this.cacheDir, f))));
        }
        catch (error) {
            console.error('[Cache] Failed to clear all cache:', error);
        }
    }
}
