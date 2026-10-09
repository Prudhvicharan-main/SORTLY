// ============================================================
// SORTLY — WhatsApp College File Organizer
// Content Script (content.js)
// Complete Automation Reliability & Premium Draggable Widget
// ============================================================

console.log("🚀 Sortly content script initializing...");

// ============================================================
// 1. CONFIGURATION & CONSTANTS
// ============================================================

const DEFAULT_MAPPINGS = {
    "9968_OOPJ_25SC2006L_S:2-L-2026-2027-ODDSEM": "Java",
    "ESD&IoT LE": "IoT",
    "Y25-Mathematics for Data Science": "Maths DS",
    "25CS2102L": "OS",
    "AIML le 2k26": "AIML",
    "S-3 MFE Lateral": "MATHS FOR ENGINER"
};
const DEFAULT_BASE_FOLDER = "E:\\College Files";

function getConfiguredGroups() {
    return Object.keys((localStore && localStore.mappings) || DEFAULT_MAPPINGS);
}

const supportedExtensions = [
    ".pdf",
    ".doc",
    ".docx",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
    ".txt",
    ".zip"
];

// Persistent state cache
let localStore = {
    version: 2,
    runState: "STOPPED",
    baseFolder: DEFAULT_BASE_FOLDER,
    mappings: { ...DEFAULT_MAPPINGS },
    groups: {},
    activeJobs: {}
};

let activeGroupName = "Unknown";
let initialImportRunning = false;
let currentActivityText = "Sortly ready";
let bridgeOnline = true;
let isSecondaryExpanded = false;
let isWidgetMinimized = false;

// In-memory DOM caching to prevent re-processing nodes during scroll
const processedDomNodes = new WeakSet();

// ============================================================
// 2. TEXT NORMALIZATION & ROBUST CANONICAL GROUP RESOLUTION
// ============================================================

