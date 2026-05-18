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
    var kind = /single\s+(pdf|document)\s+(?:document\s+)?consisting/i.test(text) ? "pack" : "course";

    var screens = [];
    var packDocs = [];

    if (kind === "pack") {
      /* Pack: every quoted path line after the command becomes a document. */
      for (var i = 0; i < lines.length; i++) {
        var ln = stripCurly(lines[i]);
        if (!ln) continue;
        if (/^["']?[^"'\n]+\.(docx?|pdf)["']?\s*$/i.test(ln) && /[\\/]/.test(ln)) {
          var raw = unquote(ln);
          packDocs.push({ raw: raw, src: deriveSrc(raw, courseId), basename: basename(raw) });
        }
      }
    } else {
      /* Course: tab-separated screen table. */
      for (var j = 0; j < lines.length; j++) {
        var line = lines[j];
        if (!line || line.indexOf("\t") === -1) continue;
        var cells = line.split("\t").map(function (c) { return c.trim(); }).filter(Boolean);
        if (cells.length < 3) continue;
        var typeKey = cells[0].toLowerCase().replace(/[^a-z]/g, "");
        if (typeKey === "screentype") continue;            // header row
        if (!SCREEN_TYPES[typeKey]) continue;              // not a screen row
        var type = SCREEN_TYPES[typeKey];
        var file = cells[cells.length - 1];
        var hours = Number(cells[1]);
        if (isNaN(hours)) hours = 0;
        var equipment = cells.length >= 5 ? cells[2] : "Flowcode / E-blocks3";
        var title = cells.length >= 5
          ? cells.slice(3, cells.length - 1).join(" ").trim()
          : cells.slice(2, cells.length - 1).join(" ").trim();
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
      if (!screens.length) warnings.push("No screen rows were detected. Check the definition uses a tab-separated table under “Please make me a browser-based course with the following screens:”.");
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

  /* Parse straight from a .docx File (browser) via mammoth.extractRawText.
     Falls back to convertToHtml→text if extractRawText is unavailable. */
  async function parseFile(file) {
    if (typeof mammoth === "undefined") throw new Error("mammoth.js is not loaded.");
    var arrayBuffer = await file.arrayBuffer();
    var raw;
    if (mammoth.extractRawText) {
      raw = (await mammoth.extractRawText({ arrayBuffer: arrayBuffer })).value || "";
    } else {
      var html = (await mammoth.convertToHtml({ arrayBuffer: arrayBuffer })).value || "";
      var doc = new DOMParser().parseFromString(html, "text/html");
      raw = (doc.body ? doc.body.textContent : html) || "";
    }
    var result = parseText(raw);
    result.sourceName = file.name;
    return result;
  }

  window.MatrixDefinition = { parseText: parseText, parseFile: parseFile };
})();
