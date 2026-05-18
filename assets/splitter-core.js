/* ============================================================================
 * splitter-core.js — Matrix Course Viewer in-browser document splitter
 *
 * Faithful port of doc_splitter/document-splitter/upload-media.js. Every
 * parse / analyze / build / utility function below is byte-identical to the
 * original tool; only the DOM-bound shell (element refs, event listeners,
 * render* functions) has been replaced with the clean `window.MatrixSplitter`
 * API at the foot of this file. Do not "improve" the algorithm — it produces
 * Word documents and SCORM packages that must stay bit-compatible with the
 * standalone splitter.
 * ==========================================================================*/
(function () {
  "use strict";

// ─── Source file state ─────────────────────────────────────────────────────
let currentSourceFile = "";
let currentSourceBuffer = null;   // raw bytes of the uploaded DOCX
let currentSourceText = "";
let currentAnalysis = null;
let currentParagraphs = [];       // [{index, textContent, xmlNode, isTable}]
let currentDocxZip = null;        // JSZip of the loaded source DOCX
let currentRels = new Map();      // rId → {type, target, mode}
let currentStylesXml = null;
let currentNumberingXml = null;
let currentThemeXml = null;
let currentDocXml = null;         // raw string of word/document.xml

// ─── Media state ───────────────────────────────────────────────────────────
let currentMediaZipName = "";
let currentMediaZipBuffer = null; // raw bytes of the uploaded media ZIP
let currentMediaBundle = [];
let currentMediaIndex = new Map();
let currentMediaDuplicateNames = new Set();
let currentEmbeddedMedia = [];
let currentEmbeddedMediaIndex = new Map();

// ─── Output state ──────────────────────────────────────────────────────────
let generatedArtefacts = [];
let activeObjectUrls = [];
let hasBuilt = false;

// ─── Constants ─────────────────────────────────────────────────────────────
const PACKAGE_RELS_XML = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="word/document.xml"/>
</Relationships>`;

const TAG_PATTERNS = [
  { label: "HTML",      open: /<HTML>/gi,      close: /<\/HTML>/gi },
  { label: "worksheet", open: /<worksheet>/gi, close: /<\/worksheet>/gi },
  { label: "document",  open: /<document>/gi,  close: /<\/document>/gi }
];

const MEDIA_PATTERN = /<(image|video|audio|datasheet|slides|resource)>\s*([^<>\n]+?)\s*<\/\1>/gi;

// ─── Source loader (DOM-free; returns the analysis object) ─────────────────
async function loadSourceFile(file) {
  resetSourceState();
  currentSourceFile = file.name;

  if (!file.name.toLowerCase().endsWith(".docx")) {
    throw new Error("Please upload a Word .docx file. The splitter does not parse .doc or PDF files.");
  }

  const buffer = await file.arrayBuffer();
  currentSourceBuffer = new Uint8Array(buffer);
  const zip = await JSZip.loadAsync(buffer);
  if (!zip.file("word/document.xml")) {
    throw new Error("The uploaded .docx could not be read as a standard Word document.");
  }

  await extractEmbeddedMediaFromDocx(zip);
  await parseDocxStructure(zip);
  currentSourceText = await extractReadableTextFromDocx(zip);

  currentAnalysis = applyMediaStateToAnalysis(analyzeText(currentParagraphs));
  return currentAnalysis;
}

// ─── Media ZIP handler ─────────────────────────────────────────────────────
async function handleMediaFile(file) {
  if (!file.name.toLowerCase().endsWith(".zip")) {
    renderMediaError("Please upload a .zip file for the companion media folder.");
    return;
  }

  revokeObjectUrls();
  generatedArtefacts = [];
  generatedPanel.hidden = true;
  currentMediaZipName = file.name;
  mediaMeta.innerHTML = `
    <span><strong>Media ZIP:</strong> ${escapeHtml(file.name)}</span>
    <span><strong>Size:</strong> ${Math.max(1, Math.round(file.size / 1024))} KB</span>
    <span><strong>Last modified:</strong> ${new Date(file.lastModified).toLocaleString()}</span>
  `;

  try {
    const buffer = await file.arrayBuffer();
    currentMediaZipBuffer = new Uint8Array(buffer);
    const zip = await JSZip.loadAsync(buffer);
    const mediaFiles = [];

    await Promise.all(Object.values(zip.files).map(async (entry) => {
      if (entry.dir || entry.name.startsWith("__MACOSX/")) return;
      const exportName = basenameOnly(entry.name);
      if (!exportName) return;
      const data = await entry.async("uint8array");
      const mime = getMimeType(exportName);
      const blob = new Blob([data], { type: mime });
      const url = createObjectUrl(blob);
      const dataUrl = await blobToDataUrl(blob);
      mediaFiles.push({ path: entry.name, exportName, key: normalizeMediaName(exportName), size: data.byteLength, mime, data, url, dataUrl });
    }));

    currentMediaBundle = mediaFiles.sort((a, b) => a.exportName.localeCompare(b.exportName));
    const indexed = buildMediaIndex(currentMediaBundle);
    currentMediaIndex = indexed.index;
    currentMediaDuplicateNames = indexed.duplicates;

    // Pre-patch the source XML: rewrite r:link → r:embed for all resolvable
    // external images so every block output inherits clean embedded references.
    patchSourceXmlForEmbeddedImages();

    if (currentAnalysis) {
      currentAnalysis = applyMediaStateToAnalysis(currentAnalysis);
      renderAnalysis(currentSourceText, currentAnalysis);
      showBuildCta();
      if (hasBuilt) {
        generatedArtefacts = await buildArtefacts(currentAnalysis.blocks);
        renderGeneratedOutputs(generatedArtefacts);
        renderAnalysisReport(currentAnalysis, dedupeWarnings([...currentAnalysis.warnings, ...currentAnalysis.media.warnings]));
      } else {
        generatedArtefacts = [];
      }
    } else {
      renderMediaPanel(null);
    }
  } catch (error) {
    console.error(error);
    renderMediaError("The media ZIP could not be read. Try compressing the folder again and re-uploading it.");
  }
}

// ─── Extract embedded media from DOCX ─────────────────────────────────────
async function extractEmbeddedMediaFromDocx(zip) {
  currentEmbeddedMedia = [];
  currentEmbeddedMediaIndex = new Map();
  const mediaEntries = Object.values(zip.files).filter(
    (entry) => !entry.dir && /^word\/media\//i.test(entry.name)
  );
  for (const entry of mediaEntries) {
    const exportName = basenameOnly(entry.name);
    if (!exportName) continue;
    const data = await entry.async("uint8array");
    const mime = getMimeType(exportName);
    const blob = new Blob([data], { type: mime });
    const url = createObjectUrl(blob);
    const dataUrl = await blobToDataUrl(blob);
    const item = { path: entry.name, exportName, key: normalizeMediaName(exportName), size: data.byteLength, mime, data, url, dataUrl };
    currentEmbeddedMedia.push(item);
    currentEmbeddedMediaIndex.set(item.key, item);
  }
}

// ─── Pre-patch: embed external images into source XML at media-load time ────

// Called once after currentMediaIndex is populated.  For every External image
// relationship in currentRels that can be matched in the media ZIP or embedded
// media, this function:
//   1. Replaces r:link="rId" → r:embed="rId" directly in currentDocXml
//   2. Marks the relationship as Internal and attaches the resolved file
//   3. Rebuilds paragraph xmlNode references from the patched XML
//
// After this runs, buildBlockDocumentXml gets clean nodes with r:embed already
// present, and buildBlockRels finds _resolvedFile on the relationship so it
// knows which bytes to copy into word/media/.
function patchSourceXmlForEmbeddedImages() {
  if (!currentDocXml || !currentRels.size) return;
  let patched = currentDocXml;
  let count = 0;

  for (const [rId, rel] of currentRels) {
    if (rel.mode !== "External" || !rel.type.includes("/image")) continue;
    const rawFileName = rel.target.split(/[\\/]/).pop();
    const fileName = (() => { try { return decodeURIComponent(rawFileName); } catch (_) { return rawFileName; } })();
    const key = normalizeMediaName(fileName);
    const resolved = currentMediaIndex.get(key) || currentEmbeddedMediaIndex.get(key);
    if (!resolved) {
      console.warn(`[DOCX-IMG] pre-patch: no match for "${fileName}" (rId=${rId})`);
      continue;
    }
    const escapedId = escapeXml(rId);
    const safeId = escapedId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const before = patched;
    patched = patched.replace(new RegExp(`(\\w[\\w-]*):link="${safeId}"`, "g"), `$1:embed="${escapedId}"`);
    if (patched !== before) {
      currentRels.set(rId, { ...rel, mode: "Internal", target: `media/${resolved.exportName}`, _resolvedFile: resolved });
      count++;
      console.log(`[DOCX-IMG] pre-patched ${rId} → ${resolved.exportName}`);
    } else {
      console.warn(`[DOCX-IMG] pre-patch: r:link="${rId}" not found in source XML — swap skipped`);
    }
  }

  if (count > 0) {
    currentDocXml = patched;
    reparseParagraphNodes();
    console.log(`[DOCX-IMG] source XML patched: ${count} external image(s) promoted to r:embed`);
  }
}

// Rebuild xmlNode references in currentParagraphs from the current (possibly
// patched) currentDocXml.  Index positions are preserved — only the DOM node
// objects are refreshed so they reflect the new attribute values.
function reparseParagraphNodes() {
  const bodyDoc = new DOMParser().parseFromString(currentDocXml, "application/xml");
  const bodyEl = bodyDoc.getElementsByTagNameNS("*", "body")[0];
  if (!bodyEl) return;
  let i = 0;
  for (const child of bodyEl.childNodes) {
    if (child.nodeType !== 1) continue;
    const ln = child.localName;
    if (ln === "p" || ln === "tbl") {
      if (currentParagraphs[i]) currentParagraphs[i].xmlNode = child;
      i++;
    } else if (ln === "sdt") {
      const content = child.getElementsByTagNameNS("*", "sdtContent")[0];
      if (content) {
        for (const sdtChild of content.childNodes) {
          if (sdtChild.nodeType !== 1) continue;
          if (sdtChild.localName === "p" || sdtChild.localName === "tbl") {
            if (currentParagraphs[i]) currentParagraphs[i].xmlNode = sdtChild;
            i++;
          }
        }
      }
    }
  }
}

// ─── Parse DOCX structure (XML paragraph nodes + relationships + styles) ───
async function parseDocxStructure(zip) {
  currentDocxZip = zip;
  currentParagraphs = [];
  currentRels = new Map();
  currentStylesXml = null;
  currentNumberingXml = null;
  currentThemeXml = null;
  currentDocXml = null;

  // Parse relationships
  const relsXmlStr = await zip.file("word/_rels/document.xml.rels")?.async("string");
  if (relsXmlStr) {
    const relsDoc = new DOMParser().parseFromString(relsXmlStr, "application/xml");
    for (const rel of relsDoc.getElementsByTagName("Relationship")) {
      const id = rel.getAttribute("Id");
      if (!id) continue;
      currentRels.set(id, {
        type: rel.getAttribute("Type") || "",
        target: rel.getAttribute("Target") || "",
        mode: rel.getAttribute("TargetMode") || "Internal"
      });
    }
  }

  // Store structural XML (copied wholesale into mini-DOCXes)
  currentStylesXml    = await zip.file("word/styles.xml")?.async("string")        || null;
  currentNumberingXml = await zip.file("word/numbering.xml")?.async("string")     || null;
  currentThemeXml     = await zip.file("word/theme/theme1.xml")?.async("string")  || null;

  // Parse body paragraphs
  currentDocXml = await zip.file("word/document.xml")?.async("string");
  if (!currentDocXml) return;

  const bodyDoc = new DOMParser().parseFromString(currentDocXml, "application/xml");
  const bodyEl  = bodyDoc.getElementsByTagNameNS("*", "body")[0];
  if (!bodyEl) return;

  let index = 0;
  for (const child of bodyEl.childNodes) {
    if (child.nodeType !== 1) continue;
    const ln = child.localName;
    if (ln === "p" || ln === "tbl") {
      currentParagraphs.push({
        index: index++,
        textContent: extractNodeText(child),
        xmlNode: child,
        isTable: ln === "tbl"
      });
    } else if (ln === "sdt") {
      // Unwrap structured document tags
      const content = child.getElementsByTagNameNS("*", "sdtContent")[0];
      if (content) {
        for (const sdtChild of content.childNodes) {
          if (sdtChild.nodeType !== 1) continue;
          const sln = sdtChild.localName;
          if (sln === "p" || sln === "tbl") {
            currentParagraphs.push({
              index: index++,
              textContent: extractNodeText(sdtChild),
              xmlNode: sdtChild,
              isTable: sln === "tbl"
            });
          }
        }
      }
    }
    // sectPr, bookmarkStart/End, proofErr etc. are ignored
  }
}

function extractNodeText(node) {
  const tNodes = node.getElementsByTagNameNS("*", "t");
  let text = "";
  for (const t of tNodes) text += t.textContent || "";
  return text.replace(/ /g, " ").trim();
}

// ─── Plain text extraction (for preview panel) ─────────────────────────────
async function extractReadableTextFromDocx(zip) {
  const xmlEntries = Object.keys(zip.files)
    .filter((name) => /^word\/(document|header\d+|footer\d+|footnotes|endnotes)\.xml$/i.test(name))
    .sort((a, b) => a.localeCompare(b));

  const parts = [];
  for (const entryName of xmlEntries) {
    const xmlString = await zip.file(entryName)?.async("string");
    if (!xmlString) continue;
    const extracted = extractReadableText(xmlString);
    if (extracted) parts.push(extracted);
  }
  return parts.join("\n\n").replace(/\n{3,}/g, "\n\n").trim();
}

function extractReadableText(xmlString) {
  const parser = new DOMParser();
  const xml = parser.parseFromString(xmlString, "application/xml");
  const paragraphs = [];
  const nodes = xml.getElementsByTagNameNS("*", "p");
  for (const paragraph of nodes) {
    const textNodes = paragraph.getElementsByTagNameNS("*", "t");
    let line = "";
    for (const node of textNodes) line += node.textContent || "";
    const tabNodes = paragraph.getElementsByTagNameNS("*", "tab");
    for (const node of tabNodes) line += node.textContent || " ";
    line = line.replace(/ /g, " ").trim();
    if (line) paragraphs.push(line);
  }
  return paragraphs.join("\n");
}

// ─── Block analysis (operates on paragraph objects) ────────────────────────
function analyzeText(paragraphs) {
  // Build joined text from paragraphs for SCORM/classification analysis and token scanning
  const text = paragraphs.map((p) => p.textContent).join("\n");

  // Build character-offset → paragraph-index mapping
  const paraOffsets = [];
  let off = 0;
  for (const p of paragraphs) {
    paraOffsets.push(off);
    off += p.textContent.length + 1; // +1 for the \n separator
  }
  const charToParaIndex = (charPos) => {
    let lo = 0, hi = paraOffsets.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (paraOffsets[mid] <= charPos) lo = mid; else hi = mid - 1;
    }
    return lo;
  };

  const warnings = [];
  const blocks = [];
  const duplicateMap = new Map();
  const tokenPattern = /<filename>\s*\"?([^\"<>\n]+)\"?\s*<\/filename>|<(HTML|worksheet|document)>|<\/(HTML|worksheet|document)>/gi;
  let currentBlock = null;
  let lastIndex = 0;
  let match;
  let sawTagToken = false;

  while ((match = tokenPattern.exec(text)) !== null) {
    const tokenIndex = match.index ?? 0;
    const paraIndex  = charToParaIndex(tokenIndex);
    const between    = text.slice(lastIndex, tokenIndex);
    if (currentBlock && between) currentBlock.bodyParts.push(between);

    const filenameValue = match[1];
    const openTag       = match[2];
    const closeTag      = match[3];
    const lineNumber    = lineNumberAt(text, tokenIndex);

    if (filenameValue) {
      sawTagToken = true;
      if (!currentBlock) {
        warnings.push({ level: "warn", title: "Filename found outside a block", detail: `${sanitizeFilenameValue(filenameValue)} appears at line ${lineNumber} but is not inside <HTML>, <worksheet>, or <document>.` });
      } else if (!currentBlock.filename) {
        currentBlock.filename = sanitizeFilenameValue(filenameValue);
      }
    } else if (openTag) {
      sawTagToken = true;
      if (currentBlock) {
        warnings.push({ level: "danger", title: `Nested or interrupted ${currentBlock.tagType} block`, detail: `A new <${openTag}> tag was found at line ${lineNumber} before <${currentBlock.tagType}> was closed${currentBlock.filename ? ` for ${currentBlock.filename}` : ""}.` });
        finalizeBlock(currentBlock, blocks, warnings, duplicateMap, paragraphs);
      }
      currentBlock = { tagType: openTag, filename: "", bodyParts: [], rawOpenIndex: tokenIndex, startLine: lineNumber, openParaIndex: paraIndex, closeParaIndex: paragraphs.length - 1 };
    } else if (closeTag) {
      sawTagToken = true;
      if (!currentBlock) {
        warnings.push({ level: "warn", title: `Extra closing ${closeTag} tag`, detail: `A closing </${closeTag}> tag was found at line ${lineNumber} with no matching opening tag.` });
      } else if (currentBlock.tagType.toLowerCase() !== closeTag.toLowerCase()) {
        warnings.push({ level: "danger", title: "Mismatched closing tag", detail: `Line ${lineNumber} closes </${closeTag}> while the open block is <${currentBlock.tagType}>${currentBlock.filename ? ` for ${currentBlock.filename}` : ""}.` });
        finalizeBlock(currentBlock, blocks, warnings, duplicateMap, paragraphs);
        currentBlock = null;
      } else {
        currentBlock.endLine = lineNumber;
        currentBlock.closeParaIndex = paraIndex;
        finalizeBlock(currentBlock, blocks, warnings, duplicateMap, paragraphs);
        currentBlock = null;
      }
    }
    lastIndex = tokenPattern.lastIndex;
  }

  if (currentBlock) {
    currentBlock.bodyParts.push(text.slice(lastIndex));
    warnings.push({ level: "danger", title: `Unclosed ${currentBlock.tagType} block`, detail: `The <${currentBlock.tagType}> block${currentBlock.filename ? ` for ${currentBlock.filename}` : ""} starts at line ${currentBlock.startLine} but has no matching closing tag.` });
    finalizeBlock(currentBlock, blocks, warnings, duplicateMap, paragraphs);
  }

  duplicateMap.forEach((count, filename) => {
    if (count > 1) warnings.push({ level: "warn", title: "Duplicate filename", detail: `${filename} appears ${count} times across detected blocks.` });
  });

  if (sawTagToken && !blocks.length) warnings.push({ level: "warn", title: "Tag-like text found but no valid blocks built", detail: "The document appears to contain tags, but complete blocks could not be formed from them." });

  blocks.sort((a, b) => a.rawOpenIndex - b.rawOpenIndex).forEach((block, i) => { block.order = i + 1; });
  return { blocks, warnings, scorm: analyzeScorm(text, blocks), media: emptyMediaState() };
}

function applyMediaStateToAnalysis(analysis) {
  const mediaWarnings = [];
  const references = [];
  const matchedKeys = new Set();
  const referencedNames = new Set();

  if (currentMediaDuplicateNames.size) mediaWarnings.push({ level: "warn", title: "Duplicate media names in ZIP", detail: `The media ZIP contains duplicate basenames for: ${[...currentMediaDuplicateNames].sort().join(", ")}.` });

  analysis.blocks.forEach((block) => {
    block.mediaRefs = block.mediaRefs.map((ref) => {
      const key = normalizeMediaName(ref.filename);
      let status = "missing";
      let matchedFile = null;
      let detail = "No media ZIP has been uploaded yet.";
      if (currentMediaDuplicateNames.has(key)) {
        status = "ambiguous";
        detail = `Multiple files named ${ref.filename} were found in the media ZIP.`;
      } else if (currentMediaIndex.has(key)) {
        status = "matched"; matchedFile = currentMediaIndex.get(key);
        detail = `Matched to ${matchedFile.exportName} (from media ZIP).`;
        matchedKeys.add(key);
      } else if (currentEmbeddedMediaIndex.has(key)) {
        status = "matched"; matchedFile = currentEmbeddedMediaIndex.get(key);
        detail = `Matched to ${matchedFile.exportName} (embedded in DOCX).`;
        matchedKeys.add(key);
      } else if (currentMediaBundle.length) {
        detail = `No file named ${ref.filename} was found in the uploaded media ZIP.`;
      } else if (currentEmbeddedMedia.length) {
        detail = `No file named ${ref.filename} was found in the DOCX embedded images or any uploaded media ZIP.`;
      }
      referencedNames.add(key);
      const enriched = { ...ref, status, matchedFile, detail };
      references.push({ ...enriched, blockOrder: block.order, blockFilename: block.filename || "(missing filename)" });
      return enriched;
    });
  });

  references.forEach((ref) => {
    if (ref.status === "missing")    mediaWarnings.push({ level: "warn", title: "Missing media file",    detail: `Block ${ref.blockOrder}${ref.blockFilename ? ` (${ref.blockFilename})` : ""} references ${ref.filename} in <${ref.tag}> but no matching media file is available.` });
    else if (ref.status === "ambiguous") mediaWarnings.push({ level: "warn", title: "Ambiguous media file", detail: `Block ${ref.blockOrder}${ref.blockFilename ? ` (${ref.blockFilename})` : ""} references ${ref.filename} in <${ref.tag}>, but more than one ZIP entry shares that basename.` });
  });

  if (!currentMediaBundle.length && !currentEmbeddedMedia.length && references.length) mediaWarnings.unshift({ level: "warn", title: "No media available", detail: "The source document references explicit media tags, but no companion media ZIP has been loaded and no images were found embedded in the DOCX." });

  analysis.media = {
    zipName: currentMediaZipName,
    loadedFiles: currentMediaBundle.length,
    embeddedCount: currentEmbeddedMedia.length,
    references,
    matchedFiles: currentMediaBundle.filter((file) => matchedKeys.has(file.key)),
    missingCount: references.filter((ref) => ref.status === "missing").length,
    ambiguousCount: references.filter((ref) => ref.status === "ambiguous").length,
    unusedFiles: currentMediaBundle.filter((file) => !referencedNames.has(file.key)),
    warnings: dedupeWarnings(mediaWarnings)
  };
  return analysis;
}

function finalizeBlock(rawBlock, blocks, warnings, duplicateMap, paragraphs) {
  const rawBody = sanitizeBodyText(rawBlock.bodyParts.join("").trim());
  const mediaRefs = extractMediaReferences(rawBody);
  const body = sanitizeBodyText(stripStructuralTags(stripMediaTags(rawBody)).trim());
  const filename = sanitizeFilenameValue(rawBlock.filename);
  const classification = inferClassification(body, filename);
  const output = inferOutput(rawBlock.tagType, filename);

  if (!filename) warnings.push({ level: "warn", title: `Missing filename in ${rawBlock.tagType} block`, detail: `The <${rawBlock.tagType}> block starting at line ${rawBlock.startLine} has no <filename> value.` });
  else duplicateMap.set(filename, (duplicateMap.get(filename) || 0) + 1);

  // Collect the XML nodes for this block's content (used by mini-DOCX builder)
  const contentParaNodes = extractContentParaNodes(rawBlock, paragraphs);
  const embeddedImageCount = countEmbeddedImages(contentParaNodes);

  // Warn when content paragraphs contain stray tag markup (authoring error — will be stripped from output)
  const strayTagRE = /<\/?(HTML|worksheet|document)\s*>|<filename>[^<>]*<\/filename>/i;
  const strayParas = contentParaNodes.filter(n => strayTagRE.test(extractNodeText(n)));
  if (strayParas.length) {
    const label = filename || `${rawBlock.tagType} block at line ${rawBlock.startLine}`;
    warnings.push({ level: "warn", title: `Stray tag markup in ${label}`, detail: `${strayParas.length} paragraph(s) inside this block contain raw tag text (e.g. <worksheet>, <filename>). These will be stripped from the exported file automatically.` });
  }

  blocks.push({
    order: blocks.length + 1,
    tagType: rawBlock.tagType,
    filename,
    excerpt: makeExcerpt(body, 220),
    body,
    classification,
    outputType: output.type,
    destination: output.destination,
    rawOpenIndex: rawBlock.rawOpenIndex,
    mediaRefs,
    embeddedImageCount,
    startLine: rawBlock.startLine,
    endLine: rawBlock.endLine || rawBlock.startLine,
    contentParaNodes,
    openParaIndex: rawBlock.openParaIndex || 0,
    closeParaIndex: rawBlock.closeParaIndex || 0
  });
}

function extractContentParaNodes(rawBlock, paragraphs) {
  const open  = rawBlock.openParaIndex  !== undefined ? rawBlock.openParaIndex  : 0;
  const close = rawBlock.closeParaIndex !== undefined ? rawBlock.closeParaIndex : paragraphs.length - 1;
  const nodes = [];
  // The opening tag paragraph (e.g. <HTML>) is normally a plain text paragraph that only
  // contains the tag marker — exclude it.  However, when the author puts the block tag
  // inside a table (a common pattern for cover/header tables that also embed images), the
  // whole table is indexed as the opening paragraph.  In that case include it so that
  // images embedded in the cover table are not silently dropped from the output.
  const openEntry = paragraphs[open];
  if (openEntry && openEntry.isTable) nodes.push(openEntry.xmlNode);
  for (let i = open + 1; i < close; i++) {
    const p = paragraphs[i];
    if (!p) continue;
    // Skip paragraphs that are purely structural tag markers — their combined text
    // reduces to empty after removing all tag patterns.  Guard image paragraphs:
    // an image-only paragraph also has empty text, so check for drawing elements
    // before discarding.
    if (!p.isTable) {
      const hasImage = (p.xmlNode.getElementsByTagNameNS("*", "drawing") || []).length > 0 ||
                       (p.xmlNode.getElementsByTagNameNS("*", "blip")    || []).length > 0;
      if (!hasImage && !p.textContent.replace(NODE_TAG_STRIP_RE, "").trim()) continue;
    }
    nodes.push(p.xmlNode);
  }
  return nodes;
}

function countEmbeddedImages(nodes) {
  if (!nodes.length) return 0;
  const ser = new XMLSerializer();
  let count = 0;
  for (const node of nodes) {
    const xml = ser.serializeToString(node);
    const matches = xml.match(/r:embed="/g);
    if (matches) count += matches.length;
  }
  return count;
}

function inferClassification(content, filename) {
  const sample = `${filename} ${content}`.toLowerCase();
  if (/(^|[\s-])(tn|sow|prep)([\s.-]|$)/i.test(filename) || /teacher'?s?\s+notes?|marking scheme|scheme of work|preparation notes?/i.test(sample)) return "teacher content";
  if (sample.includes("worksheet") || sample.includes("learner")) return "learner content";
  if (sample.includes("homework")) return "homework";
  if (sample.includes("assessment") || sample.includes("quiz") || sample.includes("test")) return "assessment";
  if (sample.includes("certificate")) return "certificate";
  if (sample.includes("project")) return "project brief";
  if (sample.includes("plan") || sample.includes("spec") || sample.includes("instruction")) return "planning/specification";
  return "learner content";
}

function inferOutput(tagType, filename) {
  if (tagType.toLowerCase() === "html") return { type: "Learner HTML", destination: filename ? "outputs/html/" : "outputs/html/ (proposed)" };
  return { type: "Worksheet or document output", destination: filename ? "outputs/docx/" : "outputs/docx/ (proposed)" };
}

function analyzeScorm(text, blocks) {
  const lower = text.toLowerCase();
  const hasScormContent = lower.includes("scorm");
  const detectedVersion = /(scorm\s*2004)/i.test(text) ? "SCORM 2004" : "SCORM 1.2";
  const checks = [
    { label: "SCORM version",          ok: true, value: /(scorm\s*1\.2|scorm\s*2004)/i.test(text) ? detectedVersion : `${detectedVersion} (default)` },
    { label: "Launch file",            ok: true, value: /launch|index\.html|start/i.test(text) ? "Detected" : "First HTML block (default)" },
    { label: "Manifest data",          ok: true, value: "Auto-generated" },
    { label: "Completion model",       ok: true, value: /completion|passed|mastery|score/i.test(text) ? "Detected" : "Completed (default)" },
    { label: "Tracking model",         ok: true, value: /tracking|suspend_data|bookmark|progress/i.test(text) ? "Detected" : "Basic (default)" },
    { label: "Navigation / sequencing",ok: true, value: /sequencing|navigation|next|previous/i.test(text) ? "Detected" : "Linear (default)" }
  ];
  const ready = hasScormContent && blocks.some((block) => block.filename);
  return {
    checks,
    ready,
    hasScormContent,
    summary: ready ? "SCORM 1.2 package ready. Missing values defaulted automatically." : hasScormContent ? "SCORM content detected — ready to package with defaults." : "No SCORM specification found in this document."
  };
}

// ─── Output builders ───────────────────────────────────────────────────────

async function buildArtefacts(blocks) {
  const artefacts = [];
  for (const block of blocks) {
    if (!block.filename) continue;
    try {
      const filename = resolveOutputFilename(block);
      const tag = block.tagType.toLowerCase();

      if (tag === "html") {
        const art = await buildHtmlArtefact(block, filename);
        if (art) artefacts.push(art);
      } else {
        const art = await buildDocxArtefact(block, filename);
        if (art) artefacts.push(art);
      }
    } catch (err) {
      console.error(`Build error for ${block.filename}:`, err);
    }
  }
  return artefacts;
}

// Generate a Word inline drawing paragraph for an embedded image
function buildDrawingXml(rId, name) {
  const escapedName = escapeXml(name);
  const docPrId = Math.floor(Math.random() * 999000) + 1000;
  const cx = 5486400, cy = 3657600; // 6 × 4 inches in EMU
  return `<w:p xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships" xmlns:wp="http://schemas.openxmlformats.org/drawingml/2006/wordprocessingDrawing" xmlns:a="http://schemas.openxmlformats.org/drawingml/2006/main" xmlns:pic="http://schemas.openxmlformats.org/drawingml/2006/picture"><w:r><w:drawing><wp:inline distT="0" distB="0" distL="0" distR="0"><wp:extent cx="${cx}" cy="${cy}"/><wp:effectExtent l="0" t="0" r="0" b="0"/><wp:docPr id="${docPrId}" name="${escapedName}"/><wp:cNvGraphicFramePr><a:graphicFrameLocks noChangeAspect="1"/></wp:cNvGraphicFramePr><a:graphic><a:graphicData uri="http://schemas.openxmlformats.org/drawingml/2006/picture"><pic:pic><pic:nvPicPr><pic:cNvPr id="${docPrId}" name="${escapedName}"/><pic:cNvPicPr/></pic:nvPicPr><pic:blipFill><a:blip r:embed="${escapeXml(rId)}"/><a:stretch><a:fillRect/></a:stretch></pic:blipFill><pic:spPr><a:xfrm><a:off x="0" y="0"/><a:ext cx="${cx}" cy="${cy}"/></a:xfrm><a:prstGeom prst="rect"><a:avLst/></a:prstGeom></pic:spPr></pic:pic></a:graphicData></a:graphic></wp:inline></w:drawing></w:r></w:p>`;
}

// Replace <image> text-only paragraphs with real Word drawing nodes
function resolveImageNodes(paraNodes, block) {
  const IMAGE_RE = /^<image>([^<>]+)<\/image>$/i;
  const result = [];
  const extraMediaFiles = [];
  const extraRelEntries = [];
  let seq = 0;
  for (const node of paraNodes) {
    const text = extractNodeText(node).trim();
    const m = IMAGE_RE.exec(text);
    if (m) {
      const key = normalizeMediaName(m[1].trim());
      const ref = block.mediaRefs.find(
        (r) => r.tag === "image" && normalizeMediaName(r.filename) === key && r.status === "matched" && r.matchedFile
      );
      if (ref) {
        const file = ref.matchedFile;
        const safeName = sanitizeMediaFilename(file.exportName);
        const rId = `rImgInj${++seq}`;
        try {
          const drawingNode = new DOMParser().parseFromString(buildDrawingXml(rId, safeName), "application/xml").documentElement;
          result.push(drawingNode);
          extraMediaFiles.push({ name: safeName, data: file.data });
          extraRelEntries.push(`  <Relationship Id="${escapeXml(rId)}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/image" Target="media/${escapeXml(safeName)}"/>`);
          continue;
        } catch (_) { /* fall through */ }
      }
    }
    result.push(node);
  }
  return { nodes: result, extraMediaFiles, extraRelEntries };
}

// Build a self-contained DOCX in memory from a block's paragraph nodes
async function buildMiniDocx(block) {
  if (!currentDocxZip || !currentDocXml) return null;
  try {
    const zip = new JSZip();
    // Always re-extract paragraph nodes from currentParagraphs at build time.
    // This ensures we pick up any patched xmlNode references (e.g. after
    // patchSourceXmlForEmbeddedImages rewrites currentDocXml and rebuilds nodes).
    const freshParaNodes = extractContentParaNodes(block, currentParagraphs);
    const { nodes, extraMediaFiles, extraRelEntries } = resolveImageNodes(freshParaNodes, block);
    const { relsXml, mediaFiles, linkedToEmbeddedIds } = await buildBlockRels(nodes, extraRelEntries);
    zip.file("word/document.xml", buildBlockDocumentXml(nodes, linkedToEmbeddedIds));
    if (currentStylesXml)    zip.file("word/styles.xml",         currentStylesXml);
    if (currentNumberingXml) zip.file("word/numbering.xml",      currentNumberingXml);
    if (currentThemeXml)     zip.file("word/theme/theme1.xml",   currentThemeXml);
    zip.file("word/_rels/document.xml.rels", relsXml);
    const seen = new Set();
    for (const f of [...mediaFiles, ...extraMediaFiles]) {
      if (!seen.has(f.name)) { seen.add(f.name); zip.file(`word/media/${f.name}`, f.data); }
    }
    zip.file("_rels/.rels",          PACKAGE_RELS_XML);
    zip.file("[Content_Types].xml",  buildContentTypesXml([...mediaFiles, ...extraMediaFiles]));
    return zip;
  } catch (err) {
    console.error("buildMiniDocx error:", err);
    return null;
  }
}

// Rebuild word/document.xml using the source document's namespace envelope but only the block's paragraphs.
// If linkedToEmbeddedIds is provided, r:link attributes for those IDs are promoted to r:embed in the DOM
// before serialization — using namespace-aware DOM mutation rather than string replacement so it works
// regardless of which prefix XMLSerializer chooses to emit.
function buildBlockDocumentXml(paraNodes, linkedToEmbeddedIds = new Set()) {
  try {
    const doc = new DOMParser().parseFromString(currentDocXml, "application/xml");
    const bodyEl = doc.getElementsByTagNameNS("*", "body")[0];
    if (!bodyEl) throw new Error("No body element in document.xml");

    while (bodyEl.firstChild) bodyEl.removeChild(bodyEl.firstChild);

    for (const node of paraNodes) {
      const imported = doc.importNode(node, true);
      stripTagMarkupFromNode(imported);
      if (!isNodeEffectivelyEmpty(imported)) bodyEl.appendChild(imported);
    }

    const wNs = "http://schemas.openxmlformats.org/wordprocessingml/2006/main";
    bodyEl.appendChild(doc.createElementNS(wNs, "w:sectPr"));

    let xmlStr = new XMLSerializer().serializeToString(doc);

    // Promote r:link → r:embed using post-serialization string replacement.
    // This is more reliable than DOM setAttributeNS because it works regardless of
    // which namespace prefix XMLSerializer chose for the relationships namespace.
    // We match on the exact rId value (e.g. "rId8") which is unique, so there is
    // no risk of accidentally replacing unrelated link attributes.
    if (linkedToEmbeddedIds.size > 0) {
      console.log("[DOCX-IMG] promoting r:link → r:embed for IDs:", [...linkedToEmbeddedIds]);
      for (const rId of linkedToEmbeddedIds) {
        const escapedId = escapeXml(rId);
        const safeId = escapedId.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
        const before = xmlStr;
        // Replace <anyprefix>:link="rId" → <anyprefix>:embed="rId"
        xmlStr = xmlStr.replace(new RegExp(`(\\w[\\w-]*):link="${safeId}"`, "g"), `$1:embed="${escapedId}"`);
        if (xmlStr === before) {
          console.warn(`[DOCX-IMG] no r:link="${rId}" found in serialized XML — swap did not apply`);
        } else {
          console.log(`[DOCX-IMG] swapped r:link="${rId}" → r:embed="${rId}"`);
        }
      }
    }

    return xmlStr;
  } catch (err) {
    console.error("buildBlockDocumentXml error:", err);
    return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><w:document xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"><w:body><w:sectPr/></w:body></w:document>`;
  }
}

// Collect relationship IDs from a DOM subtree using namespace-aware attribute lookup
function collectRelIdsFromNode(root, R_NS, out) {
  if (root.nodeType !== 1) return;
  for (const name of ["embed", "link", "id", "href"]) {
    const v = root.getAttributeNS(R_NS, name);
    if (v) out.add(v);
  }
  for (const child of root.childNodes) collectRelIdsFromNode(child, R_NS, out);
}

// Find all relationship IDs used by a set of paragraph nodes and collect the corresponding files
async function buildBlockRels(paraNodes, extraRelEntries = []) {
  const R_NS = "http://schemas.openxmlformats.org/officeDocument/2006/relationships";
  const usedRids = new Set();
  for (const node of paraNodes) {
    collectRelIdsFromNode(node, R_NS, usedRids);
  }

  // Also scan the raw serialized XML for any r:link / r:embed values that
  // getAttributeNS might have missed (e.g. if namespace prefix resolution
  // behaved unexpectedly during DOM parsing).
  const ser = new XMLSerializer();
  for (const node of paraNodes) {
    const raw = ser.serializeToString(node);
    for (const m of raw.matchAll(/\w[\w-]*:(?:link|embed|id|href)="([^"]+)"/g)) {
      usedRids.add(m[1]);
    }
  }

  console.log("[DOCX-IMG] usedRids from paragraphs:", [...usedRids]);
  console.log("[DOCX-IMG] total relationships in currentRels:", currentRels.size);

  const relEntries = [];
  const mediaFiles = [];
  const linkedToEmbeddedIds = new Set();

  for (const [rId, rel] of currentRels) {
    if (!usedRids.has(rId)) continue;

    const isImageRel = rel.type.includes("/image");
    console.log(`[DOCX-IMG] processing rId=${rId} mode=${rel.mode} isImage=${isImageRel} target=${rel.target}`);

    if (rel.mode === "External") {
      if (isImageRel) {
        const rawFileName = rel.target.split(/[\\/]/).pop();
        const fileName = (() => { try { return decodeURIComponent(rawFileName); } catch (_) { return rawFileName; } })();
        const key = normalizeMediaName(fileName);
        console.log(`[DOCX-IMG]   external image: rawFileName="${rawFileName}" fileName="${fileName}" key="${key}"`);
        console.log(`[DOCX-IMG]   zipEntry=${currentMediaIndex.has(key)} embEntry=${currentEmbeddedMediaIndex.has(key)}`);
        const zipEntry = currentMediaIndex.get(key);
        const embEntry = currentEmbeddedMediaIndex.get(key);
        if (zipEntry) {
          const safeName = sanitizeMediaFilename(zipEntry.exportName);
          mediaFiles.push({ name: safeName, data: zipEntry.data });
          relEntries.push(`  <Relationship Id="${escapeXml(rId)}" Type="${escapeXml(rel.type)}" Target="media/${escapeXml(safeName)}"/>`);
          linkedToEmbeddedIds.add(rId);
          console.log(`[DOCX-IMG]   → resolved from ZIP: ${safeName}`);
          continue;
        } else if (embEntry) {
          const safeName = sanitizeMediaFilename(embEntry.exportName);
          mediaFiles.push({ name: safeName, data: embEntry.data });
          relEntries.push(`  <Relationship Id="${escapeXml(rId)}" Type="${escapeXml(rel.type)}" Target="media/${escapeXml(safeName)}"/>`);
          linkedToEmbeddedIds.add(rId);
          console.log(`[DOCX-IMG]   → resolved from embedded: ${safeName}`);
          continue;
        } else {
          console.warn(`[DOCX-IMG]   ✗ no match for "${fileName}" — image will be missing`);
        }
      }
      relEntries.push(`  <Relationship Id="${escapeXml(rId)}" Type="${escapeXml(rel.type)}" Target="${escapeXml(rel.target)}" TargetMode="External"/>`);
    } else {
      // Internal resource — check for pre-resolved file first (set by patchSourceXmlForEmbeddedImages)
      if (isImageRel && rel._resolvedFile) {
        const f = rel._resolvedFile;
        const safeName = sanitizeMediaFilename(f.exportName);
        mediaFiles.push({ name: safeName, data: f.data });
        relEntries.push(`  <Relationship Id="${escapeXml(rId)}" Type="${escapeXml(rel.type)}" Target="media/${escapeXml(safeName)}"/>`);
        console.log(`[DOCX-IMG]   → pre-resolved: ${safeName}`);
        continue;
      }
      // Copy the file from the source DOCX
      const rawTarget = rel.target.replace(/^\//, "");
      const sourcePath = rawTarget.startsWith("word/") ? rawTarget : `word/${rawTarget}`;
      const rawFileName = rawTarget.split("/").pop();
      const fileName = sanitizeMediaFilename(rawFileName);
      const sourceEntry = currentDocxZip.file(sourcePath) || currentDocxZip.file(rawTarget);
      if (sourceEntry) {
        const data = await sourceEntry.async("uint8array");
        mediaFiles.push({ name: fileName, data });
        relEntries.push(`  <Relationship Id="${escapeXml(rId)}" Type="${escapeXml(rel.type)}" Target="media/${escapeXml(fileName)}"/>`);
      } else if (isImageRel) {
        // File missing from DOCX — try ZIP and embedded media as fallback
        const key = normalizeMediaName(rawFileName);
        const zipEntry = currentMediaIndex.get(key);
        const embEntry = currentEmbeddedMediaIndex.get(key);
        if (zipEntry) {
          const safeName = sanitizeMediaFilename(zipEntry.exportName);
          mediaFiles.push({ name: safeName, data: zipEntry.data });
          relEntries.push(`  <Relationship Id="${escapeXml(rId)}" Type="${escapeXml(rel.type)}" Target="media/${escapeXml(safeName)}"/>`);
        } else if (embEntry) {
          const safeName = sanitizeMediaFilename(embEntry.exportName);
          mediaFiles.push({ name: safeName, data: embEntry.data });
          relEntries.push(`  <Relationship Id="${escapeXml(rId)}" Type="${escapeXml(rel.type)}" Target="media/${escapeXml(safeName)}"/>`);
        }
      }
    }
  }

  return {
    relsXml: `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">\n${[...relEntries, ...extraRelEntries].join("\n")}\n</Relationships>`,
    mediaFiles,
    linkedToEmbeddedIds
  };
}

function buildContentTypesXml(mediaFiles) {
  const exts = new Set(mediaFiles.map((f) => f.name.split(".").pop().toLowerCase()).filter(Boolean));
  const extLines = [...exts].map((ext) => `  <Default Extension="${ext}" ContentType="${getMimeType(`f.${ext}`)}"/>`);
  return [
    `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>`,
    `<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">`,
    `  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>`,
    `  <Default Extension="xml" ContentType="application/xml"/>`,
    ...extLines,
    `  <Override PartName="/word/document.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.document.main+xml"/>`,
    currentStylesXml    ? `  <Override PartName="/word/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.styles+xml"/>` : "",
    currentNumberingXml ? `  <Override PartName="/word/numbering.xml" ContentType="application/vnd.openxmlformats-officedocument.wordprocessingml.numbering+xml"/>` : "",
    currentThemeXml     ? `  <Override PartName="/word/theme/theme1.xml" ContentType="application/vnd.openxmlformats.themes+xml"/>` : "",
    `</Types>`
  ].filter(Boolean).join("\n");
}

// HTML artefact: build mini-DOCX → mammoth → post-process → wrap in template
async function buildHtmlArtefact(block, filename) {
  const miniDocx = await buildMiniDocx(block);
  if (!miniDocx) return buildHtmlFallback(block, filename);

  // Check mammoth is available
  if (typeof mammoth === "undefined") return buildHtmlFallback(block, filename);

  try {
    const blob        = await miniDocx.generateAsync({ type: "blob" });
    const arrayBuffer = await blob.arrayBuffer();
    const result      = await mammoth.convertToHtml({ arrayBuffer });
    let html          = result.value || "";
    html = postProcessMammothHtml(html, block);
    const fullHtml = wrapInPageTemplate(html, filename, block);
    const mime = "text/html;charset=utf-8";
    const matchedTags = block.mediaRefs.filter((r) => r.status === "matched").length;
    const statusLabel = matchedTags ? `${matchedTags} media matched` : block.embeddedImageCount ? `${block.embeddedImageCount} embedded image${block.embeddedImageCount === 1 ? "" : "s"}` : "no images";
    return { filename, tagType: block.tagType, outputLabel: "HTML page", status: statusLabel, content: fullHtml, mime, blob: null, url: createDownloadUrl(fullHtml, mime) };
  } catch (err) {
    console.error("mammoth error, using fallback:", err);
    return buildHtmlFallback(block, filename);
  }
}

// DOCX artefact: build mini-DOCX → download as .docx
async function buildDocxArtefact(block, filename) {
  const miniDocx = await buildMiniDocx(block);
  if (!miniDocx) return null;
  try {
    const blob = await miniDocx.generateAsync({ type: "blob" });
    const url  = createObjectUrl(blob);
    const matchedTags = block.mediaRefs.filter((r) => r.status === "matched").length;
    const statusLabel = matchedTags ? `${matchedTags} media matched` : block.embeddedImageCount ? `${block.embeddedImageCount} embedded image${block.embeddedImageCount === 1 ? "" : "s"}` : "no images";
    return { filename, tagType: block.tagType, outputLabel: block.tagType.toLowerCase() === "worksheet" ? "Word worksheet" : "Word document", status: statusLabel, content: null, mime: "application/vnd.openxmlformats-officedocument.wordprocessingml.document", blob, url };
  } catch (err) {
    console.error("buildDocxArtefact error:", err);
    return null;
  }
}

// Fallback: old template-based HTML for when mammoth is unavailable or fails
function buildHtmlFallback(block, filename) {
  const content = buildPrototypeHtml(block, filename);
  const mime    = "text/html;charset=utf-8";
  return { filename, tagType: block.tagType, outputLabel: "HTML page (fallback)", status: "fallback render", content, mime, blob: null, url: createDownloadUrl(content, mime) };
}

// Post-process mammoth HTML: replace encoded explicit media tags with real elements
function postProcessMammothHtml(html, block) {
  return html.replace(/&lt;(image|video|audio|datasheet)&gt;([^&<]+)&lt;\/\1&gt;/gi, (match, tag, rawFilename) => {
    const filename = rawFilename.trim();
    const ref = block.mediaRefs.find((r) =>
      r.tag === tag.toLowerCase() && normalizeMediaName(r.filename) === normalizeMediaName(filename)
    );
    if (!ref || ref.status !== "matched" || !ref.matchedFile) {
      return `<span class="ds-missing-media">[${tag}: ${escapeHtml(filename)} — media not found]</span>`;
    }
    const src  = ref.matchedFile.dataUrl || buildEmbeddedMediaUrl(ref.matchedFile);
    const name = escapeHtml(ref.matchedFile.exportName);
    if (tag.toLowerCase() === "image")     return `<figure><img src="${src}" alt="${name}" /><figcaption>${name}</figcaption></figure>`;
    if (tag.toLowerCase() === "video")     return `<video controls><source src="${src}" /></video>`;
    if (tag.toLowerCase() === "audio")     return `<audio controls><source src="${src}" /></audio>`;
    if (tag.toLowerCase() === "datasheet") return `<a href="${src}" download="${name}" class="ds-download">${name}</a>`;
    return match;
  });
}

// Wrap mammoth HTML body content in a clean standalone page
function wrapInPageTemplate(bodyHtml, filename, block) {
  const title = escapeHtml(baseName(filename) || filename);
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${title}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; }
    body { margin: 0; font-family: "Segoe UI", Calibri, Arial, sans-serif; font-size: 11pt; line-height: 1.65; color: #1a1a2e; background: #f4f6fb; padding: 2rem 1rem 3rem; }
    .page { max-width: 860px; margin: 0 auto; background: #fff; border: 1px solid #d0d9f0; border-radius: 8px; padding: 2.5rem 3rem; box-shadow: 0 4px 24px rgba(30,60,140,0.08); }
    h1 { font-size: 1.8em; line-height: 1.2; margin: 0 0 0.6em; color: #0f2358; }
    h2 { font-size: 1.25em; margin: 1.6em 0 0.4em; color: #1d4ed8; }
    h3 { font-size: 1.08em; margin: 1.3em 0 0.3em; color: #2d4166; }
    h4, h5, h6 { font-size: 1em; margin: 1.1em 0 0.3em; color: #2d4166; }
    p { margin: 0 0 0.8em; }
    ul, ol { margin: 0 0 0.8em; padding-left: 1.5em; }
    li { margin-bottom: 0.35em; }
    table { border-collapse: collapse; width: 100%; margin: 1em 0; font-size: 0.95em; }
    th, td { border: 1px solid #c8d5f0; padding: 0.5em 0.75em; text-align: left; vertical-align: top; }
    th { background: #e8eeff; font-weight: 700; }
    tr:nth-child(even) td { background: #f7f9ff; }
    a { color: #1d4ed8; }
    img { max-width: 100%; height: auto; display: block; margin: 0.75em 0; border-radius: 4px; }
    figure { margin: 1em 0; }
    figcaption { font-size: 0.85em; color: #5a7099; margin-top: 0.3em; font-style: italic; }
    video, audio { max-width: 100%; margin: 0.75em 0; display: block; }
    code { font-family: Consolas, "Cascadia Code", monospace; font-size: 0.9em; background: #f0f4ff; padding: 0.1em 0.35em; border-radius: 3px; }
    pre  { background: #f0f4ff; border: 1px solid #cdd9f8; border-radius: 6px; padding: 1em; overflow-x: auto; }
    pre code { background: none; padding: 0; }
    .ds-missing-media { display: inline-block; padding: 0.2em 0.5em; background: #fff0da; border: 1px solid #f0d9aa; border-radius: 4px; color: #a55a00; font-size: 0.85em; }
    .ds-download { display: inline-flex; align-items: center; gap: 0.3em; padding: 0.3em 0.7em; background: #e0eaff; border: 1px solid #b3caff; border-radius: 4px; color: #1d4ed8; text-decoration: none; font-weight: 600; }
    @media print { body { background: none; padding: 0; } .page { border: none; box-shadow: none; padding: 1cm 2cm; } }
  </style>
</head>
<body>
  <div class="page">
    ${bodyHtml}
  </div>
</body>
</html>`;
}

function resolveOutputFilename(block) {
  const original = sanitizeFilenameValue(block.filename);
  const tag = block.tagType.toLowerCase();
  if (tag === "html") {
    if (/\.html?$/i.test(original)) return original;
    const stem = original.replace(/\.[^.]+$/, "") || original;
    return `${stem}.html`;
  }
  // DOCX outputs — normalise .doc → .docx
  if (/\.docx$/i.test(original)) return original;
  if (/\.doc$/i.test(original))  return original.replace(/\.doc$/i, ".docx");
  if (/\.[^.]+$/.test(original)) return original; // keep other extensions (e.g. .pdf placeholder)
  return `${original}.docx`;
}

// ─── Prototype HTML fallback builder (used when mammoth is unavailable) ────
function buildPrototypeHtml(block, filename) {
  const display = deriveDisplayContent(block, filename);
  const leadMedia = display.leadMedia;
  const remainingMedia = display.remainingMedia;
  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>${escapeHtml(filename)}</title>
  <style>
    * { box-sizing: border-box; }
    body { margin: 0; font-family: "Segoe UI", Arial, sans-serif; background: linear-gradient(180deg, #eef4ff 0%, #f8fafc 100%); color: #14213d; }
    main { max-width: 1120px; margin: 0 auto; padding: 2rem 1rem 3rem; }
    .sheet { background: #ffffff; border: 1px solid #d5e1f8; border-radius: 24px; overflow: hidden; box-shadow: 0 22px 60px rgba(37, 99, 235, 0.12); }
    .topbar { padding: 1rem 1.25rem; background: #f7faff; border-bottom: 1px solid #dbe7ff; display: flex; justify-content: space-between; gap: 1rem; flex-wrap: wrap; }
    .topbar span { font-size: 0.8rem; color: #476184; }
    .hero { display: grid; grid-template-columns: minmax(0, 1.2fr) minmax(280px, 0.8fr); gap: 1.5rem; padding: 1.75rem; align-items: start; }
    .eyebrow { display: inline-block; padding: 0.35rem 0.65rem; border-radius: 999px; background: #e0ecff; color: #1d4ed8; font-size: 12px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.08em; }
    h1 { margin: 0.8rem 0 0.35rem; font-size: clamp(2rem, 4vw, 3.15rem); line-height: 0.96; color: #102038; }
    .subtitle { margin: 0; font-size: 1.15rem; line-height: 1.35; color: #385170; font-weight: 600; }
    .summary { margin-top: 1.1rem; font-size: 1rem; line-height: 1.75; color: #455d7a; }
    .hero-media { background: #fbfdff; border: 1px solid #dbe7ff; border-radius: 20px; padding: 0.9rem; min-height: 220px; }
    .hero-media img, .hero-media video, .hero-media audio { width: 100%; max-width: 100%; border-radius: 14px; display: block; }
    .media-label { display: block; margin-bottom: 0.55rem; font-size: 0.75rem; font-weight: 800; letter-spacing: 0.08em; text-transform: uppercase; color: #5b7096; }
    .meta { display: grid; grid-template-columns: repeat(3, minmax(0,1fr)); gap: 0.75rem; padding: 0 1.75rem 1.25rem; }
    .meta div { background: #f8fbff; border: 1px solid #dbe5ff; border-radius: 14px; padding: 0.85rem; }
    .meta strong { display: block; font-size: 12px; text-transform: uppercase; color: #5b7096; margin-bottom: 0.25rem; }
    .content { display: grid; gap: 1rem; padding: 0 1.75rem 1.75rem; }
    .content-section { background: #fbfdff; border: 1px solid #e2e8f0; border-radius: 18px; padding: 1rem 1.1rem; }
    .content-section h2 { margin: 0 0 0.65rem; font-size: 0.8rem; letter-spacing: 0.08em; text-transform: uppercase; color: #1d4ed8; }
    .content-section p, .content-section li { margin: 0 0 0.7rem; line-height: 1.75; color: #334155; }
    .content-section p:last-child, .content-section li:last-child { margin-bottom: 0; }
    .content-section ul { margin: 0; padding-left: 1.2rem; }
    .media-stack { display: grid; gap: 0.9rem; }
    .media-item { background: #fbfdff; border: 1px solid #dbe5ff; border-radius: 18px; padding: 1rem; }
    .media-item strong { display: inline-block; margin-bottom: 0.35rem; }
    .media-item img, .media-item video, .media-item audio { width: 100%; max-width: 100%; margin-top: 0.75rem; border-radius: 12px; display: block; }
    .media-item a { color: #1d4ed8; }
    @media (max-width: 820px) { .hero { grid-template-columns: 1fr; } .meta { grid-template-columns: 1fr; } }
  </style>
</head>
<body>
  <main>
    <div class="sheet">
      <div class="topbar">
        <span>Document Splitter</span>
        <span>Source tag: ${escapeHtml(block.tagType)}</span>
        <span>Export file: ${escapeHtml(filename)}</span>
      </div>
      <section class="hero">
        <div>
          <span class="eyebrow">${block.tagType === "HTML" ? "Learner HTML" : "Worksheet / document"}</span>
          <h1>${escapeHtml(display.title)}</h1>
          ${display.subtitle ? `<p class="subtitle">${escapeHtml(display.subtitle)}</p>` : ""}
          <p class="summary">Generated from the tagged DOCX source. Matched media files are embedded inline.</p>
        </div>
        ${leadMedia ? `<aside class="hero-media"><span class="media-label">Lead media</span>${renderSingleMediaHtml(leadMedia)}</aside>` : `<aside class="hero-media"><span class="media-label">Lead media</span><p style="margin:0;color:#64748b;line-height:1.7;">No matched lead media for this block.</p></aside>`}
      </section>
      <div class="meta">
        <div><strong>Source block</strong>${escapeHtml(block.tagType)}</div>
        <div><strong>Classification</strong>${escapeHtml(block.classification)}</div>
        <div><strong>Destination</strong>${escapeHtml(block.destination)}</div>
      </div>
      <div class="content">
        <section class="content-section">
          <h2>Content</h2>
          ${renderBodyContentHtml(display.contentLines)}
        </section>
        ${remainingMedia.length ? `<section class="content-section"><h2>Attached media</h2>${renderPrototypeMediaHtml(remainingMedia)}</section>` : ""}
        ${display.missingMedia.length ? `<section class="content-section"><h2>Missing media refs</h2>${display.missingMedia.map((ref) => `<p><strong>&lt;${escapeHtml(ref.tag)}&gt;</strong> ${escapeHtml(ref.filename)}: ${escapeHtml(ref.detail)}</p>`).join("")}</section>` : ""}
      </div>
    </div>
  </main>
</body>
</html>`;
}

function renderPrototypeMediaHtml(mediaRefs) {
  if (!mediaRefs.length) return "";
  return `<section class="media-stack">${mediaRefs.map((ref) => `<div class="media-item">${renderSingleMediaHtml(ref)}</div>`).join("")}</section>`;
}

// ─── Build CTA helper ──────────────────────────────────────────────────────
function showBuildCta() {
  if (!currentAnalysis) return;
  const ready  = currentAnalysis.blocks.filter((b) => b.filename).length;
  const total  = currentAnalysis.blocks.length;
  const errors = currentAnalysis.warnings.filter((w) => w.level === "danger").length;
  const zipLine = currentMediaZipName
    ? `<span style="color:var(--success)">✓ ${escapeHtml(currentMediaZipName)} loaded</span>`
    : `<span style="color:var(--muted)">No media ZIP loaded (optional)</span>`;

  ctaInfo.innerHTML = `
    <strong>${escapeHtml(currentSourceFile)}</strong> —
    ${total} block${total === 1 ? "" : "s"} detected,
    ${ready} ready to build${errors ? `, <span style="color:var(--danger)">${errors} error${errors === 1 ? "" : "s"}</span>` : ""}
    &nbsp;·&nbsp; ${zipLine}
  `;
  buildAllBtn.innerHTML = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> ${hasBuilt ? "Rebuild Outputs" : "Build Outputs"}`;
  buildAllBtn.disabled = false;
  buildCta.hidden = false;
}

// ─── Render functions ──────────────────────────────────────────────────────
function renderAnalysis(text, analysis) {
  previewStatus.textContent = "Preview ready";
  previewBox.className = "preview-box";
  previewBox.textContent = text || "No readable text could be extracted.";
  renderBlocks(analysis.blocks);
  renderOutputs(analysis.blocks);
  renderScorm(analysis.scorm);
  renderMediaPanel(analysis);
  const extraWarnings = [...(analysis.blocks.length === 0 && text ? [{ level: "warn", title: "No supported tags found", detail: "The document preview was extracted, but no supported custom blocks were detected." }] : []), ...analysis.media.warnings];
  renderWarnings(analysis.warnings, extraWarnings);
}

function renderAnalysisReport(analysis, allWarnings) {
  const blocks      = analysis.blocks;
  const ready       = blocks.filter((b) => b.filename).length;
  const total       = blocks.length;
  const errors      = allWarnings.filter((w) => w.level === "danger").length;
  const warns       = allWarnings.filter((w) => w.level === "warn").length;
  const embedded    = blocks.reduce((sum, b) => sum + (b.embeddedImageCount || 0), 0);
  const mediaTags   = blocks.reduce((sum, b) => sum + b.mediaRefs.length, 0);

  const hasErrors = errors > 0;
  const hasWarns  = warns > 0;
  const iconClass = hasErrors ? "fail" : hasWarns ? "warn" : "ok";

  const iconSvg = hasErrors
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/></svg>`
    : hasWarns
    ? `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/></svg>`
    : `<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>`;

  const titleText = hasErrors
    ? `${errors} error${errors === 1 ? "" : "s"} found — review before building`
    : hasWarns
    ? `Analysis complete — ${warns} warning${warns === 1 ? "" : "s"} to review`
    : `Analysis complete — no issues detected`;

  const subtitleText = total
    ? `${total} block${total === 1 ? "" : "s"} detected · ${ready} ready to build · ${currentSourceFile}`
    : `No tagged blocks found · ${currentSourceFile}`;

  const stats = [
    { value: total,    label: "Blocks",          cls: total ? "ok" : "warn" },
    { value: ready,    label: "Ready to build",  cls: ready === total && total > 0 ? "ok" : ready > 0 ? "warn" : "fail" },
    { value: errors,   label: "Errors",          cls: errors ? "fail" : "ok" },
    { value: warns,    label: "Warnings",        cls: warns ? "warn" : "ok" },
    { value: embedded, label: "Embedded images", cls: "ok" },
    ...(mediaTags ? [{ value: mediaTags, label: "Media tags", cls: "ok" }] : [])
  ];

  analysisReport.hidden = false;
  analysisReport.innerHTML = `
    <div class="ar-header">
      <div class="ar-status-icon ${iconClass}">${iconSvg}</div>
      <div style="flex:1">
        <p class="ar-title">${escapeHtml(titleText)}</p>
        <p class="ar-subtitle">${escapeHtml(subtitleText)}</p>
      </div>
      <button id="arBundleBtn" class="action-button build-btn" type="button" style="flex-shrink:0">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download Full Bundle
      </button>
    </div>
    <div class="ar-stats">
      ${stats.map((s) => `<div class="ar-stat"><div class="ar-stat-value ${s.cls}">${s.value}</div><div class="ar-stat-label">${escapeHtml(s.label)}</div></div>`).join("")}
    </div>
    <p class="ar-hint">
      <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><line x1="12" y1="5" x2="12" y2="19"/><polyline points="19 12 12 19 5 12"/></svg>
      Expand any section below to see detail
    </p>
  `;
  document.getElementById("arBundleBtn").addEventListener("click", () => downloadBundle());
}

function renderBlocks(blocks) {
  blocksCount.textContent = `${blocks.length} block${blocks.length === 1 ? "" : "s"}`;
  if (!blocks.length) {
    blocksList.className = "empty-state";
    blocksList.innerHTML = "No supported tagged blocks were detected in this preview.";
    return;
  }
  blocksList.className = "block-list";
  blocksList.innerHTML = blocks.map((block) => `
    <article class="block-card">
      <div class="block-top">
        <div><h3>Block ${block.order}</h3><p>${escapeHtml(block.outputType)}</p></div>
        <div class="block-meta">
          <span class="mini-tag">${escapeHtml(block.tagType)}</span>
          <span class="mini-tag success">${escapeHtml(block.classification)}</span>
          ${block.filename ? `<span class="mini-tag">${escapeHtml(block.filename)}</span>` : `<span class="mini-tag warn">filename missing</span>`}
          <span class="mini-tag">lines ${block.startLine}-${block.endLine}</span>
          ${block.mediaRefs.length ? `<span class="mini-tag">${block.mediaRefs.length} media tags</span>` : block.embeddedImageCount ? `<span class="mini-tag success">${block.embeddedImageCount} embedded image${block.embeddedImageCount === 1 ? "" : "s"}</span>` : `<span class="mini-tag">no images</span>`}
        </div>
      </div>
      <div class="excerpt">${escapeHtml(block.excerpt || "(No visible text inside block)")}</div>
      <div class="meta-grid">
        <div class="meta-box"><strong>Filename</strong><div>${block.filename ? `<code>${escapeHtml(block.filename)}</code>` : "No filename detected"}</div></div>
        <div class="meta-box"><strong>Destination</strong><div><code>${escapeHtml(block.destination)}</code></div></div>
      </div>
      <div class="media-inline-note">${block.mediaRefs.length ? `Explicit media tags: ${block.mediaRefs.map((ref) => `&lt;${escapeHtml(ref.tag)}&gt;${escapeHtml(ref.filename)}&lt;/${escapeHtml(ref.tag)}&gt;`).join(", ")}` : block.embeddedImageCount ? `${block.embeddedImageCount} Word-embedded image${block.embeddedImageCount === 1 ? "" : "s"} — extracted automatically, no explicit tags needed.` : "No images detected in this block."}</div>
    </article>
  `).join("");
}

function renderOutputs(blocks) {
  const valid = blocks.filter((block) => block.filename);
  outputsCount.textContent = `${valid.length} proposed`;
  if (!valid.length) {
    outputsList.className = "empty-state";
    outputsList.innerHTML = "Valid outputs will appear here when blocks include usable filenames.";
    return;
  }
  outputsList.className = "output-list";
  outputsList.innerHTML = valid.map((block) => {
    const matchedMedia   = block.mediaRefs.filter((ref) => ref.status === "matched").length;
    const unmatchedMedia = block.mediaRefs.length - matchedMedia;
    return `
      <article class="output-card">
        <div class="output-top">
          <div><h3>${escapeHtml(block.filename)}</h3><p>${escapeHtml(block.outputType)}</p></div>
          <div class="output-meta"><span class="mini-tag success">${escapeHtml(block.tagType)}</span>${block.mediaRefs.length ? `<span class="mini-tag">${block.mediaRefs.length} refs</span>` : ""}</div>
        </div>
        <div class="meta-grid">
          <div class="meta-box"><strong>Likely folder</strong><div><code>${escapeHtml(block.destination)}</code></div></div>
          <div class="meta-box"><strong>Classification</strong><div>${escapeHtml(block.classification)}</div></div>
        </div>
        ${block.mediaRefs.length ? `<div class="meta-grid"><div class="meta-box"><strong>Matched media</strong><div>${matchedMedia}</div></div><div class="meta-box"><strong>Missing / ambiguous</strong><div>${unmatchedMedia}</div></div></div>` : block.embeddedImageCount ? `<div class="meta-grid"><div class="meta-box" style="grid-column:1/-1"><strong>Embedded images</strong><div>${block.embeddedImageCount} image${block.embeddedImageCount === 1 ? "" : "s"} embedded in source DOCX — included automatically in outputs</div></div></div>` : ""}
        <div class="excerpt" style="margin-top:0.9rem;">${escapeHtml(makeExcerpt(block.body, 160) || "(No visible text inside block)")}</div>
      </article>
    `;
  }).join("");
}

function renderScorm(scorm) {
  if (!scorm.hasScormContent) {
    scormStatus.textContent = "Not applicable";
    scormPanel.className = "empty-state";
    scormPanel.innerHTML = `<div class="empty-state-icon"><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 16V8a2 2 0 0 0-1-1.73l-7-4a2 2 0 0 0-2 0l-7 4A2 2 0 0 0 3 8v8a2 2 0 0 0 1 1.73l7 4a2 2 0 0 0 2 0l7-4A2 2 0 0 0 21 16z"/></svg></div>No SCORM specification found in this document. If you need SCORM packaging, add version, launch file, tracking, and completion notes to the source.`;
    return;
  }
  scormStatus.textContent = scorm.ready ? "Ready" : "No SCORM blocks";
  scormPanel.className = "scorm-grid";
  scormPanel.innerHTML = `
    <div class="status-banner" style="grid-column: 1 / -1;"><strong>${escapeHtml(scorm.summary)}</strong></div>
    ${scorm.checks.map((item) => `<article class="scorm-card"><div class="block-top"><h3>${escapeHtml(item.label)}</h3><span class="mini-tag success">Ready</span></div><p>${escapeHtml(item.value)}</p></article>`).join("")}
  `;
}

function renderMediaPanel(analysis) {
  if (!analysis) {
    mediaCount.textContent = currentMediaBundle.length ? `${currentMediaBundle.length} files loaded` : "0 references";
    if (!currentMediaBundle.length) {
      mediaList.className = "empty-state";
      mediaList.textContent = "Upload a source document and optional media ZIP to inspect explicit media references.";
      return;
    }
    mediaList.className = "media-list";
    mediaList.innerHTML = `<div class="status-banner"><strong>${escapeHtml(currentMediaZipName || "Media ZIP loaded")}</strong>${currentMediaBundle.length} files were loaded from the media ZIP. Upload a source document to match explicit media tags.</div>`;
    return;
  }
  const mediaState = analysis.media;
  mediaCount.textContent = `${mediaState.references.length} reference${mediaState.references.length === 1 ? "" : "s"}`;
  if (!mediaState.references.length && !mediaState.loadedFiles && !mediaState.embeddedCount) {
    mediaList.className = "empty-state";
    mediaList.textContent = "No explicit media tags were found, and no media ZIP has been loaded.";
    return;
  }
  mediaList.className = "media-list";
  mediaList.innerHTML = `
    <div class="media-summary">
      <div class="media-stat"><strong>${mediaState.embeddedCount || 0}</strong><span>embedded in DOCX</span></div>
      <div class="media-stat"><strong>${mediaState.loadedFiles}</strong><span>files loaded from ZIP</span></div>
      <div class="media-stat"><strong>${mediaState.references.length}</strong><span>explicit media tags</span></div>
      <div class="media-stat"><strong>${mediaState.matchedFiles.length}</strong><span>matched</span></div>
    </div>
    ${mediaState.references.length ? mediaState.references.map((ref) => `
      <article class="media-card">
        <div class="block-top"><div><h3>${escapeHtml(ref.filename)}</h3><p>Block ${ref.blockOrder} • ${escapeHtml(ref.blockFilename)} • <code>&lt;${escapeHtml(ref.tag)}&gt;</code> reference</p></div><span class="mini-tag ${ref.status === "matched" ? "success" : "warn"}">${ref.status === "matched" ? "Matched" : ref.status === "ambiguous" ? "Ambiguous" : "Missing"}</span></div>
        <p>${escapeHtml(ref.detail)}</p>
        ${ref.matchedFile ? `<div class="meta-grid"><div class="meta-box"><strong>ZIP entry</strong><div><code>${escapeHtml(ref.matchedFile.path)}</code></div></div><div class="meta-box"><strong>Export path</strong><div><code>media/${escapeHtml(ref.matchedFile.exportName)}</code></div></div></div><div class="media-link-row"><a class="download-link" href="${escapeHtml(ref.matchedFile.url)}" download="${escapeHtml(ref.matchedFile.exportName)}">Download media</a></div>` : ""}
      </article>
    `).join("") : `<article class="media-card"><div class="block-top"><h3>No explicit media refs in source</h3><span class="mini-tag">${mediaState.loadedFiles} loaded</span></div><p>The media ZIP is loaded, but the current source document contains no explicit media tags such as <code>&lt;image&gt;file.jpg&lt;/image&gt;</code>.</p></article>`}
    ${mediaState.unusedFiles.length ? `<article class="media-card"><div class="block-top"><h3>Unused media in ZIP</h3><span class="mini-tag">${mediaState.unusedFiles.length} unused</span></div><p>These files are loaded but not referenced by any explicit media tag in the source.</p><div class="excerpt">${escapeHtml(mediaState.unusedFiles.map((file) => file.exportName).join(", "))}</div></article>` : ""}
  `;
}

function renderWarnings(primaryWarnings, extraWarnings) {
  const allWarnings = dedupeWarnings([...primaryWarnings, ...extraWarnings]);
  const warningsPanel = document.getElementById("warningsPanel");
  warningsCount.textContent = `${allWarnings.length} warning${allWarnings.length === 1 ? "" : "s"}`;
  if (!allWarnings.length) {
    if (warningsPanel) warningsPanel.hidden = true;
    warningsList.innerHTML = "";
    return;
  }
  if (warningsPanel) warningsPanel.hidden = false;
  warningsList.innerHTML = allWarnings.map((w) => `
    <div class="warn-row">
      <span class="mini-tag ${w.level === "danger" ? "danger" : "warn"}">${w.level === "danger" ? "Error" : "Warning"}</span>
      <div class="warn-row-text">
        <strong>${escapeHtml(w.title)}</strong>
        <span>${escapeHtml(w.detail)}</span>
      </div>
    </div>`).join("");
}

function renderGeneratedOutputs(files) {
  generatedCount.textContent = `${files.length} file${files.length === 1 ? "" : "s"}`;
  if (!files.length) {
    generatedList.innerHTML = `<p style="color:var(--muted);font-size:0.85rem;margin:0">No output files were generated from this source.</p>`;
    return;
  }
  generatedList.innerHTML = `
    <div class="build-success">
      <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="var(--success)" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>
      <span>${files.length} file${files.length === 1 ? "" : "s"} ready</span>
      <button class="action-button build-btn" type="button" id="successBundleBtn">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
        Download
      </button>
    </div>`;
  document.getElementById("successBundleBtn").addEventListener("click", () => ctaBundleBtn.click());
}

function renderError(message) {
  previewStatus.textContent = "Upload failed";
  previewBox.className = "empty-state";
  previewBox.textContent = message;
  blocksList.textContent = "No blocks available.";
  outputsList.textContent = "No outputs available.";
  scormPanel.textContent = "SCORM readiness could not be assessed.";
  mediaList.textContent = currentMediaBundle.length ? "Media ZIP is loaded. Upload a valid source document to match explicit media tags." : "Upload a source document and optional media ZIP to inspect explicit media references.";
  renderWarnings([{ level: "danger", title: "File could not be processed", detail: message }], []);
}

function renderMediaError(message) {
  currentMediaZipName = "";
  currentMediaZipBuffer = null;
  currentMediaBundle = [];
  currentMediaIndex = new Map();
  currentMediaDuplicateNames = new Set();
  mediaMeta.innerHTML = `<span>${escapeHtml(message)}</span>`;
  if (currentAnalysis) {
    currentAnalysis = applyMediaStateToAnalysis(currentAnalysis);
    renderAnalysis(currentSourceText, currentAnalysis);
  } else {
    renderMediaPanel(null);
  }
}

// ─── Summary report ────────────────────────────────────────────────────────
function buildSummaryReport() {
  if (!currentAnalysis) return "";
  const filenames = currentAnalysis.blocks.filter((block) => block.filename).map((block) => block.filename);
  const warnings  = dedupeWarnings([...currentAnalysis.warnings, ...currentAnalysis.media.warnings]);
  const missingDecisions = currentAnalysis.scorm.checks.filter((item) => !item.ok).map((item) => `- ${item.label}: ${item.missing}`);
  const proposed = currentAnalysis.blocks.length ? currentAnalysis.blocks.map((block) => `- Block ${block.order}: ${block.filename || "(missing filename)"} -> ${block.outputType} -> ${block.destination} (lines ${block.startLine}-${block.endLine})`) : ["- No supported tagged blocks detected."];
  return [
    "Document Splitter — Output Summary",
    "===================================",
    `Source file: ${currentSourceFile || "Unknown"}`,
    `Media ZIP: ${currentMediaZipName || "None loaded"}`,
    `Detected blocks: ${currentAnalysis.blocks.length}`,
    `Valid filenames: ${filenames.length}`,
    "",
    "Filenames found:",
    ...(filenames.length ? filenames.map((name) => `- ${name}`) : ["- None"]),
    "",
    "Warnings and errors:",
    ...(warnings.length ? warnings.map((warning) => `- [${warning.level.toUpperCase()}] ${warning.title}: ${warning.detail}`) : ["- No obvious warnings detected."]),
    "",
    "Proposed outputs:",
    ...proposed,
    "",
    "Media summary:",
    `- Embedded images in DOCX: ${currentAnalysis.media.embeddedCount || 0}`,
    `- Files loaded from ZIP: ${currentAnalysis.media.loadedFiles}`,
    `- Explicit media refs: ${currentAnalysis.media.references.length}`,
    `- Matched media: ${currentAnalysis.media.matchedFiles.length}`,
    `- Missing refs: ${currentAnalysis.media.missingCount}`,
    `- Ambiguous refs: ${currentAnalysis.media.ambiguousCount}`,
    `- Unused media files: ${currentAnalysis.media.unusedFiles.length}`,
    "",
    "SCORM readiness:",
    `- ${currentAnalysis.scorm.summary}`,
    ...(currentAnalysis.scorm.hasScormContent && missingDecisions.length ? ["", "Missing SCORM decisions:", ...missingDecisions] : []),
    "",
    "Output note:",
    "- HTML outputs are generated using mammoth.js for faithful formatting preservation.",
    "- DOCX outputs are real Word files assembled from the source document XML.",
    "- All matched media files are embedded inline in HTML outputs and included in the bundle ZIP."
  ].join("\n");
}

// ─── SCORM manifest ────────────────────────────────────────────────────────
function buildBasicManifest(analysis, artefacts) {
  if (!analysis || !artefacts.length) return "";
  const htmlArtefacts = artefacts.filter((file) => /\.html?$/i.test(file.filename));
  if (!htmlArtefacts.length) return "";

  const packageId = `${baseName(currentSourceFile) || "prototype"}-package`.toLowerCase().replace(/[^a-z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "prototype-package";
  const orgId = `${packageId}-org`;
  const title = baseName(currentSourceFile) || "Prototype SCORM Package";
  const artefactEntries = artefacts.map((file, index) => ({ resourceId: `res-${index + 1}`, href: `generated/${file.filename}`, scormType: file.tagType.toLowerCase() === "html" ? "sco" : "asset", title: file.filename }));
  const mediaEntries    = uniqueMatchedMedia(analysis).map((file, index) => ({ resourceId: `media-res-${index + 1}`, href: `media/${file.exportName}`, scormType: "asset", title: file.exportName }));

  return `<?xml version="1.0" encoding="UTF-8"?>
<manifest identifier="${escapeXml(packageId)}"
  version="1.0"
  xmlns="http://www.imsproject.org/xsd/imscp_rootv1p1p2"
  xmlns:adlcp="http://www.adlnet.org/xsd/adlcp_rootv1p2"
  xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance"
  xsi:schemaLocation="http://www.imsproject.org/xsd/imscp_rootv1p1p2 ims_xml.xsd
  http://www.adlnet.org/xsd/adlcp_rootv1p2 adlcp_rootv1p2.xsd">
  <metadata><schema>ADL SCORM</schema><schemaversion>1.2</schemaversion></metadata>
  <organizations default="${escapeXml(orgId)}">
    <organization identifier="${escapeXml(orgId)}">
      <title>${escapeXml(title)}</title>
${artefactEntries.filter((e) => e.scormType === "sco").map((e, i) => `      <item identifier="item-${i + 1}" identifierref="${e.resourceId}"><title>${escapeXml(e.title)}</title></item>`).join("\n")}
    </organization>
  </organizations>
  <resources>
${[...artefactEntries, ...mediaEntries].map((e) => `    <resource identifier="${e.resourceId}" type="webcontent" adlcp:scormtype="${e.scormType}" href="${escapeXml(e.href)}"><file href="${escapeXml(e.href)}" /></resource>`).join("\n")}
  </resources>
</manifest>`;
}

// ─── Bundle download ───────────────────────────────────────────────────────
async function downloadBundle() {
  const zip = new JSZip();
  const matchedMedia = uniqueMatchedMedia(currentAnalysis);
  zip.file("summary-report.txt", buildSummaryReport());
  zip.file("blocks-metadata.json", JSON.stringify(currentAnalysis.blocks.map((b) => ({
    order: b.order, tagType: b.tagType, filename: b.filename, outputType: b.outputType,
    destination: b.destination, classification: b.classification,
    mediaRefs: b.mediaRefs.map((r) => ({ tag: r.tag, filename: r.filename, status: r.status, exportPath: r.matchedFile ? `media/${r.matchedFile.exportName}` : null }))
  })), null, 2));
  zip.file("scorm-readiness.txt", [
    currentAnalysis.scorm.summary, "",
    ...currentAnalysis.scorm.checks.map((item) => `${item.label}: ${item.ok ? "FOUND" : `MISSING - ${item.missing}`}`),
    "",
    `Media ZIP loaded: ${currentMediaZipName || "No"}`,
    `Matched media files: ${matchedMedia.length}`,
    `Missing media refs: ${currentAnalysis.media.missingCount}`,
    `Ambiguous media refs: ${currentAnalysis.media.ambiguousCount}`
  ].join("\n"));

  if (currentSourceBuffer)   zip.file(`source/${currentSourceFile}`, currentSourceBuffer);
  if (currentMediaZipBuffer) zip.file(`source/${currentMediaZipName}`, currentMediaZipBuffer);

  // Generated artefacts: HTML files have .content (string), DOCX files have .blob
  for (const file of generatedArtefacts) {
    if (file.blob)    zip.file(`generated/${file.filename}`, file.blob);
    else if (file.content) zip.file(`generated/${file.filename}`, file.content);
  }
  matchedMedia.forEach((file) => zip.file(`media/${file.exportName}`, file.data));

  const manifest = buildBasicManifest(currentAnalysis, generatedArtefacts);
  if (manifest) zip.file("imsmanifest.xml", manifest);

  triggerDownload(createObjectUrl(await zip.generateAsync({ type: "blob" })), `${baseName(currentSourceFile) || "prototype"}-output-bundle.zip`);
}

// ─── UI helpers ────────────────────────────────────────────────────────────

function createDownloadUrl(content, mime) {
  return createObjectUrl(new Blob([content], { type: mime }));
}

function createObjectUrl(blob) {
  const url = URL.createObjectURL(blob);
  activeObjectUrls.push(url);
  return url;
}

function downloadTextFile(filename, content) {
  triggerDownload(createDownloadUrl(content, "text/plain;charset=utf-8"), filename);
}

function triggerDownload(url, filename) {
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function revokeObjectUrls() {
  activeObjectUrls.forEach((url) => URL.revokeObjectURL(url));
  activeObjectUrls = [];
}

function resetSourceState() {
  currentSourceFile       = "";
  currentSourceBuffer     = null;
  currentSourceText       = "";
  currentAnalysis         = null;
  currentParagraphs       = [];
  currentDocxZip          = null;
  currentRels             = new Map();
  currentStylesXml        = null;
  currentNumberingXml     = null;
  currentThemeXml         = null;
  currentDocXml           = null;
  currentEmbeddedMedia    = [];
  currentEmbeddedMediaIndex = new Map();
  generatedArtefacts      = [];
  hasBuilt                = false;

  buildCta.hidden         = true;
  buildAllBtn.disabled    = false;
  buildAllBtn.innerHTML   = `<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polygon points="5 3 19 12 5 21 5 3"/></svg> Build Outputs`;
  ctaInfo.textContent     = "";
  ctaSummaryBtn.disabled  = true;
  ctaBundleBtn.disabled   = true;
  resultsArea.hidden      = true;

  // Re-collapse all detail panels
  document.querySelectorAll("[data-collapsible]").forEach((p) => p.classList.add("is-collapsed"));

  blocksCount.textContent  = "0 blocks";
  outputsCount.textContent = "0 outputs";
  warningsCount.textContent = "0 warnings";
  scormStatus.textContent  = "Not assessed";
  mediaCount.textContent   = currentMediaBundle.length ? `${currentMediaBundle.length} files loaded` : "0 references";
  previewBox.className     = "empty-state";
  previewBox.textContent   = "Upload a tagged .docx to see the extracted document text here.";
  previewStatus.textContent = "Waiting for upload";
  blocksList.className     = "empty-state";
  blocksList.textContent   = "No blocks yet. Upload a document to detect <HTML>, <worksheet>, and <document> sections.";
  outputsList.className    = "empty-state";
  outputsList.textContent  = "Proposed outputs will appear here after tags and filenames are detected.";
  scormPanel.className     = "empty-state";
  scormPanel.textContent   = "Upload a source document to inspect SCORM-related notes and missing decisions.";
  warningsList.innerHTML   = "";
  const warningsPanel = document.getElementById("warningsPanel");
  if (warningsPanel) warningsPanel.hidden = true;
  generatedList.innerHTML  = "";
  generatedCount.textContent = "0 files";
  fileMeta.innerHTML       = "<span>No source file loaded yet.</span>";
  renderMediaPanel(null);
}

// ─── Analysis utilities ────────────────────────────────────────────────────
function emptyMediaState() {
  return { zipName: currentMediaZipName, loadedFiles: currentMediaBundle.length, embeddedCount: currentEmbeddedMedia.length, references: [], matchedFiles: [], missingCount: 0, ambiguousCount: 0, unusedFiles: currentMediaBundle, warnings: [] };
}

function extractMediaReferences(body) {
  const refs = [];
  let match;
  while ((match = MEDIA_PATTERN.exec(body)) !== null) refs.push({ tag: match[1].toLowerCase(), filename: sanitizeMediaReferenceName(match[2]) });
  MEDIA_PATTERN.lastIndex = 0;
  return refs;
}

function stripMediaTags(body) {
  return body.replace(MEDIA_PATTERN, "").replace(/\n{3,}/g, "\n\n");
}

function stripStructuralTags(body) {
  return String(body || "")
    .replace(/<filename>\s*\"?([^\"<>\n]+)\"?\s*<\/filename>/gi, "")
    .replace(/<\/?(HTML|worksheet|document)>/gi, "")
    .replace(/\n{3,}/g, "\n\n");
}

// Regex matching tag markup that should never appear as visible text in output files.
const NODE_TAG_STRIP_RE = /<\/?(HTML|worksheet|document)\s*>|<filename>[^<>]*<\/filename>|<(?:image|video|audio|datasheet)[^<>]*>[^<>]*<\/(?:image|video|audio|datasheet)>/gi;

// Strip tag markup text from a DOM node (mutates — call on imported copies only).
// Works at the w:p level so split-across-runs tags are caught by joining all runs first.
// Handles both standalone paragraphs and paragraphs inside cover tables.
function stripTagMarkupFromNode(node) {
  const paras = node.localName === "p" ? [node] : [];
  if (!paras.length && node.getElementsByTagNameNS) {
    const nl = node.getElementsByTagNameNS("*", "p");
    for (let i = 0; i < nl.length; i++) paras.push(nl[i]);
  }
  for (const para of paras) {
    const tNodes = para.getElementsByTagNameNS ? para.getElementsByTagNameNS("*", "t") : [];
    if (!tNodes.length) continue;
    const fullText = Array.from(tNodes).map(t => t.textContent || "").join("");
    if (!fullText.replace(NODE_TAG_STRIP_RE, "").trim()) {
      // Whole paragraph is just structural tag text — wipe all runs
      for (const t of tNodes) t.textContent = "";
    } else {
      // Real content — only strip individual runs that exactly match a tag pattern
      for (const t of tNodes) {
        const orig = t.textContent || "";
        const stripped = orig.replace(NODE_TAG_STRIP_RE, "");
        if (stripped !== orig) t.textContent = stripped;
      }
    }
  }
}

// Returns true if a node has no inline drawings and no non-whitespace text — safe to drop from output.
function isNodeEffectivelyEmpty(node) {
  if ((node.getElementsByTagNameNS("*", "drawing") || []).length > 0) return false;
  if ((node.getElementsByTagNameNS("*", "blip")    || []).length > 0) return false;
  const tNodes = node.getElementsByTagNameNS ? node.getElementsByTagNameNS("*", "t") : [];
  for (const t of tNodes) { if ((t.textContent || "").trim()) return false; }
  return true;
}

// ─── Prototype HTML helpers (used by fallback builder) ─────────────────────
function deriveDisplayContent(block, filename) {
  const lines = splitBodyLines(block.body);
  const matchedMedia = block.mediaRefs.filter((ref) => ref.status === "matched");
  const missingMedia = block.mediaRefs.filter((ref) => ref.status !== "matched");
  let title = baseName(filename) || filename;
  let subtitle = "";
  let contentLines = [...lines];

  if (lines.length) {
    if (/^worksheet\b/i.test(lines[0]) || /^document\b/i.test(lines[0]) || /^introduction\b/i.test(lines[0])) {
      title = lines[0]; contentLines = lines.slice(1);
    } else if (lines[0].length <= 70) {
      title = lines[0]; contentLines = lines.slice(1);
    }
  }
  if (contentLines.length && contentLines[0].length <= 110 && !looksLikeSectionLabel(contentLines[0])) {
    subtitle = contentLines[0]; contentLines = contentLines.slice(1);
  }
  return { title, subtitle, contentLines, leadMedia: matchedMedia[0] || null, remainingMedia: matchedMedia.slice(1), missingMedia };
}

function renderSingleMediaHtml(ref) {
  if (ref.status !== "matched" || !ref.matchedFile) return `<p style="margin:0;color:#64748b;line-height:1.7;">${escapeHtml(ref.tag)}: ${escapeHtml(ref.filename)} (${escapeHtml(ref.detail)})</p>`;
  const embeddedHref = ref.matchedFile.dataUrl || buildEmbeddedMediaUrl(ref.matchedFile);
  if (ref.tag === "image"     && isImageFile(ref.matchedFile.exportName))  return `<strong>Image:</strong> ${escapeHtml(ref.matchedFile.exportName)}<img src="${embeddedHref}" alt="${escapeHtml(ref.matchedFile.exportName)}" />`;
  if (ref.tag === "video"     && isVideoFile(ref.matchedFile.exportName))  return `<strong>Video:</strong> ${escapeHtml(ref.matchedFile.exportName)}<video controls src="${embeddedHref}"></video>`;
  if (ref.tag === "audio"     && isAudioFile(ref.matchedFile.exportName))  return `<strong>Audio:</strong> ${escapeHtml(ref.matchedFile.exportName)}<audio controls src="${embeddedHref}"></audio>`;
  return `<strong>${escapeHtml(capitalize(ref.tag))}:</strong> <a href="${embeddedHref}" download="${escapeHtml(ref.matchedFile.exportName)}">${escapeHtml(ref.matchedFile.exportName)}</a>`;
}

function renderBodyContentHtml(lines) {
  if (!lines.length) return `<p>(No visible text inside block)</p>`;
  const html = [];
  let listBuffer = [];
  const flushList = () => {
    if (!listBuffer.length) return;
    html.push(`<ul>${listBuffer.map((line) => `<li>${linkifyText(escapeHtml(line))}</li>`).join("")}</ul>`);
    listBuffer = [];
  };
  lines.forEach((line) => {
    if (looksLikeSectionLabel(line)) { flushList(); html.push(`<h2>${escapeHtml(trimTrailingColon(line))}</h2>`); return; }
    if (looksLikeBullet(line))       { listBuffer.push(line.replace(/^[-*•]\s+/, "").trim()); return; }
    flushList();
    html.push(`<p>${linkifyText(escapeHtml(line))}</p>`);
  });
  flushList();
  return html.join("");
}

// ─── Pure utilities ────────────────────────────────────────────────────────
function splitBodyLines(value) {
  return sanitizeBodyText(value).split(/\r?\n/).map((line) => line.trim()).filter(Boolean);
}

function sanitizeBodyText(value) {
  return String(value || "").replace(/ /g, " ").replace(/[""]/g, "\"").replace(/['']/g, "'").replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
}

function sanitizeFilenameValue(value) {
  const cleaned = String(value || "")
    .replace(/[“”]/g, "")   // left/right double quotation marks (curly)
    .replace(/[‘’]/g, "")   // left/right single quotation marks (curly)
    .replace(/[​-‏﻿]/g, "")  // zero-width / BOM chars
    .trim();
  return cleaned.replace(/[<>:"|?*]/g, "").replace(/\s+/g, " ");
}

function sanitizeMediaReferenceName(value) {
  return sanitizeFilenameValue(value).replace(/^\.?[\\/]+/, "");
}

function looksLikeSectionLabel(line) {
  return /^[A-Z][A-Za-z0-9 /&()-]{1,40}:$/.test(line) || /^(over to you|challenges|hints|resources|extensions):?$/i.test(line);
}
function trimTrailingColon(line) { return String(line).replace(/:\s*$/, ""); }
function looksLikeBullet(line)   { return /^[-*•]\s+/.test(line); }
function linkifyText(html)       { return html.replace(/(https?:\/\/[^\s<]+)/gi, '<a href="$1" target="_blank" rel="noopener noreferrer">$1</a>'); }

function buildMediaIndex(files) {
  const counts = new Map();
  files.forEach((file) => counts.set(file.key, (counts.get(file.key) || 0) + 1));
  const duplicates = new Set([...counts.entries()].filter(([, count]) => count > 1).map(([key]) => key));
  const index = new Map();
  files.forEach((file) => { if (!duplicates.has(file.key)) index.set(file.key, file); });
  return { index, duplicates };
}

function dedupeWarnings(warnings) {
  const seen = new Set();
  return warnings.filter((w) => {
    const key = `${w.level}|${w.title}|${w.detail}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function uniqueMatchedMedia(analysis) {
  const seen = new Set();
  return analysis.media.references
    .filter((ref) => ref.status === "matched" && ref.matchedFile)
    .map((ref) => ref.matchedFile)
    .filter((file) => { if (seen.has(file.key)) return false; seen.add(file.key); return true; });
}

function baseName(filename)         { return filename ? filename.replace(/\.[^.]+$/, "") : ""; }
function lineNumberAt(text, index)  { return String(text || "").slice(0, index).split("\n").length; }
function basenameOnly(value)        { return String(value).split("/").pop().split("\\").pop(); }
function normalizeMediaName(value)  { return basenameOnly(value).trim().toLowerCase().replace(/[\s]+/g, "_"); }
// Sanitize a media filename for use inside a DOCX ZIP and as an OOXML relationship Target.
// OOXML relationship Targets are anyURIs — spaces are not valid in a URI path segment and
// cause Word to silently fail to load the image.  Replace spaces (and other unsafe chars)
// with underscores so the Target is always a valid URI without needing percent-encoding.
function sanitizeMediaFilename(name) { return String(name).replace(/[\s#%&?]/g, "_"); }

function blobToDataUrl(blob) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload  = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error || new Error("Could not convert blob to data URL."));
    reader.readAsDataURL(blob);
  });
}

function buildEmbeddedMediaUrl(file) {
  return `data:${file.mime || "application/octet-stream"};base64,${uint8ToBase64(file.data)}`;
}

function uint8ToBase64(uint8) {
  let binary = "";
  const chunkSize = 32768;
  for (let i = 0; i < uint8.length; i += chunkSize) {
    binary += String.fromCharCode(...uint8.subarray(i, i + chunkSize));
  }
  return btoa(binary);
}

function getMimeType(filename) {
  const lower = filename.toLowerCase();
  if (/\.(jpg|jpeg)$/.test(lower)) return "image/jpeg";
  if (/\.png$/.test(lower))        return "image/png";
  if (/\.gif$/.test(lower))        return "image/gif";
  if (/\.svg$/.test(lower))        return "image/svg+xml";
  if (/\.webp$/.test(lower))       return "image/webp";
  if (/\.mp4$/.test(lower))        return "video/mp4";
  if (/\.webm$/.test(lower))       return "video/webm";
  if (/\.mp3$/.test(lower))        return "audio/mpeg";
  if (/\.wav$/.test(lower))        return "audio/wav";
  if (/\.pdf$/.test(lower))        return "application/pdf";
  if (/\.docx$/.test(lower))       return "application/vnd.openxmlformats-officedocument.wordprocessingml.document";
  return "application/octet-stream";
}

function isImageFile(filename) { return /\.(png|jpe?g|gif|svg|webp)$/i.test(filename); }
function isVideoFile(filename) { return /\.(mp4|webm|ogg)$/i.test(filename); }
function isAudioFile(filename) { return /\.(mp3|wav|ogg|m4a)$/i.test(filename); }
function capitalize(value)     { return value ? `${value.charAt(0).toUpperCase()}${value.slice(1)}` : ""; }

function makeExcerpt(value, maxLength) {
  const cleaned = value.replace(/\s+/g, " ").trim();
  if (!cleaned) return "";
  return cleaned.length <= maxLength ? cleaned : `${cleaned.slice(0, maxLength).trim()}...`;
}

function escapeXml(value)  { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&apos;"); }
function escapeHtml(value) { return String(value).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\"/g, "&quot;").replace(/'/g, "&#39;"); }
