/**
 * Modes barrel export — import all mode configs and re-export shared types.
 * Import this file once to register all modes.
 */

// Register all modes (side-effect imports)
import './onichat';
import './workpal';
import './project';

// Re-export shared types and utilities
export { MODE_CONFIGS, getModeConfig, registerMode } from './shared';
export type { OnicodeMode, WorkpalFolder, ModeConfig, SidebarButton } from './shared';
