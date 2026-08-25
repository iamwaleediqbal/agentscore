/**
 * What the harness expects an environment to publish.
 *
 * This is the harness's half of an agreement whose other half lives in another
 * repository — the environment declares the same version and implements the
 * same two methods. Nothing else crosses the boundary: not storage, not the
 * DOM, not a framework.
 *
 * Duplicating the declaration is the honest cost of the two being separable. It
 * is also why the version is checked on every run rather than assumed: a gym
 * and a harness that disagree should say so on the first turn, not produce a
 * verdict computed from a shape one of them stopped using.
 */

import type { MailState } from "./state.ts";

export const AUTOMATION_VERSION = 1;

export interface GymAutomation {
  readonly version: number;
  readonly environment: string;
  /** Discard everything and start from the environment's own seed. */
  reset(): MailState;
  /** The world as it stands. */
  state(): MailState;
  /** Every control the interface is offering, by test id. */
  controls(): string[];
}

declare global {
  interface Window {
    clickmail?: GymAutomation;
  }
}
