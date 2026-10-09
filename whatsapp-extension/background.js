// ============================================================
// SORTLY - WhatsApp College File Organizer
// Chrome Extension Service Worker (background.js)
// Persistent Versioned State & Strict Pipeline Lifecycle
// DETECTED -> QUEUED -> DOWNLOADING -> DOWNLOADED -> ORGANIZING -> ORGANIZED
// ============================================================

const BRIDGE_URL = "http://127.0.0.1:8765/organize";
const CHECK_URL = "http://127.0.0.1:8765/check";
const HEALTH_URL = "http://127.0.0.1:8765/";

const STORAGE_KEY = "sortly_state_v2";

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

console.log("🚀 Sortly background service worker initialized.");

// ============================================================
// HELPERS
// ============================================================

function isSupportedFile(fileName) {
    if (!fileName) return false;
    const lower = fileName.toLowerCase().trim();
    return supportedExtensions.some(ext => lower.endsWith(ext));
}

function getBaseName(filePath) {
    if (!filePath) return "";
    return filePath.replace(/^.*[\\\/]/, "").trim();
}

function stripDuplicateSuffix(fileName) {
    const base = getBaseName(fileName);
    const lastDot = base.lastIndexOf(".");
    if (lastDot === -1) return base;
    const namePart = base.substring(0, lastDot).replace(/\s*\(\d+\)$/, "").trim();
    const extPart = base.substring(lastDot);
    return `${namePart}${extPart}`;
}

function matchesExpectedFileName(expectedName, actualDownloadedName) {
    if (!expectedName || !actualDownloadedName) return false;
    const exp = stripDuplicateSuffix(expectedName).toLowerCase();
    const act = stripDuplicateSuffix(actualDownloadedName).toLowerCase();
    return exp === act;
}

// ============================================================
// VERSIONED PERSISTENT STATE MANAGEMENT
// ============================================================

function createDefaultState() {
    const groups = {};
    for (const g of configuredGroups) {
        groups[g] = {
            importCompleted: false,
            baselineInitialized: false,
            baselineFileKeys: [],
            processedFileKeys: [],
            organizedFiles: [],
            failedJobs: {}
        };
    }
    return {
        version: 2,
        runState: "STOPPED", // Starts STOPPED on first use; once started, user preference persists
        groups: groups,
        activeJobs: {}
    };
}

async function getStore() {
    try {
        const data = await chrome.storage.local.get(STORAGE_KEY);
        let store = data[STORAGE_KEY];
        if (!store || store.version !== 2) {
            store = createDefaultState();
            await chrome.storage.local.set({ [STORAGE_KEY]: store });
        }
        // Ensure all configured groups are present
        let modified = false;
        if (!store.groups) {
            store.groups = {};
            modified = true;
        }
        for (const g of configuredGroups) {
            if (!store.groups[g]) {
                store.groups[g] = {
                    importCompleted: false,
                    baselineInitialized: false,
                    baselineFileKeys: [],
                    processedFileKeys: [],
                    organizedFiles: [],
                    failedJobs: {}
                };
                modified = true;
            }
        }
        if (!store.activeJobs) {
            store.activeJobs = {};
            modified = true;
        }
        if (modified) {
            await chrome.storage.local.set({ [STORAGE_KEY]: store });
        }
        return store;
    } catch (err) {
        console.error("Error reading store from chrome.storage.local:", err);
        return createDefaultState();
    }
}

async function saveStore(store) {
    try {
        await chrome.storage.local.set({ [STORAGE_KEY]: store });
    } catch (err) {
        console.error("Error writing store to chrome.storage.local:", err);
    }
}

// ============================================================
// PIPELINE JOB TRACKING
// ============================================================

const jobWaiters = new Map(); // jobId -> [resolve functions]

