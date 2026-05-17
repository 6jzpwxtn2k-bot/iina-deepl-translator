// DeepL Ceviri Eklentisi - IINA
// Mevcut yuklu altyaziyi okur, DeepL ile cevirerek 2. track olarak yukler.
// Kullanim: Subtitles > Find Online Subtitles > DeepL secenegi

var _subtitle    = iina.subtitle;
var _http        = iina.http;
var _core        = iina.core;
var _file        = iina.file;
var _preferences = iina.preferences;
var _mpv         = iina.mpv;
var _console     = iina.console;

// --- API key ---
function getApiKey() {
  return _preferences.get("apiKey") || "";
}

// --- Aktif altyazinin dosya yolunu bul ---
function getCurrentSubPath() {
  try {
    var tracks = _core.subtitle.tracks;
    for (var i = 0; i < tracks.length; i++) {
      var t = tracks[i];
      if (t.id === _core.subtitle.id && t.src) {
        return t.src;
      }
    }
    // fallback: mpv property
    var count = parseInt(_mpv.getProperty("track-list/count")) || 0;
    for (var j = 0; j < count; j++) {
      if (_mpv.getProperty("track-list/" + j + "/type") !== "sub") continue;
      if (_mpv.getProperty("track-list/" + j + "/selected") !== "yes") continue;
      var p = _mpv.getProperty("track-list/" + j + "/external-filename");
      if (p) return p;
    }
  } catch(e) { _console.log("getCurrentSubPath err: " + e); }
  return null;
}

// --- SRT Parser ---
function parseSRT(text) {
  var blocks = text.trim().replace(/\r\n/g, "\n").split(/\n\n+/);
  var entries = [];
  for (var i = 0; i < blocks.length; i++) {
    var lines = blocks[i].split("\n");
    if (lines.length < 3) continue;
    entries.push({
      index:  lines[0].trim(),
      timing: lines[1].trim(),
      text:   lines.slice(2).join("\n")
    });
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

// --- DeepL API ---
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
    if (!data.translations) throw new Error("DeepL API hatasi: " + res.text);
    data.translations.forEach(function(t) { translated.push(t.text); });
  }
  return translated;
}

// --- Ana ceviri fonksiyonu ---
// search() cagirildiginda ceviriyi yapar, sonucu subtitle item olarak dondurur
async function doTranslate(targetLang, langLabel) {
  var apiKey = getApiKey();
  if (!apiKey) {
    _core.osd("DeepL: Preferences'a API key girin!");
    return [];
  }

  var subPath = getCurrentSubPath();
  if (!subPath) {
    _core.osd("DeepL: Once bir altyazi yukleyin (1. track)");
    return [];
  }

  _core.osd("DeepL: " + langLabel + " icin ceviri basliyor...");

  try {
    var srtContent = _file.read(subPath);
    var entries = parseSRT(srtContent);
    if (!entries.length) {
      _core.osd("DeepL: Altyazi okunamadi.");
      return [];
    }

    var texts = entries.map(function(e) { return stripTags(e.text); });
    var translated = await translateTexts(texts, targetLang, apiKey);

    var newSRT = buildSRT(entries.map(function(e, i) {
      return { index: e.index, timing: e.timing, text: translated[i] || e.text };
    }));

    var outPath = "@tmp/deepl_" + targetLang.toLowerCase() + "_" + Date.now() + ".srt";
    _file.write(outPath, newSRT);

    _core.osd("DeepL: " + langLabel + " cevirisi hazir!");

    // Tek bir item dondur - kullanici secince download() cagirilir
    return [_subtitle.item(outPath, {
      name: "[DeepL] " + langLabel,
      lang: langLabel,
      author: "DeepL"
    })];

  } catch(err) {
    _core.osd("DeepL Hata: " + err.message);
    _console.log("DeepL error: " + err);
    return [];
  }
}

// --- Provider kayitlari ---
var DEEPL_LANGS = [
  { id: "deepl-tr", lang: "TR", label: "Turkce" },
  { id: "deepl-bg", lang: "BG", label: "Bulgarca" }
];

DEEPL_LANGS.forEach(function(p) {
  _subtitle.registerProvider(p.id, {

    // search: ceviriyi yap, hazir dosyayi item olarak dondur
    search: function() {
      return doTranslate(p.lang, p.label);
    },

    // description: listede ne gozuksun
    description: function(item) {
      return {
        name: "[DeepL] " + p.label + " Cevirisi",
        left: p.label,
        right: "DeepL"
      };
    },

    // download: kullanici secti - 2. track olarak yukle
    download: function(item) {
      return new Promise(function(resolve, reject) {
        try {
          var path = item.data.url;
          // once normal yukle
          _core.subtitle.loadTrack(path).then(function() {
            // simdi 2. track olarak ata
            // az once yuklenen track en son eklenen olacak
            var tracks = _core.subtitle.tracks;
            var newTrack = tracks[tracks.length - 1];
            if (newTrack) {
              _core.subtitle.secondId = newTrack.id;
              _core.osd("DeepL: " + p.label + " 2. altyazi olarak yuklendi!");
            }
            resolve(path);
          }).catch(function(e) {
            // loadTrack basarisiz olursa sadece path dondur
            resolve(path);
          });
        } catch(e) {
          reject(e);
        }
      });
    }
  });
});

_console.log("DeepL Translator plugin yuklu.");
