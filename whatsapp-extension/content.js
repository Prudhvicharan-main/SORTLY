// ============================================================
// SORTLY - WhatsApp College File Organizer
// Content Script (content.js)
// Persistent State, Full Pipeline Tracking, and Explicit Controls
// (Start, Pause, Resume, Stop, Initial Import)
// ============================================================

console.log("🚀 Sortly content script loaded.");

const configuredGroups = [
    "9968_OOPJ_25SC2006L_S:2-L-2026-2027-ODDSEM",
    "ESD&IoT LE",
    "Y25-Mathematics for Data Science",
    "25CS2102L",
    "AIML le 2k26",
    "S-3 MFE Lateral"
];

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

// Local memory cache synced with chrome.storage.local
let localStore = {
    version: 2,
    runState: "STOPPED",
    groups: {},
    activeJobs: {}
};

let activeGroupName = "Unknown";
let initialImportRunning = false;
let importProgressText = "";
let bridgeOnline = true;

// ============================================================
// SYNC PERSISTENT STATE WITH BACKGROUND
// ============================================================

async function refreshStore() {
    try {
        const response = await chrome.runtime.sendMessage({ type: "GET_STATE" });
        if (response && response.ok && response.store) {
            localStore = response.store;
        }
    } catch (err) {
        // Background might be spinning up
    }
}

async function pollBridgeStatus() {
    try {
        const res = await chrome.runtime.sendMessage({ type: "CHECK_BRIDGE_STATUS" });
        bridgeOnline = Boolean(res && res.online);
    } catch (e) {
        bridgeOnline = false;
    }
    updateUIBadge();
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
// TEXT & FILE HELPERS
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

// ============================================================
// ACTIVE GROUP DETECTION (STRICTLY FROM #main header)
// ============================================================

function getActiveMainPanel() {
    return document.getElementById("main") || document.querySelector("#main");
}

function detectActiveGroup() {
    const main = getActiveMainPanel();
    if (!main) return "Unknown";

    const header = main.querySelector("header") || main.querySelector('[role="banner"]');
    if (!header) return "Unknown";

    // 1. Check title attributes in active header
    const titleElements = header.querySelectorAll("[title]");
    for (const el of titleElements) {
        const title = normalizeText(el.getAttribute("title"));
        for (const group of configuredGroups) {
            if (title === normalizeText(group)) {
                return group;
            }
        }
    }

    // 2. Check header innerText line by line
    const lines = (header.innerText || "").split(/\r?\n/).map(normalizeText);
    for (const line of lines) {
        if (!line) continue;
        for (const group of configuredGroups) {
            if (line === normalizeText(group)) {
                return group;
            }
        }
    }

    // 3. Check text spans inside active header
    const candidateElements = header.querySelectorAll(
        '[data-testid="conversation-info-header"], span[dir="auto"], span, div[role="button"]'
    );
    for (const el of candidateElements) {
        const text = normalizeText(el.textContent);
        for (const group of configuredGroups) {
            if (text === normalizeText(group)) {
                return group;
            }
        }
    }

    return "Unknown";
}

// ============================================================
// DOCUMENT & MESSAGE HELPERS
// ============================================================

function getDocumentButtons() {
    const main = getActiveMainPanel();
    if (!main) return [];

    const elements = main.querySelectorAll(
        '[data-testid="document-thumb"], [role="button"][title*="Download"], [title*="Download"]'
    );
    return Array.from(elements);
}

function getFileNameFromButton(button) {
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

    // 3. Document bubble text search
    const row = button.closest('[data-id]') || button.closest('[role="row"]');
    if (row) {
        const titleEls = row.querySelectorAll("[title]");
        for (const el of titleEls) {
            const t = normalizeText(el.getAttribute("title"));
            if (isSupportedFile(t) && t.length < 255) {
                return t;
            }
        }
        const textElements = row.querySelectorAll("span, div");
        for (const el of textElements) {
            const txt = normalizeText(el.textContent);
            if (isSupportedFile(txt) && txt.length < 255 && !txt.includes("\n")) {
                return txt;
            }
        }
    }

    return null;
}

function createDocumentKey(button, fileName) {
    const row = button.closest('[data-id]') || button.closest('[role="row"]');
    const msgId = row ? (row.getAttribute("data-id") || row.id || "") : "";
    return msgId ? `${msgId}::${fileName}` : fileName;
}

// ============================================================
// SIMULATE REAL USER CLICK & MODAL MANAGEMENT
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
        // Step 0: Fast close any lingering preview modal
        const existingDialog = document.querySelector('div[role="dialog"]');
        if (existingDialog) {
            document.dispatchEvent(new KeyboardEvent('keydown', {
                key: 'Escape',
                code: 'Escape',
                keyCode: 27,
                which: 27,
                bubbles: true
            }));
            await new Promise(r => setTimeout(r, 60));
        }

        // Step 1: Scroll message into view
        element.scrollIntoView({ behavior: "auto", block: "center" });
        await new Promise(r => setTimeout(r, 50));

        // Step 2: Check if row has direct download icon
        const row = element.closest('[data-id]') || element.closest('[role="row"]');
        const directDownloadBtn = row ? row.querySelector('[data-icon="download"], [title*="Download"], [aria-label*="Download"]') : null;
        const targetBtn = directDownloadBtn || element;

        dispatchClick(targetBtn);

        // Step 3: Check for PDF preview modal ONLY if this file is a PDF
        const isPdf = (fileName || "").toLowerCase().endsWith(".pdf");
        if (isPdf) {
            let modalDownloadBtn = null;
            // Fast poll: max 200ms
            for (let attempt = 0; attempt < 4; attempt++) {
                await new Promise(r => setTimeout(r, 50));
                if (!document.querySelector('div[role="dialog"]')) {
                    if (attempt >= 1) break;
                    continue;
                }
                modalDownloadBtn = document.querySelector(
                    'div[role="dialog"] [title*="Download"], ' +
                    'div[role="dialog"] [data-icon="download"], ' +
                    '[data-testid="media-viewer-download"], ' +
                    '#app [title="Download"]:not(#main [title="Download"]), ' +
                    'div[role="dialog"] [aria-label*="Download"]'
                );
                if (modalDownloadBtn) break;
            }

            if (modalDownloadBtn) {
                console.log("📥 Detected PDF preview modal. Clicking modal download button...");
                dispatchClick(modalDownloadBtn);
                await new Promise(r => setTimeout(r, 100));

                const closeBtn = document.querySelector(
                    'div[role="dialog"] [title*="Close"], ' +
                    'div[role="dialog"] [data-icon="x"], ' +
                    'div[role="dialog"] [aria-label*="Close"], ' +
                    '[data-testid="media-viewer-close"]'
                );

                if (closeBtn) {
                    dispatchClick(closeBtn);
                } else {
                    document.dispatchEvent(new KeyboardEvent('keydown', {
                        key: 'Escape',
                        code: 'Escape',
                        keyCode: 27,
                        which: 27,
                        bubbles: true
                    }));
                }
                await new Promise(r => setTimeout(r, 60));
            }
        }
    } catch (err) {
        console.error("❌ Sortly failed to click download button:", err);
    }
}