function notifyJobWaiters(job) {
    if (!job || !job.id) return;
    const waiters = jobWaiters.get(job.id);
    if (waiters && waiters.length > 0) {
        for (const resolve of waiters) {
            resolve(job);
        }
        if (job.state === "ORGANIZED" || job.state === "FAILED") {
            jobWaiters.delete(job.id);
        }
    }
}

async function registerPipelineJob(groupName, fileName, elementKey) {
    if (!configuredGroups.includes(groupName)) {
        throw new Error(`Unconfigured group: ${groupName}`);
    }
    if (!isSupportedFile(fileName)) {
        throw new Error(`Unsupported file: ${fileName}`);
    }

    const store = await getStore();
    const cleanName = stripDuplicateSuffix(fileName);
    const jobId = `job_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const job = {
        id: jobId,
        groupName: groupName,
        fileName: fileName,
        cleanFileName: cleanName,
        elementKey: elementKey || fileName,
        state: "DETECTED",
        downloadId: null,
        actualFilePath: null,
        destination: null,
        error: null,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };

    store.activeJobs[jobId] = job;
    await saveStore(store);
    return job;
}

async function updateJobState(jobId, newState, extraData = {}) {
    const store = await getStore();
    const job = store.activeJobs[jobId];
    if (!job) return null;

    job.state = newState;
    job.updatedAt = Date.now();
    Object.assign(job, extraData);

    // If terminal state ORGANIZED, update group stats
    if (newState === "ORGANIZED") {
        const groupState = store.groups[job.groupName];
        if (groupState) {
            if (!groupState.organizedFiles.includes(job.cleanFileName)) {
                groupState.organizedFiles.push(job.cleanFileName);
            }
            if (job.elementKey && !groupState.processedFileKeys.includes(job.elementKey)) {
                groupState.processedFileKeys.push(job.elementKey);
            }
            delete groupState.failedJobs[job.elementKey];
        }
    } else if (newState === "FAILED") {
        const groupState = store.groups[job.groupName];
        if (groupState && job.elementKey) {
            groupState.failedJobs[job.elementKey] = {
                fileName: job.fileName,
                reason: job.error || "Unknown error",
                timestamp: Date.now()
            };
        }
    }

    store.activeJobs[jobId] = job;
    await saveStore(store);
    notifyJobWaiters(job);
    return job;
}

// ============================================================
// CHROME DOWNLOAD LISTENERS (LIFECYCLE ADVANCEMENT)
// ============================================================

chrome.downloads.onCreated.addListener(async (downloadItem) => {
    const store = await getStore();
    if (store.runState === "PAUSED" || store.runState === "STOPPED") {
        return;
    }

    const jobs = Object.values(store.activeJobs);
    // Find oldest QUEUED or DETECTED job awaiting download
    const pendingJob = jobs.find(j => (j.state === "QUEUED" || j.state === "DETECTED") && !j.downloadId);
    if (pendingJob) {
        console.log(`📥 Associated Chrome download #${downloadItem.id} with job: "${pendingJob.cleanFileName}"`);
        await updateJobState(pendingJob.id, "DOWNLOADING", {
            downloadId: downloadItem.id
        });
    }
});

