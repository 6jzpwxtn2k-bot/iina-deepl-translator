"use strict";

// global.js - runs always (even without a video)
// Menu items for subtitle translation

const { menu, core, http, file, preferences, mpv } = iina;

// --- SRT Parser ---
function parseSRT(text) {
  const blocks = text.trim().replace(/\r\n/g, "\n").split(/\n\n+/);
  const entries = [];
  for (const block of blocks) {
    const lines = block.split("\n");
    if (lines.length < 3) continue;
    const index = lines[0].trim();
    const timing = lines[1].trim();
    const textLines = lines.slice(2).join("\n");
    entries.push({ index, timing, text: textLines });
  }
  return entries;
}

function buildSRT(entries) {
  return entries.map((e) => `${e.index}\n${e.timing}\n${e.text}`).join("\n\n") + "\n";
}

function stripTags(str) {
  return str.replace(/<[^>]*>/g, "");
}

// Get subtitle file path from mpv track list
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

// Translate with DeepL
async function translateTexts(texts, targetLang) {
  const apiKey = preferences.get("apiKey") || "f7ce594d-226f-4eea-b6d4-a6f137729e33:fx";
  const BATCH = 50;
  const translated = [];
  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const body = batch.map((t) => `text=${encodeURIComponent(t)}`).join("&")
      + `&target_lang=${targetLang}&source_lang=EN`;
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

async function doTranslate(targetLang, langLabel) {
  const trackPath = getSubtitlePath();
  if (!trackPath) {
    core.osd("No external subtitle loaded.");
    return;
  }
  core.osd(`Translating to ${langLabel}...`);
  try {
    const srtContent = file.read(trackPath);
    const entries = parseSRT(srtContent);
    if (!entries.length) { core.osd("Cannot parse subtitle."); return; }
    const texts = entries.map((e) => stripTags(e.text));
    const translated = await translateTexts(texts, targetLang);
    const newSRT = buildSRT(entries.map((e, i) => ({ ...e, text: translated[i] || e.text })));
    const outPath = `@tmp/translated_${targetLang.toLowerCase()}_${Date.now()}.srt`;
    file.write(outPath, newSRT);
    await core.subtitle.loadTrack(outPath);
    core.osd(`${langLabel} subtitle loaded!`);
  } catch (err) {
    core.osd("Error: " + err.message);
    console.error(err);
  }
}

// Register menu
const translateMenu = menu.item("Translate Subtitle");
translateMenu.addSubmenuItem(menu.item("Translate to Turkish (TR)", () => doTranslate("TR", "Turkish")));
translateMenu.addSubmenuItem(menu.item("Translate to Bulgarian (BG)", () => doTranslate("BG", "Bulgarian")));
menu.addItem(translateMenu);
