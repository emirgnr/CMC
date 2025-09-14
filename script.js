(() => {
  "use strict";

  /* =========================
   *  Utilities / DOM helpers
   * ========================= */
  const $ = (s) => document.querySelector(s);
  const $$ = (s) => Array.from(document.querySelectorAll(s));

  // ---- SAFE setters ----
  const setText = (sel, val) => {
    const el = $(sel);
    if (el) el.textContent = String(val ?? "");
  };
  const setHTML = (sel, val) => {
    const el = $(sel);
    if (el) el.innerHTML = String(val ?? "");
  };
  const setChecked = (sel, val) => {
    const el = $(sel);
    if (el) el.checked = !!val;
  };
  const setDisabled = (sel, val) => {
    const el = $(sel);
    if (el) el.disabled = !!val;
  };

  const toNum = (v, def = 0) => {
    const n = Number(String(v).replace(",", "."));
    return Number.isFinite(n) ? n : def;
  };

  const fmt = (v, min = 2, max = 8) => {
    const n = Number(v);
    return Number.isFinite(n)
      ? n.toLocaleString("tr-TR", {
          minimumFractionDigits: min,
          maximumFractionDigits: max,
        })
      : "—";
  };

  const fmtUSD = (v) => {
    const n = Number(v);
    return Number.isFinite(n)
      ? n.toLocaleString("tr-TR", {
          style: "currency",
          currency: "USD",
          minimumFractionDigits: 2,
          maximumFractionDigits: 8,
        })
      : "—";
  };

  const storage = {
    get: (k, def) => {
      try {
        const v = localStorage.getItem(k);
        return v ? JSON.parse(v) : def;
      } catch {
        return def;
      }
    },
    set: (k, v) => {
      try {
        localStorage.setItem(k, JSON.stringify(v));
      } catch {}
    },
  };

  /* =========================
   *  Status mesajı temizleyici
   * ========================= */
  const STATUS_MAX = 48; // ekranda max karakter
  const stripUrls = (s) =>
    String(s || "")
      .replace(/https?:\/\/\S+/gi, "") // http(s) kaldır
      .replace(/(?:^|\s)\/api\/\S+/gi, "") // /api/... kaldır
      .replace(/\s{2,}/g, " ")
      .trim();
  const clamp = (s, n = STATUS_MAX) =>
    s.length > n ? s.slice(0, n - 1) + "…" : s;
  function setStatusClean(level, msg) {
    const txt = clamp(stripUrls(msg));
    setText("#status", `${level}: ${txt}`);
  }
  // Eski API ile uyumluluk (kullanmak istersen)
  function setStatus(txt, tone = "info") {
    setText("#status", `${tone.toUpperCase()}: ${txt}`);
  }

  /* =========================
   *  Constants / Keys
   * ========================= */
  const SYM_KEY = "lastSymbol.v1";
  const AUTO_KEY = "auto.v1";
  const FAV_KEY = "favCoins.v2";

  const API = {
    TICKER_24H: (s) => `https://api.binance.com/api/v3/ticker/24hr?symbol=${s}`,
    PRICES: `https://api.binance.com/api/v3/ticker/price`,
    KLINES: (s, i = "1m", lim = 60) =>
      `https://api.binance.com/api/v3/klines?symbol=${s}&interval=${i}&limit=${lim}`,
  };

  /* =========================
   *  App State
   * ========================= */
  const state = {
    symbol: "BTCUSDT",
    loading: false,
    auto: { enabled: false, rem: 5, timer: null, busy: false },
    dnd: { active: false, bound: false },
  };

  /* =========================
   *  Logger (event-driven, timed, dedupe)
   * ========================= */
  const Log = (() => {
    const items = []; // { id, ts, level, msg, src, symbol, meta }
    const MAX = 2000;
    let seq = 0;

    // filters / ui state
    let levelFilter = "all";
    let query = "";
    let autoscroll = true;
    let paused = false;
    let srcFilter = "ALL";
    let symFilter = "ALL";

    // dedupe cache
    const seen = new Map(); // key -> expireTs

    const elList = () => $("#logList");
    const elWrap = () => $("#logWrap");

    const esc = (s) =>
      String(s)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;");

    function ensureSymbolOption(sym) {
      const sel = $("#logSym");
      if (!sel || !sym) return;
      if ([...sel.options].some((o) => o.value === sym)) return;
      const o = document.createElement("option");
      o.value = sym;
      o.textContent = sym;
      sel.appendChild(o);
    }

    function match(rec) {
      if (levelFilter !== "all" && rec.level.toLowerCase() !== levelFilter)
        return false;
      if (srcFilter !== "ALL" && (rec.src || "App") !== srcFilter) return false;
      if (symFilter !== "ALL" && (rec.symbol || "") !== symFilter) return false;
      if (query) {
        const blob = (rec.msg + " " + JSON.stringify(rec.meta)).toLowerCase();
        if (!blob.includes(query)) return false;
      }
      return true;
    }

    function row(rec) {
      const ts = new Date(rec.ts).toLocaleTimeString("tr-TR");
      const metaStr = JSON.stringify(rec.meta ?? {}, null, 2);
      const chip = `<span class="chip-src">${esc(rec.src || "UI")}${
        rec.symbol ? ` • ${esc(rec.symbol)}` : ""
      }</span>`;
      const lvl = (rec.level || "INFO").toUpperCase();
      const lvlCls =
        lvl === "ERROR"
          ? "level-error"
          : lvl === "WARN"
          ? "level-warn"
          : "level-info";

      return `
<li class="log-item" data-id="${rec.id}">
  <div class="log-meta">
    <span class="log-time">${ts}</span>
    <span class="level-pill ${lvlCls}">${lvl}</span>
  </div>
  <div class="log-msg">${esc(rec.msg)} ${chip}</div>
  <div class="d-flex gap-2">
    <button class="btn btn-sm button-custom copy-meta" data-copy="${esc(
      metaStr
    )}">Kopyala</button>
  </div>
  <details class="mt-2">
    <summary class="log-summary">detaylar</summary>
    <pre class="json-pre">${esc(metaStr)}</pre>
  </details>
</li>`;
    }

    function render(keepScroll = false) {
      const ul = elList();
      if (!ul) return;
      const wrap = elWrap();

      const openIds = new Set(
        Array.from(ul.querySelectorAll("li details[open]"))
          .map((d) => d.closest("li")?.dataset.id)
          .filter(Boolean)
      );

      const prevTop = wrap?.scrollTop ?? 0;
      const nearBottom = wrap
        ? wrap.scrollHeight - wrap.clientHeight - wrap.scrollTop < 8
        : false;

      ul.innerHTML =
        items.filter(match).map(row).join("") ||
        `<li class="log-empty">Kayıt yok.</li>`;

      openIds.forEach((id) =>
        ul
          .querySelector(`li[data-id="${id}"] details`)
          ?.setAttribute("open", "")
      );

      if (wrap) {
        if (autoscroll && !paused && (nearBottom || items.length <= 1)) {
          wrap.scrollTop = wrap.scrollHeight;
        } else if (keepScroll && !autoscroll) {
          wrap.scrollTop = prevTop;
        }
      }
    }

    function push(rec) {
      items.push(rec);
      if (items.length > MAX) items.shift();

      // —— status güncelleme politikası —— (kısa ve URL'siz)
      const t = rec.meta?.type;
      const a = rec.meta?.action;
      const allow =
        ["refresh", "network", "ui", "calc"].includes(t) &&
        ["start", "update", "success", "note"].includes(a) &&
        rec.level !== "ERROR" &&
        !rec.meta?.noStatus; // ← status'a düşmesini istemediklerimizi engelle

      if (allow && rec.msg) setStatusClean(rec.level, rec.msg);
      // ————————————————————————————————

      ensureSymbolOption(rec.symbol);
      if (!paused) render(true);
    }

    function write(level, msg, meta = {}) {
      const rec = {
        id: ++seq,
        ts: Date.now(),
        level: String(level || "INFO").toUpperCase(),
        msg: String(msg ?? ""),
        src: meta.src || "App",
        symbol: meta.symbol || null,
        meta,
      };
      push(rec);
    }

    // ---------- Public helpers ----------
    function event({
      type = "app",
      action = "note",
      msg = "",
      level,
      meta = {},
    }) {
      const defaults = {
        start: "INFO",
        success: "INFO",
        update: "INFO",
        note: "INFO",
        warn: "WARN",
        error: "ERROR",
      };
      const lvl = (level || defaults[action] || "INFO").toUpperCase();
      write(lvl, msg || `${type}.${action}`, { type, action, ...meta });
    }

    function begin(type, label, meta = {}) {
      const corr = `${type}-${Date.now()}-${Math.random()
        .toString(36)
        .slice(2, 7)}`;
      const t0 = performance.now();
      event({
        type,
        action: "start",
        msg: label || `${type} başladı`,
        meta: { ...meta, corr },
      });
      return {
        corr,
        end(ok = true, extra = {}) {
          const dur = Math.round(performance.now() - t0);
          event({
            type,
            action: ok ? "success" : "error",
            msg: `${label || type} ${ok ? "bitti" : "hata"}`,
            meta: { dur, ...extra, corr },
            level: ok ? "INFO" : "ERROR",
          });
        },
        step(action, msg, extra = {}) {
          const dur = Math.round(performance.now() - t0);
          event({ type, action, msg, meta: { dur, ...extra, corr } });
        },
      };
    }

    function time(label, baseMeta = {}) {
      const t0 = performance.now();
      return () => {
        const dur = Math.round(performance.now() - t0);
        event({
          type: "perf",
          action: "update",
          msg: `${label}: ${dur} ms`,
          meta: { dur, ...baseMeta },
        });
        return dur;
      };
    }

    function dedupe(key, ttlMs = 10000) {
      const now = Date.now();
      const exp = seen.get(key);
      if (exp && exp > now) return true;
      seen.set(key, now + ttlMs);
      return false;
    }

    // JSON -> syntax + tablo/CSV
    function syntaxHighlight(jsonStr) {
      return jsonStr
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(
          /"(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"(?=\\s*:)/g,
          '<span class="k">$&</span>'
        )
        .replace(
          /"(\\u[a-fA-F0-9]{4}|\\[^u]|[^\\"])*"/g,
          '<span class="s">$&</span>'
        )
        .replace(
          /\\b-?\\d+(\\.\\d+)?([eE][+-]?\\d+)?\\b/g,
          '<span class="n">$&</span>'
        )
        .replace(/\\b(true|false)\\b/g, '<span class="b">$1</span>')
        .replace(/\\bnull\\b/g, '<span class="l">null</span>');
    }

    function findArrayTableCandidate(raw) {
      try {
        const obj = typeof raw === "string" ? JSON.parse(raw) : raw;
        const pick = (val) => {
          if (Array.isArray(val) && val.length && typeof val[0] === "object")
            return val;
          if (val && typeof val === "object") {
            for (const k of Object.keys(val)) {
              const res = pick(val[k]);
              if (res) return res;
            }
          }
          return null;
        };
        const arr = pick(obj);
        if (!arr) return null;
        const cols = Array.from(
          arr.reduce((s, r) => {
            Object.keys(r || {}).forEach((k) => s.add(k));
            return s;
          }, new Set())
        );
        return { rows: arr, cols };
      } catch {
        return null;
      }
    }

    function toCSV({ rows, cols }) {
      const escCSV = (v) => {
        const s = v == null ? "" : String(v);
        return /[",;\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
      };
      const head = cols.join(",");
      const body = rows
        .map((r) => cols.map((c) => escCSV(r?.[c])).join(","))
        .join("\n");
      return head + "\n" + body;
    }

    function arrayToTableHTML({ rows, cols }) {
      const th = cols.map((c) => `<th>${esc(c)}</th>`).join("");
      const tr = rows
        .slice(0, 500)
        .map(
          (r) =>
            `<tr>${cols.map((c) => `<td>${esc(r?.[c])}</td>`).join("")}</tr>`
        )
        .join("");
      return `<div class="table-responsive"><table class="table table-sm table-dark table-striped"><thead><tr>${th}</tr></thead><tbody>${tr}</tbody></table></div>`;
    }

    function openDetail(entry) {
      const pre = $("#logDetailPre");
      const host = $("#tableHost");
      if (!pre || !host) return;

      const raw = entry.meta;
      const jsonStr =
        typeof raw === "string" ? raw : JSON.stringify(raw ?? {}, null, 2);
      pre.innerHTML = syntaxHighlight(jsonStr);

      const tabBtnTable = $("#tab-table");
      const tabBtnJSON = $("#tab-json");
      const paneTable = $("#pane-table");
      const paneJSON = $("#pane-json");
      tabBtnTable?.classList.add("d-none");
      paneTable?.classList.remove("show", "active");
      tabBtnJSON?.classList.add("active");
      paneJSON?.classList.add("show", "active");

      const cand = findArrayTableCandidate(raw);
      if (cand) {
        host.innerHTML = arrayToTableHTML(cand);
        tabBtnTable?.classList.remove("d-none");
        tabBtnTable?.classList.add("active");
        paneTable?.classList.add("show", "active");
        tabBtnJSON?.classList.remove("active");
        paneJSON?.classList.remove("show", "active");

        $("#logDetailCSV")?.addEventListener(
          "click",
          () => {
            const csv = toCSV(cand);
            const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
            const url = URL.createObjectURL(blob);
            const a = Object.assign(document.createElement("a"), {
              href: url,
              download: `log_table_${new Date()
                .toISOString()
                .slice(0, 19)
                .replace(/[:T]/g, "-")}.csv`,
            });
            document.body.appendChild(a);
            a.click();
            a.remove();
            URL.revokeObjectURL(url);
            info("CSV indirildi", { src: "UI" });
          },
          { once: true }
        );
      } else {
        host.innerHTML = `<div class="text-muted">Tabloya dönüştürülebilir uygun dizi yok.</div>`;
        $("#logDetailCSV")?.addEventListener(
          "click",
          () => warn("CSV: dönüştürülebilir dizi bulunamadı", { src: "UI" }),
          { once: true }
        );
      }

      setText("#logDetailTitle", `${entry.level} • ${entry.msg}`);
      new bootstrap.Modal($("#logDetailModal")).show();

      $("#logDetailCopy")?.addEventListener(
        "click",
        () => {
          navigator.clipboard
            .writeText(jsonStr)
            .then(() => info("Detay panoya kopyalandı", { src: "UI" }));
        },
        { once: true }
      );
    }

    // ---------- Public API ----------
    function info(m, meta) {
      write("INFO", m, meta);
    }
    function warn(m, meta) {
      write("WARN", m, meta);
    }
    function error(m, meta) {
      write("ERROR", m, meta);
    }

    function clear() {
      items.length = 0;
      seq = 0;
      render();
      const w = elWrap();
      if (w) w.scrollTop = 0;
    }

    function attachUI() {
      $("#logFilter")?.addEventListener("change", (e) => {
        levelFilter = e.target.value;
        render();
      });
      $("#logSearch")?.addEventListener("input", (e) => {
        query = (e.target.value || "").trim().toLowerCase();
        render();
      });
      $("#logAutoscroll")?.addEventListener("change", (e) => {
        autoscroll = !!e.target.checked;
      });
      $("#logClear")?.addEventListener("click", () => {
        items.length = 0;
        seq = 0;
        render();
      });
      $("#logCopy")?.addEventListener("click", () => {
        navigator.clipboard
          .writeText($("#logList")?.innerText || "")
          .then(() => info("Log panoya kopyalandı", { src: "UI" }));
      });
      $("#logDownload")?.addEventListener("click", () => {
        const txt = $("#logList")?.innerText || "";
        const blob = new Blob([txt], { type: "text/plain;charset=utf-8" });
        const url = URL.createObjectURL(blob);
        const a = Object.assign(document.createElement("a"), {
          href: url,
          download: `log_${new Date()
            .toISOString()
            .slice(0, 19)
            .replace(/[:T]/g, "-")}.txt`,
        });
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        info("Log indirildi", { src: "UI" });
      });
      $("#logSrc")?.addEventListener("change", (e) => {
        srcFilter = e.target.value;
        render();
      });
      $("#logSym")?.addEventListener("change", (e) => {
        symFilter = e.target.value;
        render();
      });

      $("#logList")?.addEventListener("click", (e) => {
        const btnCopy = e.target.closest(".copy-meta");
        if (btnCopy) {
          navigator.clipboard
            .writeText(btnCopy.dataset.copy || "")
            .then(() => info("Meta panoya kopyalandı", { src: "UI" }));
          return;
        }
        const btnDet = e.target.closest(".open-detail");
        if (btnDet) {
          const li = btnDet.closest("li");
          const id = Number(li?.dataset.id);
          const entry = id ? items.find((x) => x.id === id) : null;
          if (entry) openDetail(entry);
        }
      });
    }

    return {
      info,
      warn,
      error,
      clear,
      attachUI,
      setAutoscroll: (v) => {
        autoscroll = !!v;
      },
      setFilter: (v) => {
        levelFilter = v || "all";
        render();
      },
      setQuery: (v) => {
        query = (v || "").toLowerCase();
        render();
      },
      openDetail,
      event,
      begin,
      time,
      dedupe,
    };
  })();

  /* =========================
   *  Network (abortable fetch)
   * ========================= */
  const inflight = new Set();
  async function fetchJSON(url, { timeout = 8000, ...opts } = {}) {
    if (state.dnd.active) throw new Error("dnd-active");

    // endpoint ismini çıkar (URL göstermeden)
    const endpoint = (url.match(/\/api\/v3\/[a-zA-Z0-9/_-]+/) || ["İstek"])[0];
    const task = Log.begin("network", `İstek ${endpoint}`, {
      endpoint,
      method: (opts.method || "GET").toUpperCase(),
    });

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort("timeout"), timeout);
    inflight.add(ctrl);

    try {
      const res = await fetch(url, { ...opts, signal: ctrl.signal });
      const ok = res.ok;
      const status = res.status;

      const clone = res.clone();
      let json;
      try {
        json = await clone.json();
      } catch {
        json = null;
      }

      const meta = {
        endpoint,
        status,
        ok,
        type: Array.isArray(json) ? "array" : typeof json,
        size: Array.isArray(json)
          ? json.length
          : json && typeof json === "object"
          ? Object.keys(json).length
          : 0,
      };

      if (!ok) {
        task.end(false, meta);
        if (!Log.dedupe(`http-${status}-${endpoint}`, 10000)) {
          Log.error(`HTTP ${status}`, { ...meta, src: "NET" });
        }
        throw new Error(`HTTP ${status} — ${endpoint}`);
      }

      task.step("success", "Yanıt alındı", meta);

      if (Array.isArray(json) ? json.length <= 50 : typeof json !== "object") {
        Log.info("API cevabı", { src: "NET", body: json, endpoint });
      }

      task.end(true, meta);
      return json;
    } finally {
      clearTimeout(t);
      inflight.delete(ctrl);
    }
  }
  function cancelInflight() {
    inflight.forEach((c) => c.abort("refresh-cancelled"));
    inflight.clear();
  }

  /* =========================
   *  Price cache (TTL)
   * ========================= */
  const priceCache = new Map();
  let priceCacheStamp = 0;
  const PRICE_TTL_MS = 3000;
  let allPriceFetchPromise = null;

  async function preloadAllPrices(force = false) {
    if (
      !force &&
      Date.now() - priceCacheStamp < PRICE_TTL_MS &&
      priceCache.size
    )
      return;
    if (state.dnd.active) return;
    if (allPriceFetchPromise) return allPriceFetchPromise;

    allPriceFetchPromise = (async () => {
      try {
        const arr = await fetchJSON(API.PRICES);
        priceCache.clear();
        for (const it of arr) priceCache.set(it.symbol, Number(it.price));
        priceCacheStamp = Date.now();
      } finally {
        allPriceFetchPromise = null;
      }
    })();

    return allPriceFetchPromise;
  }
  async function ensurePricesFor(symbols = []) {
    if (state.dnd.active) return;
    if (Date.now() - priceCacheStamp >= PRICE_TTL_MS || !priceCache.size)
      await preloadAllPrices();
    if (symbols.some((s) => !priceCache.has(s))) await preloadAllPrices(true);
  }
  const getPrice = (symbol) => priceCache.get(symbol) ?? null;

  /* =========================
   *  Symbol & Status
   * ========================= */
  function setSymbol(sym) {
    const s = String(sym || "")
      .toUpperCase()
      .trim();
    if (!s) return;
    state.symbol = s;
    storage.set(SYM_KEY, s);
    setText("#symbol", s);
    $("#customSymbol") && ($("#customSymbol").value = "");
    const sel = $("#symbolSelect");
    if (sel && sel.querySelector(`option[value="${s}"]`)) sel.value = s;
    Log.event({
      type: "ui",
      action: "update",
      msg: `Sembol değişti: ${s}`,
      meta: { symbol: s },
    });
  }

  /* =========================
   *  Main: ticker + sparkline
   * ========================= */
  async function loadTicker() {
    const sym = state.symbol;
    await ensurePricesFor([sym]);
    if (state.dnd.active) return;

    const [stats, price] = await Promise.all([
      fetchJSON(API.TICKER_24H(sym)),
      Promise.resolve(getPrice(sym)),
    ]);

    setText("#price", fmt(price));

    const chg = Number(stats.priceChange);
    const pct = Number(stats.priceChangePercent);
    const changeEl = $("#change");
    if (changeEl) {
      changeEl.textContent = `${chg >= 0 ? "+" : ""}${fmt(chg)} (${
        Number.isFinite(pct) ? pct.toFixed(2) : "0.00"
      }%)`;
      changeEl.classList.toggle("text-good", pct >= 0);
      changeEl.classList.toggle("text-danger", pct < 0);
    }
    setText("#high", fmt(stats.highPrice));
    setText("#low", fmt(stats.lowPrice));
    setText("#vol", fmt(stats.volume, 0, 2));
    setText("#updated", new Date(stats.closeTime).toLocaleString("tr-TR"));
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
    setHTML(
      "#spark",
      `<polyline points="${pts}" fill="none" stroke="${color}" stroke-width="2"></polyline>` +
        `<circle cx="${sx(values.length - 1)}" cy="${sy(
          last
        )}" r="3" fill="${color}"></circle>`
    );
  }

  async function loadSpark() {
    const arr = await fetchJSON(API.KLINES(state.symbol, "1m", 60));
    drawSparkline(arr.map((k) => Number(k[4])));
  }

  async function refreshAll() {
    if (state.loading) return;
    state.loading = true;
    state.auto.busy = true;
    clearAutoTimer();
    setStatusClean("INFO", "Yenileniyor…");
    Log.event({ type: "refresh", action: "start", msg: "Yenileme başladı" });
    cancelInflight();

    try {
      const need = new Set([state.symbol, ...favorites.map((f) => f.symbol)]);
      await ensurePricesFor([...need]);
      await loadTicker();
      await new Promise((r) => setTimeout(r, 120));
      await loadSpark();
      await updateFavoritesPrices();
      setStatusClean("INFO", "Yenileme tamam");
      Log.event({ type: "refresh", action: "success", msg: "Yenileme tamam" });
    } catch (e) {
      if (e?.message !== "dnd-active") {
        Log.error(e?.message || String(e));
        // status'a uzun/hatalı/URL içeren şey basmıyoruz
      }
    } finally {
      state.loading = false;
      state.auto.busy = false;
      if (state.auto.enabled && !state.dnd.active) {
        state.auto.rem = 5;
        updateAutoLabel();
        scheduleNextTick(1000);
      }
    }
  }

  /* =========================
   *  Auto Refresh
   * ========================= */
  function updateAutoLabel() {
    setText(
      "#autoLbl",
      `Otomatik yenile: ${state.auto.enabled ? state.auto.rem : 5} sn`
    );
  }
  function clearAutoTimer() {
    if (state.auto.timer) {
      clearTimeout(state.auto.timer);
      state.auto.timer = null;
    }
  }
  function scheduleNextTick(ms = 1000) {
    clearAutoTimer();
    state.auto.timer = setTimeout(autoTick, ms);
  }
  async function autoTick() {
    if (!state.auto.enabled) return;
    if (state.auto.busy || state.dnd.active) {
      scheduleNextTick(250);
      return;
    }
    if (state.auto.rem === 0) {
      Log.info("Otomatik yenileme çalıştı");
      await refreshAll();
      return;
    }
    state.auto.rem -= 1;
    updateAutoLabel();
    scheduleNextTick(1000);
  }
  function setAutoRefresh(enabled) {
    state.auto.enabled = !!enabled;
    storage.set(AUTO_KEY, state.auto.enabled);
    clearAutoTimer();
    if (!state.auto.enabled) {
      updateAutoLabel();
      Log.event({
        type: "ui",
        action: "update",
        msg: "Otomatik yenile kapatıldı",
        meta: { noStatus: true },
      });
      return;
    }
    state.auto.rem = 5;
    updateAutoLabel();
    scheduleNextTick(1000);
    Log.event({
      type: "ui",
      action: "update",
      msg: "Otomatik yenile açıldı",
      meta: { noStatus: true },
    });
  }

  /* =========================
   *  Favorites (render, price, dnd)
   * ========================= */
  let favorites = storage.get(FAV_KEY, []);
  const saveFavorites = (arr) => storage.set(FAV_KEY, arr);

  const inputCell = (value, k) => `
    <input data-k="${k}" type="number" step="any" value="${value}"
      class="form-control form-control-sm text-end"
      style="width:120px;background:#0f141b;color:var(--text);border:1px solid rgba(255,255,255,.09);border-radius:8px;height:32px;padding:0 8px;" />`;

  function renderFavoritesTable() {
    const tbody = $("#favTableBody");
    if (!tbody) return;

    tbody.innerHTML = favorites
      .map((f, i) => {
        let side = (f.side || "buy").toLowerCase();
        if (side === "alış") side = "buy";
        if (side === "satış") side = "sell";
        const chipClass = `chip ${side === "sell" ? "sell" : "buy"}`;
        const sideText = side === "sell" ? "Satış" : "Alış";

        return `<tr data-index="${i}" draggable="true" class="draggable-row">
        <td class="text-center" style="white-space:nowrap;">
          <span class="drag-handle" title="Taşı" aria-label="Taşı" style="cursor:grab;display:inline-block;padding:4px 8px;opacity:.8;">
            <i class="bi bi-list text-muted"></i>
          </span>
        </td>
        <td class="text-muted" style="width:36px;">${i + 1}</td>
        <td><span class="kbd">${f.symbol}</span></td>
        <td><span class="rounded-pill ${chipClass}">${sideText}</span></td>
        <td class="text-end miktar-td">${inputCell(f.qty || 0, "qty")}</td>
        <td class="text-end ref-td">${inputCell(f.ref ?? 0, "ref")}</td>
        <td class="text-end" data-k="price">—</td>
        <td class="text-end" data-k="diff">—</td>
        <td class="text-end" data-k="pnl">—</td>
        <td class="text-end" data-k="total">—</td>
        <td class="text-center" style="white-space:nowrap;">
          <button class="btn text-white btn-sm rounded-3" data-action="rm" type="button" aria-label="Sil">
            <i class="fa-solid fa-trash text-muted" aria-hidden="true"></i>
          </button>
        </td>
      </tr>`;
      })
      .join("");

    setText("#favLimit", `${favorites.length}/4`);
    setText("#sumPL", favorites.length ? "Hesaplanıyor…" : "—");
    setText("#sumRef", favorites.length ? "Hesaplanıyor…" : "—");
    setText("#sumMarket", favorites.length ? "Hesaplanıyor…" : "—");
    setDisabled("#favAdd", favorites.length >= 4);

    if (!state.dnd.bound) {
      bindDragAndDrop();
      state.dnd.bound = true;
    }
  }

  const signClass = (n) =>
    n == null || Number.isNaN(n) ? "" : n >= 0 ? "text-success" : "text-danger";

  async function updateFavoritesPrices() {
    const tbody = $("#favTableBody");
    if (!tbody || state.dnd.active) return;
    const rows = Array.from(tbody.querySelectorAll("tr"));
    let grand = 0,
      grandRef = 0,
      grandPnl = 0;

    await ensurePricesFor([
      ...new Set([state.symbol, ...favorites.map((f) => f.symbol)]),
    ]);
    if (state.dnd.active) return;

    rows.forEach((tr, i) => {
      const f = favorites[i];
      if (!f) return;
      const price = getPrice(f.symbol);
      const qty = toNum(f.qty);
      const ref = toNum(f.ref);
      const side = (f.side || "buy").toLowerCase() === "sell" ? "SELL" : "BUY";

      const diff = ref ? price - ref : null;
      const pnl =
        ref && qty
          ? side === "BUY"
            ? (price - ref) * qty
            : (ref - price) * qty
          : null;

      const totalCurrent = Number.isFinite(price * qty) ? price * qty : 0;
      const totalRef = Number.isFinite(ref * qty) ? ref * qty : 0;

      const setCell = (k, val, cls) => {
        const el = tr.querySelector(`[data-k="${k}"]`);
        if (el) {
          el.textContent = val;
          if (cls != null) el.className = `text-end ${cls}`;
        }
      };

      setCell("price", fmt(price));
      setCell(
        "diff",
        diff == null ? "—" : `${diff >= 0 ? "+" : ""}${fmt(diff)}`,
        signClass(diff)
      );
      setCell(
        "pnl",
        pnl == null ? "—" : `${pnl >= 0 ? "+" : ""}${fmtUSD(pnl)}`,
        signClass(pnl)
      );
      setCell("total", fmtUSD(totalCurrent));

      grand += totalCurrent;
      grandRef += totalRef;
      if (pnl != null) grandPnl += pnl;
    });

    setText("#sumMarket", fmtUSD(grand));
    setText("#sumRef", grandRef > 0 ? fmtUSD(grandRef) : "—");

    const pnlCell = $("#sumPL");
    if (pnlCell) {
      if (favorites.some((f) => Number(f.ref))) {
        pnlCell.textContent = (grandPnl >= 0 ? "+" : "") + fmtUSD(grandPnl);
        pnlCell.className = `text-end fw-bold ${signClass(grandPnl)}`;
      } else {
        pnlCell.textContent = "—";
        pnlCell.className = "text-end fw-bold";
      }
    }

    // P&L özet eşiği
    const prevKey = "__lastPnl";
    const last = updateFavoritesPrices[prevKey] ?? { pnl: 0 };
    const changedSign = Math.sign(grandPnl) !== Math.sign(last.pnl);
    const jumped = Math.abs(grandPnl - last.pnl) >= 100;
    if (
      favorites.some((f) => Number(f.ref)) &&
      (changedSign || jumped) &&
      !state.dnd.active
    ) {
      Log.event({
        type: "calc",
        action: "update",
        msg: `Toplam P&L: ${grandPnl >= 0 ? "+" : ""}${fmtUSD(grandPnl)}`,
        meta: { pnl: grandPnl, prev: last.pnl, market: grand, ref: grandRef },
      });
      updateFavoritesPrices[prevKey] = { pnl: grandPnl };
    }
  }

  function addFavorite(sym, qty, side, price) {
    const symbol = String(sym || "")
      .toUpperCase()
      .trim();
    let sd = (side || "buy").toLowerCase();
    if (sd === "alış") sd = "buy";
    if (sd === "satış") sd = "sell";
    if (sd !== "buy" && sd !== "sell") sd = "buy";

    const amount = toNum(qty);
    const ref = toNum(price);

    if (!symbol) return alert("Sembol boş");
    if (!/^[A-Z0-9]{3,12}$/.test(symbol)) return alert("Sembol formatı hatalı");
    if (!(amount >= 0)) return alert("Miktar sayısal olmalı");
    if (!(ref >= 0)) return alert("Birim fiyat sayısal olmalı");
    if (favorites.length >= 4) return alert("Favori limiti dolu (4)");
    if (favorites.some((f) => f.symbol === symbol)) return alert("Zaten ekli");

    favorites.push({ symbol, qty: amount, side: sd, ref });
    Log.info(`Favori eklendi: ${symbol}`);
    saveFavorites(favorites);
    renderFavoritesTable();
    updateFavoritesPrices();
  }

  function removeFavorite(index) {
    const removed = favorites[index];
    favorites.splice(index, 1);
    Log.info(`Favori silindi: ${removed?.symbol || index}`);
    saveFavorites(favorites);
    renderFavoritesTable();
    updateFavoritesPrices();
  }

  // Drag & Drop
  function getRowAfterY(tbody, y) {
    const rows = [...tbody.querySelectorAll("tr:not(.dragging)")];
    return rows.reduce(
      (closest, child) => {
        const box = child.getBoundingClientRect();
        const offset = y - (box.top + box.height / 2);
        if (offset < 0 && offset > closest.offset)
          return { offset, element: child };
        return closest;
      },
      { offset: Number.NEGATIVE_INFINITY, element: null }
    ).element;
  }

  function bindDragAndDrop() {
    const tbody = $("#favTableBody");
    if (!tbody) return;
    let startOrder = [];

    tbody.addEventListener("dragstart", (e) => {
      const tr = e.target.closest("tr");
      if (!tr) return;
      state.dnd.active = true;
      tr.classList.add("dragging");
      e.dataTransfer.effectAllowed = "move";
      e.dataTransfer.setData("text/plain", tr.dataset.index);
      startOrder = favorites.slice();
      cancelInflight();
    });

    tbody.addEventListener("dragend", (e) => {
      const tr = e.target.closest("tr");
      if (tr) tr.classList.remove("dragging");
      state.dnd.active = false;
      renderFavoritesTable();
      updateFavoritesPrices();
    });

    tbody.addEventListener("dragover", (e) => {
      e.preventDefault();
      const dragging = tbody.querySelector(".dragging");
      if (!dragging) return;
      const afterEl = getRowAfterY(tbody, e.clientY);
      if (!afterEl) tbody.appendChild(dragging);
      else tbody.insertBefore(dragging, afterEl);
    });

    tbody.addEventListener("drop", (e) => {
      e.preventDefault();
      const newOrder = [];
      tbody.querySelectorAll("tr").forEach((tr) => {
        const oldIdx = Number(tr.dataset.index);
        newOrder.push(startOrder[oldIdx]);
      });
      favorites = newOrder;
      saveFavorites(favorites);
      Log.info("Favori sırası değiştirildi");
      state.dnd.active = false;
      renderFavoritesTable();
      updateFavoritesPrices();
      if (state.auto.enabled) {
        state.auto.rem = 5;
        updateAutoLabel();
        scheduleNextTick(1000);
      }
    });
  }

  /* =========================
   *  UI Bindings
   * ========================= */
  function bindUI() {
    $("#apply")?.addEventListener("click", () => {
      const cs = $("#customSymbol");
      const sel = $("#symbolSelect");
      setSymbol(cs?.value.trim() || sel?.value || "");
      refreshAll();
    });

    $("#refresh")?.addEventListener("click", refreshAll);
    $("#auto")?.addEventListener("change", (e) =>
      setAutoRefresh(e.target.checked)
    );
    $("#symbolSelect")?.addEventListener("change", (e) =>
      setSymbol(e.target.value)
    );

    $$("#quick button").forEach((b) =>
      b.addEventListener("click", () => {
        setSymbol(b.dataset.sym);
        refreshAll();
      })
    );

    $("#favAdd")?.addEventListener("click", () => {
      addFavorite(
        $("#favSymbol")?.value,
        $("#favAmount")?.value,
        $("#favSide")?.value,
        $("#favRefPrice")?.value
      );
      ["favSymbol", "favAmount", "favRefPrice"].forEach((id) => {
        const el = $("#" + id);
        if (el) el.value = "";
      });
      const fs = $("#favSide");
      if (fs) fs.value = "buy";
    });

    $("#favClearAll")?.addEventListener("click", () => {
      if (confirm("Tüm favorileri silmek istiyor musun?")) {
        favorites = [];
        saveFavorites(favorites);
        renderFavoritesTable();
        updateFavoritesPrices();
        Log.info("Tüm favoriler silindi");
      }
    });

    $("#favTableBody")?.addEventListener("input", (e) => {
      const tr = e.target.closest("tr");
      if (!tr || state.dnd.active) return;
      const i = Number(tr.dataset.index);
      const k = e.target.dataset.k;
      if (!["qty", "ref"].includes(k)) return;
      favorites[i][k] = toNum(e.target.value);
      saveFavorites(favorites);
      updateFavoritesPrices();
    });
    $("#favTableBody")?.addEventListener("click", (e) => {
      if (state.dnd.active) return;
      const tr = e.target.closest("tr");
      if (!tr) return;
      if (e.target.closest('[data-action="rm"]'))
        removeFavorite(Number(tr.dataset.index));
    });

    const collapse = $("#favFormCollapse");
    const toggleBtn = $("#favFormToggle");
    if (collapse && toggleBtn) {
      collapse.addEventListener(
        "show.bs.collapse",
        () => (toggleBtn.textContent = "Gizle")
      );
      collapse.addEventListener(
        "hide.bs.collapse",
        () => (toggleBtn.textContent = "Ekle")
      );
      toggleBtn.textContent = collapse.classList.contains("show")
        ? "Gizle"
        : "Ekle";
    }

    $("#logClear")?.addEventListener("click", () => Log.clear());
  }

  /* =========================
   *  Boot
   * ========================= */
  window.addEventListener("DOMContentLoaded", async () => {
    try {
      Log.attachUI();
      Log.info("Uygulama yüklendi");
      bindUI();

      const selEl = $("#symbolSelect");
      const defaultSym = storage.get(SYM_KEY, selEl?.value || "BTCUSDT");
      setSymbol(defaultSym);

      renderFavoritesTable();

      const autoSaved = storage.get(AUTO_KEY, false);
      setChecked("#auto", !!autoSaved);
      setAutoRefresh(!!autoSaved);
      updateAutoLabel();

      await refreshAll();
    } catch (e) {
      Log.error(e?.message || String(e));
    }
  });
})();
