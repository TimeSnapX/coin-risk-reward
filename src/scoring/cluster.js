// v1.6 rule 3 (Mnemosyne): a CLUSTER is >= 3 coins that each show a launch bundle + cloned holder wallets + paid boosts. It can only be seen ACROSS coins,
// so it is a batch / tracker level pass: it reads every stored coin, and each member then gets +4 insider points (rules.js insiders) on its next score.
// A coin's signals come from its own data when it has been checked, else from the signals the scouts declared in the batch file (only the ones they stated:
// a signal nobody stated is unknown and the coin does not count).
import { CONFIG } from "../config.js";
import { familySignals } from "./rules.js";

const signalsOf = (e, cfg) => (e.data ? familySignals(e.data, cfg) : (() => { const s = e.tracker?.signals || {}; return { bundle: s.bundle, cloned: s.cloned, boosts: s.boosts, all: s.bundle === true && s.cloned === true && s.boosts === true }; })());
export function clusterPass(entries, cfg = CONFIG) {
  const rows = entries.map((e) => ({ address: e.address, name: e.symbol || e.name || String(e.address).slice(0, 4), ...signalsOf(e, cfg) }));
  const hit = rows.filter((r) => r.all);
  const ok = hit.length >= cfg.cluster.minCoins;
  return { ok, size: hit.length, members: ok ? hit.map((r) => r.address) : [], names: ok ? hit.map((r) => r.name) : [], rows };
}
// the data object to score for one coin: adds the cluster context (no-op when the coin is not a member)
export function withCluster(data, address, pass) {
  return pass?.ok && pass.members.includes(address) ? { ...data, cluster: { member: true, size: pass.size, names: pass.names } } : data;
}
