// DeepL Ceviri Eklentisi - IINA
var _subtitle    = iina.subtitle;
var _http        = iina.http;
var _core        = iina.core;
var _file        = iina.file;
var _preferences = iina.preferences;
var _mpv         = iina.mpv;
var _console     = iina.console;

function getApiKey() {
  return _preferences.get("apiKey") || "";
}

// --- Aktif altyazi yolunu bul (her turlu track) ---
function getCurrentSubPath() {
  try {
    // Yontem 1: _core.subtitle.tracks uzerinden
    var tracks = _core.subtitle.tracks;
    if (tracks) {
      for (var i = 0; i < tracks.length; i++) {
        var t = tracks[i];
        _console.log("[DeepL] track[" + i + "]: id=" + t.id + " src=" + t.src + " isSelected=" + (t.id === _core.subtitle.id));
        if (t.src) return t.src; // secili olsun olmaSIN, src varsa al
      }
    }
    // Yontem 2: mpv track-list uzerinden TUM sub track'leri tara
    var count = parseInt(_mpv.getProperty("track-list/count")) || 0;
    _console.log("[DeepL] mpv track count: " + count);
    for (var j = 0; j < count; j++) {
      var type = _mpv.getProperty("track-list/" + j + "/type");
      if (type !== "sub") continue;
      var extFile = _mpv.getProperty("track-list/" + j + "/external-filename");
      var extSrc  = _mpv.getProperty("track-list/" + j + "/src");
      var extPath = extFile || extSrc;
      _console.log("[DeepL] sub track[" + j + "]: " + extPath);
      if (extPath) return extPath;
    }
  } catch(e) { _console.log("[DeepL] getCurrentSubPath err: " + e); }
  return null;
}

function parseSRT(text) {
  var blocks = text.trim().replace(/\r\n/g, "\n").split(/\n\n+/);
  var entries = [];
  for (var i = 0; i < blocks.length; i++) {
    var lines = blocks[i].split("\n");
    if (lines.length < 3) continue;
    entries.push({ index: lines[0].trim(), timing: lines[1].trim(), text: lines.slice(2).join("\n") });
  }
  return entries;
}

function buildSRT(entries) {
  return entries.map(function(e) {
    return e.index + "\n" + e.timing + "\n" + e.text;
  }).join("\n\n") + "\n";
}

function stripTags(str) {
  return str.replace(/<[^>]*>/g, "");
}

async function translateTexts(texts, targetLang, apiKey) {
  var BATCH = 50;
  var translated = [];
  for (var i = 0; i < texts.length; i += BATCH) {
    var batch = texts.slice(i, i + BATCH);
    var body = batch.map(function(t) {
      return "text=" + encodeURIComponent(t);
    }).join("&") + "&target_lang=" + targetLang;
    var res = await _http.post("https://api-free.deepl.com/v2/translate", {
      headers: {
        "Authorization": "DeepL-Auth-Key " + apiKey,
        "Content-Type": "application/x-www-form-urlencoded"
      },
      body: body
    });
    var data = JSON.parse(res.text);
    if (!data.translations) throw new Error("DeepL API: " + res.text);
    data.translations.forEach(function(t) { translated.push(t.text); });
  }
  return translated;
}

var _cachedPaths = {};

var DEEPL_LANGS = [
  { id: "deepl-tr", lang: "TR", label: "Turkce" },
  { id: "deepl-bg", lang: "BG", label: "Bulgarca" }
];

DEEPL_LANGS.forEach(function(p) {
  _subtitle.registerProvider(p.id, {

    search: async function(options) {
      _console.log("[DeepL] search() cagirildi: " + JSON.stringify(options));
      var apiKey = getApiKey();
      if (!apiKey) {
        _core.osd("[DeepL] API Key girilmemis! Plugin Preferences'i ac.");
        return [];
      }
      var subPath = getCurrentSubPath();
      _console.log("[DeepL] subPath sonuc: " + subPath);
      if (!subPath) {
        _core.osd("[DeepL] HATA: Onceden bir .srt/.ass altyazi yuklenmeli!");
        return [];
      }
      _core.osd("[DeepL] " + p.label + " cevirisi basliyor...");
      try {
        var srtContent = _file.read(subPath);
        if (!srtContent || !srtContent.length) {
          _core.osd("[DeepL] Altyazi dosyasi okunamadi: " + subPath);
          return [];
        }
        var entries = parseSRT(srtContent);
        if (!entries.length) {
          _core.osd("[DeepL] SRT parse hatasi, entries bos!");
          return [];
        }
        var texts = entries.map(function(e) { return stripTags(e.text); });
        var translated = await translateTexts(texts, p.lang, apiKey);
        var newSRT = buildSRT(entries.map(function(e, i) {
          return { index: e.index, timing: e.timing, text: translated[i] || e.text };
        }));
        var outPath = "@tmp/deepl_" + p.lang.toLowerCase() + "_" + Date.now() + ".srt";
        _file.write(outPath, newSRT);
        _cachedPaths[p.id] = outPath;
        _core.osd("[DeepL] " + p.label + " hazir - listeden secin!");
        return [{
          name: "[DeepL] " + p.label + " Cevirisi",
          data: { path: outPath }
        }];
      } catch(err) {
        _core.osd("[DeepL] HATA: " + err.message);
        _console.log("[DeepL] err: " + err);
        return [];
      }
    },

    description: function(item) {
      return { name: "[DeepL] " + p.label, left: p.label, right: "DeepL AI" };
    },

    download: async function(item) {
      var path = _cachedPaths[p.id];
      if (!path && item && item.data) path = item.data.path || item.data.url;
      if (!path) {
        _core.osd("[DeepL] Cache bos, tekrar ceviri yapiliyor...");
        await _subtitle.providers[p.id].search({});
        path = _cachedPaths[p.id];
      }
      if (!path) { _core.osd("[DeepL] Dosya olusturulamadi!"); return null; }
      await _core.subtitle.loadTrack(path);
      try {
        var tracks = _core.subtitle.tracks;
        if (tracks && tracks.length > 0) {
          _core.subtitle.secondId = tracks[tracks.length - 1].id;
          _core.osd("[DeepL] " + p.label + " 2. altyazi olarak yuklendi!");
        }
      } catch(e) { _console.log("secondId err: " + e); }
      return path;
    }
  });
});

_console.log("[DeepL] Plugin yuklu.");
