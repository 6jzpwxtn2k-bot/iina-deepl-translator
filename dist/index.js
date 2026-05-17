"use strict";

// index.js - per-video context
// Handles sidebar UI and translation logic.

const { core, http, file, preferences, mpv, sidebar } = iina;

// --- Sidebar HTML ---
const SIDEBAR_HTML = `
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<style>
  * { box-sizing: border-box; margin: 0; padding: 0; }
  body {
    font-family: -apple-system, BlinkMacSystemFont, "Helvetica Neue", sans-serif;
    font-size: 13px;
    padding: 16px;
    background: transparent;
    color: #fff;
  }
  h3 { font-size: 13px; font-weight: 600; margin-bottom: 12px; opacity: 0.8; }
  .btn {
    display: block;
    width: 100%;
    padding: 8px 12px;
    margin-bottom: 8px;
    background: rgba(255,255,255,0.15);
    border: 1px solid rgba(255,255,255,0.2);
    border-radius: 6px;
    color: #fff;
    font-size: 13px;
    cursor: pointer;
    text-align: left;
  }
  .btn:hover { background: rgba(255,255,255,0.25); }
  .btn:active { background: rgba(255,255,255,0.1); }
  #status {
    margin-top: 12px;
    font-size: 11px;
    opacity: 0.6;
    min-height: 16px;
  }
</style>
</head>
<body>
  <h3>DeepL Translator</h3>
  <button class="btn" id="btn-tr" onclick="translate('TR')">Turkce'ye Cevir (TR)</button>
  <button class="btn" id="btn-bg" onclick="translate('BG')">Bulgarcaya Cevir (BG)</button>
  <div id="status">Hazir.</div>
  <script>
    function translate(lang) {
      document.getElementById('status').textContent = 'Ceviri basliyor...';
      iina.postMessage('translate', { lang: lang });
    }
    iina.onMessage('status', function(data) {
      document.getElementById('status').textContent = data.text;
    });
  <\/script>
</body>
</html>
`;

// --- SRT Parser ---
function parseSRT(text) {
  const blocks = text.trim().replace(/\r\n/g, "\n").split(/\n\n+/);
  const entries = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 3) continue;
    entries.push({
      index: lines[0].trim(),
      timing: lines[1].trim(),
      text: lines.slice(2).join("\n")
    });
  }
  return entries;
}

function buildSRT(entries) {
  return entries.map((e) => `${e.index}\n${e.timing}\n${e.text}`).join("\n\n") + "\n";
}

function stripTags(str) {
  return str.replace(/<[^>]*>/g, "");
}

// --- Get subtitle path ---
function getSubtitlePath() {
  try {
    const sid = mpv.getProperty("sid");
    if (!sid || sid === "no") return null;
    const count = parseInt(mpv.getProperty("track-list/count")) || 0;
    for (let i = 0; i < count; i++) {
      if (mpv.getProperty(`track-list/${i}/type`) !== "sub") continue;
      if (mpv.getProperty(`track-list/${i}/selected`) !== "yes") continue;
      const p = mpv.getProperty(`track-list/${i}/external-filename`);
      if (p) return p;
    }
  } catch (e) {
    console.error("getSubtitlePath:", e);
  }
  return null;
}

// --- DeepL API ---
async function translateTexts(texts, targetLang) {
  const apiKey = preferences.get("apiKey") || "f7ce594d-226f-4eea-b6d4-a6f137729e33:fx";
  const BATCH = 50;
  const translated = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const body = batch.map((t) => `text=${encodeURIComponent(t)}`).join("&")
      + `&target_lang=${targetLang}`;
    const res = await http.post("https://api-free.deepl.com/v2/translate", {
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const data = JSON.parse(res.text);
    if (!data.translations) throw new Error("DeepL: " + res.text);
    data.translations.forEach((t) => translated.push(t.text));
  }
  return translated;
}

// --- Main translate handler ---
async function doTranslate(targetLang, langLabel) {
  const trackPath = getSubtitlePath();
  if (!trackPath) {
    core.osd("Harici altyazi yuklenmemis.");
    sidebar.postMessage("status", { text: "Hata: Harici .srt altyazi yukle." });
    return;
  }
  core.osd(`${langLabel} icin ceviri basliyor...`);
  sidebar.postMessage("status", { text: `${langLabel} cevrilyor...` });
  try {
    const srtContent = file.read(trackPath);
    const entries = parseSRT(srtContent);
    if (!entries.length) {
      sidebar.postMessage("status", { text: "Altyazi dosyasi okunamadi." });
      return;
    }
    const texts = entries.map((e) => stripTags(e.text));
    const translated = await translateTexts(texts, targetLang);
    const newSRT = buildSRT(entries.map((e, i) => ({ ...e, text: translated[i] || e.text })));
    const outPath = `@tmp/translated_${targetLang.toLowerCase()}_${Date.now()}.srt`;
    file.write(outPath, newSRT);
    await core.subtitle.loadTrack(outPath);
    core.osd(`${langLabel} altyazi yuklendi!`);
    sidebar.postMessage("status", { text: `${langLabel} altyazi basariyla yuklendi!` });
  } catch (err) {
    core.osd("Hata: " + err.message);
    sidebar.postMessage("status", { text: "Hata: " + err.message });
    console.error(err);
  }
}

// --- Sidebar setup ---
sidebar.loadString(SIDEBAR_HTML);

sidebar.onMessage("translate", (data) => {
  if (data.lang === "TR") doTranslate("TR", "Turkce");
  else if (data.lang === "BG") doTranslate("BG", "Bulgarca");
});
