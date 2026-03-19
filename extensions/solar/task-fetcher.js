/**
 * HTTP client for fetching and reporting agent tasks
 */
export class TaskFetcher {
    config;
    constructor(config) {
        this.config = config;
    }
    /**
     * Fetches tasks assigned to an agent
     * GET {apiUrl}/agents/{agentId}/tasks
     */
    async fetchTasks(agentId) {
        const url = `${this.config.apiUrl}/agents/${agentId}/tasks`;
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
            if (!data.success || !Array.isArray(data.data)) {
                throw new Error('Invalid tasks response structure');
            }
            return data.data;
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error(`Tasks request timeout after ${this.config.timeoutMs}ms`);
            }
            throw error;
        }
    }
    /**
     * Sends a heartbeat to the backend
     * POST {apiUrl}/agents/{agentId}/heartbeat
     */
    async heartbeat(agentId, status = 'idle', currentTaskId) {
        const url = `${this.config.apiUrl}/agents/${agentId}/heartbeat`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
        try {
            const body = { status };
            if (currentTaskId)
                body.currentTaskId = currentTaskId;
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.config.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(body),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                throw new Error(`Heartbeat failed: ${response.status}`);
            }
            const data = await response.json();
            if (!data.success) {
                throw new Error('Heartbeat response unsuccessful');
            }
            return data.data;
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error(`Heartbeat timeout after ${this.config.timeoutMs}ms`);
            }
            throw error;
        }
    }
    /**
     * Claims a task for the agent
     * PATCH {apiUrl}/agents/{agentId}/tasks/{taskId}/claim
     */
    async claimTask(agentId, taskId) {
        const url = `${this.config.apiUrl}/agents/${agentId}/tasks/${taskId}/claim`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
        try {
            const response = await fetch(url, {
                method: 'PATCH',
                headers: {
                    'Authorization': `Bearer ${this.config.token}`,
                    'Content-Type': 'application/json',
                },
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                throw new Error(`Claim task failed: ${response.status}`);
            }
            const data = await response.json();
            return data.data;
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error(`Claim task timeout after ${this.config.timeoutMs}ms`);
            }
            throw error;
        }
    }
    /**
     * Completes a task (marks as done)
     * POST {apiUrl}/agents/{agentId}/tasks/{taskId}/complete
     */
    async completeTask(agentId, taskId, result) {
        const url = `${this.config.apiUrl}/agents/${agentId}/tasks/${taskId}/complete`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.config.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ result }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                throw new Error(`Complete task failed: ${response.status}`);
            }
            const data = await response.json();
            return data.data;
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error(`Complete task timeout after ${this.config.timeoutMs}ms`);
            }
            throw error;
        }
    }
    /**
     * Creates a subtask
     * POST {apiUrl}/agents/{agentId}/tasks
     */
    async createTask(agentId, input) {
        const url = `${this.config.apiUrl}/agents/${agentId}/tasks`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.config.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify(input),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                throw new Error(`Create task failed: ${response.status}`);
            }
            const data = await response.json();
            return data.data;
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error(`Create task timeout after ${this.config.timeoutMs}ms`);
            }
            throw error;
        }
    }
    /**
     * Reports progress on a task
     * POST {apiUrl}/agents/{agentId}/tasks/{taskId}/progress
     */
    async reportProgress(agentId, taskId, message) {
        const url = `${this.config.apiUrl}/agents/${agentId}/tasks/${taskId}/progress`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.config.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ message }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                throw new Error(`Report progress failed: ${response.status}`);
            }
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error(`Report progress timeout after ${this.config.timeoutMs}ms`);
            }
            throw error;
        }
    }
    /**
     * Marks a task as blocked
     * POST {apiUrl}/agents/{agentId}/tasks/{taskId}/block
     */
    async blockTask(agentId, taskId, reason) {
        const url = `${this.config.apiUrl}/agents/${agentId}/tasks/${taskId}/block`;
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), this.config.timeoutMs);
        try {
            const response = await fetch(url, {
                method: 'POST',
                headers: {
                    'Authorization': `Bearer ${this.config.token}`,
                    'Content-Type': 'application/json',
                },
                body: JSON.stringify({ reason }),
                signal: controller.signal,
            });
            clearTimeout(timeoutId);
            if (!response.ok) {
                throw new Error(`Block task failed: ${response.status}`);
            }
            const data = await response.json();
            return data.data;
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error(`Block task timeout after ${this.config.timeoutMs}ms`);
            }
            throw error;
        }
    }
    /**
     * Fetches tasks for a specific board (pending tasks for agent to pick up)
     * GET {apiUrl}/boards/{boardId}/tasks?status=1
     */
    async fetchBoardTasks(boardId) {
        const url = `${this.config.apiUrl}/tasks?boardId=${boardId}&status=1`;
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
                throw new Error(`Fetch board tasks failed: ${response.status}`);
            }
            const data = await response.json();
            if (!data.success || !Array.isArray(data.data)) {
                throw new Error('Invalid board tasks response structure');
            }
            return data.data;
        }
        catch (error) {
            clearTimeout(timeoutId);
            if (error.name === 'AbortError') {
                throw new Error(`Board tasks request timeout after ${this.config.timeoutMs}ms`);
            }
            throw error;
        }
    }
}
