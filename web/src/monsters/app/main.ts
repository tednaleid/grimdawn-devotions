// ABOUTME: Entry point for the monster page: loads the dataset + localization, owns the render loop.
// ABOUTME: All view state lives in the URL hash; render reads the decoded ViewState.
import { loadMonsters } from "../adapters/dataSource";

async function boot() {
  // Clear any boot-fail guard now the module has loaded (see bootFailed() in the HTML shell).
  try {
    sessionStorage.removeItem("monBootReloaded");
  } catch {}

  const doc = await loadMonsters("..");
  const host = document.getElementById("mon-rank-body");
  if (host) host.textContent = `${doc.monsters.length} monsters loaded`;
}

boot().catch((err) => {
  console.error(err);
  const fail = (globalThis as { bootFailed?: () => void }).bootFailed;
  if (typeof fail === "function") fail();
});
