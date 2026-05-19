/* ============================================================================
 * definition-parser.js — Matrix Course Viewer
 *
 * Parses a "<id> - definition.docx" (the authoring manifest) into the data the
 * LMS needs. A definition document is an AI-instruction wrapper around a
 * tab-separated screen table:
 *
 *   <AI instruction>
 *   <Command>
 *   <filename> "CO0001- FC-EB CPD.pdf" </filename>
 *   "Please make me a browser-based course with the following screens:
 *   <TAB>Screen type<TAB>Hours<TAB>Equipment<TAB><TAB>Title<TAB><TAB><TAB><TAB>File
 *   Image<TAB><TAB>0<TAB>Flowcode / E-blocks3<TAB>Introduction…<TAB>"Folder\file.png"
 *   …
 *   When the client has gone through all screens … certificate …
 *   <filename> "…\CPDcert.docx" </filename>
 *   "
 *   </command>
 *   </AI instruction>
 *
 * Pack definitions use a different command:
 *   "Please make me a single PDF/Document consisting of the following documents:"
 * followed by a list of "path" lines.
 *
 * Output is wired straight into the courses.json `screens[]` schema:
 *   { id, type, title, hours, equipment, src }
 * with type ∈ image|html|youtube|pdf|powerpoint|document.
 * ==========================================================================*/
