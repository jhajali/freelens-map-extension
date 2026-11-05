import { Renderer } from "@freelensapp/extensions";

/** The active Freelens theme's colors, for the export (Task 19). */
export const themeColors = (): Record<string, string> => ({ ...Renderer.Theme.activeTheme.get().colors });