function normalizeText(value) {
    return (value || "")
        .replace(/[\u200B-\u200D\uFEFF\u200E\u200F\u202A-\u202E]/g, "")
        .replace(/\u00A0/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}

function isSupportedFile(fileName) {
    if (!fileName) return false;
    const lower = normalizeText(fileName).toLowerCase();
    return supportedExtensions.some(ext => lower.endsWith(ext));
}

function stripDuplicateSuffix(fileName) {
    if (!fileName) return "";
    const clean = normalizeText(fileName);
    const lastDot = clean.lastIndexOf(".");
    if (lastDot === -1) return clean;
    const namePart = clean.substring(0, lastDot).replace(/\s*\(\d+\)$/, "").trim();
    const extPart = clean.substring(lastDot);
    return `${namePart}${extPart}`;
}

// Canonical group resolution with case-insensitivity, symbol stripping, and alias support
function resolveConfiguredGroup(rawText) {
    if (!rawText) return null;
    const norm = normalizeText(rawText);
    if (!norm) return null;
    const lower = norm.toLowerCase();

    const allGroups = getConfiguredGroups();

    // 1. Exact match (case-insensitive)
    for (const g of allGroups) {
        if (lower === g.toLowerCase()) {
            return g;
        }
    }

    // 2. Clean alphanumeric matching (handles emojis, unusual spaces, and symbols)
    const alphaOnly = lower.replace(/[^a-z0-9]/g, "");

    // AIML group: "AIML le 2k26" (matches AIML LE 2K26, AIML le 2026, AIML, etc.)
    if (alphaOnly.includes("aimlle2k26") || (lower.includes("aiml") && (lower.includes("2k26") || lower.includes("2026") || lower.includes("le")))) {
        return "AIML le 2k26";
    }
    if (lower.startsWith("aiml") || lower === "aiml") {
        return "AIML le 2k26";
    }

    // Maths for Engineering: "S-3 MFE Lateral"
    if (alphaOnly.includes("s3mfelateral") || lower.includes("s-3 mfe") || lower.includes("s3 mfe") || (lower.includes("mfe") && lower.includes("lateral"))) {
        return "S-3 MFE Lateral";
    }
    if (lower.includes("mfe") && !lower.includes("data science") && !lower.includes("maths ds")) {
        return "S-3 MFE Lateral";
    }
    if (lower.includes("math") && (lower.includes("enginer") || lower.includes("engineer")) && !lower.includes("data science")) {
        return "S-3 MFE Lateral";
    }

    // OS group: "25CS2102L"
    if (alphaOnly.includes("25cs2102l") || lower.includes("25cs2102l")) {
        return "25CS2102L";
    }

    // Java group: "9968_OOPJ_25SC2006L_S:2-L-2026-2027-ODDSEM"
    if (alphaOnly.includes("9968oopj") || lower.includes("9968_oopj") || (lower.includes("oopj") && lower.includes("25sc2006l")) || lower.includes("oopj")) {
        return "9968_OOPJ_25SC2006L_S:2-L-2026-2027-ODDSEM";
    }

    // IoT group: "ESD&IoT LE"
    if (alphaOnly.includes("esdiotle") || lower.includes("esd&iot") || lower.includes("esd & iot") || (lower.includes("esd") && lower.includes("iot"))) {
        return "ESD&IoT LE";
    }

    // Maths for Data Science group: "Y25-Mathematics for Data Science"
    if (alphaOnly.includes("y25mathematicsfordatascience") || (lower.includes("mathematics") && lower.includes("data science")) || lower.includes("maths ds") || lower.includes("25mt1306")) {
        return "Y25-Mathematics for Data Science";
    }

    // Dynamic heuristic matching for custom user groups:
    for (const g of allGroups) {
        const gLower = g.toLowerCase();
        const gAlpha = gLower.replace(/[^a-z0-9]/g, "");
        if (gAlpha.length >= 3 && alphaOnly.includes(gAlpha)) {
            return g;
        }
        if (gLower.length >= 3 && (lower.includes(gLower) || gLower.includes(lower))) {
            return g;
        }
    }

    return null;
}

function getActiveMainPanel() {
    return document.getElementById("main") || document.querySelector("#main");
}

function detectActiveGroup() {
    const main = getActiveMainPanel();
    if (!main) return "Unknown";

    // Strictly inspect the active conversation header only (never the sidebar #side)
    const header = main.querySelector("header") || main.querySelector('[role="banner"]');
    if (!header) return "Unknown";

    // 1. Title attributes in header
    const titleElements = header.querySelectorAll("[title]");
    for (const el of titleElements) {
        const matched = resolveConfiguredGroup(el.getAttribute("title"));
        if (matched) return matched;
    }

    // 2. Lines of header text
    const lines = (header.innerText || "").split(/\r?\n/);
    for (const line of lines) {
        const matched = resolveConfiguredGroup(line);
        if (matched) return matched;
    }

    // 3. Candidate header spans / headings
    const candidateElements = header.querySelectorAll(
        '[data-testid="conversation-info-header"], span[dir="auto"], span, div[role="button"]'
    );
    for (const el of candidateElements) {
        const matched = resolveConfiguredGroup(el.textContent);
        if (matched) return matched;
    }

    return "Unknown";
}

// ============================================================
// 3. PERSISTENT STATE SYNCHRONIZATION
// ============================================================

async function refreshStore() {
    try {
        const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
        if (response && response.ok && response.store) {
            localStore = response.store;
        }
    } catch (err) {
        // Service worker waking up
    }
}

async function pollBridgeStatus() {
    try {
        const res = await chrome.runtime.sendMessage({ type: "CHECK_BRIDGE_STATUS" });
        bridgeOnline = Boolean(res && res.online);
    } catch (e) {
        bridgeOnline = false;
    }
    updateWidgetUI();
}

function getLocalGroupState(groupName) {
    if (!localStore.groups[groupName]) {
        localStore.groups[groupName] = {
            importCompleted: false,
            baselineInitialized: false,
            baselineFileKeys: [],
            processedFileKeys: [],
            organizedFiles: [],
            failedJobs: {}
        };
    }
    return localStore.groups[groupName];
}

// ============================================================
// 4. DOCUMENT DISCOVERY & DEDUPLICATION (ONE ELEMENT PER ROW)
// ============================================================

function getDocumentElements() {
    const main = getActiveMainPanel();
    if (!main) return [];

    // Query potential document indicators
    const allMatches = main.querySelectorAll(
        '[data-testid="document-thumb"], [role="button"][title*="Download"], [title*="Download"]'
    );

    const uniqueList = [];
    const seenRows = new Set();

    for (const el of allMatches) {
        // Deduplicate strictly by message container row
        const row = el.closest('[data-id]') || el.closest('[role="row"]') || el.parentElement;
        if (!row) continue;
        if (seenRows.has(row)) continue;
        seenRows.add(row);
        uniqueList.push({ button: el, row: row });
    }

    return uniqueList;
}

function getFileNameFromButton(button, row) {
    if (!button) return null;

    // 1. Title attribute
    const title = button.getAttribute("title") || "";
    const titleMatch = title.match(/Download\s+"(.+?)"/i) || title.match(/Download\s+(.+)/i);
    if (titleMatch && titleMatch[1]) {
        return normalizeText(titleMatch[1]);
    }

    // 2. Aria-label attribute
    const aria = button.getAttribute("aria-label") || "";
    const ariaMatch = aria.match(/Download\s+"(.+?)"/i) || aria.match(/Download\s+(.+)/i);
    if (ariaMatch && ariaMatch[1]) {
        return normalizeText(ariaMatch[1]);
    }

    // 3. Search parent row for document text
    const targetRow = row || button.closest('[data-id]') || button.closest('[role="row"]');
    if (targetRow) {
        const titleEls = targetRow.querySelectorAll("[title]");
        for (const el of titleEls) {
            const t = normalizeText(el.getAttribute("title"));
            if (isSupportedFile(t) && t.length < 255) {
                return t;
            }
        }
        const textElements = targetRow.querySelectorAll("span, div");
        for (const el of textElements) {
            const txt = normalizeText(el.textContent);
            if (isSupportedFile(txt) && txt.length < 255 && !txt.includes("\n")) {
                return txt;
            }
        }
    }

    return null;
}

function createStableDocumentKey(groupName, row, fileName) {
    const msgId = row ? (row.getAttribute("data-id") || row.id || "") : "";
    const cleanName = stripDuplicateSuffix(fileName);
    if (msgId) {
        return `${groupName}::${msgId}::${cleanName}`;
    }
    return `${groupName}::${cleanName}`;
}

// ============================================================
// 5. SAFE CLICK & SAFE MODAL CLOSING (NO ESCAPE KEY ON DOCUMENT!)
// ============================================================

function dispatchClick(el) {
    if (!el) return;
    try {
        el.focus();
        const eventTypes = ["pointerdown", "mousedown", "pointerup", "mouseup", "click"];
        for (const type of eventTypes) {
            el.dispatchEvent(new MouseEvent(type, {
                bubbles: true,
                cancelable: true,
                view: window
            }));
        }
    } catch (e) {
        console.error("Error dispatching click:", e);
    }
}

async function triggerDownload(element, fileName = "") {
    if (!element) return;
    try {
        // Step 0: Safely close any lingering preview modal using its close button
        const existingDialog = document.querySelector('div[role="dialog"]');
        if (existingDialog) {
            const closeBtn = existingDialog.querySelector(
                '[data-testid="media-viewer-close"], [data-icon="x"], [title*="Close"], [aria-label*="Close"], button'
            );
            if (closeBtn) {
                dispatchClick(closeBtn);
            } else {
                // Dispatch escape ONLY to the dialog element itself, NEVER to document/window!
                existingDialog.dispatchEvent(new KeyboardEvent('keydown', {
                    key: 'Escape',
                    code: 'Escape',
                    keyCode: 27,
                    bubbles: true
                }));
            }
            await new Promise(r => setTimeout(r, 60));
        }

        // Step 1: Scroll message into view
        element.scrollIntoView({ behavior: "auto", block: "center" });
        await new Promise(r => setTimeout(r, 50));

        // Step 2: Check if row has a specific direct download button
        const row = element.closest('[data-id]') || element.closest('[role="row"]');
        const directDownloadBtn = row ? row.querySelector('[data-icon="download"], [title*="Download"], [aria-label*="Download"]') : null;
        const targetBtn = directDownloadBtn || element;

        dispatchClick(targetBtn);

        // Step 3: Handle PDF preview modal ONLY if the document is a PDF
        const isPdf = (fileName || "").toLowerCase().endsWith(".pdf");
        if (isPdf) {
            let modalDownloadBtn = null;
            for (let attempt = 0; attempt < 4; attempt++) {
                await new Promise(r => setTimeout(r, 50));
                const dialog = document.querySelector('div[role="dialog"]');
                if (!dialog) {
                    if (attempt >= 1) break;
                    continue;
                }
                modalDownloadBtn = dialog.querySelector(
                    '[title*="Download"], [data-icon="download"], [data-testid="media-viewer-download"], [aria-label*="Download"]'
                );
                if (modalDownloadBtn) break;
            }

            if (modalDownloadBtn) {
                dispatchClick(modalDownloadBtn);
                await new Promise(r => setTimeout(r, 80));

                const currentDialog = document.querySelector('div[role="dialog"]');
                if (currentDialog) {
                    const closeBtn = currentDialog.querySelector(
                        '[data-testid="media-viewer-close"], [data-icon="x"], [title*="Close"], [aria-label*="Close"], button'
                    );
                    if (closeBtn) {
                        dispatchClick(closeBtn);
                    } else {
                        currentDialog.dispatchEvent(new KeyboardEvent('keydown', {
                            key: 'Escape',
                            code: 'Escape',
                            keyCode: 27,
                            bubbles: true
                        }));
                    }
                }
                await new Promise(r => setTimeout(r, 50));
            }
        }
    } catch (err) {
        console.error("❌ Sortly failed to trigger download:", err);
    }
}

// ============================================================
// 6. BASELINE MANAGEMENT (PERSISTED IN CHROME.STORAGE.LOCAL)
// ============================================================

async function establishBaseline(groupName) {
    const groupState = getLocalGroupState(groupName);
    if (groupState.baselineInitialized) {
        return;
    }

    console.log(`🧠 Establishing baseline for "${groupName}"...`);
    currentActivityText = "Learning baseline files...";
    updateWidgetUI();

    await new Promise(r => setTimeout(r, 600));
    if (detectActiveGroup() !== groupName) return;

    const docItems = getDocumentElements();
    const newBaselineKeys = [];

    for (const item of docItems) {
        const fileName = getFileNameFromButton(item.button, item.row);
        if (fileName && isSupportedFile(fileName)) {
            const key = createStableDocumentKey(groupName, item.row, fileName);
            if (!newBaselineKeys.includes(key)) {
                newBaselineKeys.push(key);
            }
            processedDomNodes.add(item.row);
            item.button.dataset.sortlyBaseline = "true";
        }
    }

    groupState.baselineInitialized = true;
    groupState.baselineFileKeys = Array.from(new Set([...groupState.baselineFileKeys, ...newBaselineKeys]));

    await chrome.runtime.sendMessage({
        type: "UPDATE_GROUP_STATE",
        groupName: groupName,
        updates: {
            baselineInitialized: true,
            baselineFileKeys: groupState.baselineFileKeys
        }
    });

    console.log(`✅ Baseline established for "${groupName}": ${newBaselineKeys.length} files protected.`);
    currentActivityText = groupState.importCompleted ? "Monitoring new files" : "Ready for Initial Import";
    updateWidgetUI();
}

// ============================================================
// 7. LIVE MODE — AUTOMATIC DETECTION OF GENUINELY NEW FILES
// ============================================================

async function processNewDocuments(groupName) {
    await refreshStore();
    if (localStore.runState !== "RUNNING") return;

    const groupState = getLocalGroupState(groupName);
    if (!groupState.baselineInitialized) return;

    const docItems = getDocumentElements();
    const inFlightThisCycle = new Set();

    for (const item of docItems) {
        // Fast in-memory check to prevent re-processing on scroll
        if (processedDomNodes.has(item.row)) continue;

        const fileName = getFileNameFromButton(item.button, item.row);
        if (!fileName || !isSupportedFile(fileName)) continue;

        const cleanName = stripDuplicateSuffix(fileName).toLowerCase();
        if (inFlightThisCycle.has(cleanName)) continue;

        const key = createStableDocumentKey(groupName, item.row, fileName);

        // Check persistent baseline and processed keys
        if (groupState.baselineFileKeys.includes(key)) {
            processedDomNodes.add(item.row);
            continue;
        }
        if (groupState.processedFileKeys.includes(key)) {
            processedDomNodes.add(item.row);
            continue;
        }
        if (groupState.organizedFiles.includes(stripDuplicateSuffix(fileName))) {
            processedDomNodes.add(item.row);
            continue;
        }

        // Mark in-memory immediately before triggering
        processedDomNodes.add(item.row);
        inFlightThisCycle.add(cleanName);
        item.button.dataset.sortlyProcessed = "true";

        console.log(`🆕 Live Mode: New file discovered: "${fileName}" in "${groupName}"`);
        currentActivityText = `Downloading: ${fileName}`;
        updateWidgetUI();

        try {
            const regRes = await chrome.runtime.sendMessage({
                type: "REGISTER_JOB",
                groupName: groupName,
                fileName: fileName,
                elementKey: key
            });

            if (regRes && regRes.ok && regRes.job) {
                console.log(`📤 Job #${regRes.job.id} registered. Triggering download: "${fileName}"`);
                await triggerDownload(item.button, fileName);
            } else {
                if (regRes && (regRes.alreadyCompleted || regRes.error === "ALREADY_ACTIVE")) {
                    console.log(`⚡ File "${fileName}" already active or completed.`);
                }
            }
        } catch (err) {
            console.error(`❌ Failed to start live download for "${fileName}":`, err);
        }
    }
}

// ============================================================
// 8. INITIAL IMPORT (DELIBERATE, SEQUENTIAL & VERIFIED)
// ============================================================

async function startInitialImport() {
    const groupName = detectActiveGroup();
    if (groupName === "Unknown") {
        alert("Sortly: Please open a configured college group first.");
        return;
    }

    if (initialImportRunning) {
        console.warn("⚠️ Initial Import is already in progress.");
        return;
    }

    await refreshStore();
    if (localStore.runState === "STOPPED") {
        await setRunState("RUNNING");
    }

    initialImportRunning = true;
    console.log(`📥 Sortly Initial Import started for "${groupName}"...`);

    const docItems = getDocumentElements();
    console.log(`📚 Found ${docItems.length} unique document rows in view.`);

    let processedCount = 0;
    const seenNames = new Set();

    for (let i = 0; i < docItems.length; i++) {
        await refreshStore();
        if (localStore.runState === "PAUSED" || localStore.runState === "STOPPED") {
            console.warn(`⚠️ Initial Import suspended because Sortly is ${localStore.runState}.`);
            currentActivityText = `Work ${localStore.runState.toLowerCase()} — state preserved`;
            break;
        }

        if (detectActiveGroup() !== groupName) {
            console.warn("⚠️ Active group changed during Initial Import. Stopping.");
            break;
        }

        const item = docItems[i];
        const fileName = getFileNameFromButton(item.button, item.row);
        if (!fileName || !isSupportedFile(fileName)) continue;

        const cleanName = stripDuplicateSuffix(fileName).toLowerCase();
        if (seenNames.has(cleanName)) continue;
        seenNames.add(cleanName);

        const key = createStableDocumentKey(groupName, item.row, fileName);

        // Step 0: Check if file already exists in destination folder
        try {
            const checkRes = await chrome.runtime.sendMessage({
                type: "CHECK_FILE_EXISTS",
                groupName: groupName,
                fileName: fileName
            });

            if (checkRes && checkRes.exists) {
                console.log(`⚡ "${fileName}" already exists in subject folder. Skipping.`);
                currentActivityText = `Organized (${i + 1}/${docItems.length}): ${fileName}`;
                updateWidgetUI();
                processedCount++;

                const groupState = getLocalGroupState(groupName);
                if (!groupState.processedFileKeys.includes(key)) {
                    groupState.processedFileKeys.push(key);
                }
                const clean = stripDuplicateSuffix(fileName);
                if (!groupState.organizedFiles.includes(clean)) {
                    groupState.organizedFiles.push(clean);
                }
                processedDomNodes.add(item.row);
                continue;
            }
        } catch (e) {
            // Proceed to download
        }

        currentActivityText = `Importing (${i + 1}/${docItems.length}): ${fileName}`;
        updateWidgetUI();

        try {
            const regRes = await chrome.runtime.sendMessage({
                type: "REGISTER_JOB",
                groupName: groupName,
                fileName: fileName,
                elementKey: key
            });

            if (regRes && regRes.ok && regRes.job) {
                await triggerDownload(item.button, fileName);

                const waitRes = await chrome.runtime.sendMessage({
                    type: "AWAIT_JOB",
                    jobId: regRes.job.id,
                    timeout: 25000
                });

                if (waitRes && waitRes.ok) {
                    console.log(`🎉 Confirmed ORGANIZED: "${fileName}"`);
                    processedCount++;
                    processedDomNodes.add(item.row);
                } else {
                    console.error(`⚠️ Job did not complete for "${fileName}":`, waitRes);
                }

                await new Promise(r => setTimeout(r, 60));
            }
        } catch (err) {
            console.error(`❌ Initial Import error for "${fileName}":`, err);
        }
    }

    initialImportRunning = false;

    await refreshStore();
    if (localStore.runState === "RUNNING") {
        await chrome.runtime.sendMessage({
            type: "MARK_IMPORT_COMPLETED",
            groupName: groupName
        });
        await refreshStore();
        currentActivityText = `All caught up • ${processedCount} files organized`;
        console.log(`✅ Initial Import completed & persisted for "${groupName}".`);
    }

    updateWidgetUI();
}

// ============================================================
// 9. AUTOMATION CONTROLS (START, PAUSE, RESUME, STOP)
// ============================================================

async function setRunState(newState) {
    const res = await chrome.runtime.sendMessage({
        type: "SET_RUN_STATE",
        runState: newState
    });
    if (res && res.ok) {
        localStore.runState = newState;
        if (newState === "PAUSED") {
            currentActivityText = "Work paused — state preserved";
        } else if (newState === "STOPPED") {
            currentActivityText = "Automation stopped";
        } else if (newState === "RUNNING") {
            currentActivityText = "Monitoring new files";
        }
        updateWidgetUI();
    }
}

// Intercept manual clicks on document downloads
document.addEventListener("click", (e) => {
    const groupName = detectActiveGroup();
    if (groupName === "Unknown") return;

    const target = e.target;
    if (!target) return;

    const downloadTarget = target.closest(
        '[data-testid="document-thumb"], [data-icon="download"], [title*="Download"], [aria-label*="Download"], [role="button"]'
    );
    if (!downloadTarget) return;

    const row = downloadTarget.closest('[data-id]') || downloadTarget.closest('[role="row"]');
    const fileName = getFileNameFromButton(downloadTarget, row);
    if (!fileName || !isSupportedFile(fileName)) return;

    console.log(`👆 User clicked document manually: "${fileName}" in "${groupName}"`);
    chrome.runtime.sendMessage({
        type: "REGISTER_JOB",
        groupName: groupName,
        fileName: fileName,
        elementKey: createStableDocumentKey(groupName, row, fileName)
    });
}, true);

// Runtime message listener for active group query
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "GET_CURRENT_GROUP") {
        sendResponse({ groupName: detectActiveGroup() });
        return true;
    }
});

