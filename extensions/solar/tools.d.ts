import { AgentConfig, UseSkillInput, UseSkillResult, Logger } from './types.js';
/**
 * Builds a lightweight markdown catalog of available skills.
 * Includes names and descriptions only — NO full content.
 */
export declare function buildCatalogMarkdown(config: AgentConfig): string;
/**
 * Factory that creates a use_skill handler, closing over the agent config.
 * Builds a Map<lowercase_name, Skill> once for O(1) lookups.
 */
export declare function createUseSkillHandler(config: AgentConfig, logger: Logger): (input: UseSkillInput) => UseSkillResult;
/**
 * Returns a JSON Schema tool definition compatible with OpenAI/Anthropic tool-use.
 * Uses enum constraint so the LLM can only propose valid skill names.
 */
export declare function getUseSkillToolDefinition(skillNames: string[]): {
    name: string;
    description: string;
    inputSchema: Record<string, unknown>;
};
