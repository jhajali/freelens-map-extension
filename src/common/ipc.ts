/** IPC channels between the renderer page and the main-process data collector. */
export const SPIKE_HUBBLE = "spike:hubble";

export interface SpikeHubbleResult {
  ok: boolean;
  flows: unknown[];
  error?: string;
}