// ============================================================
// BASELINE MANAGEMENT (PER GROUP, PERSISTED IN STORAGE)
// ============================================================

async function establishBaseline(groupName) {
    const groupState = getLocalGroupState(groupName);
    if (groupState.baselineInitialized) {
        return;
    }

    console.log(`🧠 Establishing baseline of existing files for "${groupName}"...`);
    await new Promise(r => setTimeout(r, 800));

    if (detectActiveGroup() !== groupName) return;

    const buttons = getDocumentButtons();
    const newBaselineKeys = [];

    for (const btn of buttons) {
        const fileName = getFileNameFromButton(btn);
        if (fileName && isSupportedFile(fileName)) {
            const key = createDocumentKey(btn, fileName);
            if (!newBaselineKeys.includes(key)) {
                newBaselineKeys.push(key);
            }
            btn.dataset.sortlyBaseline = "true";
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
    updateUIBadge();
}

// ============================================================
// LIVE MODE - PROCESS GENUINELY NEW DOCUMENTS
// ============================================================

async function processNewDocuments(groupName) {
    await refreshStore();
    if (localStore.runState !== "RUNNING") return;

    const groupState = getLocalGroupState(groupName);
    if (!groupState.baselineInitialized) return;

    const buttons = getDocumentButtons();

    for (const btn of buttons) {
        const fileName = getFileNameFromButton(btn);
        if (!fileName || !isSupportedFile(fileName)) continue;

        const key = createDocumentKey(btn, fileName);

        // Ignore existing baseline files
        if (groupState.baselineFileKeys.includes(key)) continue;

        // Ignore already processed or downloading files
        if (groupState.processedFileKeys.includes(key) || btn.dataset.sortlyProcessed === "true") continue;

        btn.dataset.sortlyProcessed = "true";
        console.log(`🆕 Live Mode: New file detected: "${fileName}" in "${groupName}"`);

        try {
            const regRes = await chrome.runtime.sendMessage({
                type: "REGISTER_JOB",
                groupName: groupName,
                fileName: fileName,
                elementKey: key
            });

            if (regRes && regRes.ok && regRes.job) {
                console.log(`📤 Registered job #${regRes.job.id} for "${fileName}". Triggering download...`);
                await triggerDownload(btn, fileName);
            } else {
                delete btn.dataset.sortlyProcessed;
            }
        } catch (err) {
            console.error(`❌ Failed to start live download for "${fileName}":`, err);
            delete btn.dataset.sortlyProcessed;
        }
    }
}

// ============================================================
// INITIAL IMPORT (SEQUENTIAL, VERIFIED TERMINAL STATES)
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

    const buttons = getDocumentButtons();
    console.log(`📚 Found ${buttons.length} total document elements in view.`);

    let processedCount = 0;
    const seenFiles = new Set();

    for (let i = 0; i < buttons.length; i++) {
        await refreshStore();
        if (localStore.runState === "PAUSED" || localStore.runState === "STOPPED") {
            console.warn(`⚠️ Initial Import suspended because Sortly is ${localStore.runState}.`);
            break;
        }

        if (detectActiveGroup() !== groupName) {
            console.warn("⚠️ Active group changed during Initial Import. Stopping.");
            break;
        }

        const btn = buttons[i];
        const fileName = getFileNameFromButton(btn);
        if (!fileName || !isSupportedFile(fileName) || seenFiles.has(fileName)) {
            continue;
        }
        seenFiles.add(fileName);

        const key = createDocumentKey(btn, fileName);

        // Step 0: Check if file already exists in destination folder
        try {
            const checkRes = await chrome.runtime.sendMessage({
                type: "CHECK_FILE_EXISTS",
                groupName: groupName,
                fileName: fileName
            });

            if (checkRes && checkRes.exists) {
                console.log(`⚡ "${fileName}" already exists in subject folder. Skipping download.`);
                importProgressText = `Already organized (${i + 1}/${buttons.length}): ${fileName}`;
                updateUIBadge();
                processedCount++;

                const groupState = getLocalGroupState(groupName);
                if (!groupState.processedFileKeys.includes(key)) {
                    groupState.processedFileKeys.push(key);
                }
                const clean = stripDuplicateSuffix(fileName);
                if (!groupState.organizedFiles.includes(clean)) {
                    groupState.organizedFiles.push(clean);
                }
                continue;
            }
        } catch (e) {
            // Proceed to download
        }

        importProgressText = `Processing (${i + 1}/${buttons.length}): ${fileName}`;
        updateUIBadge();

        try {
            // Register pipeline job
            const regRes = await chrome.runtime.sendMessage({
                type: "REGISTER_JOB",
                groupName: groupName,
                fileName: fileName,
                elementKey: key
            });

            if (regRes && regRes.ok && regRes.job) {
                // Trigger download
                await triggerDownload(btn, fileName);

                // Await verified terminal state (ORGANIZED or FAILED)
                const waitRes = await chrome.runtime.sendMessage({
                    type: "AWAIT_JOB",
                    jobId: regRes.job.id,
                    timeout: 25000
                });

                if (waitRes && waitRes.ok) {
                    console.log(`🎉 Confirmed ORGANIZED: "${fileName}"`);
                    processedCount++;
                } else {
                    console.error(`⚠️ Job did not reach ORGANIZED state for "${fileName}":`, waitRes);
                }

                await new Promise(r => setTimeout(r, 60));
            }
        } catch (err) {
            console.error(`❌ Initial Import failed for "${fileName}":`, err);
        }
    }

    initialImportRunning = false;
    importProgressText = "";

    await refreshStore();
    // Only mark completed if import was not stopped/paused midway
    if (localStore.runState === "RUNNING") {
        await chrome.runtime.sendMessage({
            type: "MARK_IMPORT_COMPLETED",
            groupName: groupName
        });
        await refreshStore();
        console.log(`✅ Initial Import completed & persisted for "${groupName}".`);
    }

    updateUIBadge();
}

// ============================================================
// OPERATING CONTROLS (START, PAUSE, RESUME, STOP)
// ============================================================

async function setRunState(newState) {
    const res = await chrome.runtime.sendMessage({
        type: "SET_RUN_STATE",
        runState: newState
    });
    if (res && res.ok) {
        localStore.runState = newState;
        updateUIBadge();
    }
}

// Manual click interceptor
document.addEventListener("click", (e) => {
    const groupName = detectActiveGroup();
    if (groupName === "Unknown") return;

    const target = e.target;
    if (!target) return;

    const downloadTarget = target.closest(
        '[data-testid="document-thumb"], [data-icon="download"], [title*="Download"], [aria-label*="Download"], [role="button"]'
    );
    if (!downloadTarget) return;

    const fileName = getFileNameFromButton(downloadTarget);
    if (!fileName || !isSupportedFile(fileName)) return;

    console.log(`👆 User clicked document manually: "${fileName}" in "${groupName}"`);
    chrome.runtime.sendMessage({
        type: "REGISTER_JOB",
        groupName: groupName,
        fileName: fileName,
        elementKey: createDocumentKey(downloadTarget, fileName)
    });
}, true);

// Runtime message receiver (active group inquiry)
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message && message.type === "GET_CURRENT_GROUP") {
        sendResponse({ groupName: detectActiveGroup() });
        return true;
    }
});

