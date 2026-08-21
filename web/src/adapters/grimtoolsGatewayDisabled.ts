// ABOUTME: GrimtoolsGateway that never talks to the worker: both methods answer "network" at once.
// ABOUTME: Wired in place of the worker gateway when the planner's grimtools feature is switched off.
import type { GrimtoolsGateway } from "../ports/GrimtoolsGateway";

export const disabledGateway: GrimtoolsGateway = {
  fetchBuild: async () => ({ kind: "network" }),
  saveBuild: async () => ({ kind: "network" }),
};
