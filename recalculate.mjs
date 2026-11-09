// Next 50 discount cards. Recomputes from the start after the list is finished.
import {readFileSync, writeFileSync, readdirSync} from "node:fs";
import {fromCard, looseFromCard} from "./picking-rules.mjs";

const root = new URL(".", import.meta.url);
const cards = readdirSync(root).filter((name) => /^cards-\d+\.json$/.test(name)).sort().flatMap((name) => JSON.parse(readFileSync(new URL(name, root), "utf8")));
const feedUrl = new URL("peak-feed.json", root);
let feed = {updatedAt: null, batchSize: 50, checkedIds: [], models: [], ranking: []};
try { feed = {...feed, ...JSON.parse(readFileSync(feedUrl, "utf8"))}; } catch {}

function rowFor(card, model) {
  const scenario = model.scenarios?.[0];
  if (!scenario) return null;
  let benefitSpend = 0, gross = 0, excluded = 0;
  const labels = [];
  for (const segment of scenario.segments || []) {
    if (!(segment.rate > 0) || !(segment.cap > 0)) continue;
    const spending = Math.ceil(segment.cap / segment.rate - 1e-8);
    const cut = Math.min(segment.cap, Math.floor(spending * segment.rate + 1e-8));
    if (segment.counts === false) excluded += spending;
    else benefitSpend += spending;
    gross += cut;
    labels.push(segment.label);
  }
  for (const fixed of scenario.fixed || []) {
    if (fixed.counts === false) excluded += fixed.spending || 0;
    else benefitSpend += fixed.spending || 0;
    gross += fixed.gross || 0;
    labels.push(fixed.label);
  }
  const filler = Math.max(0, (scenario.threshold || 0) - benefitSpend);
  const spend = benefitSpend + filler + excluded;
  const net = gross - model.annual / 12;
  if (!(spend > 0 && net > 0)) return null;
  const rate = Math.round((net / spend) * 10000) / 100;
  if (!(rate > 0 && rate <= 12) || model.annual > 500000) return null;
  return {id: card.id, issuer: card.issuer, name: card.name, type: "이번 계산", annual: model.annual, net: Math.round(net), spend, rate, benefits: [...labels.slice(0, 3), model.note].filter(Boolean)};
}

const batchAt = process.argv.indexOf("--batch");
const limit = batchAt >= 0 ? Number(process.argv[batchAt + 1]) || 50 : 50;
const checked = new Set(feed.checkedIds || []);
let pending = cards.filter((card) => !checked.has(card.id));
if (!pending.length) {
  checked.clear();
  pending = cards.slice();
}
pending.sort((a, b) => a.id.localeCompare(b.id, "en", {numeric: true}));
const slice = pending.slice(0, limit);
const byId = new Map((feed.models || []).map((model) => [model.id, model]));
let calculated = 0;
for (const card of slice) {
  checked.add(card.id);
  const model = fromCard(card) || looseFromCard(card);
  if (!model?.scenarios?.length) {
    byId.delete(card.id);
    continue;
  }
  byId.set(card.id, {id: card.id, annual: model.annual, source: card.sourceUrl || "", basis: model.basis, evidence: model.evidence, note: model.note, conditions: model.conditions, scenarios: model.scenarios});
  calculated += 1;
}
const models = [...byId.values()].sort((a, b) => a.id.localeCompare(b.id, "en", {numeric: true}));
const ranking = [];
for (const model of models) {
  const card = cards.find((row) => row.id === model.id);
  const row = card && rowFor(card, model);
  if (row) ranking.push(row);
}
ranking.sort((a, b) => b.rate - a.rate || a.annual - b.annual || a.name.localeCompare(b.name, "ko"));
const next = {updatedAt: new Date().toISOString(), batchSize: limit, checkedIds: [...checked], models, ranking};
writeFileSync(feedUrl, JSON.stringify(next));
console.log(JSON.stringify({checked: slice.length, calculated, models: models.length, ranking: ranking.length, remaining: Math.max(0, pending.length - slice.length)}));
