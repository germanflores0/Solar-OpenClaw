/**
 * Builds a lightweight markdown catalog of available skills.
 * Includes names and descriptions only — NO full content.
 */
export function buildCatalogMarkdown(config) {
    const skills = config.skills.filter(s => s.description);
    let md = '# Available Skills (Solar)\n\n';
    md += `> ${skills.length} skill(s) available. Use the \`use_skill\` tool to load full instructions.\n\n`;
    md += '| Skill | Description |\n';
    md += '|-------|-------------|\n';
    for (const skill of skills) {
        // Escape pipes in description for markdown table safety
        const desc = (skill.description || '').replace(/\|/g, '\\|');
        md += `| ${skill.name} | ${desc} |\n`;
    }
    md += '\n**Usage:** When you need a skill, call `use_skill({"skill_name": "<name>"})`.';
    return md;
}
/**
 * Factory that creates a use_skill handler, closing over the agent config.
 * Builds a Map<lowercase_name, Skill> once for O(1) lookups.
 */
export function createUseSkillHandler(config, logger) {
    const skillMap = new Map(config.skills.map(s => [s.name.toLowerCase(), s]));
    return (input) => {
        const name = (input.skill_name || '').trim().toLowerCase();
        if (!name) {
            return {
                found: false,
                skill_name: '',
                error: `No skill name provided. Available: ${config.skills.map(s => s.name).join(', ')}`,
            };
        }
        const skill = skillMap.get(name);
        if (skill) {
            logger.info(`use_skill: serving "${skill.name}" (${skill.content.length} chars)`);
            return {
                found: true,
                skill_name: skill.name,
                content: skill.content,
            };
        }
        const available = config.skills.map(s => s.name).join(', ');
        logger.warn(`use_skill: "${input.skill_name}" not found. Available: ${available}`);
        return {
            found: false,
            skill_name: input.skill_name,
            error: `Skill "${input.skill_name}" not found. Available skills: ${available}`,
        };
    };
}
/**
 * Returns a JSON Schema tool definition compatible with OpenAI/Anthropic tool-use.
 * Uses enum constraint so the LLM can only propose valid skill names.
 */
export function getUseSkillToolDefinition(skillNames) {
    return {
        name: 'use_skill',
        description: 'Load the full instructions for a specific skill. Call this when you need detailed guidance for a task.',
        inputSchema: {
            type: 'object',
            properties: {
                skill_name: {
                    type: 'string',
                    description: 'Name of the skill to load',
                    enum: skillNames,
                },
            },
            required: ['skill_name'],
        },
    };
}