chrome.downloads.onChanged.addListener(async (delta) => {
    if (!delta.state || delta.state.current !== "complete") {
        return;
    }

    chrome.downloads.search({ id: delta.id }, async (results) => {
        if (!results || results.length === 0) return;
        const item = results[0];
        const downloadedBase = getBaseName(item.filename);

        if (!isSupportedFile(downloadedBase)) return;

        const store = await getStore();
        const jobs = Object.values(store.activeJobs);

        // 1. Look for job specifically bound to this downloadId
        let matchedJob = jobs.find(j => j.downloadId === delta.id && j.state === "DOWNLOADING");

        // 2. Fallback: match by filename among DOWNLOADING or QUEUED jobs
        if (!matchedJob) {
            matchedJob = jobs.find(j =>
                (j.state === "DOWNLOADING" || j.state === "QUEUED" || j.state === "DETECTED") &&
                matchesExpectedFileName(j.cleanFileName, downloadedBase)
            );
        }

        // 3. Fallback: active tab group context
        if (!matchedJob) {
            const fallbackGroup = await getActiveWhatsAppGroup();
            if (fallbackGroup && configuredGroups.includes(fallbackGroup)) {
                console.log(`🎯 Fallback: Correlating download to active group "${fallbackGroup}": ${downloadedBase}`);
                matchedJob = await registerPipelineJob(fallbackGroup, downloadedBase, downloadedBase);
                matchedJob = await updateJobState(matchedJob.id, "DOWNLOADING", { downloadId: delta.id });
            }
        }

        if (!matchedJob) {
            console.log("⚠️ Ignored completed download (not associated with any Sortly job):", downloadedBase);
            return;
        }

        console.log(`✅ Download finished for job "${matchedJob.cleanFileName}" at: ${item.filename}`);
        await updateJobState(matchedJob.id, "DOWNLOADED", {
            actualFilePath: item.filename,
            downloadId: delta.id
        });

        // Advance to ORGANIZING
        await processJobOrganization(matchedJob.id, item.filename);
    });
});

async function processJobOrganization(jobId, actualFilePath) {
    const store = await getStore();
    const job = store.activeJobs[jobId];
    if (!job) return;

    await updateJobState(jobId, "ORGANIZING");
    console.log(`📦 Dispatching to Python bridge: group="${job.groupName}", file="${actualFilePath}"`);

    try {
        const response = await fetch(BRIDGE_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                groupName: job.groupName,
                fileName: actualFilePath,
                originalName: job.cleanFileName
            })
        });

        const result = await response.json();
        if (result && result.ok) {
            console.log(`🎉 Successfully organized to: ${result.destination}`);
            await updateJobState(jobId, "ORGANIZED", {
                destination: result.destination
            });
        } else {
            const errMsg = (result && result.message) || "Bridge organization rejected";
            console.error(`❌ Bridge rejected file:`, errMsg);
            await updateJobState(jobId, "FAILED", {
                error: errMsg
            });
        }
    } catch (err) {
        console.error(`❌ Bridge communication failed:`, err);
        await updateJobState(jobId, "FAILED", {
            error: `Bridge communication error: ${err.message}`
        });
    }
}

async function getActiveWhatsAppGroup() {
    return new Promise(resolve => {
        chrome.tabs.query({ active: true, currentWindow: true }, tabs => {
            if (!tabs || tabs.length === 0) return resolve(null);
            const tab = tabs[0];
            if (!tab.url || !tab.url.includes("web.whatsapp.com")) return resolve(null);
            chrome.tabs.sendMessage(tab.id, { type: "GET_CURRENT_GROUP" }, response => {
                if (chrome.runtime.lastError || !response || !response.groupName) {
                    resolve(null);
                } else {
                    resolve(response.groupName);
                }
            });
        });
    });
}

