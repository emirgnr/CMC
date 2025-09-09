const $ = (s) => document.querySelector(s);

// ---------- Formatlayıcılar ----------
const fmt = new Intl.NumberFormat("tr-TR", { maximumFractionDigits: 8 });
const fmtPrice = new Intl.NumberFormat("tr-TR", {
  minimumFractionDigits: 2,
  maximumFractionDigits: 8,
});
const fmtUSD = new Intl.NumberFormat("tr-TR", {
  style: "currency",
  currency: "USD",
  minimumFractionDigits: 2,
  maximumFractionDigits: 8,
});

// ---------- Durum ----------
const state = {
  symbol: "BTCUSDT",
  loading: false,
  auto: { enabled: false, rem: 5, tick: null },
};

// ---------- Son sembol ----------
const SYM_KEY = "lastSymbol.v1";
function loadLastSymbol() {
  try {
    return localStorage.getItem(SYM_KEY) || null;
  } catch {
    return null;
  }
}
function saveLastSymbol(sym) {
  try {
    localStorage.setItem(SYM_KEY, sym);
  } catch {}
}
function syncSymbolControls(sym) {
  const sel = $("#symbolSelect");
  const has = [...sel.options].some((o) => o.value === sym);
  if (has) sel.value = sym;
  $("#customSymbol").value = "";
}

