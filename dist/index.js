"use strict";

const { core, menu, http, file, preferences } = iina;

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

async function translateTexts(texts, targetLang) {
  const apiKey = preferences.get("apiKey") || "f7ce594d-226f-4eea-b6d4-a6f137729e33:fx";
  const url = "https://api-free.deepl.com/v2/translate";
  const BATCH = 50;
  const translated = [];

  for (let i = 0; i < texts.length; i += BATCH) {
    const batch = texts.slice(i, i + BATCH);
    const params = batch.map((t) => `text=${encodeURIComponent(t)}`).join("&");
    const body = `${params}&target_lang=${targetLang}&source_lang=EN`;

    const res = await http.post(url, {
      headers: {
        Authorization: `DeepL-Auth-Key ${apiKey}`,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: body,
    });

    const data = JSON.parse(res.text);
    if (!data.translations) {
      throw new Error("DeepL API error: " + res.text);
    }
    for (const t of data.translations) {
      translated.push(t.text);
    }
  }
  return translated;
}

async function translateCurrentSubtitle(targetLang, langLabel) {
  const tracks = core.subtitle.tracks;
  if (!tracks || tracks.length === 0) {
    core.osd("No subtitle track loaded.");
    return;
  }

  const current = core.subtitle.currentTrack;
  if (!current) {
    core.osd("No active subtitle track.");
    return;
  }

  const trackPath = current.externalFilename;
  if (!trackPath) {
    core.osd("Cannot read embedded subtitles. Load an external .srt file first.");
    return;
  }

  core.osd(`Translating to ${langLabel}...`);

  try {
    const srtContent = file.read(trackPath);
    const entries = parseSRT(srtContent);

    if (entries.length === 0) {
      core.osd("Could not parse subtitle file.");
      return;
    }

    const texts = entries.map((e) => stripTags(e.text));
    const translated = await translateTexts(texts, targetLang);

    const newEntries = entries.map((e, i) => ({
      ...e,
      text: translated[i] || e.text,
    }));
    const newSRT = buildSRT(newEntries);

    const outPath = `@tmp/translated_${targetLang.toLowerCase()}.srt`;
    file.write(outPath, newSRT);

    await core.subtitle.loadTrack(outPath);
    core.osd(`${langLabel} subtitle loaded!`);
  } catch (err) {
    core.osd("Translation failed: " + err.message);
    console.error("DeepL translation error:", err);
  }
}

// Menu
const translateMenu = menu.item("Translate Subtitle");
const toTurkish = menu.item("Translate to Turkish (TR)", () => {
  translateCurrentSubtitle("TR", "Turkish");
});
const toBulgarian = menu.item("Translate to Bulgarian (BG)", () => {
  translateCurrentSubtitle("BG", "Bulgarian");
});

translateMenu.addSubmenuItem(toTurkish);
translateMenu.addSubmenuItem(toBulgarian);
menu.addItem(translateMenu);
