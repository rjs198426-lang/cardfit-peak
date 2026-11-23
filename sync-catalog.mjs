// 카드고릴라 사이트맵에서 어제까지 없던 카드를 catalog-additions.json에 추가한다.
import {readFileSync, writeFileSync} from "node:fs";

const knownPath = "known-cg-ids.json";
const addPath = "catalog-additions.json";
const known = new Set(JSON.parse(readFileSync(knownPath, "utf8")));
const additions = JSON.parse(readFileSync(addPath, "utf8"));
if (!Array.isArray(additions.products)) additions.products = [];

const sitemap = await fetch("https://www.card-gorilla.com/sitemap-cards.xml", {headers: {"user-agent": "cardfit-catalog"}}).then((response) => response.ok ? response.text() : "").catch(() => "");
if (!sitemap) {
  console.log("사이트맵을 받지 못했습니다.");
  process.exit(0);
}
const ids = [...new Set([...sitemap.matchAll(/card\/detail\/(\d+)/g)].map((match) => "cg-" + match[1]))];
const fresh = ids.filter((id) => !known.has(id)).sort((a, b) => Number(a.slice(3)) - Number(b.slice(3))).slice(0, 30);
let changed = false;
for (const id of fresh) {
  const html = await fetch("https://www.card-gorilla.com/card/detail/" + id.slice(3), {headers: {"user-agent": "cardfit-catalog"}}).then((response) => response.ok ? response.text() : "").catch(() => "");
  const block = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  if (!block) continue;
  let data;
  try { data = JSON.parse(block[1]); } catch { continue; }
  const product = (data["@graph"] || []).find((item) => item["@type"] === "Product");
  if (!product?.name) continue;
  const category = product.category || "";
  const name = String(product.name).replace(/\s*\|\s*카드고릴라$/, "").trim();
  const cardType = category === "체크" || /체크/.test(name) ? "check" : category === "신용" ? "credit" : null;
  const availabilityText = String(product.offers?.availability || "");
  const availability = /OutOfStock|Discontinued/.test(availabilityText) ? "discontinued" : "listed";
  known.add(id);
  changed = true;
  if (!cardType || additions.products.some((row) => row.id === id || row.name === name)) continue;
  additions.products.push({id, name, issuer: product.brand?.name || "", cardType, availability, sourceUrl: "https://www.card-gorilla.com/card/detail/" + id.slice(3)});
  console.log("추가", id, name);
}
if (!changed) {
  console.log("신규 없음");
  process.exit(0);
}
additions.updatedAt = new Date().toISOString();
const ordered = [...known].sort((a, b) => Number(a.slice(3)) - Number(b.slice(3)));
writeFileSync(addPath, JSON.stringify(additions, null, 2) + "\n");
writeFileSync(knownPath, JSON.stringify(ordered) + "\n");
