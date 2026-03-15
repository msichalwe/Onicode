/**
 * Shared mode definitions — types and utilities used across all modes.
 */

export type OnicodeMode = 'onichat' | 'workpal' | 'projects';

export interface WorkpalFolder {
    path: string;
    name: string;
}

export interface ModeConfig {
    id: OnicodeMode;
    label: string;
    shortcut: string;
    sidebarButtons: SidebarButton[];
    rightPanelWidgets: string[];
    welcomeSuggestions: string[];
    expertPrompt: (ctx: { workingDirectory?: string }) => string;
}

export interface SidebarButton {
    view: string;
    label: string;
    icon: string; // SVG path
    title: string;
}

// Sidebar button definitions (shared icon paths)
export const ICONS = {
    chat: 'M21 15a2 2 0 01-2 2H7l-4 4V5a2 2 0 012-2h14a2 2 0 012 2z',
    projects: 'M22 19a2 2 0 01-2 2H4a2 2 0 01-2-2V5a2 2 0 012-2h5l2 3h9a2 2 0 012 2z',
    files: 'M21.44 11.05l-9.19 9.19a6 6 0 01-8.49-8.49l9.19-9.19a4 4 0 015.66 5.66l-9.2 9.19a2 2 0 01-2.83-2.83l8.49-8.48',
    agents: 'M12 1v4M12 19v4M4.22 4.22l2.83 2.83M16.95 16.95l2.83 2.83M1 12h4M19 12h4M4.22 19.78l2.83-2.83M16.95 7.05l2.83-2.83',
    agentsCircle: '', // uses <circle> + path above
    tasks: 'M9 11l3 3L22 4|M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11',
    workflows: 'M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83',
    settings: '', // complex path, handled inline
};

/**
 * Get mode config by ID.
 */
export function getModeConfig(mode: OnicodeMode): ModeConfig {
    return MODE_CONFIGS[mode];
}

/**
 * All mode configs.
 */
export const MODE_CONFIGS: Record<OnicodeMode, ModeConfig> = {} as Record<OnicodeMode, ModeConfig>;

// Populated by individual mode files via registerMode()
export function registerMode(config: ModeConfig) {
    MODE_CONFIGS[config.id] = config;
}
