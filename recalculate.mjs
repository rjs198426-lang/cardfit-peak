// Next 50 discount cards and 50 points cards. Starts over after each list is finished.
import {readFileSync, writeFileSync, readdirSync} from "node:fs";
import {fromCard, looseFromCard} from "./picking-rules.mjs";

const root = new URL(".", import.meta.url);
const load = (prefix) => readdirSync(root).filter((name) => new RegExp(`^${prefix}-\\d+\\.json$`).test(name)).sort().flatMap((name) => JSON.parse(readFileSync(new URL(name, root), "utf8")));
const cards = load("cards");
const pointCards = load("points");
const feedUrl = new URL("peak-feed.json", root);
let feed = {updatedAt: null, batchSize: 50, checkedIds: [], models: [], ranking: [], checkedPointIds: [], pointsModels: [], pointsRanking: []};
try { feed = {...feed, ...JSON.parse(readFileSync(feedUrl, "utf8"))}; } catch {}

function rowFor(card, model, yearly) {
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
  const scale = yearly ? 12 : 1;
  const row = {id: card.id, issuer: card.issuer, name: card.name, type: "이번 계산", annual: model.annual, net: Math.round(net * scale), spend: spend * scale, rate, benefits: [...labels.slice(0, 3), model.note].filter(Boolean)};
  if (yearly) row.earn = Math.round(gross * 12);
  return row;
}
function takeBatch(list, seen) {
  let pending = list.filter((card) => !seen.has(card.id));
  if (!pending.length) {
    seen.clear();
    pending = list.slice();
  }
  pending.sort((a, b) => a.id.localeCompare(b.id, "en", {numeric: true}));
  return pending.slice(0, limit);
}
function score(slice, seen, models) {
  let calculated = 0;
  for (const card of slice) {
    seen.add(card.id);
    const model = fromCard(card) || looseFromCard(card);
    if (!model?.scenarios?.length) {
      models.delete(card.id);
      continue;
    }
    models.set(card.id, {id: card.id, annual: model.annual, source: card.sourceUrl || "", basis: model.basis, evidence: model.evidence, note: model.note, conditions: model.conditions, scenarios: model.scenarios});
    calculated += 1;
  }
  return calculated;
}
function ranked(list, models, yearly) {
  const rows = [];
  for (const model of models.values()) {
    const card = list.find((row) => row.id === model.id);
    const row = card && rowFor(card, model, yearly);
    if (row) rows.push(row);
  }
  rows.sort((a, b) => b.rate - a.rate || a.annual - b.annual || a.name.localeCompare(b.name, "ko"));
  return rows;
}

const batchAt = process.argv.indexOf("--batch");
const limit = batchAt >= 0 ? Number(process.argv[batchAt + 1]) || 50 : 50;
const checked = new Set(feed.checkedIds || []);
const discountSlice = takeBatch(cards, checked);
const discountModels = new Map((feed.models || []).map((model) => [model.id, model]));
const discountCalculated = score(discountSlice, checked, discountModels);
const ranking = ranked(cards, discountModels, false);
const pointChecked = new Set(feed.checkedPointIds || []);
const pointSlice = takeBatch(pointCards, pointChecked);
const pointModels = new Map((feed.pointsModels || []).map((model) => [model.id, model]));
const pointCalculated = score(pointSlice, pointChecked, pointModels);
const pointsRanking = ranked(pointCards, pointModels, true);
const next = {
  updatedAt: new Date().toISOString(),
  batchSize: limit,
  checkedIds: [...checked],
  models: [...discountModels.values()].sort((a, b) => a.id.localeCompare(b.id, "en", {numeric: true})),
  ranking,
  checkedPointIds: [...pointChecked],
  pointsModels: [...pointModels.values()].sort((a, b) => a.id.localeCompare(b.id, "en", {numeric: true})),
  pointsRanking,
};
writeFileSync(feedUrl, JSON.stringify(next));
console.log(JSON.stringify({
  discount: {checked: discountSlice.length, calculated: discountCalculated, ranking: ranking.length, remaining: Math.max(0, cards.filter((card) => !checked.has(card.id)).length)},
  points: {checked: pointSlice.length, calculated: pointCalculated, ranking: pointsRanking.length, remaining: Math.max(0, pointCards.filter((card) => !pointChecked.has(card.id)).length)},
}));
