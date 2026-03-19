/**
 * Tipos para el plugin de Solar
 */
export interface PluginConfig {
    apiUrl: string;
    token: string;
    timeoutMs: number;
    cacheTTL: number;
}
export interface AgentConfig {
    agentId: string;
    name: string;
    model: string;
    skills: Skill[];
    knowledgeBase: KnowledgeBaseItem[];
    metadata: {
        archetypeId: string;
        purpose: string | null;
        lastUpdated: string;
    };
}
export interface Skill {
    id: string;
    name: string;
    description?: string;
    content: string;
    priority: number;
}
export interface KnowledgeBaseItem {
    filename: string;
    content: string;
}
export interface CacheEntry {
    config: AgentConfig;
    timestamp: number;
}
export interface SkillCatalogEntry {
    name: string;
    description: string;
}
export interface UseSkillInput {
    skill_name: string;
}
export interface UseSkillResult {
    found: boolean;
    skill_name: string;
    content?: string;
    error?: string;
}
export interface TaskConfig {
    id: string;
    name: string;
    description?: string;
    status: number;
    priority: number;
    blocked: boolean;
    skillOverrides?: any;
    activities: ActivityNote[];
}
export interface ActivityNote {
    action: string;
    note?: string;
    actorType: string;
    actorName?: string;
    createdAt: string;
}
export interface AgentTasksResponse {
    success: boolean;
    data: TaskConfig[];
}
export interface TaskCacheEntry {
    tasks: TaskConfig[];
    timestamp: number;
}
export interface HeartbeatResponse {
    success: boolean;
    data: {
        autoMode: boolean;
        pendingTasks: TaskConfig[];
        inProgressTasks: TaskConfig[];
        nextTask: TaskConfig | null;
        hasNewAssignments: boolean;
    };
}
export interface AgentCreateTaskInput {
    name: string;
    description?: string;
    priority?: number;
    parentTaskId?: string;
}
export interface RuntimeCapabilities {
    hasToolRegistration: boolean;
    hasHookRegistration: boolean;
}
export interface Logger {
    info: (message: string, meta?: any) => void;
    warn: (message: string, meta?: any) => void;
    error: (message: string, meta?: any) => void;
    debug: (message: string, meta?: any) => void;
}
