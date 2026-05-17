"use strict";

// global.js - global context
// Tüm çeviri mantığı ve menü kaydı burada.

const { core, http, file, preferences, mpv, menu } = iina;

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
      text: lines.slice(2).join("\n"),
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

// --- Aktif altyazı yolunu al ---
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
  const apiKey = preferences.get("apiKey") || "";
  if (!apiKey) {
    throw new Error("DeepL API anahtari ayarlanmamis. Lutfen eklenti tercihlerinden girin.");
  }
  const BATCH = 50;
  const translated = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const body =
      batch.map((t) => `text=${encodeURIComponent(t)}`).join("&") +
      `&target_lang=${targetLang}`;
    const res = await http.post("https://api-free.deepl.com/v2/translate", {
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body,
    });
    const data = JSON.parse(res.text);
    if (!data.translations) throw new Error("DeepL hatasi: " + res.text);
    data.translations.forEach((t) => translated.push(t.text));
  }
  return translated;
}

// --- Ana çeviri fonksiyonu ---
async function doTranslate(targetLang, langLabel) {
  const trackPath = getSubtitlePath();
  if (!trackPath) {
    core.osd("Hata: Once harici .srt altyazi yukle.");
    return;
  }
  core.osd(`${langLabel} icin ceviri basliyor...`);
  try {
    const srtContent = file.read(trackPath);
    const entries = parseSRT(srtContent);
    if (!entries.length) {
      core.osd("Hata: Altyazi dosyasi okunamadi.");
      return;
    }
    const texts = entries.map((e) => stripTags(e.text));
    const translated = await translateTexts(texts, targetLang);
    const newSRT = buildSRT(
      entries.map((e, i) => ({ ...e, text: translated[i] || e.text }))
    );
    const outPath = `@tmp/translated_${targetLang.toLowerCase()}_${Date.now()}.srt`;
    file.write(outPath, newSRT);
    await core.subtitle.loadTrack(outPath);
    core.osd(`${langLabel} altyazi basariyla yuklendi!`);
  } catch (err) {
    core.osd("Hata: " + err.message);
    console.error(err);
  }
}

// --- Menü kaydı ---
menu.addItem(
  menu.item("DeepL: Türkçeye Çevir (TR)", () => {
    doTranslate("TR", "Turkce");
  })
);

menu.addItem(
  menu.item("DeepL: Bulgarcaya Çevir (BG)", () => {
    doTranslate("BG", "Bulgarca");
  })
);
