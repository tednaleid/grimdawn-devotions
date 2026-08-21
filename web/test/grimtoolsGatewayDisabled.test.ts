// ABOUTME: Tests the disabled GrimtoolsGateway: both port methods answer "network" without any
// ABOUTME: request, so the planner can switch the grimtools feature off while keeping its wiring.
import { test, expect } from "bun:test";
import { disabledGateway } from "../src/adapters/grimtoolsGatewayDisabled";

test("fetchBuild answers network for any slug", async () => {
  expect(await disabledGateway.fetchBuild("qNYgbjeV")).toEqual({ kind: "network" });
});

test("saveBuild answers network with and without a base", async () => {
  expect(await disabledGateway.saveBuild(["sk688"])).toEqual({ kind: "network" });
  expect(await disabledGateway.saveBuild(["sk688"], { slug: "qNYgbjeV", remove: ["sk1"] })).toEqual({
    kind: "network",
  });
});