// ============================================================
// MAIN OBSERVER LOOP
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
            }
        } else {
            activeGroupName = "Unknown";
        }
        updateUIBadge();
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
    }, 400);
});

observer.observe(document.body, { childList: true, subtree: true });
setInterval(checkActiveConversation, 1500);

// ============================================================
// STATUS BADGE UI & CONTROLS
// ============================================================

function createUIBadge() {
    if (document.getElementById("sortly-status-badge")) return;

    const badge = document.createElement("div");
    badge.id = "sortly-status-badge";
    badge.style.position = "fixed";
    badge.style.bottom = "16px";
    badge.style.right = "16px";
    badge.style.zIndex = "999999";
    badge.style.padding = "10px 14px";
    badge.style.borderRadius = "10px";
    badge.style.backgroundColor = "rgba(17, 27, 33, 0.94)";
    badge.style.color = "#e9edef";
    badge.style.fontSize = "13px";
    badge.style.fontFamily = "Segoe UI, sans-serif";
    badge.style.boxShadow = "0 4px 14px rgba(0,0,0,0.4)";
    badge.style.display = "flex";
    badge.style.alignItems = "center";
    badge.style.gap = "10px";
    badge.style.border = "1px solid rgba(255,255,255,0.18)";
    badge.style.backdropFilter = "blur(6px)";

    document.body.appendChild(badge);
    updateUIBadge();
}

