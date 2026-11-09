// Conservative discount rules. Hand-written ranking rows stay ahead of these.
function money(value) {
  return Math.round(value);
}
function won(raw, unit) {
  const value = Number(String(raw).replace(/,/g, ""));
  if (!Number.isFinite(value)) return null;
  if (unit === "천") return money(value * 1000);
  if (unit === "만") return money(value * 10000);
  return money(value);
}
function annualFee(detail) {
  const rows = (detail.annuals || []).filter((row) => Number.isFinite(row.amount) && row.amount >= 0);
  const domestic = rows.find((row) => /국내전용|국내 전용/.test(row.label || ""));
  if (domestic) return domestic.amount;
  const standard = rows.filter((row) => !/가족|모바일|후불교통|제휴/.test(row.label || ""));
  const pool = standard.length ? standard : rows;
  return pool.length ? Math.min(...pool.map((row) => row.amount)) : null;
}
function benefitSections(detail) {
  return (detail.sections || []).filter((section) => section?.text && !/^유의사항/.test(section.title || ""));
}
function cashRates(text) {
  const found = [];
  const re = /(\d+(?:\.\d+)?)\s*%\s*(?:결제일\s*)?(?:청구\s*)?(?:할인|캐시백|환급)/g;
  let match;
  while ((match = re.exec(text))) {
    const before = text.slice(Math.max(0, match.index - 28), match.index);
    if (/포인트|마일|적립|수수료|무이자|리터당|리터 /.test(before)) continue;
    const pct = Number(match[1]);
    if (pct > 0 && pct <= 20) found.push(pct);
  }
  const reversed = /(?:청구|결제일)\s*할인\s*(\d+(?:\.\d+)?)\s*%/g;
  while ((match = reversed.exec(text))) {
    const pct = Number(match[1]);
    if (pct > 0 && pct <= 20) found.push(pct);
  }
  return [...new Set(found)];
}
function noCapPhrase(text) {
  return /한도\s*(?:제한\s*)?(?:없이|없음)|할인한도\s*無|한도\s*無|횟수\s*제한\s*,\s*할인한도\s*無/.test(text);
}
function noMinPhrase(text) {
  return /전월\s*이용금액에\s*관계없이|실적\s*조건\s*(?:제한\s*)?없|실적에\s*관계없이|전월\s*실적\s*조건\s*제한\s*없|전월\s*실적\s*,\s*횟수\s*제한|전월\s*(?:이용)?실적\s*조건\s*(?:및|없)|실적조건\s*(?:및|없)|이용실적\s*조건\s*없/.test(text);
}
function uncappedRate(text) {
  if (!noCapPhrase(text) || !noMinPhrase(text)) return null;
  const match = text.match(/국내(?:[·ㆍ/\s]?외)?\s*(?:모든\s*|전\s*|일반\s*)?가맹점[^%]{0,60}?(\d+(?:\.\d+)?)\s*%\s*(?:결제일\s*)?(?:청구\s*)?(?:할인|캐시백)/);
  if (!match) return null;
  const around = text.slice(Math.max(0, match.index - 24), match.index + 48);
  if (/포인트|마일|수수료|이벤트|웰컴/.test(around)) return null;
  const pct = Number(match[1]);
  return pct > 0 && pct <= 2 ? pct : null;
}
function hyundaiRate(detail, text) {
  if (!/현대/.test(detail.issuer || "")) return null;
  if (!noCapPhrase(text) || !noMinPhrase(text)) return null;
  const match = text.match(/(\d+(?:\.\d+)?)\s*%[^%]{0,18}M\s*포인트|M\s*포인트[^%]{0,28}(\d+(?:\.\d+)?)\s*%/);
  if (!match) return null;
  const pct = Number(match[1] || match[2]);
  return pct > 0 && pct <= 3 ? pct / 1.5 : null;
}
function thresholdsIn(text) {
  const found = [];
  const re = /전월\s*(?:이용)?(?:실적|금액)\s*(?:별\s*)?(\d+(?:\.\d+)?)\s*만\s*원\s*(?:이상|미만)?|전월[^0-9\n]{0,24}이용금액\s*(\d+(?:\.\d+)?)\s*만\s*원\s*(?:이상|미만)?|(\d+(?:\.\d+)?)\s*만\s*원\s*이상/g;
  let match;
  while ((match = re.exec(text))) {
    const raw = match[1] || match[2] || match[3];
    if (!match[1] && !match[2] && !/실적|할인한도|할인\s*한도/.test(text.slice(Math.max(0, match.index - 40), match.index))) continue;
    if (/건당|건 당|1회/.test(text.slice(Math.max(0, match.index - 16), match.index))) continue;
    const amount = won(raw, "만");
    if (amount >= 30000 && amount <= 5000000) found.push(amount);
  }
  return [...new Set(found)].sort((a, b) => a - b);
}
function capsNear(text) {
  const caps = [];
  const push = (amount) => {
    if (amount >= 1000 && amount <= 150000) caps.push(amount);
  };
  const re = /(?:할인\s*한도|할인한도|통합할인한도|통합\s*할인한도|월\s*한도|당월\s*할인한도)(?![^0-9]{0,12}전월)[^0-9건]{0,24}(\d+(?:,\d{3})*(?:\.\d+)?)(?:\s*(천|만))?\s*원/g;
  let match;
  while ((match = re.exec(text))) {
    const between = text.slice(match.index, Math.max(match.index, text.indexOf(match[1], match.index)));
    if (/전월|이용금액|결제금액|승인금액|주유금액/.test(between)) continue;
    const before = text.slice(Math.max(0, match.index - 10), match.index);
    if (/건당\s*$|1회\s*$|리터/.test(before)) continue;
    push(won(match[1], match[2]));
  }
  const afterAmount = /(?:최대\s*)?(\d+(?:,\d{3})*(?:\.\d+)?)\s*(천|만)?\s*원\s*(?:할인\s*)?한도|월(?:간|별)?\s*최대\s*(\d+(?:,\d{3})*(?:\.\d+)?)\s*(천|만)?\s*원\s*할인|월\s*(\d+(?:\.\d+)?)\s*(천|만)\s*원\s*한도/g;
  while ((match = afterAmount.exec(text))) {
    const before = text.slice(Math.max(0, match.index - 18), match.index);
    if (/건당|건 당|1회\s*$|리터|이용금액|결제금액|주유금액/.test(before)) continue;
    const raw = match[1] || match[3] || match[5];
    const unit = match[2] || match[4] || match[6];
    push(won(raw, unit));
  }
  const loose = /(\d+(?:,\d{3})*(?:\.\d+)?)\s*(천)\s*원/g;
  while ((match = loose.exec(text))) {
    const before = text.slice(Math.max(0, match.index - 40), match.index);
    if (!/한도/.test(before) || /전월\s*(?:이용)?실적/.test(before.slice(-18))) continue;
    if (/건당|건 당|1회/.test(before.slice(-12))) continue;
    push(won(match[1], "천"));
  }
  return [...new Set(caps)];
}
function clusterTiers(text) {
  const re = /전월\s*실적\s*(\d+(?:\.\d+)?)\s*만\s*원\s*이상/g;
  const groups = [];
  let current = [];
  let match;
  while ((match = re.exec(text))) {
    if (current.length && match.index - current.at(-1).end > 30) {
      groups.push(current);
      current = [];
    }
    current.push({threshold: won(match[1], "만"), end: match.index + match[0].length});
  }
  if (current.length) groups.push(current);
  const tiers = [];
  for (const group of groups) {
    const after = text.slice(group.at(-1).end, group.at(-1).end + 280);
    const amounts = [...after.matchAll(/(\d+(?:,\d{3})*(?:\.\d+)?)\s*(천|만)\s*원/g)]
      .map((item) => ({amount: won(item[1], item[2]), index: item.index, raw: item[0]}))
      .filter((item) => {
        if (item.amount < 1000 || item.amount > 150000) return false;
        const tail = after.slice(item.index + item.raw.length, item.index + item.raw.length + 6);
        if (/^\s*(?:이상|미만)/.test(tail)) return false;
        if (/건당|건 당|1회|결제\s*시|이용\s*시/.test(after.slice(Math.max(0, item.index - 14), item.index))) return false;
        return true;
      });
    if (amounts.length >= group.length) {
      group.forEach((row, index) => tiers.push({threshold: row.threshold, cap: amounts[index].amount}));
    }
  }
  const seen = new Set();
  return tiers.filter((tier) => {
    const key = `${tier.threshold}:${tier.cap}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function tierPairs(text) {
  if (!/할인한도|할인\s*한도|월\s*한도|생활할인한도/.test(text)) return [];
  const re = /(\d+(?:\.\d+)?)\s*만\s*원\s*이상(?:\s*시)?(?:\s*\d+(?:\.\d+)?\s*만\s*원\s*미만)?[^0-9]{0,18}?(\d+(?:\.\d+)?)\s*(천|만)\s*원(?!\s*(?:이상|미만))/g;
  const tiers = [];
  let match;
  while ((match = re.exec(text))) {
    const before = text.slice(Math.max(0, match.index - 12), match.index);
    if (/건당|건 당|1회/.test(before)) continue;
    const threshold = won(match[1], "만");
    const cap = won(match[2], match[3]);
    if (threshold >= 30000 && threshold <= 5000000 && cap >= 1000 && cap <= 150000 && cap < threshold) {
      tiers.push({threshold, cap});
    }
  }
  const seen = new Set();
  return tiers.filter((tier) => {
    const key = `${tier.threshold}:${tier.cap}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}
function columnTiers(text) {
  if (!/월\s*할인\s*한도|월\s*할인한도|할인한도/.test(text)) return [];
  const head = /(?:\d+(?:\.\d+)?\s*만\s*원\s*이상){2,4}/.exec(text);
  if (!head) return [];
  const thresholds = [...head[0].matchAll(/(\d+(?:\.\d+)?)\s*만\s*원\s*이상/g)].map((item) => won(item[1], "만"));
  if (thresholds.length < 2 || thresholds.some((amount, index) => index && amount <= thresholds[index - 1])) return [];
  if (thresholds.some((amount) => amount < 30000 || amount > 5000000)) return [];
  const after = text.slice(head.index + head[0].length, head.index + head[0].length + 180);
  const found = [...after.matchAll(/(\d+(?:\.\d+)?)\s*(천|만)\s*원/g)];
  const caps = [];
  let cursor = null;
  for (const item of found) {
    if (cursor != null && item.index - cursor > 1) break;
    const amount = won(item[1], item[2]);
    caps.push(amount);
    cursor = item.index + item[0].length;
    if (caps.length === thresholds.length) break;
  }
  if (caps.length !== thresholds.length) return [];
  if (caps.some((amount, index) => amount < 1000 || amount > 150000 || amount >= thresholds[index] || (index && amount < caps[index - 1]))) return [];
  return thresholds.map((threshold, index) => ({threshold, cap: caps[index]}));
}
function tableTiers(text) {
  const head = text.search(/월\s*할인\s*한도|월\s*할인한도/);
  if (head < 0) return [];
  const slice = text.slice(head, head + 240);
  const bands = [...slice.matchAll(/(\d+(?:\.\d+)?)\s*만\s*원\s*이상/g)].map((item) => won(item[1], "만"));
  const wons = [...slice.matchAll(/(\d{1,3}(?:,\d{3})+)\s*원/g)].map((item) => won(item[1]));
  if (bands.length < 2 || bands.length !== wons.length) return [];
  if (wons.some((amount) => amount < 1000 || amount > 150000)) return [];
  if (bands.some((amount) => amount < 30000 || amount > 5000000)) return [];
  return bands.map((threshold, index) => ({threshold, cap: wons[index]}));
}
function sectionTiers(text, detail) {
  const table = tableTiers(text);
  if (table.length) return table;
  const clustered = clusterTiers(text);
  if (clustered.length) return clustered;
  const thresholds = thresholdsIn(text);
  const caps = capsNear(text);
  if (thresholds.length && caps.length && thresholds.length === caps.length) {
    return thresholds.map((threshold, index) => ({threshold, cap: caps[index]}));
  }
  if (caps.length === 1) {
    const capAt = text.search(/한도|최대/);
    const around = capAt < 0 ? "" : text.slice(Math.max(0, capAt - 80), capAt + 24);
    const unconditional = /전월\s*실적\s*조건\s*없|전월실적\s*조건\s*없|실적\s*조건\s*(?:제한\s*)?없|실적에\s*관계없이|전월\s*이용금액에\s*관계없이|조건\s*없이/;
    if (!thresholds.length && unconditional.test(around)) return [{threshold: 0, cap: caps[0]}];
    const threshold = thresholds[0] ?? performanceFloor(detail) ?? looseThreshold(text);
    if (Number.isFinite(threshold)) return [{threshold, cap: caps[0]}];
  }
  if (thresholds.length >= 1 && caps.length >= 1) {
    const count = Math.min(thresholds.length, caps.length);
    return thresholds.slice(0, count).map((threshold, index) => ({threshold, cap: caps[index]}));
  }
  return fallbackTiers(text, detail, thresholds);
}
function looseThreshold(text) {
  const re = /전월[^.\n]{0,36}?(\d+(?:\.\d+)?)\s*만\s*원\s*이상/g;
  const found = [];
  let match;
  while ((match = re.exec(text))) {
    const before = text.slice(Math.max(0, match.index - 12), match.index + 8);
    if (/건당|건 당|1회/.test(before)) continue;
    const amount = won(match[1], "만");
    if (amount >= 30000 && amount <= 5000000) found.push(amount);
  }
  return found.sort((a, b) => a - b)[0] ?? null;
}
function fallbackTiers(text, detail, thresholds) {
  const paired = tierPairs(text);
  if (paired.length) return paired;
  const columns = columnTiers(text);
  if (columns.length) return columns;
  const explicit = explicitDiscountCaps(text);
  if (explicit.length === 1) {
    const threshold = (thresholds && thresholds[0]) ?? performanceFloor(detail) ?? looseThreshold(text);
    if (Number.isFinite(threshold)) return [{threshold, cap: explicit[0]}];
  }
  return [];
}
function explicitDiscountCaps(text) {
  const caps = [];
  const push = (amount) => {
    if (amount >= 1000 && amount <= 150000) caps.push(amount);
  };
  const re = /(\d+(?:\.\d+)?)\s*(천|만)\s*원\s*할인\s*한도|(?:할인\s*한도|할인한도)\s*[:：]?\s*(\d+(?:\.\d+)?)\s*(천|만)?\s*원|최대\s*(\d+(?:\.\d+)?)\s*(천|만)\s*원\s*한도|\(월\s*할인한도\s*(\d+(?:\.\d+)?)\s*(천|만)\s*원\)/g;
  let match;
  while ((match = re.exec(text))) {
    const before = text.slice(Math.max(0, match.index - 8), match.index);
    if (/건당|건 당|1회|이용금액|결제금액/.test(before)) continue;
    if (match[1]) push(won(match[1], match[2]));
    else if (match[3]) push(won(match[3], match[4]));
    else if (match[5]) push(won(match[5], match[6]));
    else if (match[7]) push(won(match[7], match[8]));
  }
  return [...new Set(caps)];
}
function visitSpend(text) {
  if (/리터당|리터 /.test(text)) return null;
  const times = Number((text.match(/월\s*(\d+)\s*회/) || [])[1]);
  if (!times || times > 31) return null;
  const man = text.match(/1회\s*(?:이용|결제)?금액\s*(\d+(?:\.\d+)?)\s*만\s*원\s*한도/);
  const plain = text.match(/1회\s*(?:이용|결제)?금액\s*(\d{1,3}(?:,\d{3})+)\s*원\s*한도/);
  const each = man ? won(man[1], "만") : plain ? won(plain[1]) : null;
  if (!each || each < 5000 || each > 500000) return null;
  return each * times;
}
function fixedVisit(text) {
  if (/리터당|리터 /.test(text)) return null;
  const times = Number((text.match(/월\s*(\d+)\s*회|\(월\s*(\d+)\s*회\)/) || []).slice(1).find(Boolean));
  if (!times || times > 31) return null;
  const man = text.match(/(\d+(?:\.\d+)?)\s*만\s*원\s*이상[^~\n%]{0,24}?(\d+(?:\.\d+)?)\s*천\s*원\s*(?:청구\s*|결제일\s*)?(?:할인|캐시백)/);
  const plain = text.match(/(\d{1,3}(?:,\d{3})+)\s*원\s*이상[^~\n%]{0,24}?(\d{1,3}(?:,\d{3})+)\s*원\s*(?:청구\s*|결제일\s*)?(?:할인|캐시백)/);
  if (man) return {spend: won(man[1], "만") * times, gross: won(man[2], "천") * times};
  if (plain) return {spend: won(plain[1]) * times, gross: won(plain[2]) * times};
  return null;
}
function flatBands(text) {
  if (/(?:\d+(?:\.\d+)?)\s*%\s*(?:결제일\s*)?(?:청구\s*)?(?:할인|캐시백)/.test(text)) return [];
  if (!/할인|캐시백/.test(text)) return [];
  const rows = [];
  const re = /(\d+(?:\.\d+)?)\s*만\s*원\s*이상(?:\s*[~～-]\s*\d+(?:\.\d+)?\s*만\s*원\s*미만)?\s*(?:(\d{1,3}(?:,\d{3})+)\s*원|(\d+(?:\.\d+)?)\s*천\s*원)/g;
  let match;
  while ((match = re.exec(text))) {
    const before = text.slice(Math.max(0, match.index - 12), match.index);
    if (/건당|건 당|1회/.test(before)) continue;
    const capRaw = match[2] || match[3];
    const capAt = match.index + match[0].lastIndexOf(capRaw);
    if (/한도/.test(text.slice(Math.max(0, capAt - 16), capAt))) continue;
    const threshold = won(match[1], "만");
    const cap = match[2] ? won(match[2]) : won(match[3], "천");
    if (threshold >= 30000 && threshold <= 5000000 && cap >= 1000 && cap <= 150000 && cap < threshold) rows.push({threshold, cap});
  }
  const ceiling = /(?:전월|지난달|전달)\s*(?:이용)?(?:실적|금액)\s*(\d+(?:\.\d+)?)\s*만\s*원\s*이상\s*시\s*(?:최대\s*)?(\d{1,3}(?:,\d{3})+)\s*원\s*(?:청구\s*|결제일\s*)?(?:할인|캐시백)/g;
  while ((match = ceiling.exec(text))) {
    const threshold = won(match[1], "만");
    const cap = won(match[2]);
    if (threshold >= 30000 && threshold <= 5000000 && cap >= 1000 && cap <= 150000 && cap < threshold) rows.push({threshold, cap});
  }
  return rows;
}
function performanceFloor(detail) {
  const match = String(detail.performanceText || "").match(/([\d,]+)\s*원/);
  if (!match) return null;
  const amount = won(match[1]);
  return amount >= 10000 && amount <= 5000000 ? amount : null;
}
function countsFor(text) {
  if (/할인[^.\n]{0,18}실적[^.\n]{0,12}제외|할인(?:받은|된)?\s*(?:매출|이용금액|금액)[^.\n]{0,16}제외|할인\s*혜택이\s*적용된\s*이용금액[\s\S]{0,180}제외|전월\s*이용금액\s*산정\s*시[\s\S]{0,180}제외/.test(text)) return false;
  return /국내(?:[·ㆍ/\s]?외)?\s*(?:모든\s*|전\s*|일반\s*)?가맹점/.test(text);
}
function rateFor(text, rates, cap) {
  const usable = rates.filter((pct) => {
    const spend = cap / (pct / 100);
    return spend >= 10000 && spend <= 2000000;
  });
  if (!usable.length) return null;
  if (usable.length === 1) return usable[0];
  const capAt = text.search(/월\s*할인\s*한도|월\s*할인한도|할인\s*한도|할인한도/);
  const before = text.slice(0, capAt < 0 ? 0 : capAt);
  const near = [...before.matchAll(/(\d+(?:\.\d+)?)\s*%/g)].map((item) => Number(item[1])).filter((pct) => usable.includes(pct));
  return near.length ? near.at(-1) : null;
}
function benefitChunks(text) {
  const lines = text.split(/\n/).map((line) => line.trim()).filter(Boolean);
  const chunks = [];
  let buffer = "";
  for (const line of lines) {
    buffer = buffer ? `${buffer} ${line}` : line;
    if (cashRates(buffer).length && capsNear(buffer).length) {
      chunks.push(buffer);
      buffer = "";
    }
  }
  return chunks.length ? chunks : [text];
}
function baseModel(pct, annual, kind) {
  const amount = 500000;
  const gross = Math.floor(amount * (pct / 100) + 1e-8);
  const mpoint = kind === "mpoint";
  return {
    annual,
    basis: "base-reference",
    referenceSpending: amount,
    note: mpoint
      ? `현대카드 M포인트 기본 적립을 1.5M=1원으로 환산한 월 50만원 참고값 (${pct}% 상당)`
      : `월 50만원 국내 기본 결제 ${pct}% 기준 · 선택/추가/연간 혜택 미합산`,
    conditions: mpoint
      ? [
          "한도와 전월 실적이 없다고 적힌 M포인트 기본 적립만 반영했습니다.",
          "H-Coin 전환 1.5M포인트=1원만 사용했습니다.",
          "월 50만원 참고값이며, 소비가 늘수록 연회비 비중이 줄어 이 비율에 가까워집니다.",
        ]
      : [
          "적립·할인 제외 업종을 피한 국내 일반 신용 결제 50만원의 기본 혜택만 계산합니다.",
          "원문에 실적 조건과 할인 한도가 없다고 적힌 기본 할인만 사용했습니다.",
          "한도가 없는 정률형은 유한한 소비의 최댓값이 없습니다. 월 50만원 기준의 참고값입니다.",
        ],
    scenarios: [{threshold: 0, fixed: [{label: mpoint ? `M포인트 현금환산 ${pct}%` : `국내 기본 ${pct}%`, spending: amount, gross, counts: true}]}],
    evidence: "",
  };
}

export function fromCard(detail) {
  const annual = annualFee(detail);
  if (!Number.isFinite(annual)) return null;
  const blocks = benefitSections(detail);
  const whole = blocks.map((section) => `${section.title || ""}\n${section.text}`).join("\n");
  let flat = null;
  for (const section of blocks) {
    flat = uncappedRate(section.text) ?? hyundaiRate(detail, section.text);
    if (flat) {
      const model = baseModel(flat, annual, hyundaiRate(detail, section.text) && !uncappedRate(section.text) ? "mpoint" : "cash");
      model.evidence = section.text.replace(/\s+/g, " ").slice(0, 280);
      flat = model;
      const gross = model.scenarios[0].fixed[0].gross;
      if (gross - annual / 12 <= 0) { flat = null; continue; }
      break;
    }
  }

  const sharedCap = /통합\s*(?:월\s*)?(?:할인\s*)?한도|월\s*통합\s*할인\s*한도|한도\s*통합|통합\s*적용/.test(whole);
  const pieces = [];
  for (const section of blocks) {
    const text = section.text;
    const chunks = benefitChunks(text);
    for (const chunk of chunks) {
    const rates = cashRates(chunk);
    let tiers = sectionTiers(chunk, detail).filter((tier) => tier.cap && tier.cap <= 150000 && tier.threshold >= 0 && !(tier.threshold >= 30000 && tier.cap >= tier.threshold));
    if (!rates.length) tiers = [];
    const needed = thresholdsIn(chunk)[0] ?? (noMinPhrase(chunk) ? 0 : performanceFloor(detail));
    const visit = visitSpend(chunk);
    if (!tiers.length && rates.length === 1 && visit && Number.isFinite(needed)) {
      const gross = Math.floor(visit * (rates[0] / 100));
      if (gross >= 500 && gross <= 150000) tiers = [{threshold: needed, cap: gross}];
    }
    const fixed = tiers.length ? null : fixedVisit(chunk);
    if (!tiers.length && fixed && Number.isFinite(needed) && fixed.gross >= 500 && fixed.gross <= 150000 && fixed.spend >= 10000 && fixed.gross < fixed.spend) {
      const pct = Math.round((fixed.gross / fixed.spend) * 1000) / 10;
      tiers = [{threshold: needed, cap: fixed.gross}];
      rates.splice(0, rates.length, pct);
    }
    const bands = !rates.length && !tiers.length ? flatBands(chunk) : [];
    if (bands.length) {
      const band = bands.slice().sort((a, b) => (a.cap - annual / 12) / a.threshold - (b.cap - annual / 12) / b.threshold).at(-1);
      const score = (band.cap - annual / 12) / band.threshold;
      if (score > 0 && score * 100 <= 12) {
        pieces.push({
          score,
          threshold: band.threshold,
          flat: true,
          segment: {
            label: `${section.title || "혜택"} 월 ${band.cap.toLocaleString("ko-KR")}원 할인`,
            spending: band.threshold,
            gross: band.cap,
          },
          evidence: chunk.replace(/\s+/g, " ").slice(0, 280),
          counts: true,
        });
      }
      continue;
    }
    if (!rates.length || !tiers.length) continue;
    let best = null;
    for (const tier of tiers) {
      const ratePct = rateFor(chunk, rates, tier.cap);
      if (!ratePct) continue;
      const spend = Math.ceil(tier.cap / (ratePct / 100) - 1e-8);
      if (spend < 10000) continue;
      const gross = Math.min(tier.cap, Math.floor(spend * (ratePct / 100) + 1e-8));
      if (gross < 500) continue;
      const counts = countsFor(chunk);
      const total = spend + (counts ? 0 : tier.threshold || 0);
      const score = (gross - annual / 12) / Math.max(total, tier.threshold || spend);
      const ratePctShown = (score * 100);
      if (score <= 0 || ratePctShown > 12) continue;
      if (!best || score > best.score) {
        best = {
          score,
          threshold: tier.threshold || 0,
          segment: {
            label: `${section.title || "혜택"} ${ratePct}% (월 한도 ${tier.cap.toLocaleString("ko-KR")}원)`,
            rate: ratePct / 100,
            cap: tier.cap,
            counts,
          },
          evidence: chunk.replace(/\s+/g, " ").slice(0, 280),
          counts,
        };
      }
    }
    if (best) pieces.push(best);
    }
  }

  const byTitle = new Map();
  for (const piece of pieces) {
    const title = piece.segment.label.split(" ")[0];
    const prev = byTitle.get(title);
    if (!prev || piece.score > prev.score) byTitle.set(title, piece);
  }
  const uniquePieces = [];
  const seenEvidence = new Set();
  for (const piece of byTitle.values()) {
    const key = piece.evidence.slice(0, 120);
    if (seenEvidence.has(key)) continue;
    seenEvidence.add(key);
    uniquePieces.push(piece);
  }
  const percentPieces = uniquePieces.filter((piece) => !piece.flat);
  const flatPieces = uniquePieces.filter((piece) => piece.flat);

  if (!percentPieces.length && flatPieces.length) {
    const flat = flatPieces.reduce((top, row) => (row.score > top.score ? row : top));
    return {
      annual,
      basis: "benefit",
      evidence: flat.evidence,
      note: `원문에 적힌 월 ${flat.segment.gross.toLocaleString("ko-KR")}원 할인을 전월 ${flat.threshold.toLocaleString("ko-KR")}원 실적 안에서 계산했습니다. 선택·연간 혜택은 넣지 않았습니다.`,
      conditions: [
        "정액 할인이라 결제액이 따로 없으면, 그 실적 금액 안에 포함되는 것으로 계산했습니다.",
        "같은 실적 구간의 정액 할인이 여러 개면 더하지 않고 금액이 큰 하나만 반영했습니다.",
        "무이자, 라운지, 연간 기프트, 포인트·마일의 임의 환산은 포함하지 않았습니다.",
      ],
      scenarios: [{threshold: flat.threshold, fixed: [{label: flat.segment.label, spending: flat.segment.spending, gross: flat.segment.gross, counts: true}]}],
    };
  }

  if (!percentPieces.length) return flat;

  let chosen;
  if (sharedCap || percentPieces.length === 1) {
    chosen = percentPieces.reduce((top, row) => (row.score > top.score ? row : top));
    chosen = {
      threshold: chosen.threshold,
      segments: [chosen.segment],
      evidence: chosen.evidence,
      counts: chosen.counts,
    };
  } else {
    const groups = new Map();
    for (const piece of percentPieces) {
      const key = piece.threshold;
      if (!groups.has(key)) groups.set(key, []);
      groups.get(key).push(piece);
    }
    let best = null;
    for (const [threshold, rows] of groups) {
      const segments = rows.map((row) => row.segment);
      const spend = segments.reduce((sum, segment) => sum + Math.ceil(segment.cap / segment.rate - 1e-8), 0);
      const gross = segments.reduce((sum, segment) => sum + segment.cap, 0);
      const excludedSpend = segments.some((segment) => segment.counts === false);
      const total = excludedSpend ? spend + Number(threshold) : Math.max(spend, Number(threshold));
      const score = (gross - annual / 12) / total;
      if (score * 100 > 12 || score <= 0) continue;
      if (!best || score > best.score) best = {threshold: Number(threshold), segments, evidence: rows.map((row) => row.evidence).join(" / ").slice(0, 280), counts: !excludedSpend, score};
    }
    chosen = best;
  }

  if (!chosen?.segments?.length) return flat;
  const spend = chosen.segments.reduce((sum, segment) => sum + Math.ceil(segment.cap / segment.rate - 1e-8), 0);
  const gross = chosen.segments.reduce((sum, segment) => sum + segment.cap, 0);
  const excludedSpend = chosen.segments.some((segment) => segment.counts === false);
  const total = excludedSpend ? spend + Number(chosen.threshold || 0) : Math.max(spend, Number(chosen.threshold || 0));
  const shown = total ? (gross - annual / 12) / total * 100 : -1;
  if (!(shown > 0 && shown <= 12)) return flat;

  const model = {
    annual,
    basis: "benefit",
    evidence: chosen.evidence,
    note: `원문에 적힌 할인율과 월 한도, 전월 ${(chosen.threshold || 0).toLocaleString("ko-KR")}원으로 계산했습니다. 선택·연간 혜택은 넣지 않았습니다.`,
    conditions: [
      chosen.counts
        ? "국내 일반 가맹점 할인은 그 결제가 실적에 포함되는 것으로 계산했습니다."
        : "영역 할인은 실적과 따로 두고, 전월 실적만큼 추가 소비가 필요하다고 본 보수적 계산입니다.",
      sharedCap
        ? "통합 월 한도가 있어 여러 영역을 더하지 않고 한 구간만 반영했습니다."
        : "영역마다 한도가 나뉜 경우에만 같은 전월 실적 구간의 한도를 함께 반영했습니다.",
      "무이자, 라운지, 연간 기프트, 포인트·마일의 임의 환산은 포함하지 않았습니다.",
    ],
    scenarios: [{threshold: chosen.threshold || 0, segments: chosen.segments}],
  };
  if (flat) model.scenarios.push(flat.scenarios[0]);
  return model;
}

function looseCaps(text) {
  const caps = [];
  const patterns = [
    /(?:할인\s*한도|할인한도|월\s*할인\s*한도|월\s*할인한도|통합\s*(?:월\s*)?(?:할인\s*)?한도|월간\s*통합\s*할인\s*한도)[^0-9건]{0,18}(\d+(?:,\d{3})*(?:\.\d+)?)(?:\s*(천|만))?\s*원/g,
    /(\d+(?:\.\d+)?)\s*(천|만)\s*원\s*(?:할인\s*)?한도/g,
    /월\s*최대\s*(\d+(?:,\d{3})*(?:\.\d+)?|\d+(?:\.\d+)?)\s*(천|만)?\s*원\s*(?:할인|캐시백)/g,
  ];
  for (const re of patterns) {
    let match;
    while ((match = re.exec(text))) {
      const before = text.slice(Math.max(0, match.index - 18), match.index);
      if (/건당|건 당|리터|적립\s*한도|포인트|마일/.test(before)) continue;
      const amount = won(match[1], match[2]);
      if (amount >= 1000 && amount <= 150000) caps.push(amount);
    }
  }
  return [...new Set(caps)];
}
function looseRates(text) {
  const found = [];
  const re = /(\d+(?:\.\d+)?)\s*%\s*(?:결제일\s*)?(?:청구\s*)?(?:할인|캐시백|환급)/g;
  let match;
  while ((match = re.exec(text))) {
    const before = text.slice(Math.max(0, match.index - 24), match.index);
    if (/포인트|마일|적립|수수료|무이자|리터당|리터 |현장/.test(before)) continue;
    const pct = Number(match[1]);
    if (pct > 0 && pct <= 20) found.push(pct);
  }
  return [...new Set(found)];
}
function pointUnit(detail) {
  const text = benefitSections(detail).map((section) => section.text).join("\n");
  if (/1\s*(?:포인트|점)\s*(?:=|은|는)\s*1\s*원|포인트\s*(?:는|은)?\s*1\s*(?:점|P)?\s*(?:=|당)\s*1\s*원/.test(text)) return 1;
  if (/현대/.test(detail.issuer || "") && /M\s*포인트/.test(text)) return 1 / 1.5;
  return null;
}
function pointRates(text) {
  const found = [];
  const re = /(\d+(?:\.\d+)?)\s*%[^%\n]{0,16}(?:포인트\s*)?적립/g;
  let match;
  while ((match = re.exec(text))) {
    const before = text.slice(Math.max(0, match.index - 16), match.index);
    if (/마일|수수료|무이자/.test(before)) continue;
    const pct = Number(match[1]);
    if (pct > 0 && pct <= 10) found.push(pct);
  }
  return [...new Set(found)];
}
function pointCaps(text, unit) {
  const caps = [];
  const re = /(?:적립\s*한도|적립한도|월\s*적립(?:\s*한도)?)[^0-9]{0,16}(\d+(?:\.\d+)?)(?:\s*(천|만))?\s*(?:점|포인트)/g;
  let match;
  while ((match = re.exec(text))) {
    const points = won(match[1], match[2]);
    const amount = Math.floor(points * unit);
    if (amount >= 1000 && amount <= 150000) caps.push(amount);
  }
  return [...new Set(caps)];
}

export function looseFromCard(detail) {
  const annual = annualFee(detail);
  if (!Number.isFinite(annual)) return null;
  const unit = pointUnit(detail);
  let best = null;
  const keep = (row) => {
    if (row.score > 0 && row.score * 100 <= 12 && (!best || row.score > best.score)) best = row;
  };
  for (const section of benefitSections(detail)) {
    const text = section.text;
    const looseFloor = looseThreshold(text);
    const threshold = thresholdsIn(text)[0] ?? (Number.isFinite(looseFloor) ? looseFloor : performanceFloor(detail));
    const rates = looseRates(text);
    const caps = looseCaps(text);
    if (rates.length === 1 && caps.length && Number.isFinite(threshold)) {
      const cap = Math.min(...caps);
      const spend = Math.ceil(cap / (rates[0] / 100) - 1e-8);
      if (spend >= 10000 && spend <= 2000000) {
        const counts = countsFor(text);
        const total = counts ? Math.max(spend, threshold) : spend + (threshold || 0);
        const gross = Math.min(cap, Math.floor(spend * (rates[0] / 100) + 1e-8));
        keep({
          score: (gross - annual / 12) / total,
          threshold: threshold || 0,
          evidence: text.replace(/\s+/g, " ").slice(0, 280),
          note: "같은 문단에 적힌 할인율과 월 한도만 반영했습니다. 다른 영역은 더하지 않았습니다.",
          scenarios: [{threshold: threshold || 0, segments: [{label: `${section.title || "혜택"} ${rates[0]}% (월 한도 ${cap.toLocaleString("ko-KR")}원)`, rate: rates[0] / 100, cap, counts}]}],
        });
      }
    }
    if (!rates.length) {
      const re = /(?:전월|지난달|전달)[^.\n]{0,60}?(\d+(?:\.\d+)?)\s*만\s*원\s*이상[^.\n%]{0,48}?(\d{1,3}(?:,\d{3})+|\d+(?:\.\d+)?)\s*(천)?\s*원\s*(?:청구\s*|결제일\s*)?(?:할인|캐시백)/g;
      let match;
      while ((match = re.exec(text))) {
        if (/건당|1회/.test(text.slice(Math.max(0, match.index - 16), match.index))) continue;
        const band = won(match[1], "만");
        const gross = match[3] ? won(match[2], "천") : won(match[2]);
        if (band < 30000 || gross < 1000 || gross > 150000 || gross >= band) continue;
        keep({
          score: (gross - annual / 12) / band,
          threshold: band,
          evidence: text.replace(/\s+/g, " ").slice(0, 280),
          note: `원문에 적힌 월 ${gross.toLocaleString("ko-KR")}원 할인을 전월 ${band.toLocaleString("ko-KR")}원 실적 안에서 계산했습니다.`,
          scenarios: [{threshold: band, fixed: [{label: `${section.title || "혜택"} 월 ${gross.toLocaleString("ko-KR")}원 할인`, spending: band, gross, counts: true}]}],
        });
      }
    }
    if (unit) {
      const pRates = pointRates(text);
      const pCaps = pointCaps(text, unit);
      const pThreshold = Number.isFinite(threshold) ? threshold : 0;
      if (pRates.length === 1 && pCaps.length && Number.isFinite(threshold)) {
        const cap = Math.min(...pCaps);
        const nominal = pRates[0] * unit;
        const spend = Math.ceil(cap / (nominal / 100) - 1e-8);
        if (nominal > 0 && nominal <= 5 && spend >= 10000 && spend <= 5000000) {
          const counts = countsFor(text);
          const total = counts ? Math.max(spend, pThreshold) : spend + pThreshold;
          keep({
            score: (cap - annual / 12) / total,
            threshold: pThreshold,
            evidence: text.replace(/\s+/g, " ").slice(0, 280),
            note: unit === 1 ? "원문에 1포인트=1원이라고 적힌 적립만 현금으로 봤습니다." : "현대카드 M포인트는 1.5M=1원으로만 환산했습니다.",
            scenarios: [{threshold: pThreshold, segments: [{label: `${section.title || "적립"} ${pRates[0]}% 포인트`, rate: nominal / 100, cap, counts}]}],
          });
        }
      }
    }
  }
  if (!best) {
    for (const section of benefitSections(detail)) {
      const pct = uncappedRate(section.text) ?? hyundaiRate(detail, section.text);
      if (!pct) continue;
      const model = baseModel(pct, annual, hyundaiRate(detail, section.text) && !uncappedRate(section.text) ? "mpoint" : "cash");
      if (model.scenarios[0].fixed[0].gross - annual / 12 <= 0) continue;
      model.evidence = section.text.replace(/\s+/g, " ").slice(0, 280);
      return model;
    }
    return null;
  }
  return {
    annual,
    basis: "benefit",
    evidence: best.evidence,
    note: best.note,
    conditions: [
      "한 문단에서 할인율과 한도가 같이 읽히는 경우만 넣었습니다.",
      "여러 영역이 있어도 더하지 않고, 비율이 가장 나은 하나만 반영했습니다.",
      "포인트·마일은 1원 가치가 원문에 있는 경우만 환산했습니다.",
    ],
    scenarios: best.scenarios,
  };
}