// ============================================================
// 10. MAIN OBSERVER LOOP (DEBOUNCED & SCOPED)
// ============================================================

async function checkActiveConversation() {
    const currentGroup = detectActiveGroup();

    if (currentGroup !== activeGroupName) {
        if (currentGroup !== "Unknown") {
            console.log(`🎯 Active configured group: "${currentGroup}"`);
            activeGroupName = currentGroup;
            await refreshStore();
            const groupState = getLocalGroupState(currentGroup);
            if (!groupState.baselineInitialized) {
                await establishBaseline(currentGroup);
            } else {
                currentActivityText = groupState.importCompleted ? "Monitoring new files" : "Ready for Initial Import";
            }
        } else {
            activeGroupName = "Unknown";
            currentActivityText = "Sortly idle • Open college group";
        }
        updateWidgetUI();
    }

    if (activeGroupName !== "Unknown" && !initialImportRunning) {
        await processNewDocuments(activeGroupName);
    }
}

let debounceTimer = null;
const observer = new MutationObserver(() => {
    if (debounceTimer) clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => {
        checkActiveConversation();
    }, 800);
});

observer.observe(document.body, { childList: true, subtree: true });
setInterval(checkActiveConversation, 2000);

// ============================================================
// 11. REDESIGNED PREMIUM DRAGGABLE SORTLY WIDGET
// ============================================================