// ============================================================
// RUNTIME MESSAGE API (FOR CONTENT SCRIPT)
// ============================================================

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (!message || !message.type) return;

    // 1. Health check
    if (message.type === "CHECK_BRIDGE_STATUS") {
        fetch(HEALTH_URL)
            .then(r => r.json())
            .then(data => sendResponse({ ok: true, online: true, data }))
            .catch(() => sendResponse({ ok: false, online: false }));
        return true;
    }

    // 2. Get complete persistent state
    if (message.type === "GET_STATE") {
        getStore().then(store => sendResponse({ ok: true, store }));
        return true;
    }

    // 3. Set runState (RUNNING, PAUSED, STOPPED)
    if (message.type === "SET_RUN_STATE") {
        (async () => {
            const store = await getStore();
            const allowed = ["RUNNING", "PAUSED", "STOPPED"];
            if (allowed.includes(message.runState)) {
                store.runState = message.runState;
                await saveStore(store);
                console.log(`🔄 Run state changed to: ${message.runState}`);
                sendResponse({ ok: true, runState: store.runState });
            } else {
                sendResponse({ ok: false, error: "Invalid run state" });
            }
        })();
        return true;
    }

    // 4. Update group state (e.g. baselineInitialized, baselineFileKeys)
    if (message.type === "UPDATE_GROUP_STATE") {
        (async () => {
            const store = await getStore();
            const { groupName, updates } = message;
            if (store.groups[groupName]) {
                Object.assign(store.groups[groupName], updates);
                await saveStore(store);
                sendResponse({ ok: true, groupState: store.groups[groupName] });
            } else {
                sendResponse({ ok: false, error: "Unknown group" });
            }
        })();
        return true;
    }

    // 5. Mark initial import completed for a group
    if (message.type === "MARK_IMPORT_COMPLETED") {
        (async () => {
            const store = await getStore();
            const { groupName } = message;
            if (store.groups[groupName]) {
                store.groups[groupName].importCompleted = true;
                store.groups[groupName].baselineInitialized = true;
                // Transition to RUNNING if it was STOPPED
                if (store.runState === "STOPPED") {
                    store.runState = "RUNNING";
                }
                await saveStore(store);
                console.log(`🏁 Initial Import marked COMPLETED for group: "${groupName}"`);
                sendResponse({ ok: true, groupState: store.groups[groupName] });
            } else {
                sendResponse({ ok: false, error: "Unknown group" });
            }
        })();
        return true;
    }

    // 6. Check if file already exists in destination folder
    if (message.type === "CHECK_FILE_EXISTS") {
        fetch(CHECK_URL, {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
                groupName: message.groupName,
                fileName: message.fileName
            })
        })
        .then(r => r.json())
        .then(data => sendResponse(data))
        .catch(err => {
            console.error("Bridge /check error:", err);
            sendResponse({ ok: false, exists: false });
        });
        return true;
    }

    // 7. Register and queue job for download
    if (message.type === "REGISTER_JOB") {
        (async () => {
            try {
                const store = await getStore();
                if (store.runState === "PAUSED" || store.runState === "STOPPED") {
                    sendResponse({ ok: false, error: `Sortly is ${store.runState}` });
                    return;
                }
                const job = await registerPipelineJob(message.groupName, message.fileName, message.elementKey);
                await updateJobState(job.id, "QUEUED");
                sendResponse({ ok: true, job });
            } catch (err) {
                sendResponse({ ok: false, error: err.message });
            }
        })();
        return true;
    }

    // 8. Wait for job to reach ORGANIZED or FAILED terminal state
    if (message.type === "AWAIT_JOB") {
        const { jobId, timeout = 25000 } = message;
        (async () => {
            const store = await getStore();
            const job = store.activeJobs[jobId];
            if (!job) {
                sendResponse({ ok: false, error: "Job not found" });
                return;
            }
            if (job.state === "ORGANIZED" || job.state === "FAILED") {
                sendResponse({ ok: job.state === "ORGANIZED", job });
                return;
            }

            let timer = null;
            const waiter = (updatedJob) => {
                if (updatedJob.state === "ORGANIZED" || updatedJob.state === "FAILED") {
                    if (timer) clearTimeout(timer);
                    sendResponse({ ok: updatedJob.state === "ORGANIZED", job: updatedJob });
                }
            };

            if (!jobWaiters.has(jobId)) {
                jobWaiters.set(jobId, []);
            }
            jobWaiters.get(jobId).push(waiter);

            timer = setTimeout(async () => {
                const currentStore = await getStore();
                const currentJob = currentStore.activeJobs[jobId];
                sendResponse({
                    ok: currentJob && currentJob.state === "ORGANIZED",
                    timeout: true,
                    job: currentJob
                });
            }, timeout);
        })();
        return true;
    }
});