(function () {
  "use strict";

  var SCREEN_TYPES = {
    image: "image", html: "html", htm: "html", youtube: "youtube",
    pdf: "pdf", powerpoint: "powerpoint", document: "document"
  };
  var COURSE_CODE_RE = /\b(C[OP]\d{3,4})\b/i;

  function stripCurly(s) {
    return String(s == null ? "" : s)
      .replace(/[“”″"]/g, '"')
      .replace(/[‘’′']/g, "'")
      .replace(/[​-‏﻿]/g, "")
      .trim();
  }
  function unquote(s) {
    return stripCurly(s).replace(/^["']+|["']+\s*$/g, "").trim();
  }
  function isUrl(s) { return /^https?:\/\//i.test(String(s || "").trim()); }

  function basename(p) {
    return String(p || "").split(/[\\/]/).pop().trim();
  }
  function folderOf(p) {
    var parts = String(p || "").split(/[\\/]/);
    parts.pop();
    return parts.join("/").trim();
  }

  /* Map a definition file path to an LMS src.
     "CP4807 – Introduction to Microcontrollers\CP4807-1.docx"
       → content/CP4807/CP4807-1.docx
     A .doc basename is normalised to .docx (the splitter emits .docx). */
  function deriveSrc(rawFile, fallbackCourseId) {
    var clean = unquote(rawFile);
    if (isUrl(clean)) return clean;
    var folder = folderOf(clean);
    var file = basename(clean);
    if (/\.doc$/i.test(file)) file = file.replace(/\.doc$/i, ".docx");
    var m = folder.match(COURSE_CODE_RE) || clean.match(COURSE_CODE_RE);
    var dir = m ? m[1].toUpperCase() : (fallbackCourseId || "");
    return dir ? "content/" + dir + "/" + file : "content/" + file;
  }

  function slug(s) {
    return String(s || "").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");
  }

  /* Parse the raw text (tabs preserved — use mammoth.extractRawText). */
  function parseText(rawText) {
    var text = String(rawText || "");
    var lines = text.split(/\r?\n/);
    var warnings = [];

    /* Course id: prefer the document heading "CO0001 - Definition", else the
       first <filename> token, else the first course code anywhere. */
    var courseId = "";
    var headMatch = text.match(/^\s*([A-Z]{2}\d{3,4})\b[^\n]*definition/im);
    if (headMatch) courseId = headMatch[1].toUpperCase();
    var fnMatches = [];
    var fnRe = /<filename>\s*([^<]+?)\s*<\/filename>/gi, fm;
    while ((fm = fnRe.exec(text)) !== null) fnMatches.push(unquote(fm[1]));
    if (!courseId && fnMatches.length) {
      var cm = fnMatches[0].match(COURSE_CODE_RE);
      if (cm) courseId = cm[1].toUpperCase();
    }
    if (!courseId) {
      var any = text.match(COURSE_CODE_RE);
      if (any) courseId = any[1].toUpperCase();
    }

    var courseFilename = fnMatches.length ? fnMatches[0] : "";

    /* Intent sentence + kind. */
    var intent = "";
    var intentMatch = text.match(/Please make me ([^\n]+)/i);
    if (intentMatch) intent = stripCurly(intentMatch[0]).replace(/[":]+\s*$/, "");
    var hasDefnCommand = /browser-based course|consisting of the following/i.test(text);
    var kind = /single\s+(pdf|docx?|document)\s+(?:document\s+)?consisting/i.test(text) ? "pack" : "course";

    /* A *content* doc (splitter source) has <worksheet>/<document> blocks
       and <filename> tags but none of the definition commands. People drop
       these into the Definition tab by mistake — detect it so we can say
       exactly what's wrong instead of "no screen rows". */
    var looksLikeContentDoc =
      !hasDefnCommand &&
      (/<\s*(worksheet|document)\b/i.test(text) || /<\/filename>/i.test(text));

    var screens = [];
    var packDocs = [];

    if (kind === "pack") {
      /* Pack docs are the quoted filenames listed AFTER the
         "…consisting of the following documents:" command, up to the end
         of that command / AI-instruction block. Entries are bare or
         pathed filenames ending .doc/.docx/.pdf — e.g. "CP4807-head.docx"
         (NO path). Tab-separated screen-table rows and unrelated path/URL
         lines (e.g. the CP9645 datasheet) are NOT entries. */
      var DOC_RE = /^["'“”]?\s*([^"'“”\t]+?\.(?:docx?|pdf))\s*["'“”]?\s*$/i;
      var startIdx = -1;
      for (var s = 0; s < lines.length; s++) {
        if (/consisting of the following documents/i.test(lines[s])) { startIdx = s; break; }
      }
      var scan = function (from) {
        for (var i = from; i < lines.length; i++) {
          var ln = stripCurly(lines[i]);
          if (!ln) continue;
          if (/<\/?\s*(command|ai\s*instruction)\s*>/i.test(ln)) break;     /* block end */
          if (/^<\s*(command|filename|ai\s*instruction)\b/i.test(ln)) break; /* next block */
          if (/please make me|consisting of the following/i.test(ln)) break;/* next command */
          if (/^when\b/i.test(ln)) break;                                   /* trailing prose */
          if (/^["'“”]\s*$/.test(ln)) continue;                             /* lone closing quote */
          if (ln.indexOf("\t") !== -1) continue;                            /* screen-table row */
          var m = ln.match(DOC_RE);
          if (!m) continue;
          var raw = unquote(m[1]);
          if (raw) packDocs.push({ raw: raw, src: deriveSrc(raw, courseId), basename: basename(raw) });
        }
      };
      if (startIdx !== -1) scan(startIdx + 1);
      /* Fallback for an unexpected layout: whole-file scan, still without a
         path requirement and still skipping tab rows / command lines. */
      if (!packDocs.length) {
        for (var k = 0; k < lines.length; k++) {
          var l2 = stripCurly(lines[k]);
          if (!l2 || l2.indexOf("\t") !== -1) continue;
          if (/please make me|consisting of the following/i.test(l2)) continue;
          var mm = l2.match(DOC_RE);
          if (mm) {
            var rn = unquote(mm[1]);
            if (rn) packDocs.push({ raw: rn, src: deriveSrc(rn, courseId), basename: basename(rn) });
          }
        }
      }
    } else {
      /* Course: one screen per line. Anchor-based parse so it works
         whether the .docx tabs survive (Node mammoth) or get collapsed
         to spaces (browser mammoth):

           <Type> <Hours> <Equipment> <Title> <File-or-URL>

         - Type: a leading keyword (Image/HTML/YouTube/PDF/Powerpoint/
           Document/Spreadsheet), case-insensitive.
         - File: the trailing quoted "…path…" OR a trailing http(s) URL.
         - Hours: the first number after the type.
         - Equipment: the fixed "Flowcode / E-blocks3" string if present
           (used as the title pivot); otherwise inferred.
         - Title: whatever sits between hours/equipment and the file. */
      var TYPE_RE = /^\s*(Image|HTML|YouTube|PDF|Powerpoint|PowerPoint|Document|Spreadsheet)\b/i;
      for (var j = 0; j < lines.length; j++) {
        var line = stripCurly(lines[j]);
        if (!line) continue;
        var tmatch = line.match(TYPE_RE);
        if (!tmatch) continue;
        var typeKey = tmatch[1].toLowerCase().replace(/[^a-z]/g, "");
        if (!SCREEN_TYPES[typeKey]) continue;
        var type = SCREEN_TYPES[typeKey];

        /* rest = everything after the type keyword */
        var rest = line.slice(tmatch[0].length).replace(/\t/g, " ").replace(/\s{2,}/g, " ").trim();

        /* File ref: trailing quoted path or trailing URL. */
        var file = "";
        var urlM = rest.match(/(https?:\/\/\S+)\s*$/i);
        var quoteM = rest.match(/"([^"]+)"\s*$/);
        if (quoteM) {
          file = quoteM[1].trim();
          rest = rest.slice(0, quoteM.index).trim();
        } else if (urlM) {
          file = urlM[1].trim();
          rest = rest.slice(0, urlM.index).trim();
        } else {
          /* last whitespace-token that looks like a path/file */
          var tail = rest.match(/(\S+\.(?:docx?|html?|htm|pdf|pptx?|xlsx?|png|jpe?g|svg|gif))\s*$/i);
          if (tail) { file = tail[1].trim(); rest = rest.slice(0, tail.index).trim(); }
        }

        /* Hours: first number in the remaining text. */
        var hM = rest.match(/(\d+(?:\.\d+)?)/);
        var hours = hM ? Number(hM[1]) : 0;
        if (isNaN(hours)) hours = 0;

        /* Equipment pivot + title. */
        var equipment = "Flowcode / E-blocks3";
        var title = "";
        var eqIdx = rest.indexOf("Flowcode / E-blocks");
        if (eqIdx !== -1) {
          var afterEq = rest.slice(eqIdx).replace(/^Flowcode \/ E-blocks\s*3?/i, "").trim();
          title = afterEq;
        } else if (hM) {
          title = rest.slice((hM.index || 0) + hM[1].length).trim();
        } else {
          title = rest.trim();
        }
        title = title.replace(/^[\s\-–·|]+/, "").trim();
        if (!title) title = basename(unquote(file)).replace(/\.[a-z0-9]+$/i, "");

        var src = deriveSrc(file, courseId);
        var n = screens.length + 1;
        screens.push({
          id: (slug(courseId) || "screen") + "-s" + n,
          type: type,
          title: stripCurly(title),
          hours: hours,
          equipment: stripCurly(equipment),
          src: src,
          file: { raw: unquote(file), folder: folderOf(unquote(file)), basename: basename(unquote(file)), isUrl: isUrl(unquote(file)) }
        });
      }
      if (!screens.length) {
        warnings.push(looksLikeContentDoc
          ? "This looks like a course CONTENT document (splitter source — it contains <worksheet>/<filename> tags), not a definition. Use the Splitter tab for this file. The Definition tab expects a “…- definition.docx” that lists screens, or a pack’s document list."
          : "No screen rows were detected. The definition should list one screen per line starting with a type (Image / HTML / YouTube / PDF / Powerpoint / Document) under “Please make me a browser-based course with the following screens:”.");
      }
    }
    if (kind === "pack" && !packDocs.length) {
      warnings.push(looksLikeContentDoc
        ? "This looks like a course CONTENT document (splitter source), not a definition. Use the Splitter tab for this file."
        : "A pack command was found but no document list could be read after “…consisting of the following documents:”.");
    }

    /* Certificate: a <filename> near the word "certificate". */
    var certificate = null;
    var certMatch = text.match(/certificate[^<]*<filename>\s*([^<]+?)\s*<\/filename>/i);
    if (certMatch) {
      var craw = unquote(certMatch[1]);
      certificate = { enabled: true, file: craw, src: deriveSrc(craw, courseId) };
    }

    return {
      courseId: courseId,
      courseFilename: courseFilename,
      kind: kind,
      intent: intent,
      screens: screens,
      packDocs: packDocs,
      certificate: certificate,
      warnings: warnings,
      screensJson: JSON.stringify(
        screens.map(function (s) { return { id: s.id, type: s.type, title: s.title, hours: s.hours, equipment: s.equipment, src: s.src }; }),
        null, 2
      ),
      structureText: buildStructureText({
        courseId: courseId, courseFilename: courseFilename, kind: kind,
        intent: intent, screens: screens, packDocs: packDocs, certificate: certificate
      })
    };
  }

  /* Human-readable structure summary for the Tools "structure" text field. */
  function buildStructureText(d) {
    var L = [];
    L.push("Course: " + (d.courseId || "(unknown id)"));
    if (d.courseFilename) L.push("Definition output: " + d.courseFilename);
    L.push("Kind: " + d.kind);
    if (d.intent) L.push(d.intent);
    L.push("");
    if (d.kind === "pack") {
      L.push(d.packDocs.length + " document(s) in this pack:");
      d.packDocs.forEach(function (p, i) { L.push("  " + (i + 1) + ". " + p.basename + "   → " + p.src); });
    } else {
      L.push(d.screens.length + " screen(s):");
      var totalH = 0;
      d.screens.forEach(function (s, i) {
        totalH += Number(s.hours) || 0;
        var t = s.hours ? (s.hours === 1 ? "1 hour" : s.hours + " hours") : "—";
        L.push(
          "  " + String(i + 1).padStart(2, "0") + ". [" + s.type.toUpperCase() + "] " +
          s.title + "   Time: " + t + "   Asset: " + s.src
        );
      });
      L.push("");
      L.push("Total time: " + (Number.isInteger(totalH) ? totalH : totalH.toFixed(1)) + " hours across " + d.screens.length + " screens");
    }
    if (d.certificate) L.push("\nCertificate on 100%: " + d.certificate.file + "  → " + d.certificate.src);
    return L.join("\n");
  }

  /* Convert a mammoth HTML rendering into the tab-separated text the
     parser expects. Word tables become <table><tr><td> — we join each
     row's cells with TAB and each row with newline so parseText()'s
     tab logic works. Non-table content (the <AI instruction> wrapper,
     <filename> tokens, pack document lists) is emitted line-by-line
     from block elements so it's still scannable.

     This is the robust path: mammoth's browser build does NOT preserve
     tab characters when flattening Word tables via extractRawText, so
     the old raw-text approach found zero screen rows. */
  function htmlToTabText(html) {
    var doc = new DOMParser().parseFromString(html, "text/html");
    var out = [];
    var body = doc.body || doc.documentElement;

    function walk(node) {
      for (var i = 0; i < node.children.length; i++) {
        var el = node.children[i];
        var tag = el.tagName.toLowerCase();
        if (tag === "table") {
          var rows = el.querySelectorAll("tr");
          for (var r = 0; r < rows.length; r++) {
            var cells = rows[r].querySelectorAll("th, td");
            var vals = [];
            for (var c = 0; c < cells.length; c++) {
              vals.push((cells[c].textContent || "").replace(/\s+/g, " ").trim());
            }
            out.push(vals.join("\t"));
          }
        } else if (tag === "ul" || tag === "ol") {
          var lis = el.querySelectorAll("li");
          for (var k = 0; k < lis.length; k++) out.push((lis[k].textContent || "").trim());
        } else if (el.children.length && (tag === "div" || tag === "section")) {
          walk(el);
        } else {
          var txt = (el.textContent || "").trim();
          if (txt) out.push(txt);
        }
      }
    }
    walk(body);
    return out.join("\n");
  }

  /* Parse straight from a .docx File (browser).
     Strategy: get BOTH the HTML (preserves table structure) and the raw
     text (preserves the AI-instruction prose / pack lists), parse each,
     and keep whichever yields screens/packDocs. HTML-table parsing is
     tried first because the screen table is a real Word table. */
  async function parseFile(file) {
    if (typeof mammoth === "undefined") throw new Error("mammoth.js is not loaded.");
    var arrayBuffer = await file.arrayBuffer();

    var html = "";
    try { html = (await mammoth.convertToHtml({ arrayBuffer: arrayBuffer })).value || ""; }
    catch (_) { html = ""; }

    var rawText = "";
    if (mammoth.extractRawText) {
      try { rawText = (await mammoth.extractRawText({ arrayBuffer: arrayBuffer })).value || ""; }
      catch (_) { rawText = ""; }
    }
    if (!rawText && html) {
      var d = new DOMParser().parseFromString(html, "text/html");
      rawText = (d.body ? d.body.textContent : html) || "";
    }

    /* Primary attempt: tab-text reconstructed from the HTML tables. */
    var fromHtml = html ? parseText(htmlToTabText(html)) : null;
    /* Secondary: the raw text (covers pack docs whose list is prose). */
    var fromRaw = rawText ? parseText(rawText) : null;

    var result;
    if (fromHtml && (fromHtml.screens.length || fromHtml.packDocs.length)) {
      result = fromHtml;
    } else if (fromRaw && (fromRaw.screens.length || fromRaw.packDocs.length)) {
      result = fromRaw;
    } else {
      /* Neither found rows — return the HTML attempt (carries warnings)
         but borrow the raw text's id/kind/intent if richer. */
      result = fromHtml || fromRaw || parseText("");
      if (fromRaw && !result.courseId && fromRaw.courseId) result.courseId = fromRaw.courseId;
    }
    result.sourceName = file.name;
    return result;
  }

  window.MatrixDefinition = { parseText: parseText, parseFile: parseFile };
})();
