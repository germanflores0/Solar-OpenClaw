import { CacheManager } from './cache.js';
import { ApiFetcher } from './fetcher.js';
import { TaskFetcher } from './task-fetcher.js';
import { TaskCacheManager } from './task-cache.js';
import { syncMemoryToSolar } from './retry.js';
import { readFileSync } from 'fs';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const createLogger = () => {
    const writeLog = (level, msg, meta) => {
        const metaStr = meta ? ` ${JSON.stringify(meta)}` : '';
        const consoleFn = level === 'ERROR' ? console.error : console.log;
        consoleFn(`[Solar] [${level}] ${msg}${metaStr}`);
    };
    return {
        info: (msg, meta) => writeLog('INFO', msg, meta),
        warn: (msg, meta) => writeLog('WARN', msg, meta),
        error: (msg, meta) => writeLog('ERROR', msg, meta),
        debug: (msg, meta) => writeLog('DEBUG', msg, meta),
    };
};
const logger = createLogger();
let _fileConfig;
function loadFileConfig() {
    if (_fileConfig !== undefined)
        return _fileConfig;
    const defaults = {};
    const home = process.env.HOME || '';
    const candidates = [
        join(__dirname, 'solar.config.json'),
        join(home, '.openclaw', 'hooks', 'solar', 'solar.config.json'),
        '/data/.openclaw/hooks/solar/solar.config.json',
        '/home/node/.openclaw/hooks/solar/solar.config.json',
        '/root/.openclaw/hooks/solar/solar.config.json',
    ];
    logger.info(`Config search: __dirname=${__dirname}, HOME=${home}`);
    for (const filePath of candidates) {
        try {
            const raw = readFileSync(filePath, 'utf-8');
            const parsed = JSON.parse(raw);
            _fileConfig = parsed;
            logger.info(`Loaded config from ${filePath}`, { keys: Object.keys(parsed) });
            return _fileConfig;
        }
        catch (e) {
            logger.debug(`Config not at ${filePath}: ${e.code || e.message}`);
        }
    }
    logger.warn(`No solar.config.json found in ${candidates.length} paths`);
    _fileConfig = defaults;
    return _fileConfig;
}
function getPluginConfig() {
    const fileConfig = loadFileConfig();
    return {
        apiUrl: process.env.SOLAR_API_URL || fileConfig.apiUrl || 'http://localhost:3000',
        token: process.env.SOLAR_TOKEN || fileConfig.token || '',
        timeoutMs: parseInt(process.env.SOLAR_TIMEOUT_MS || '5000', 10),
        cacheTTL: parseInt(process.env.SOLAR_CACHE_TTL || '600000', 10),
        agentId: process.env.SOLAR_AGENT_ID || fileConfig.agentId || '',
    };
}
/**
 * Detect runtime capabilities from the api object.
 */
export function detectCapabilities(api) {
    return {
        hasToolRegistration: typeof api?.registerTool === 'function',
        hasHookRegistration: typeof api?.on === 'function',
    };
}
/**
 * Build markdown content from agent config skills and knowledge base.
 * (Legacy mode — injects full content into system prompt)
 */
function buildSkillsMarkdown(config) {
    let content = '# Dynamic Skills (Solar)\n\n';
    content += `> Loaded ${config.skills.length} skill(s) from Solar\n\n`;
    for (const skill of config.skills) {
        content += `---\n\n${skill.content}\n\n`;
    }
    if (config.knowledgeBase.length > 0) {
        content += '# Knowledge Base (Solar)\n\n';
        for (const item of config.knowledgeBase) {
            content += `---\n\n## ${item.filename}\n\n${item.content}\n\n`;
        }
    }
    return content;
}
const PRIORITY_LABELS = ['None', 'Low', 'Medium', 'High'];
const STATUS_LABELS = ['Inbox', 'Up Next', 'In Progress', 'Review', 'Done'];
/**
 * Build markdown content from agent tasks for injection into context.
 */
