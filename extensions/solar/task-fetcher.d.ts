import { PluginConfig, TaskConfig, HeartbeatResponse, AgentCreateTaskInput } from './types.js';
/**
 * HTTP client for fetching and reporting agent tasks
 */
export declare class TaskFetcher {
    private config;
    constructor(config: PluginConfig);
    /**
     * Fetches tasks assigned to an agent
     * GET {apiUrl}/agents/{agentId}/tasks
     */
    fetchTasks(agentId: string): Promise<TaskConfig[]>;
    /**
     * Sends a heartbeat to the backend
     * POST {apiUrl}/agents/{agentId}/heartbeat
     */
    heartbeat(agentId: string, status?: 'idle' | 'working', currentTaskId?: string): Promise<HeartbeatResponse['data']>;
    /**
     * Claims a task for the agent
     * PATCH {apiUrl}/agents/{agentId}/tasks/{taskId}/claim
     */
    claimTask(agentId: string, taskId: string): Promise<TaskConfig>;
    /**
     * Completes a task (marks as done)
     * POST {apiUrl}/agents/{agentId}/tasks/{taskId}/complete
     */
    completeTask(agentId: string, taskId: string, result?: string): Promise<TaskConfig>;
    /**
     * Creates a subtask
     * POST {apiUrl}/agents/{agentId}/tasks
     */
    createTask(agentId: string, input: AgentCreateTaskInput): Promise<TaskConfig>;
    /**
     * Reports progress on a task
     * POST {apiUrl}/agents/{agentId}/tasks/{taskId}/progress
     */
    reportProgress(agentId: string, taskId: string, message: string): Promise<void>;
    /**
     * Marks a task as blocked
     * POST {apiUrl}/agents/{agentId}/tasks/{taskId}/block
     */
    blockTask(agentId: string, taskId: string, reason: string): Promise<TaskConfig>;
    /**
     * Fetches tasks for a specific board (pending tasks for agent to pick up)
     * GET {apiUrl}/boards/{boardId}/tasks?status=1
     */
    fetchBoardTasks(boardId: string): Promise<TaskConfig[]>;
}