const WIDGET_ID = "sortly-widget-panel";
const STORAGE_POS_KEY = "sortly_widget_pos";

function createWidgetStyles() {
    if (document.getElementById("sortly-custom-styles")) return;
    const style = document.createElement("style");
    style.id = "sortly-custom-styles";
    style.textContent = `
        #${WIDGET_ID} {
            position: fixed;
            z-index: 9999999;
            font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif;
            color: #f3f4f6;
            background: rgba(17, 24, 39, 0.94);
            backdrop-filter: blur(16px);
            -webkit-backdrop-filter: blur(16px);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 14px;
            box-shadow: 0 16px 40px rgba(0, 0, 0, 0.55), 0 0 0 1px rgba(255, 255, 255, 0.05);
            transition: box-shadow 0.2s ease, opacity 0.2s ease;
            user-select: none;
            width: 320px;
            box-sizing: border-box;
        }
        #${WIDGET_ID}.minimized {
            width: auto;
            border-radius: 24px;
            padding: 6px 14px;
            cursor: pointer;
        }
        #${WIDGET_ID} * {
            box-sizing: border-box;
        }
        .sortly-header {
            display: flex;
            align-items: center;
            justify-content: space-between;
            padding: 10px 14px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            cursor: grab;
            border-top-left-radius: 14px;
            border-top-right-radius: 14px;
        }
        .sortly-header:active {
            cursor: grabbing;
        }
        .sortly-title-box {
            display: flex;
            align-items: center;
            gap: 8px;
            font-weight: 700;
            font-size: 13px;
            letter-spacing: 0.3px;
        }
        .sortly-icon-svg {
            width: 18px;
            height: 18px;
            fill: #00a884;
        }
        .sortly-header-actions {
            display: flex;
            align-items: center;
            gap: 6px;
        }
        .sortly-btn-icon {
            background: transparent;
            border: none;
            color: #9ca3af;
            cursor: pointer;
            padding: 3px 6px;
            border-radius: 6px;
            font-size: 12px;
            display: flex;
            align-items: center;
            justify-content: center;
            transition: background 0.15s, color 0.15s;
        }
        .sortly-btn-icon:hover {
            background: rgba(255, 255, 255, 0.1);
            color: #fff;
        }
        .sortly-body {
            padding: 12px 14px;
            display: flex;
            flex-direction: column;
            gap: 10px;
        }
        .sortly-status-row {
            display: flex;
            align-items: center;
            gap: 8px;
        }
        .sortly-dot {
            width: 9px;
            height: 9px;
            border-radius: 50%;
            flex-shrink: 0;
        }
        .dot-green {
            background: #00a884;
            box-shadow: 0 0 10px #00a884;
        }
        .dot-blue {
            background: #3b82f6;
            box-shadow: 0 0 10px #3b82f6;
        }
        .dot-amber {
            background: #f59e0b;
            box-shadow: 0 0 10px #f59e0b;
        }
        .dot-red {
            background: #ef4444;
            box-shadow: 0 0 10px #ef4444;
        }
        .dot-gray {
            background: #6b7280;
        }
        .sortly-group-badge {
            font-size: 11px;
            font-weight: 600;
            background: rgba(255, 255, 255, 0.08);
            padding: 2px 8px;
            border-radius: 6px;
            max-width: 220px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .sortly-activity-line {
            font-size: 11px;
            color: #9ca3af;
            line-height: 1.4;
            min-height: 16px;
            overflow: hidden;
            text-overflow: ellipsis;
            white-space: nowrap;
        }
        .sortly-controls {
            display: flex;
            gap: 8px;
            align-items: center;
        }
        .sortly-btn {
            font-size: 11px;
            font-weight: 600;
            border-radius: 8px;
            padding: 6px 12px;
            cursor: pointer;
            border: none;
            transition: opacity 0.15s, transform 0.1s;
        }
        .sortly-btn:active {
            transform: scale(0.97);
        }
        .btn-teal {
            background: #00a884;
            color: #111827;
        }
        .btn-teal:hover {
            opacity: 0.9;
        }
        .btn-amber {
            background: #f59e0b;
            color: #111827;
        }
        .btn-amber:hover {
            opacity: 0.9;
        }
        .btn-stop {
            background: rgba(239, 68, 68, 0.18);
            color: #ef4444;
            border: 1px solid rgba(239, 68, 68, 0.3);
        }
        .btn-stop:hover {
            background: rgba(239, 68, 68, 0.28);
        }
        .btn-ghost {
            background: transparent;
            color: #9ca3af;
            border: 1px solid rgba(255, 255, 255, 0.15);
        }
        .btn-ghost:hover {
            background: rgba(255, 255, 255, 0.08);
            color: #fff;
        }
        .sortly-secondary-panel {
            padding-top: 6px;
            border-top: 1px solid rgba(255, 255, 255, 0.06);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }

        /* Settings Modal Backdrop & Card */
        #sortly-settings-modal-backdrop {
            position: fixed;
            top: 0;
            left: 0;
            width: 100vw;
            height: 100vh;
            background: rgba(0, 0, 0, 0.7);
            backdrop-filter: blur(5px);
            z-index: 999999;
            display: flex;
            align-items: center;
            justify-content: center;
            animation: sortlyFadeIn 0.18s ease-out;
        }
        @keyframes sortlyFadeIn {
            from { opacity: 0; transform: scale(0.97); }
            to { opacity: 1; transform: scale(1); }
        }
        #sortly-settings-modal {
            background: rgba(17, 24, 39, 0.98);
            border: 1px solid rgba(255, 255, 255, 0.12);
            border-radius: 14px;
            box-shadow: 0 25px 60px -15px rgba(0, 0, 0, 0.75);
            color: #f3f4f6;
            width: 540px;
            max-width: 92vw;
            max-height: 85vh;
            display: flex;
            flex-direction: column;
            overflow: hidden;
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif;
        }
        .sortly-modal-header {
            padding: 16px 20px;
            border-bottom: 1px solid rgba(255, 255, 255, 0.08);
            display: flex;
            justify-content: space-between;
            align-items: center;
        }
        .sortly-modal-body {
            padding: 18px 20px;
            overflow-y: auto;
            display: flex;
            flex-direction: column;
            gap: 16px;
        }
        .sortly-modal-footer {
            padding: 14px 20px;
            border-top: 1px solid rgba(255, 255, 255, 0.08);
            display: flex;
            justify-content: space-between;
            align-items: center;
            background: rgba(10, 15, 26, 0.5);
        }
        .sortly-input-group {
            display: flex;
            flex-direction: column;
            gap: 6px;
        }
        .sortly-input-label {
            font-size: 11px;
            font-weight: 700;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            color: #9ca3af;
        }
        .sortly-input-field {
            background: rgba(255, 255, 255, 0.06);
            border: 1px solid rgba(255, 255, 255, 0.14);
            border-radius: 8px;
            padding: 8px 12px;
            color: #fff;
            font-size: 12px;
            outline: none;
            transition: border-color 0.2s, background 0.2s;
        }
        .sortly-input-field:focus {
            border-color: #00a884;
            background: rgba(255, 255, 255, 0.09);
        }
        .sortly-mapping-card {
            background: rgba(255, 255, 255, 0.04);
            border: 1px solid rgba(255, 255, 255, 0.07);
            border-radius: 8px;
            padding: 8px 12px;
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
        }
        .sortly-del-btn {
            background: rgba(239, 68, 68, 0.15);
            color: #ef4444;
            border: 1px solid rgba(239, 68, 68, 0.3);
            border-radius: 6px;
            padding: 4px 8px;
            font-size: 10px;
            font-weight: 600;
            cursor: pointer;
            transition: background 0.15s;
        }
        .sortly-del-btn:hover {
            background: rgba(239, 68, 68, 0.28);
        }
    `;
    document.head.appendChild(style);
}