function buildTasksMarkdown(tasks) {
    if (tasks.length === 0)
        return '';
    const active = tasks.filter(t => t.status === 2); // IN_PROGRESS
    const queued = tasks.filter(t => t.status === 1 && !t.blocked); // UP_NEXT, not blocked
    const blocked = tasks.filter(t => t.blocked);
    let content = '\n\n# Current Tasks (Solar)\n\n';
    if (active.length > 0) {
        for (const task of active) {
            content += `## Active Task\n`;
            content += `**${task.name}** (Priority: ${PRIORITY_LABELS[task.priority] ?? task.priority})\n`;
            content += `Status: ${STATUS_LABELS[task.status] ?? task.status}\n\n`;
            if (task.description) {
                content += `${task.description}\n\n`;
            }
            if (task.activities.length > 0) {
                content += `### Recent Activity\n`;
                for (const act of task.activities.slice(0, 5)) {
                    const actor = act.actorName ? `[${act.actorType}:${act.actorName}]` : `[${act.actorType}]`;
                    content += `- ${actor} ${act.action}${act.note ? ': ' + act.note : ''}\n`;
                }
                content += '\n';
            }
        }
    }
    if (queued.length > 0) {
        content += `## Task Queue (${queued.length} more)\n`;
        for (let i = 0; i < queued.length; i++) {
            const t = queued[i];
            content += `${i + 1}. ${t.name} (${PRIORITY_LABELS[t.priority] ?? t.priority})\n`;
        }
        content += '\n';
    }
    if (blocked.length > 0) {
        content += `## Blocked Tasks (${blocked.length})\n`;
        for (const t of blocked) {
            content += `- ${t.name} (blocked)\n`;
        }
        content += '\n';
    }
    return content;
}
/**
 * before_agent_start handler.
 * OpenClaw calls this before every agent turn.
 * Supports two modes:
 *   HYBRID: lightweight catalog in system prompt + use_skill tool for on-demand content
 *   LEGACY: full skill content injected into system prompt (backwards compatible)
 */