function updateUIBadge() {
    const badge = document.getElementById("sortly-status-badge");
    if (!badge) return;

    // 1. Bridge offline
    if (!bridgeOnline) {
        badge.innerHTML = `
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#ff5252;box-shadow:0 0 8px #ff5252;"></span>
            <div>
                <div style="color:#ff5252;font-weight:600;">Sortly: Python Bridge Offline</div>
                <div style="font-size:11px;color:#8696a0;">Run start_organizer.bat to activate</div>
            </div>
        `;
        return;
    }

    // 2. Idle (no configured group open)
    if (activeGroupName === "Unknown") {
        badge.innerHTML = `
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#8696a0;"></span>
            <div>
                <div>Sortly: <strong>Idle</strong></div>
                <div style="font-size:11px;color:#8696a0;">Open a configured college group</div>
            </div>
        `;
        return;
    }

    const groupState = getLocalGroupState(activeGroupName);
    const runState = localStore.runState;

    // Helper button styles
    const btnStyle = (bg, color) => `
        background: ${bg};
        color: ${color};
        border: none;
        border-radius: 6px;
        padding: 4px 8px;
        font-weight: 600;
        font-size: 11px;
        cursor: pointer;
        margin-left: 4px;
    `;

    // 3. Initial Import Running
    if (initialImportRunning) {
        badge.innerHTML = `
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#53bdeb;box-shadow:0 0 8px #53bdeb;"></span>
            <div>
                <div><strong>Sortly Importing:</strong> ${activeGroupName}</div>
                <div style="font-size:11px;color:#53bdeb;">${importProgressText || 'Processing...'}</div>
            </div>
            <button id="sortly-pause-btn" style="${btnStyle('#f39c12', '#fff')}">Pause</button>
            <button id="sortly-stop-btn" style="${btnStyle('#e74c3c', '#fff')}">Stop</button>
        `;
        badge.querySelector("#sortly-pause-btn")?.addEventListener("click", () => setRunState("PAUSED"));
        badge.querySelector("#sortly-stop-btn")?.addEventListener("click", () => setRunState("STOPPED"));
        return;
    }

    // 4. STOPPED State
    if (runState === "STOPPED") {
        badge.innerHTML = `
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#8696a0;"></span>
            <div>
                <div><strong>Sortly Stopped:</strong> ${activeGroupName}</div>
                <div style="font-size:11px;color:#8696a0;">Automation halted</div>
            </div>
            <button id="sortly-start-btn" style="${btnStyle('#00a884', '#111b21')}">Start</button>
            ${!groupState.importCompleted ? `<button id="sortly-import-btn" style="${btnStyle('#53bdeb', '#111b21')}">Initial Import</button>` : ''}
        `;
        badge.querySelector("#sortly-start-btn")?.addEventListener("click", () => setRunState("RUNNING"));
        badge.querySelector("#sortly-import-btn")?.addEventListener("click", startInitialImport);
        return;
    }

    // 5. PAUSED State
    if (runState === "PAUSED") {
        badge.innerHTML = `
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#f39c12;box-shadow:0 0 8px #f39c12;"></span>
            <div>
                <div><strong>Sortly Paused:</strong> ${activeGroupName}</div>
                <div style="font-size:11px;color:#f39c12;">Work paused (state preserved)</div>
            </div>
            <button id="sortly-resume-btn" style="${btnStyle('#00a884', '#111b21')}">Resume</button>
            <button id="sortly-stop-btn" style="${btnStyle('#e74c3c', '#fff')}">Stop</button>
        `;
        badge.querySelector("#sortly-resume-btn")?.addEventListener("click", () => setRunState("RUNNING"));
        badge.querySelector("#sortly-stop-btn")?.addEventListener("click", () => setRunState("STOPPED"));
        return;
    }

    // 6. RUNNING State - Group Import Completed (LIVE MODE)
    if (groupState.importCompleted) {
        badge.innerHTML = `
            <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#00a884;box-shadow:0 0 8px #00a884;"></span>
            <div>
                <div><strong>Sortly Live:</strong> ${activeGroupName}</div>
                <div style="font-size:11px;color:#00a884;">All files organized ✔ Watching for new files</div>
            </div>
            <button id="sortly-pause-btn" style="${btnStyle('transparent', '#8696a0')};border:1px solid rgba(255,255,255,0.2);">Pause</button>
            <button id="sortly-stop-btn" style="${btnStyle('transparent', '#8696a0')};border:1px solid rgba(255,255,255,0.2);">Stop</button>
            <button id="sortly-resync-btn" style="${btnStyle('transparent', '#8696a0')};border:1px solid rgba(255,255,255,0.2);" title="Re-scan group files">Re-Sync</button>
        `;
        badge.querySelector("#sortly-pause-btn")?.addEventListener("click", () => setRunState("PAUSED"));
        badge.querySelector("#sortly-stop-btn")?.addEventListener("click", () => setRunState("STOPPED"));
        badge.querySelector("#sortly-resync-btn")?.addEventListener("click", startInitialImport);
        return;
    }

    // 7. RUNNING State - Group Needs Initial Import
    badge.innerHTML = `
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#00a884;box-shadow:0 0 8px #00a884;"></span>
        <div>
            <div><strong>Sortly Active:</strong> ${activeGroupName}</div>
            <div style="font-size:11px;color:#8696a0;">Baseline active • Initial Import available</div>
        </div>
        <button id="sortly-import-btn" style="${btnStyle('#00a884', '#111b21')}">Initial Import</button>
        <button id="sortly-pause-btn" style="${btnStyle('transparent', '#8696a0')};border:1px solid rgba(255,255,255,0.2);">Pause</button>
        <button id="sortly-stop-btn" style="${btnStyle('transparent', '#8696a0')};border:1px solid rgba(255,255,255,0.2);">Stop</button>
    `;
    badge.querySelector("#sortly-import-btn")?.addEventListener("click", startInitialImport);
    badge.querySelector("#sortly-pause-btn")?.addEventListener("click", () => setRunState("PAUSED"));
    badge.querySelector("#sortly-stop-btn")?.addEventListener("click", () => setRunState("STOPPED"));
}

// Initial boot
refreshStore().then(() => {
    setInterval(pollBridgeStatus, 3000);
    pollBridgeStatus();
    setTimeout(createUIBadge, 2000);
});