function escapeHTML(str) {
    if (!str) return "";
    return String(str)
        .replace(/&/g, "&amp;")
        .replace(/</g, "&lt;")
        .replace(/>/g, "&gt;")
        .replace(/"/g, "&quot;")
        .replace(/'/g, "&#39;");
}

let tempMappings = null;
let tempBaseFolder = "";

async function openSettingsModal() {
    closeSettingsModal();
    try {
        const res = await chrome.runtime.sendMessage({ type: "GET_CONFIG" });
        if (res && res.ok) {
            tempMappings = { ...(res.mappings || DEFAULT_MAPPINGS) };
            tempBaseFolder = res.baseFolder || DEFAULT_BASE_FOLDER;
        } else {
            tempMappings = { ...(localStore.mappings || DEFAULT_MAPPINGS) };
            tempBaseFolder = localStore.baseFolder || DEFAULT_BASE_FOLDER;
        }
    } catch (e) {
        tempMappings = { ...(localStore.mappings || DEFAULT_MAPPINGS) };
        tempBaseFolder = localStore.baseFolder || DEFAULT_BASE_FOLDER;
    }
    renderSettingsModal();
}

function closeSettingsModal() {
    const existing = document.getElementById("sortly-settings-modal-backdrop");
    if (existing) existing.remove();
}

function renderSettingsModal(statusMsg = "") {
    let backdrop = document.getElementById("sortly-settings-modal-backdrop");
    if (!backdrop) {
        backdrop = document.createElement("div");
        backdrop.id = "sortly-settings-modal-backdrop";
        backdrop.addEventListener("click", (e) => {
            if (e.target === backdrop) closeSettingsModal();
        });
        document.body.appendChild(backdrop);
    }

    const mappingEntries = Object.entries(tempMappings || {});

    backdrop.innerHTML = `
        <div id="sortly-settings-modal">
            <div class="sortly-modal-header">
                <div style="display:flex;align-items:center;gap:10px;">
                    ${createSortlySVG()}
                    <div>
                        <div style="font-size:14px;font-weight:700;color:#fff;">Sortly Settings & Group Manager</div>
                        <div style="font-size:11px;color:#9ca3af;">Map WhatsApp groups to your subject folders</div>
                    </div>
                </div>
                <button id="sortly-modal-close-btn" class="sortly-btn-icon" style="font-size:16px;">✕</button>
            </div>

            <div class="sortly-modal-body">
                <!-- Base Folder -->
                <div class="sortly-input-group">
                    <label class="sortly-input-label">Base Storage Folder / Drive</label>
                    <input id="sortly-input-base-folder" class="sortly-input-field" type="text" value="${escapeHTML(tempBaseFolder)}" placeholder="e.g. E:\\College Files or C:\\Users\\...\\Documents">
                    <span style="font-size:10px;color:#9ca3af;">College subject folders are created inside this directory on your machine.</span>
                </div>

                <!-- Active Group Mappings -->
                <div class="sortly-input-group">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <label class="sortly-input-label">Configured Subjects (${mappingEntries.length})</label>
                        <span style="font-size:10px;color:#00a884;">Auto-monitored in WhatsApp</span>
                    </div>
                    <div class="sortly-mappings-container" style="max-height:190px;overflow-y:auto;display:flex;flex-direction:column;gap:6px;padding-right:4px;">
                        ${mappingEntries.length === 0 ? `
                            <div style="text-align:center;padding:16px;color:#9ca3af;font-size:12px;background:rgba(255,255,255,0.02);border-radius:8px;">No groups configured yet. Add your first group below!</div>
                        ` : mappingEntries.map(([grp, folder]) => `
                            <div class="sortly-mapping-card">
                                <div style="display:flex;flex-direction:column;gap:2px;overflow:hidden;flex:1;">
                                    <div style="font-size:12px;font-weight:600;color:#fff;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;" title="${escapeHTML(grp)}">${escapeHTML(grp)}</div>
                                    <div style="font-size:11px;color:#00a884;">📁 Subfolder: <strong style="color:#e5e7eb;">${escapeHTML(folder)}</strong></div>
                                </div>
                                <button class="sortly-del-btn" data-group="${escapeHTML(grp)}" title="Remove this mapping">✕</button>
                            </div>
                        `).join("")}
                    </div>
                </div>

                <!-- Add New Mapping -->
                <div style="background:rgba(255,255,255,0.03);border:1px solid rgba(255,255,255,0.08);border-radius:10px;padding:12px;display:flex;flex-direction:column;gap:10px;">
                    <div style="display:flex;justify-content:space-between;align-items:center;">
                        <span style="font-size:11px;font-weight:700;color:#e5e7eb;text-transform:uppercase;">+ Add New Subject Mapping</span>
                        <button id="sortly-btn-autofill" class="sortly-btn btn-ghost" style="padding:3px 8px;font-size:10px;">Detect Active Chat</button>
                    </div>
                    <div style="display:flex;gap:8px;">
                        <input id="sortly-new-group-input" class="sortly-input-field" style="flex:1.4;" type="text" placeholder="WhatsApp Group Name">
                        <input id="sortly-new-folder-input" class="sortly-input-field" style="flex:1;" type="text" placeholder="Subfolder (e.g. Physics)">
                        <button id="sortly-btn-add-mapping" class="sortly-btn btn-teal" style="padding:6px 12px;">Add</button>
                    </div>
                    <div id="sortly-add-error" style="font-size:11px;color:#ef4444;display:none;"></div>
                </div>
            </div>

            <div class="sortly-modal-footer">
                <div style="display:flex;align-items:center;gap:8px;">
                    <span class="sortly-dot ${bridgeOnline ? 'dot-green' : 'dot-red'}"></span>
                    <span style="font-size:11px;color:#9ca3af;">${bridgeOnline ? 'Bridge Online' : 'Bridge Offline'}</span>
                    ${statusMsg ? `<span style="font-size:11px;color:#00a884;font-weight:600;margin-left:8px;">${statusMsg}</span>` : ''}
                </div>
                <div style="display:flex;gap:8px;">
                    <button id="sortly-btn-reset-defaults" class="sortly-btn btn-ghost">Reset Defaults</button>
                    <button id="sortly-btn-save-sync" class="sortly-btn btn-teal">Save & Sync Bridge</button>
                </div>
            </div>
        </div>
    `;

    // Bind events
    backdrop.querySelector("#sortly-modal-close-btn")?.addEventListener("click", closeSettingsModal);

    backdrop.querySelector("#sortly-input-base-folder")?.addEventListener("input", (e) => {
        tempBaseFolder = e.target.value.trim();
    });

    backdrop.querySelectorAll(".sortly-del-btn").forEach(btn => {
        btn.addEventListener("click", () => {
            const grp = btn.getAttribute("data-group");
            if (grp && tempMappings[grp]) {
                delete tempMappings[grp];
                renderSettingsModal("Mapping removed");
            }
        });
    });

    backdrop.querySelector("#sortly-btn-autofill")?.addEventListener("click", () => {
        const active = detectActiveGroup();
        const header = getActiveMainPanel()?.querySelector("header");
        let foundName = active !== "Unknown" ? active : "";
        if (!foundName && header) {
            const titleEl = header.querySelector("[title]");
            foundName = titleEl ? titleEl.getAttribute("title") : (header.innerText || "").split("\n")[0];
        }
        if (foundName) {
            const input = backdrop.querySelector("#sortly-new-group-input");
            if (input) input.value = normalizeText(foundName);
            const err = backdrop.querySelector("#sortly-add-error");
            if (err) err.style.display = "none";
        } else {
            const err = backdrop.querySelector("#sortly-add-error");
            if (err) {
                err.textContent = "Open a WhatsApp chat first, then click Detect Active Chat.";
                err.style.display = "block";
            }
        }
    });

    backdrop.querySelector("#sortly-btn-add-mapping")?.addEventListener("click", () => {
        const grpInput = backdrop.querySelector("#sortly-new-group-input");
        const fldInput = backdrop.querySelector("#sortly-new-folder-input");
        const err = backdrop.querySelector("#sortly-add-error");

        const grp = normalizeText(grpInput?.value);
        const fld = normalizeText(fldInput?.value).replace(/[\\\/]/g, "").trim();

        if (!grp) {
            if (err) {
                err.textContent = "Please enter or auto-fill a WhatsApp Group Name.";
                err.style.display = "block";
            }
            return;
        }
        if (!fld) {
            if (err) {
                err.textContent = "Please enter a target folder name (e.g. Physics).";
                err.style.display = "block";
            }
            return;
        }

        tempMappings[grp] = fld;
        renderSettingsModal(`Added: ${grp} → ${fld}`);
    });

    backdrop.querySelector("#sortly-btn-reset-defaults")?.addEventListener("click", () => {
        tempMappings = { ...DEFAULT_MAPPINGS };
        tempBaseFolder = DEFAULT_BASE_FOLDER;
        renderSettingsModal("Reset to default subjects");
    });

    backdrop.querySelector("#sortly-btn-save-sync")?.addEventListener("click", async () => {
        const saveBtn = backdrop.querySelector("#sortly-btn-save-sync");
        if (saveBtn) {
            saveBtn.textContent = "Saving...";
            saveBtn.disabled = true;
        }

        try {
            const res = await chrome.runtime.sendMessage({
                type: "UPDATE_CONFIG",
                baseFolder: tempBaseFolder,
                mappings: tempMappings
            });

            if (res && res.ok) {
                localStore.baseFolder = tempBaseFolder;
                localStore.mappings = { ...tempMappings };
                activeGroupName = detectActiveGroup();
                updateWidgetUI();
                renderSettingsModal(res.bridgeSynced ? "✅ Saved & Bridge Synced!" : "✅ Saved to Extension!");
            } else {
                renderSettingsModal("⚠️ Error saving: " + (res?.error || "Unknown"));
            }
        } catch (err) {
            renderSettingsModal("❌ Error: " + err.message);
        }
    });
}

function createSortlySVG() {
    return `
        <svg class="sortly-icon-svg" viewBox="0 0 24 24">
            <path d="M10 4H4c-1.1 0-1.99.9-1.99 2L2 18c0 1.1.9 2 2 2h16c1.1 0 2-.9 2-2V8c0-1.1-.9-2-2-2h-8l-2-2z"/>
            <path fill="#fff" d="M10.5 14.5l-2-2-1.4 1.4 3.4 3.4 7-7-1.4-1.4z"/>
        </svg>
    `;
}

function createWidgetElement() {
    let widget = document.getElementById(WIDGET_ID);
    if (widget) return widget;

    createWidgetStyles();

    widget = document.createElement("div");
    widget.id = WIDGET_ID;

    // Load saved position from storage
    chrome.storage.local.get(STORAGE_POS_KEY, (res) => {
        const saved = res[STORAGE_POS_KEY];
        if (saved && typeof saved.left === "number" && typeof saved.top === "number") {
            const clamped = clampCoordinates(saved.left, saved.top, 320, 150);
            widget.style.left = clamped.left + "px";
            widget.style.top = clamped.top + "px";
            if (saved.minimized) {
                isWidgetMinimized = true;
            }
        } else {
            // Default bottom-right
            widget.style.bottom = "20px";
            widget.style.right = "20px";
        }
        updateWidgetUI();
    });

    document.body.appendChild(widget);
    setupWidgetDrag(widget);
    return widget;
}

function clampCoordinates(left, top, width, height) {
    const minX = 10;
    const maxX = Math.max(10, window.innerWidth - width - 10);
    const minY = 10;
    const maxY = Math.max(10, window.innerHeight - height - 10);
    return {
        left: Math.max(minX, Math.min(maxX, left)),
        top: Math.max(minY, Math.min(maxY, top))
    };
}

function setupWidgetDrag(widget) {
    let isDragging = false;
    let startX = 0;
    let startY = 0;
    let initialLeft = 0;
    let initialTop = 0;

    const onPointerDown = (e) => {
        // Do not drag if user clicked a button or interactive child
        if (e.target.closest("button, a, input, [role='button']")) {
            return;
        }

        // Only left mouse or primary pointer
        if (e.button !== 0) return;

        isDragging = true;
        startX = e.clientX;
        startY = e.clientY;

        const rect = widget.getBoundingClientRect();
        initialLeft = rect.left;
        initialTop = rect.top;

        widget.setPointerCapture(e.pointerId);
        widget.style.transition = "none";
        e.preventDefault();
        e.stopPropagation();
    };

    const onPointerMove = (e) => {
        if (!isDragging) return;

        const deltaX = e.clientX - startX;
        const deltaY = e.clientY - startY;

        const rect = widget.getBoundingClientRect();
        const clamped = clampCoordinates(initialLeft + deltaX, initialTop + deltaY, rect.width, rect.height);

        widget.style.left = clamped.left + "px";
        widget.style.top = clamped.top + "px";
        widget.style.bottom = "auto";
        widget.style.right = "auto";

        e.preventDefault();
        e.stopPropagation();
    };

    const onPointerUp = (e) => {
        if (!isDragging) return;
        isDragging = false;
        widget.releasePointerCapture(e.pointerId);

        const rect = widget.getBoundingClientRect();
        chrome.storage.local.set({
            [STORAGE_POS_KEY]: {
                left: Math.round(rect.left),
                top: Math.round(rect.top),
                minimized: isWidgetMinimized
            }
        });
        e.stopPropagation();
    };

    widget.addEventListener("pointerdown", onPointerDown);
    widget.addEventListener("pointermove", onPointerMove);
    widget.addEventListener("pointerup", onPointerUp);
    widget.addEventListener("pointercancel", onPointerUp);

    // Keep widget in viewport on window resize
    window.addEventListener("resize", () => {
        const rect = widget.getBoundingClientRect();
        const clamped = clampCoordinates(rect.left, rect.top, rect.width, rect.height);
        widget.style.left = clamped.left + "px";
        widget.style.top = clamped.top + "px";
    });
}

function updateWidgetUI() {
    const widget = document.getElementById(WIDGET_ID);
    if (!widget) return;

    // Minimized View
    if (isWidgetMinimized) {
        widget.className = "minimized";
        let statusDotClass = "dot-gray";
        if (!bridgeOnline) statusDotClass = "dot-red";
        else if (localStore.runState === "RUNNING") statusDotClass = "dot-green";
        else if (localStore.runState === "PAUSED") statusDotClass = "dot-amber";

        widget.innerHTML = `
            <div style="display:flex;align-items:center;gap:8px;">
                ${createSortlySVG()}
                <span class="sortly-dot ${statusDotClass}"></span>
                <span style="font-size:12px;font-weight:700;">Sortly</span>
                <span style="font-size:11px;color:#9ca3af;">${activeGroupName !== "Unknown" ? activeGroupName : "Idle"}</span>
            </div>
        `;
        widget.onclick = (e) => {
            if (e.target.closest("button")) return;
            isWidgetMinimized = false;
            chrome.storage.local.set({
                [STORAGE_POS_KEY]: {
                    left: parseInt(widget.style.left || 0),
                    top: parseInt(widget.style.top || 0),
                    minimized: false
                }
            });
            updateWidgetUI();
        };
        return;
    }

    // Expanded View
    widget.className = "";
    widget.onclick = null;

    let dotClass = "dot-gray";
    let stateLabel = "Sortly: Idle";
    let badgeText = activeGroupName !== "Unknown" ? activeGroupName : "No active group";

    if (!bridgeOnline) {
        dotClass = "dot-red";
        stateLabel = "Bridge Offline";
    } else if (activeGroupName === "Unknown") {
        dotClass = "dot-gray";
        stateLabel = "Idle (Open College Group)";
    } else if (initialImportRunning) {
        dotClass = "dot-blue";
        stateLabel = "Importing Files...";
    } else if (localStore.runState === "PAUSED") {
        dotClass = "dot-amber";
        stateLabel = "Paused";
    } else if (localStore.runState === "STOPPED") {
        dotClass = "dot-gray";
        stateLabel = "Stopped";
    } else {
        const groupState = getLocalGroupState(activeGroupName);
        if (groupState.importCompleted) {
            dotClass = "dot-green";
            stateLabel = "Live Mode (Watching)";
        } else {
            dotClass = "dot-green";
            stateLabel = "Active (Import Available)";
        }
    }

    const groupState = activeGroupName !== "Unknown" ? getLocalGroupState(activeGroupName) : null;
    const isLive = groupState && groupState.importCompleted;

    // Controls generation based on automation runState
    let controlsHTML = "";
    if (!bridgeOnline) {
        controlsHTML = `
            <button id="sortly-retry-btn" class="sortly-btn btn-amber" style="flex:1;">Retry Connection</button>
        `;
    } else if (activeGroupName === "Unknown") {
        controlsHTML = `
            <div style="font-size:11px;color:#9ca3af;">Select a college group to activate automation</div>
        `;
    } else if (localStore.runState === "STOPPED") {
        controlsHTML = `
            <button id="sortly-start-btn" class="sortly-btn btn-teal" style="flex:1;">Start</button>
            ${!isLive ? `<button id="sortly-import-quick-btn" class="sortly-btn btn-ghost">Initial Import</button>` : ''}
        `;
    } else if (localStore.runState === "PAUSED") {
        controlsHTML = `
            <button id="sortly-resume-btn" class="sortly-btn btn-teal" style="flex:1;">Resume</button>
            <button id="sortly-stop-btn" class="sortly-btn btn-stop">Stop</button>
        `;
    } else {
        // RUNNING state
        controlsHTML = `
            <button id="sortly-pause-btn" class="sortly-btn btn-amber" style="flex:1;">Pause</button>
            <button id="sortly-stop-btn" class="sortly-btn btn-stop">Stop</button>
        `;
    }

    const targetFolder = (localStore.mappings && activeGroupName !== "Unknown") ? localStore.mappings[activeGroupName] : "";

    widget.innerHTML = `
        <div class="sortly-header">
            <div class="sortly-title-box">
                ${createSortlySVG()}
                <span>Sortly</span>
                <span style="font-size:9px;background:rgba(0,168,132,0.18);color:#00a884;padding:1px 5px;border-radius:4px;">PRO</span>
            </div>
            <div class="sortly-header-actions">
                <button id="sortly-settings-btn" class="sortly-btn-icon" title="Settings & Group Manager">⚙</button>
                <button id="sortly-expand-btn" class="sortly-btn-icon" title="Toggle extra controls">${isSecondaryExpanded ? '▴' : '▾'}</button>
                <button id="sortly-min-btn" class="sortly-btn-icon" title="Minimize panel">−</button>
            </div>
        </div>
        <div class="sortly-body">
            <div class="sortly-status-row">
                <span class="sortly-dot ${dotClass}"></span>
                <span style="font-size:12px;font-weight:600;">${stateLabel}</span>
            </div>
            <div style="display:flex;align-items:center;justify-content:space-between;gap:6px;">
                <div style="display:flex;align-items:center;gap:6px;overflow:hidden;flex:1;">
                    <span style="font-size:12px;">📁</span>
                    <span class="sortly-group-badge" title="${badgeText}">${badgeText}</span>
                </div>
                ${targetFolder ? `<span style="font-size:10px;color:#00a884;background:rgba(0,168,132,0.12);padding:2px 6px;border-radius:4px;white-space:nowrap;" title="Target Folder: ${escapeHTML(targetFolder)}">→ ${escapeHTML(targetFolder)}</span>` : ''}
            </div>
            <div class="sortly-activity-line" title="${currentActivityText}">
                ${!bridgeOnline ? 'Run start_organizer.bat to connect' : currentActivityText}
            </div>
            <div class="sortly-controls">
                ${controlsHTML}
            </div>
            ${isSecondaryExpanded && activeGroupName !== "Unknown" ? `
                <div class="sortly-secondary-panel">
                    <span style="font-size:10px;color:#9ca3af;">Historical Files</span>
                    <button id="sortly-import-btn" class="sortly-btn btn-ghost" style="padding:4px 8px;font-size:10px;">
                        ${isLive ? 'Re-Sync Group' : 'Initial Import'}
                    </button>
                </div>
            ` : ''}
        </div>
    `;

    // Bind UI actions
    widget.querySelector("#sortly-settings-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        openSettingsModal();
    });

    widget.querySelector("#sortly-min-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        isWidgetMinimized = true;
        const rect = widget.getBoundingClientRect();
        chrome.storage.local.set({
            [STORAGE_POS_KEY]: { left: Math.round(rect.left), top: Math.round(rect.top), minimized: true }
        });
        updateWidgetUI();
    });

    widget.querySelector("#sortly-expand-btn")?.addEventListener("click", (e) => {
        e.stopPropagation();
        isSecondaryExpanded = !isSecondaryExpanded;
        updateWidgetUI();
    });

    widget.querySelector("#sortly-retry-btn")?.addEventListener("click", () => pollBridgeStatus());
    widget.querySelector("#sortly-start-btn")?.addEventListener("click", () => setRunState("RUNNING"));
    widget.querySelector("#sortly-resume-btn")?.addEventListener("click", () => setRunState("RUNNING"));
    widget.querySelector("#sortly-pause-btn")?.addEventListener("click", () => setRunState("PAUSED"));
    widget.querySelector("#sortly-stop-btn")?.addEventListener("click", () => setRunState("STOPPED"));
    widget.querySelector("#sortly-import-quick-btn")?.addEventListener("click", startInitialImport);
    widget.querySelector("#sortly-import-btn")?.addEventListener("click", startInitialImport);
}

// ============================================================
// 12. INITIALIZATION
// ============================================================

refreshStore().then(() => {
    setInterval(pollBridgeStatus, 3000);
    pollBridgeStatus();
    setTimeout(() => {
        createWidgetElement();
        checkActiveConversation();
    }, 1500);
});