async function beforeAgentStartHandler(event, ctx, api) {
    try {
        logger.info(`[HANDLER] before_agent_start fired`, {
            eventKeys: Object.keys(event || {}),
            ctxKeys: Object.keys(ctx || {})
        });
        const pluginConfig = getPluginConfig();
        logger.info(`Plugin config: apiUrl=${pluginConfig.apiUrl}, agentId=${pluginConfig.agentId || '(empty)'}, token=${pluginConfig.token ? pluginConfig.token.slice(0, 8) + '...' : '(empty)'}`);
        if (!pluginConfig.token) {
            logger.error('SOLAR_TOKEN not configured');
            return;
        }
        // Extract agent ID: prefer explicit config, then event context
        const agentId = pluginConfig.agentId
            || ctx?.agentId
            || event?.agentId
            || event?.sessionKey?.split(':')[1]
            || 'main';
        logger.info(`Processing for agent: ${agentId} (source: ${pluginConfig.agentId ? 'config' : ctx?.agentId ? 'ctx' : 'fallback'})`);
        // Detect heartbeat session
        const isHeartbeat = ctx?.sessionKey?.includes(':heartbeat:') || event?.sessionType === 'heartbeat';
        const cache = new CacheManager(pluginConfig.cacheTTL);
        const taskCache = new TaskCacheManager(30000); // 30s TTL for tasks
        const fetcher = new ApiFetcher(pluginConfig);
        const taskFetcher = new TaskFetcher(pluginConfig);
        // If heartbeat session, call heartbeat endpoint for optimized response
        if (isHeartbeat) {
            logger.info(`Heartbeat session detected for agent ${agentId}`);
            try {
                const heartbeatData = await taskFetcher.heartbeat(agentId);
                await taskCache.clear(agentId); // Fresh data on heartbeat
                // Auto-claim: if autoMode is on, no in-progress tasks, and there's a next task
                if (heartbeatData.autoMode && heartbeatData.nextTask && heartbeatData.inProgressTasks.length === 0) {
                    const nextTask = heartbeatData.nextTask;
                    logger.info(`[solar] Auto-mode: claiming task "${nextTask.name}" (${nextTask.id})`);
                    try {
                        await taskFetcher.claimTask(agentId, nextTask.id);
                        await taskCache.clear(agentId);
                        // Move the claimed task into inProgressTasks for context injection
                        heartbeatData.inProgressTasks.push({ ...nextTask, status: 2 });
                        heartbeatData.nextTask = null;
                    }
                    catch (claimErr) {
                        logger.warn(`Auto-claim failed: ${claimErr.message}`);
                    }
                }
                else if (heartbeatData.autoMode && heartbeatData.inProgressTasks.length > 0) {
                    logger.info(`[solar] Auto-mode: skipping claim — already working on task`);
                }
                if (!heartbeatData.nextTask && heartbeatData.pendingTasks.length === 0 && heartbeatData.inProgressTasks.length === 0) {
                    logger.info('Heartbeat: no pending work, minimal context');
                    return { prependContext: '# Agent Heartbeat Check\n\nNo pending tasks. You can rest until the next heartbeat.\n' };
                }
                let hbContent = '# Agent Heartbeat Check\n\n';
                hbContent += `You have ${heartbeatData.pendingTasks.length} pending and ${heartbeatData.inProgressTasks.length} in-progress task(s).\n\n`;
                if (heartbeatData.inProgressTasks.length > 0) {
                    hbContent += '## In Progress\n';
                    for (const task of heartbeatData.inProgressTasks) {
                        hbContent += `- **${task.name}** (ID: ${task.id}, Priority: ${PRIORITY_LABELS[task.priority] ?? task.priority})\n`;
                        if (task.description)
                            hbContent += `  ${task.description}\n`;
                    }
                    hbContent += '\nContinue working on these tasks. Use `report_task_progress` to log updates and `complete_task` when done.\n\n';
                }
                if (heartbeatData.nextTask) {
                    const task = heartbeatData.nextTask;
                    hbContent += `## Next Task\n`;
                    hbContent += `**${task.name}** (ID: ${task.id}, Priority: ${PRIORITY_LABELS[task.priority] ?? task.priority})\n`;
                    if (task.description)
                        hbContent += `${task.description}\n`;
                    hbContent += '\n## Instructions\n';
                    hbContent += '1. Use `claim_task` to claim this task\n';
                    hbContent += '2. Execute the work described\n';
                    hbContent += '3. Use `report_task_progress` to log progress\n';
                    hbContent += '4. Use `complete_task` when done (submits for human review)\n';
                    hbContent += '5. If you need subtasks, use `create_subtask`\n';
                }
                if (heartbeatData.hasNewAssignments) {
                    hbContent += '\n> **New assignments detected since last heartbeat!**\n';
                }
                logger.info(`Heartbeat: injecting ${hbContent.length} chars of task context`);
                return { prependContext: hbContent };
            }
            catch (err) {
                logger.error(`Heartbeat failed: ${err.message}`);
                // Fall through to normal flow
            }
        }
        // Parallel fetch: config + tasks + autoMode check
        const configPromise = (async () => {
            let config = await cache.get(agentId);
            if (!config) {
                logger.info('Fetching config from API...');
                try {
                    config = await fetcher.fetchWithRetry(agentId, 10);
                    await cache.set(agentId, config);
                    logger.info(`Fetched ${config.skills.length} skills from API`);
                }
                catch (error) {
                    logger.error(`API Fetch failed: ${error.message}`);
                    const stale = await cache.getStale(agentId);
                    if (stale) {
                        config = stale;
                        logger.info('Using stale cached config');
                    }
                }
            }
            else {
                logger.info(`Using cached config (${config.skills.length} skills)`);
            }
            return config;
        })();
        const tasksPromise = (async () => {
            let tasks = await taskCache.get(agentId);
            if (!tasks) {
                try {
                    tasks = await taskFetcher.fetchTasks(agentId);
                    await taskCache.set(agentId, tasks);
                    logger.info(`Fetched ${tasks.length} tasks from API`);
                }
                catch (error) {
                    logger.warn(`Tasks fetch failed: ${error.message}`);
                    const stale = await taskCache.getStale(agentId);
                    if (stale) {
                        tasks = stale;
                        logger.info('Using stale cached tasks');
                    }
                    else {
                        tasks = [];
                    }
                }
            }
            else {
                logger.info(`Using cached tasks (${tasks.length})`);
            }
            return tasks;
        })();
        // Lightweight heartbeat to check autoMode flag
        const autoModePromise = (async () => {
            try {
                const hb = await taskFetcher.heartbeat(agentId);
                return hb.autoMode ?? false;
            }
            catch {
                return false;
            }
        })();
        const [config, tasks, autoMode] = await Promise.all([configPromise, tasksPromise, autoModePromise]);
        // Auto-claim in regular flow: if autoMode is on, there's an UP_NEXT task, and nothing in progress
        if (autoMode && tasks.length > 0) {
            const inProgress = tasks.filter(t => t.status === 2);
            const upNext = tasks.filter(t => t.status === 1 && !t.blocked);
            if (inProgress.length === 0 && upNext.length > 0) {
                const target = upNext[0];
                logger.info(`[solar] Auto-mode: claiming task "${target.name}" (${target.id})`);
                try {
                    await taskFetcher.claimTask(agentId, target.id);
                    await taskCache.clear(agentId);
                    // Update local task state so injected context reflects the claim
                    target.status = 2;
                }
                catch (claimErr) {
                    logger.warn(`Auto-claim failed: ${claimErr.message}`);
                }
            }
            else if (inProgress.length > 0) {
                logger.info(`[solar] Auto-mode: skipping claim — already working on task`);
            }
        }
        if (!config) {
            // No config at all — still inject tasks if available
            if (tasks.length > 0) {
                const taskMarkdown = buildTasksMarkdown(tasks);
                logger.info(`No skills, but injecting ${tasks.length} task(s)`);
                return { prependContext: taskMarkdown };
            }
            return;
        }
        if (config.knowledgeBase.length === 0 && tasks.length === 0) {
            logger.info('No knowledge base or tasks to inject');
            return;
        }
        // Skills are handled natively by OpenClaw (deployed as SKILL.md files to VPS).
        // The plugin only injects tasks, knowledge base, and registers the task progress tool.
        const capabilities = api ? detectCapabilities(api) :
            { hasToolRegistration: false, hasHookRegistration: false };
        const taskMarkdown = buildTasksMarkdown(tasks);
        // Register task tools if runtime supports it
        if (capabilities.hasToolRegistration && tasks.length > 0) {
            // report_task_progress
            try {
                api.registerTool({
                    name: 'report_task_progress',
                    description: 'Report progress on your current task to Solar. Use this to update status or add activity notes.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            task_id: { type: 'string', description: 'The task ID to update' },
                            note: { type: 'string', description: 'Progress note or status update' },
                            status: { type: 'number', description: 'New status: 0=inbox, 1=up_next, 2=in_progress, 3=review, 4=done' },
                        },
                        required: ['task_id', 'note'],
                    },
                }, async (input) => {
                    try {
                        await taskFetcher.reportProgress(agentId, input.task_id, input.note);
                        await taskCache.clear(agentId);
                        return { success: true, message: 'Progress reported' };
                    }
                    catch (err) {
                        return { success: false, error: err.message };
                    }
                });
                logger.info('Registered report_task_progress tool');
            }
            catch (err) {
                logger.warn(`Failed to register report_task_progress: ${err.message}`);
            }
            // claim_task
            try {
                api.registerTool({
                    name: 'claim_task',
                    description: 'Claim a task to start working on it. Moves the task to In Progress.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            task_id: { type: 'string', description: 'The task ID to claim' },
                        },
                        required: ['task_id'],
                    },
                }, async (input) => {
                    try {
                        const claimed = await taskFetcher.claimTask(agentId, input.task_id);
                        await taskCache.clear(agentId);
                        return { success: true, message: 'Task claimed', task: claimed };
                    }
                    catch (err) {
                        return { success: false, error: err.message };
                    }
                });
                logger.info('Registered claim_task tool');
            }
            catch (err) {
                logger.warn(`Failed to register claim_task: ${err.message}`);
            }
            // complete_task
            try {
                api.registerTool({
                    name: 'complete_task',
                    description: 'Mark a task as complete and submit it for human review. Provide a summary of what was done.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            task_id: { type: 'string', description: 'The task ID to complete' },
                            summary: { type: 'string', description: 'Summary of the work done' },
                        },
                        required: ['task_id', 'summary'],
                    },
                }, async (input) => {
                    try {
                        const completed = await taskFetcher.completeTask(agentId, input.task_id, input.summary);
                        await taskCache.clear(agentId);
                        // Best-effort memory sync after task completion
                        syncMemoryToSolar(agentId, process.cwd(), pluginConfig.apiUrl, pluginConfig.token);
                        return { success: true, message: 'Task completed', task: completed };
                    }
                    catch (err) {
                        return { success: false, error: err.message };
                    }
                });
                logger.info('Registered complete_task tool');
            }
            catch (err) {
                logger.warn(`Failed to register complete_task: ${err.message}`);
            }
            // create_subtask
            try {
                api.registerTool({
                    name: 'create_subtask',
                    description: 'Create a subtask linked to a parent task. The subtask is auto-assigned to you.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            parent_task_id: { type: 'string', description: 'The parent task ID' },
                            name: { type: 'string', description: 'Name of the subtask' },
                            description: { type: 'string', description: 'Description of the subtask' },
                            priority: { type: 'number', description: 'Priority: 0=none, 1=low, 2=medium, 3=high' },
                        },
                        required: ['parent_task_id', 'name'],
                    },
                }, async (input) => {
                    try {
                        const task = await taskFetcher.createTask(agentId, {
                            name: input.name,
                            description: input.description,
                            priority: input.priority,
                            parentTaskId: input.parent_task_id,
                        });
                        await taskCache.clear(agentId);
                        return { success: true, message: 'Subtask created', task };
                    }
                    catch (err) {
                        return { success: false, error: err.message };
                    }
                });
                logger.info('Registered create_subtask tool');
            }
            catch (err) {
                logger.warn(`Failed to register create_subtask: ${err.message}`);
            }
            // block_task
            try {
                api.registerTool({
                    name: 'block_task',
                    description: 'Flag a task as blocked with a reason. Use this when you cannot proceed due to a dependency, missing information, or other blocker.',
                    inputSchema: {
                        type: 'object',
                        properties: {
                            task_id: { type: 'string', description: 'The task ID to block' },
                            reason: { type: 'string', description: 'Why this task is blocked' },
                        },
                        required: ['task_id', 'reason'],
                    },
                }, async (input) => {
                    try {
                        const blocked = await taskFetcher.blockTask(agentId, input.task_id, input.reason);
                        await taskCache.clear(agentId);
                        return { success: true, message: 'Task marked as blocked', task: blocked };
                    }
                    catch (err) {
                        return { success: false, error: err.message };
                    }
                });
                logger.info('Registered block_task tool');
            }
            catch (err) {
                logger.warn(`Failed to register block_task: ${err.message}`);
            }
        }
        // Inject knowledge base + tasks only (no skills)
        let prependContent = '';
        if (config.knowledgeBase.length > 0) {
            prependContent += '# Knowledge Base (Solar)\n\n';
            for (const item of config.knowledgeBase) {
                prependContent += `---\n\n## ${item.filename}\n\n${item.content}\n\n`;
            }
        }
        prependContent += taskMarkdown;
        if (prependContent.trim()) {
            logger.info(`Injecting KB + tasks via prependContext (${prependContent.length} chars)`);
            return { prependContext: prependContent };
        }
    }
    catch (error) {
        logger.error(`CRITICAL ERROR: ${error.message}`, { stack: error.stack });
    }
}
// --- DUAL EXPORT ---
// OpenClaw calls default(api) during extension registration.
// We detect whether the argument is the plugin API or a hook event,
// and register the before_agent_start hook accordingly.
function registerHook(api) {
    logger.info('[LIFECYCLE] Registering before_agent_start hook');
    if (typeof api?.on === 'function') {
        api.on('before_agent_start', (event, ctx) => beforeAgentStartHandler(event, ctx, api));
        logger.info('Hook registered via api.on()');
    }
    else if (typeof api?.registerHook === 'function') {
        api.registerHook('before_agent_start', (event, ctx) => beforeAgentStartHandler(event, ctx, api));
        logger.info('Hook registered via api.registerHook()');
    }
    else {
        logger.warn('No hook registration method found on API object');
    }
}
function isPluginApi(obj) {
    return obj && (typeof obj.registerHook === 'function' ||
        typeof obj.registerTool === 'function' ||
        typeof obj.registerService === 'function');
}
function handler(eventOrApi, ctx) {
    // Detect: is this extension registration (API object) or hook invocation (event)?
    if (isPluginApi(eventOrApi)) {
        logger.info('[LIFECYCLE] Extension registration detected — registering hook');
        registerHook(eventOrApi);
        return; // Sync return — no promise for OpenClaw to ignore
    }
    // Hook invocation: run the before_agent_start logic
    beforeAgentStartHandler(eventOrApi, ctx).catch((err) => logger.error(`Hook handler error: ${err.message}`));
}
// Attach extension properties for backwards compatibility
const dual = Object.assign(handler, {
    id: 'solar',
    register: (api) => {
        logger.info('[LIFECYCLE] register(api) called');
        registerHook(api);
    },
    activate: async () => {
        logger.info('[LIFECYCLE] activate() called');
    },
});
export default dual;
