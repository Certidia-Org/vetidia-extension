import type { ATSPlatform } from "./detector";
import type { ATSHandler } from "./base";
import { greenhouseHandler } from "./greenhouse";
import { leverHandler } from "./lever";
import { workdayHandler } from "./workday";
import { ashbyHandler } from "./ashby";
import { icimsHandler } from "./icims";

/** Registry of ATS-specific handlers. */
const handlers: Partial<Record<ATSPlatform, ATSHandler>> = {
  greenhouse: greenhouseHandler,
  lever: leverHandler,
  workday: workdayHandler,
  ashby: ashbyHandler,
  icims: icimsHandler,
};

/**
 * Get the ATS handler for a detected platform.
 * Returns null for unsupported platforms (will use generic/AI fallback).
 */
export function getATSHandler(platform: ATSPlatform): ATSHandler | null {
  return handlers[platform] ?? null;
}

export { detectATS, getATSDisplayName, extractPageContext, countFormFields } from "./detector";
export type { ATSPlatform } from "./detector";
export type { ATSHandler } from "./base";