// ---------- Gelişmiş LOG ----------
const Log = {
  items: [],
  max: 2000,
  paused: false,
  autoscroll: true,
  filter: {
    q: "",
    levels: new Set(["INFO", "WARN", "ERROR"]),
    src: "ALL",
    symbol: "ALL",
  },

  write(level, msg, meta = {}) {
    const t = new Date();
    const rec = {
      t,
      ts: t.toISOString(),
      level,
      msg: String(msg),
      src: meta.src || "App",
      symbol: meta.symbol || null,
      meta: meta && typeof meta === "object" ? { ...meta } : { value: meta },
    };
    this.items.unshift(rec);
    if (this.items.length > this.max) this.items.length = this.max;
    if (!this.paused) this.render(true);
    $("#status").textContent = `${level}: ${String(msg).slice(0, 48)}`;
    if (rec.symbol) this._ensureSymbolOption(rec.symbol);
  },

  info(m, meta) {
    this.write("INFO", m, meta);
  },
  warn(m, meta) {
    this.write("WARN", m, meta);
  },
  error(m, meta) {
    this.write("ERROR", m, meta);
  },

  _ensureSymbolOption(sym) {
    const sel = $("#logSym");
    if (!sel) return;
    if (![...sel.options].some((o) => o.value === sym)) {
      const o = document.createElement("option");
      o.value = sym;
      o.textContent = sym;
      sel.appendChild(o);
    }
  },

  _match(rec) {
    if (!this.filter.levels.has(rec.level)) return false;
    if (this.filter.src !== "ALL" && rec.src !== this.filter.src) return false;
    if (this.filter.symbol !== "ALL" && rec.symbol !== this.filter.symbol)
      return false;
    if (this.filter.q) {
      const q = this.filter.q.toLowerCase();
      const blob = (rec.msg + " " + JSON.stringify(rec.meta)).toLowerCase();
      if (!blob.includes(q)) return false;
    }
    return true;
  },

  _row(rec) {
    const ts = new Date(rec.ts).toLocaleTimeString("tr-TR");
    const esc = (s) =>
      String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");
    const metaStr = JSON.stringify(rec.meta, null, 2);
    const chip = `<span class="chip-src">${esc(rec.src)}${
      rec.symbol ? ` • ${esc(rec.symbol)}` : ""
    }</span>`;
    return `<div class="log-item lvl-${rec.level}">
      <span class="ts">${ts}</span>
      <span class="lvl">${rec.level}</span>
      <span class="msg">${esc(rec.msg)} ${chip}</span>
      <span class="actions"><button class="copy-btn" data-copy='${esc(
        metaStr
      )}'>Kopyala</button></span>
      <details><summary>detaylar</summary><pre>${esc(metaStr)}</pre></details>
    </div>`;
  },

  render(keepScroll = false) {
    const el = $("#log");
    if (!el) return;
    const beforeTop = el.scrollTop;

    const html = this.items
      .filter((r) => this._match(r))
      .map((r) => this._row(r))
      .join("");
    el.innerHTML =
      html || `<div class="muted" style="padding:8px 12px">Kayıt yok.</div>`;

    if (this.autoscroll && !this.paused) {
      el.scrollTop = 0;
    } else if (keepScroll && !this.autoscroll) {
      el.scrollTop = beforeTop;
    }
  },

  clear() {
    this.items = [];
    this.render();
  },
  export() {
    const blob = new Blob([JSON.stringify(this.items, null, 2)], {
      type: "application/json",
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logs-${new Date().toISOString().replaceAll(":", "-")}.json`;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  },

  attachUI() {
    $("#logSearch")?.addEventListener("input", (e) => {
      this.filter.q = e.target.value.trim();
      this.render();
    });
    $("#logSrc")?.addEventListener("change", (e) => {
      this.filter.src = e.target.value;
      this.render();
    });
    $("#logSym")?.addEventListener("change", (e) => {
      this.filter.symbol = e.target.value;
      this.render();
    });
    $("#lvINFO")?.addEventListener("change", (e) => {
      e.target.checked
        ? this.filter.levels.add("INFO")
        : this.filter.levels.delete("INFO");
      this.render();
    });
    $("#lvWARN")?.addEventListener("change", (e) => {
      e.target.checked
        ? this.filter.levels.add("WARN")
        : this.filter.levels.delete("WARN");
      this.render();
    });
    $("#lvERROR")?.addEventListener("change", (e) => {
      e.target.checked
        ? this.filter.levels.add("ERROR")
        : this.filter.levels.delete("ERROR");
      this.render();
    });
    $("#logAutoscroll")?.addEventListener("change", (e) => {
      this.autoscroll = !!e.target.checked;
    });

    $("#logPause")?.addEventListener("click", (e) => {
      this.paused = !this.paused;
      e.target.textContent = this.paused ? "Resume" : "Pause";
      if (!this.paused) this.render();
    });
    $("#logExport")?.addEventListener("click", () => this.export());
    $("#logClear")?.addEventListener("click", () => this.clear());

    $("#log")?.addEventListener("click", (e) => {
      const btn = e.target.closest(".copy-btn");
      if (!btn) return;
      navigator.clipboard.writeText(btn.dataset.copy || "").then(() => {
        this.info("Meta panoya kopyalandı", { src: "UI" });
      });
    });
  },
};

// ---------- Fetch Wrapper ----------
async function fetchJSON(url, opts = {}) {
  const start = performance.now();
  let res, data;
  try {
    res = await fetch(url, opts);
    const ms = Math.round(performance.now() - start);
    const headers = Object.fromEntries(res.headers.entries());
    const status = res.status;
    if (!res.ok) {
      Log.error("HTTP hata", { src: "HTTP", url, status, headers, ms });
      throw new Error(`HTTP ${status} — ${url}`);
    }
    data = await res.json();
    const size = JSON.stringify(data).length;
    Log.info("HTTP OK", { src: "HTTP", url, status, ms, size, headers });
    return data;
  } catch (e) {
    const ms = Math.round(performance.now() - start);
    Log.error("İstek başarısız", {
      src: "HTTP",
      url,
      ms,
      error: String(e),
      status: res?.status,
    });
    throw e;
  }
}

// ---------- Fiyat cache (toplu preload) ----------
const priceCache = new Map(); // symbol -> number
let priceCacheStamp = 0;
const PRICE_TTL_MS = 3_000; // 3 sn içinde tazeyse tekrar çağırma

function cacheFresh() {
  return Date.now() - priceCacheStamp < PRICE_TTL_MS && priceCache.size > 0;
}

/** Tüm semboller için fiyatları tek seferde çek ve cache'le */
async function preloadAllPrices(force = false) {
  if (!force && cacheFresh()) return;
  const arr = await fetchJSON(`https://api.binance.com/api/v3/ticker/price`);
  priceCache.clear();
  for (const it of arr) priceCache.set(it.symbol, Number(it.price));
  priceCacheStamp = Date.now();
  Log.info("Toplu fiyat cache güncellendi", {
    src: "HTTP",
    count: priceCache.size,
    ttl_ms: PRICE_TTL_MS,
  });
}

/** Gerekli semboller için cache'in hazır olmasını garanti eder */
async function ensurePricesFor(symbols = []) {
  if (!cacheFresh()) await preloadAllPrices();
  const missing = symbols.filter((s) => !priceCache.has(s));
  if (missing.length) {
    Log.warn("Cache’de eksik semboller var, force preload", {
      src: "HTTP",
      missing,
    });
    await preloadAllPrices(true);
  }
}

/** Cache'ten tek fiyat çek */
function getPrice(symbol) {
  return priceCache.get(symbol) ?? null;
}

// ---------- Sembol ----------
function setSymbol(sym) {
  state.symbol = String(sym || "").toUpperCase();
  saveLastSymbol(state.symbol);
  $("#symbol").textContent = state.symbol;
  syncSymbolControls(state.symbol);
  Log.info("Sembol değişti", { src: "UI", symbol: state.symbol });
  resetAutoCountdown();
}

// ---------- Ana panel ----------
async function loadTicker() {
  const sym = state.symbol;

  // fiyatları hazırla (cache yoksa tek istek atılır)
  await ensurePricesFor([sym]);

  // 24s istatistik + cache'ten fiyat
  const stats = await fetchJSON(
    `https://api.binance.com/api/v3/ticker/24hr?symbol=${sym}`
  );
  const price = getPrice(sym);

  $("#price").textContent = fmtPrice.format(price);
  const change = Number(stats.priceChange);
  const changePct = Number(stats.priceChangePercent);
  const changeEl = $("#change");
  changeEl.textContent = `${change >= 0 ? "+" : ""}${fmtPrice.format(
    change
  )} (${changePct.toFixed(2)}%)`;
  changeEl.className = "diff " + (changePct >= 0 ? "up" : "down");

  $("#high").textContent = fmtPrice.format(Number(stats.highPrice));
  $("#low").textContent = fmtPrice.format(Number(stats.lowPrice));
  $("#vol").textContent = fmt.format(Number(stats.volume));
  $("#updated").textContent = new Date(Number(stats.closeTime)).toLocaleString(
    "tr-TR"
  );

  Log.info("Ticker güncellendi", {
    src: "Ticker",
    symbol: sym,
    lastPrice: price,
    change,
    changePct,
    high: Number(stats.highPrice),
    low: Number(stats.lowPrice),
    closeTime: stats.closeTime,
  });
}

function drawSparkline(values) {
  const w = 500,
    h = 100,
    p = 6;
  const min = Math.min(...values),
    max = Math.max(...values);
  const sx = (i) => (i / (values.length - 1)) * (w - p * 2) + p;
  const sy = (v) => h - ((v - min) / (max - min || 1)) * (h - p * 2) - p;
  const pts = values
    .map((v, i) => `${sx(i).toFixed(1)},${sy(v).toFixed(1)}`)
    .join(" ");
  const last = values.at(-1),
    prev = values.at(-2) ?? last;
  const color = last >= prev ? "#22c55e" : "#ef4444";
  $(
    "#spark"
  ).innerHTML = `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"/><circle cx="${sx(
    values.length - 1
  )}" cy="${sy(last)}" r="3" fill="${color}"/>`;
}

async function loadSpark() {
  const url = `https://api.binance.com/api/v3/klines?symbol=${state.symbol}&interval=1m&limit=60`;
  const arr = await fetchJSON(url);
  drawSparkline(arr.map((k) => Number(k[4])));
  Log.info("Sparkline güncellendi", {
    src: "Spark",
    symbol: state.symbol,
    candles: arr.length,
    interval: "1m",
  });
}

async function refreshAll() {
  if (state.loading) return;
  state.loading = true;
  try {
    Log.info("Yenile başlatıldı", { src: "UI", symbol: state.symbol });

    // toplu preload: ana sembol + favoriler
    const needSymbols = new Set([state.symbol]);
    favorites.forEach((f) => needSymbols.add(f.symbol));
    await ensurePricesFor([...needSymbols]);

    await loadTicker();
    await new Promise((r) => setTimeout(r, 250));
    await loadSpark();
    await updateFavoritesPrices();
    Log.info("Yenile tamamlandı", { src: "UI", symbol: state.symbol });
  } catch (e) {
    Log.error("Yenile hata", {
      src: "UI",
      symbol: state.symbol,
      error: String(e),
    });
  } finally {
    state.loading = false;
    resetAutoCountdown();
  }
}

// ---------- Otomatik Yenile ----------
function updateAutoLabel() {
  $("#autoLbl").textContent = state.auto.enabled
    ? `Otomatik yenile: ${state.auto.rem}s`
    : "Otomatik yenile (5 sn)";
}
function resetAutoCountdown() {
  if (!state.auto.enabled) return;
  state.auto.rem = 5;
  updateAutoLabel();
}
function setAutoRefresh(enabled) {
  state.auto.enabled = !!enabled;
  clearInterval(state.auto.tick);

  if (!state.auto.enabled) {
    updateAutoLabel();
    return;
  }

  state.auto.rem = 5;
  updateAutoLabel();

  state.auto.tick = setInterval(async () => {
    if (!state.auto.enabled) {
      clearInterval(state.auto.tick);
      return;
    }

    if (state.auto.rem === 0) {
      updateAutoLabel(); // 0'ı göster
      await refreshAll();
    } else {
      updateAutoLabel();
      state.auto.rem -= 1;
    }
  }, 1000);
}

// ---------- Favoriler ----------
const FAV_KEY = "favCoins.v2";
function migrateV1() {
  try {
    const v1 = JSON.parse(localStorage.getItem("favCoins.v1") || "[]");
    if (Array.isArray(v1) && v1.length) {
      const v2 = v1.map((f) => ({
        symbol: String(f.symbol || "").toUpperCase(),
        qty: Number(f.qty) || 0,
        side: "BUY",
        ref: Number(f.entry) || 0,
      }));
      localStorage.setItem(FAV_KEY, JSON.stringify(v2));
      return v2;
    }
  } catch {}
  return null;
}
function loadFavorites() {
  try {
    const v2 = JSON.parse(localStorage.getItem(FAV_KEY) || "[]");
    if (Array.isArray(v2)) return v2;
  } catch {}
  return migrateV1() || [];
}
function saveFavorites(arr) {
  localStorage.setItem(FAV_KEY, JSON.stringify(arr));
}
let favorites = loadFavorites();

function inputCell(value, k) {
  return `<input data-k="${k}" type="number" step="any" value="${value}"
    style="width:120px;background:#0f141b;color:var(--text);border:1px solid rgba(255,255,255,.09);
    border-radius:8px;height:32px;padding:0 8px;text-align:right;" />`;
}

function renderFavoritesTable() {
  const tbody = $("#favBody");
  tbody.innerHTML = "";
  favorites.forEach((f, i) => {
    const tr = document.createElement("tr");
    tr.dataset.index = i;
    tr.innerHTML = `
      <td>${i + 1}</td>
      <td><span class="kbd">${f.symbol}</span></td>
      <td><span class="chip ${f.side === "BUY" ? "buy" : "sell"}">${
      f.side === "BUY" ? "Alış" : "Satış"
    }</span></td>
      <td class="right">${inputCell(f.qty || 0, "qty")}</td>
      <td class="right">${inputCell(f.ref ?? 0, "ref")}</td>
      <td class="right" data-k="price">—</td>
      <td class="right" data-k="diff">—</td>
      <td class="right" data-k="pnl">—</td>
      <td class="right" data-k="total">—</td>
      <td class="right"><button data-action="rm">Sil</button></td>
    `;
    tbody.appendChild(tr);
    Log._ensureSymbolOption(f.symbol);
  });
  const has = favorites.length > 0;
  $("#favGrand").textContent = has ? "Hesaplanıyor…" : "—";
  $("#favRefGrand").textContent = has ? "Hesaplanıyor…" : "—";
  $("#favPnlGrand").textContent = has ? "Hesaplanıyor…" : "—";
  $("#favAdd").disabled = favorites.length >= 4;
  $("#favInfo").textContent =
    favorites.length >= 4
      ? "Limit dolu (4/4)"
      : `Yerel kayıt • ${favorites.length}/4`;
}

function clsBySign(n) {
  if (n == null || Number.isNaN(n)) return "";
  return "diff " + (n >= 0 ? "up" : "down");
}

async function updateFavoritesPrices() {
  const rows = Array.from($("#favBody").querySelectorAll("tr"));
  let grand = 0,
    grandRef = 0,
    grandPnl = 0;

  // Listedeki tüm semboller + ana sembol için cache hazırla
  const needSymbols = new Set([state.symbol]);
  favorites.forEach((f) => needSymbols.add(f.symbol));
  await ensurePricesFor([...needSymbols]);

  for (const tr of rows) {
    const i = Number(tr.dataset.index);
    const f = favorites[i];
    try {
      const price = getPrice(f.symbol); // tek istekle preload edilen cache
      const qty = Number(f.qty || 0);
      const ref = Number(f.ref || 0);
      const side = f.side === "SELL" ? "SELL" : "BUY";

      const diff = ref ? price - ref : null; // birim fark (gösterim)
      const pnl = ref
        ? side === "BUY"
          ? (price - ref) * qty
          : (ref - price) * qty
        : null; // yönlü P/L
      const totalCurrent = price * qty; // satırın güncel toplamı
      const totalRef = ref ? ref * qty : 0; // referans toplam

      tr.querySelector('[data-k="price"]').textContent = fmtPrice.format(price);

      const diffEl = tr.querySelector('[data-k="diff"]');
      diffEl.textContent =
        diff == null ? "—" : `${diff >= 0 ? "+" : ""}${fmtPrice.format(diff)}`;
      diffEl.className = clsBySign(diff);

      const pnlEl = tr.querySelector('[data-k="pnl"]');
      pnlEl.textContent =
        pnl == null ? "—" : `${pnl >= 0 ? "+" : ""}${fmtUSD.format(pnl)}`;
      pnlEl.className = clsBySign(pnl);

      tr.querySelector('[data-k="total"]').textContent =
        fmtUSD.format(totalCurrent);

      // dip toplamlar
      grand += totalCurrent;
      grandRef += totalRef;
      if (pnl != null) grandPnl += pnl;

      Log.info("Favori hesap", {
        src: "Favorites",
        symbol: f.symbol,
        side,
        qty,
        ref,
        price,
        diff,
        pnl,
        totalCurrent,
        totalRef,
      });
    } catch (e) {
      tr.querySelector('[data-k="price"]').textContent = "—";
      tr.querySelector('[data-k="diff"]').textContent = "—";
      tr.querySelector('[data-k="pnl"]').textContent = "—";
      tr.querySelector('[data-k="total"]').textContent = "—";
      Log.warn("Favori fiyat alınamadı", {
        src: "Favorites",
        symbol: f.symbol,
        error: String(e),
      });
    }
    // satır başı 120ms delay artık gereksiz (tek istekle preload yapıldı)
  }

  // Dip toplamlar (USD)
  $("#favGrand").textContent = fmtUSD.format(grand);
  $("#favRefGrand").textContent = grandRef > 0 ? fmtUSD.format(grandRef) : "—";

  const pnlCell = $("#favPnlGrand");
  if (favorites.some((f) => Number(f.ref))) {
    pnlCell.textContent = (grandPnl >= 0 ? "+" : "") + fmtUSD.format(grandPnl);
    pnlCell.className = grandPnl >= 0 ? "diff up" : "diff down";
  } else {
    pnlCell.textContent = "—";
    pnlCell.className = "";
  }
}

function addFavorite(sym, qty, side, price) {
  const symbol = String(sym || "")
    .toUpperCase()
    .trim();
  const amount = Number(String(qty || "0").replace(",", "."));
  const ref = Number(String(price || "0").replace(",", "."));
  const sd = side === "SELL" ? "SELL" : "BUY";

  if (!symbol) return Log.warn("Favori ekle: sembol boş.", { src: "UI" });
  if (!/^[A-Z0-9]{3,12}$/.test(symbol))
    return Log.warn("Favori ekle: sembol formatı geçersiz.", {
      src: "UI",
      symbol,
    });
  if (!(amount >= 0))
    return Log.warn("Favori ekle: miktar sayısal olmalı.", {
      src: "UI",
      symbol,
    });
  if (!(ref >= 0))
    return Log.warn("Favori ekle: birim fiyat sayısal olmalı.", {
      src: "UI",
      symbol,
    });
  if (favorites.length >= 4)
    return Log.warn("Favori limiti dolu (4).", { src: "UI" });
  if (favorites.some((f) => f.symbol === symbol))
    return Log.warn("Bu sembol zaten favorilerde.", { src: "UI", symbol });

  favorites.push({ symbol, qty: amount, side: sd, ref });
  saveFavorites(favorites);
  renderFavoritesTable();
  updateFavoritesPrices();
  Log.info("Favori eklendi", { src: "UI", symbol, qty: amount, side: sd, ref });
}

function removeFavorite(index) {
  const sym = favorites[index]?.symbol;
  favorites.splice(index, 1);
  saveFavorites(favorites);
  renderFavoritesTable();
  updateFavoritesPrices();
  Log.info("Favori silindi", { src: "UI", symbol: sym, index });
}

// ---------- UI Events ----------
$("#apply").addEventListener("click", () => {
  const custom = $("#customSymbol").value.trim();
  setSymbol(custom || $("#symbolSelect").value);
  refreshAll();
});
$("#refresh").addEventListener("click", () => {
  refreshAll();
});
$("#auto").addEventListener("change", (e) => setAutoRefresh(e.target.checked));
$("#symbolSelect").addEventListener("change", (e) => {
  setSymbol(e.target.value);
});
document.querySelectorAll("#quick button").forEach((b) =>
  b.addEventListener("click", () => {
    setSymbol(b.dataset.sym);
    refreshAll();
  })
);

$("#favAdd").addEventListener("click", () => {
  addFavorite(
    $("#favSymbol").value,
    $("#favQty").value,
    $("#favSide").value,
    $("#favPrice").value
  );
  $("#favSymbol").value = "";
  $("#favQty").value = "";
  $("#favPrice").value = "";
  $("#favSide").value = "BUY";
});
$("#favClear").addEventListener("click", () => {
  if (confirm("Tüm favorileri silmek istediğine emin misin?")) {
    favorites = [];
    saveFavorites(favorites);
    renderFavoritesTable();
    updateFavoritesPrices();
    Log.info("Tüm favoriler silindi", { src: "UI" });
  }
});

// Tabloda qty/ref düzenleme + satır silme
$("#favBody").addEventListener("input", (e) => {
  const tr = e.target.closest("tr");
  if (!tr) return;
  const i = Number(tr.dataset.index);
  const k = e.target.dataset.k;
  if (k === "qty" || k === "ref") {
    const v = Number(String(e.target.value).replace(",", "."));
    favorites[i][k] = isNaN(v) ? 0 : v;
    saveFavorites(favorites);
    updateFavoritesPrices();
    Log.info("Favori düzenlendi", {
      src: "UI",
      symbol: favorites[i].symbol,
      key: k,
      value: favorites[i][k],
    });
  }
});
$("#favBody").addEventListener("click", (e) => {
  const tr = e.target.closest("tr");
  if (!tr) return;
  if (e.target.dataset.action === "rm")
    removeFavorite(Number(tr.dataset.index));
});

// Kısayollar
document.addEventListener("keydown", (e) => {
  const k = e.key.toLowerCase();
  if ((e.ctrlKey || e.metaKey) && k === "u") {
    e.preventDefault();
    $("#apply").click();
    Log.info("Kısayol: Uygula", { src: "UI" });
  } else if ((e.ctrlKey || e.metaKey) && k === "y") {
    e.preventDefault();
    const a = $("#auto");
    a.checked = !a.checked;
    a.dispatchEvent(new Event("change"));
    Log.info("Kısayol: Auto toggle", { src: "UI", enabled: a.checked });
  } else if ((e.ctrlKey || e.metaKey) && k === "l") {
    e.preventDefault();
    Log.clear();
    Log.info("Log temizlendi", { src: "UI" });
  }
});

window.addEventListener("beforeunload", () => {
  clearInterval(state.auto.tick);
});

// ---------- Başlangıç ----------
const bootSym = loadLastSymbol() || $("#symbolSelect").value;
setSymbol(bootSym);
Log.attachUI(); // <-- toolbar bağlama
renderFavoritesTable();
updateAutoLabel();
refreshAll();
