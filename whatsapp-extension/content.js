// ============================================================
// SORTLY - WhatsApp College File Organizer
// SAFE CONTENT SCRIPT
// ============================================================

console.log("🚀 Sortly automatic file organizer loaded.");

// ============================================================
// CONFIGURATION
// ============================================================

const knownGroups = [
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

// ============================================================
// STATE
// ============================================================

// LIVE = automatically process genuinely new documents
// INITIAL_IMPORT = deliberately import existing documents
let sortlyMode = "LIVE";

// Documents that existed when the baseline was created.
const baselineDocuments = new Set();

// Documents that have already been sent to the download pipeline.
const processedDocuments = new Set();

// Documents that were already handled during the current
// Initial Import operation.
const importedDocuments = new Set();

// Prevent repeated baseline construction.
let baselineReady = false;
let baselineBuildRunning = false;

// Prevent two Initial Imports at the same time.
let initialImportRunning = false;

// Current group currently associated with this page.
let currentGroupName = "Unknown";

// Timestamp of last reliable group detection.
let currentGroupDetectedAt = 0;

// ============================================================
// SUPPORTED FILE CHECK
// ============================================================

function isSupportedFile(fileName) {

    if (!fileName) {
        return false;
    }

    const lower = fileName.toLowerCase();

    return supportedExtensions.some(ext =>
        lower.endsWith(ext)
    );
}

// ============================================================
// GET FILE NAME FROM DOCUMENT BUTTON
// ============================================================

function getFileNameFromButton(button) {

    if (!button) {
        return null;
    }

    // WhatsApp currently uses title:
    // Download "filename.ext"

    const title =
        button.getAttribute("title") || "";

    const titleMatch =
        title.match(/^Download\s+"(.+)"$/);

    if (titleMatch && titleMatch[1]) {
        return titleMatch[1];
    }

    // Backup: aria-label

    const aria =
        button.getAttribute("aria-label") || "";

    const ariaMatch =
        aria.match(/^Download\s+"(.+)"$/);

    if (ariaMatch && ariaMatch[1]) {
        return ariaMatch[1];
    }

    return null;
}

// ============================================================
// NORMALIZE TEXT
// ============================================================

function normalizeText(value) {

    return (value || "")
        .replace(/\s+/g, " ")
        .trim();
}

// ============================================================
// FIND CURRENT WHATSAPP GROUP
// ============================================================
//
// IMPORTANT:
//
// We deliberately do NOT simply scan the whole page and accept
// any matching text. That caused files from one group to be
// associated with another group.
//
// We first inspect likely WhatsApp conversation/header areas,
// then use exact matching.
//
// ============================================================

function findGroup() {

    // --------------------------------------------------------
    // 1. Try known group names against likely header elements.
    // --------------------------------------------------------

    const likelySelectors = [
        'header',
        '[role="banner"]',
        '[data-testid="conversation-header"]',
        '[data-testid="conversation-info-header"]',
        '[data-testid="chat-header"]'
    ];

    for (const selector of likelySelectors) {

        const elements =
            document.querySelectorAll(selector);

        for (const element of elements) {

            const text =
                normalizeText(element.textContent);

            if (!text) {
                continue;
            }

            for (const group of knownGroups) {

                if (
                    text === group ||
                    text.includes(group)
                ) {

                    currentGroupName = group;
                    currentGroupDetectedAt = Date.now();

                    console.log(
                        "🎯 Sortly detected current group:",
                        group
                    );

                    return group;
                }
            }
        }
    }

    // --------------------------------------------------------
    // 2. Look for exact title / aria-label matches.
    // --------------------------------------------------------

    const attributed =
        document.querySelectorAll(
            "[title], [aria-label]"
        );

    for (const element of attributed) {

        const title =
            normalizeText(
                element.getAttribute("title")
            );

        const aria =
            normalizeText(
                element.getAttribute("aria-label")
            );

        for (const group of knownGroups) {

            if (
                title === group ||
                aria === group
            ) {

                currentGroupName = group;
                currentGroupDetectedAt = Date.now();

                console.log(
                    "🎯 Sortly detected current group:",
                    group
                );

                return group;
            }
        }
    }

    // --------------------------------------------------------
    // 3. Exact text fallback.
    //
    // We only accept an element whose complete visible text
    // equals a configured group name.
    // --------------------------------------------------------

    for (const group of knownGroups) {

        const elements =
            document.querySelectorAll(
                "span, div"
            );

        for (const element of elements) {

            const text =
                normalizeText(
                    element.textContent
                );

            if (text === group) {

                // Avoid accepting huge containers.
                // A group name should normally be a reasonably
                // small element.

                if (text.length > 200) {
                    continue;
                }

                currentGroupName = group;
                currentGroupDetectedAt = Date.now();

                console.log(
                    "🎯 Sortly detected current group:",
                    group
                );

                return group;
            }
        }
    }

    // --------------------------------------------------------
    // 4. Do NOT blindly trust an old group forever.
    //
    // If group detection has gone stale, return Unknown.
    // --------------------------------------------------------

    const GROUP_CONTEXT_TIMEOUT = 15000;

    if (
        currentGroupName !== "Unknown" &&
        Date.now() - currentGroupDetectedAt <
        GROUP_CONTEXT_TIMEOUT
    ) {

        return currentGroupName;
    }

    return "Unknown";
}

// ============================================================
// CHECK WHETHER A DOCUMENT BELONGS TO A MESSAGE
// ============================================================

function getMessageContainer(button) {

    if (!button) {
        return null;
    }

    // WhatsApp message containers normally contain data-id.

    const message =
        button.closest(
            '[data-id]'
        );

    return message || null;
}

// ============================================================
// CREATE UNIQUE DOCUMENT KEY
// ============================================================

function createDocumentKey(button, fileName) {

    if (!button) {
        return fileName;
    }

    const message =
        getMessageContainer(button);

    if (message) {

        const id =
            message.getAttribute(
                "data-id"
            );

        if (id) {

            return (
                id +
                "::" +
                fileName
            );
        }
    }

    // Fallback.

    return fileName;
}

// ============================================================
// CHECK WHETHER DOCUMENT WAS PROCESSED
// ============================================================

function wasProcessed(documentKey) {

    return processedDocuments.has(
        documentKey
    );
}

// ============================================================
// PROCESS DOCUMENT DOWNLOAD
// ============================================================

async function processDownloadButton(
    button,
    forceImport = false
) {

    if (!button) {
        return;
    }

    // --------------------------------------------------------
    // Get filename
    // --------------------------------------------------------

    const fileName =
        getFileNameFromButton(button);

    if (!fileName) {
        return;
    }

    // --------------------------------------------------------
    // Ignore unsupported files
    //
    // This automatically excludes:
    // JPG
    // JPEG
    // PNG
    // WEBP
    // GIF
    // MP4
    // MP3
    // etc.
    // --------------------------------------------------------

    if (!isSupportedFile(fileName)) {

        return;
    }

    // --------------------------------------------------------
    // Current group
    // --------------------------------------------------------

    const groupName =
        findGroup();

    if (
        !groupName ||
        groupName === "Unknown"
    ) {

        console.log(
            "⏳ Sortly: current WhatsApp group not detected. Ignoring:",
            fileName
        );

        return;
    }

    // --------------------------------------------------------
    // Make document key
    // --------------------------------------------------------

    const documentKey =
        createDocumentKey(
            button,
            fileName
        );

    // --------------------------------------------------------
    // INITIAL IMPORT
    // --------------------------------------------------------
    //
    // During Initial Import we intentionally allow documents
    // that were already present in the baseline.
    //
    // This is the important fix for the old logic.
    // --------------------------------------------------------

    if (forceImport) {

        if (
            importedDocuments.has(
                documentKey
            )
        ) {

            return;
        }

        // Mark before sending so MutationObserver cannot
        // trigger another import simultaneously.

        importedDocuments.add(
            documentKey
        );

        processedDocuments.add(
            documentKey
        );

        console.log(
            "📥 Sortly Initial Import:",
            fileName,
            "| Group:",
            groupName
        );

    }

    // --------------------------------------------------------
    // LIVE MODE
    // --------------------------------------------------------

    else {

        // Before baseline:
        //
        // Existing files are remembered.
        // Nothing is downloaded.

        if (!baselineReady) {

            baselineDocuments.add(
                documentKey
            );

            return;
        }

        // Already part of baseline.

        if (
            baselineDocuments.has(
                documentKey
            )
        ) {

            return;
        }

        // Already processed.

        if (
            wasProcessed(
                documentKey
            )
        ) {

            return;
        }

        // ----------------------------------------------------
        // NEW DOCUMENT
        // ----------------------------------------------------

        processedDocuments.add(
            documentKey
        );

        console.log(
            "🆕 Sortly detected NEW document:",
            fileName,
            "| Group:",
            groupName
        );
    }

    // --------------------------------------------------------
    // Prevent repeated processing on the same DOM button.
    // --------------------------------------------------------

    button.dataset.sortlyProcessed =
        "true";

    // --------------------------------------------------------
    // Tell background.js
    // --------------------------------------------------------

    try {

        const response =
            await chrome.runtime.sendMessage({

                type:
                    "WHATSAPP_DOWNLOAD_STARTED",

                groupName:
                    groupName,

                fileName:
                    fileName
            });

        if (
            response &&
            response.ok
        ) {

            console.log(
                "📤 Sortly sent to download pipeline:",
                fileName,
                "| Group:",
                groupName
            );

        } else {

            console.log(
                "⚠️ Sortly background response:",
                response
            );

            // If the bridge did not accept the request,
            // allow a future retry.

            processedDocuments.delete(
                documentKey
            );

            if (forceImport) {
                importedDocuments.delete(
                    documentKey
                );
            }

            delete button.dataset.sortlyProcessed;
        }

    } catch (error) {

        console.error(
            "❌ Sortly failed to contact background:",
            error
        );

        // Allow retry.

        processedDocuments.delete(
            documentKey
        );

        if (forceImport) {
            importedDocuments.delete(
                documentKey
            );
        }

        delete button.dataset.sortlyProcessed;
    }
}

// ============================================================
// GET ALL DOCUMENT BUTTONS
// ============================================================

function getDocumentButtons() {

    return [
        ...document.querySelectorAll(
            '[data-testid="document-thumb"]'
        )
    ];
}

// ============================================================
// BUILD INITIAL BASELINE
// ============================================================
//
// The baseline means:
//
// "These documents already existed when Sortly started
// watching this conversation."
//
// They are NOT downloaded automatically.
//
// ============================================================

async function buildInitialBaseline() {

    if (baselineReady) {
        return;
    }

    if (baselineBuildRunning) {
        return;
    }

    baselineBuildRunning = true;

    console.log(
        "🧠 Sortly is learning existing documents..."
    );

    let attempts = 0;

    const maxAttempts = 30;

    while (
        !baselineReady &&
        attempts < maxAttempts
    ) {

        attempts++;

        const groupName =
            findGroup();

        const buttons =
            getDocumentButtons();

        console.log(
            "🔎 Sortly baseline check:",
            "Group =",
            groupName,
            "| Documents =",
            buttons.length
        );

        // ----------------------------------------------------
        // Wait for WhatsApp chat to become ready.
        // ----------------------------------------------------

        if (
            groupName === "Unknown"
        ) {

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        2000
                    )
            );

            continue;
        }

        // ----------------------------------------------------
        // If there are no supported documents, we can still
        // establish the baseline.
        //
        // This prevents infinite retry for groups containing
        // only images or unsupported files.
        // ----------------------------------------------------

        let supportedCount = 0;

        for (
            const button of buttons
        ) {

            const fileName =
                getFileNameFromButton(
                    button
                );

            if (
                fileName &&
                isSupportedFile(
                    fileName
                )
            ) {

                supportedCount++;
            }
        }

        // Give WhatsApp a little time to render documents,
        // but do not wait forever.

        if (
            buttons.length === 0 &&
            attempts < 5
        ) {

            await new Promise(
                resolve =>
                    setTimeout(
                        resolve,
                        2000
                    )
            );

            continue;
        }

        // ----------------------------------------------------
        // Remember all existing supported documents.
        // ----------------------------------------------------

        let remembered = 0;

        for (
            const button of buttons
        ) {

            const fileName =
                getFileNameFromButton(
                    button
                );

            if (
                !fileName ||
                !isSupportedFile(
                    fileName
                )
            ) {

                continue;
            }

            const key =
                createDocumentKey(
                    button,
                    fileName
                );

            if (
                !baselineDocuments.has(
                    key
                )
            ) {

                baselineDocuments.add(
                    key
                );

                remembered++;

                button.dataset.sortlyBaseline =
                    "true";

                console.log(
                    "🧠 Sortly remembered:",
                    fileName
                );
            }
        }

        // ----------------------------------------------------
        // Baseline complete.
        // ----------------------------------------------------

        baselineReady = true;

        console.log(
            "🧠 Sortly baseline:",
            baselineDocuments.size,
            "existing documents remembered."
        );

        console.log(
            "📊 Supported documents visible:",
            supportedCount
        );

        console.log(
            "✅ Sortly baseline complete. NEW documents can now be downloaded automatically."
        );
    }

    baselineBuildRunning = false;
}

// ============================================================
// INITIAL IMPORT
// ============================================================
//
// This is deliberately triggered by the user.
//
// It downloads the existing supported documents currently
// visible in the open WhatsApp group.
//
// ============================================================

async function startInitialImport() {

    if (initialImportRunning) {

        console.log(
            "⚠️ Sortly Initial Import is already running."
        );

        return;
    }

    initialImportRunning = true;

    console.log(
        "📥 Sortly Initial Import started..."
    );

    // --------------------------------------------------------
    // Make sure baseline exists.
    // --------------------------------------------------------

    if (!baselineReady) {

        console.log(
            "⏳ Sortly waiting for baseline..."
        );

        await buildInitialBaseline();
    }

    // --------------------------------------------------------
    // Detect current group again.
    // --------------------------------------------------------

    const groupName =
        findGroup();

    if (
        !groupName ||
        groupName === "Unknown"
    ) {

        console.log(
            "❌ Sortly could not detect current group."
        );

        initialImportRunning = false;

        return;
    }

    // --------------------------------------------------------
    // Get current visible documents.
    // --------------------------------------------------------

    const buttons =
        getDocumentButtons();

    console.log(
        "📚 Sortly found",
        buttons.length,
        "document messages."
    );

    // --------------------------------------------------------
    // Switch to Initial Import.
    // --------------------------------------------------------

    sortlyMode =
        "INITIAL_IMPORT";

    // --------------------------------------------------------
    // Clear import tracking for this run.
    // --------------------------------------------------------

    importedDocuments.clear();

    // --------------------------------------------------------
    // Process each supported document.
    // --------------------------------------------------------

    for (
        const button of buttons
    ) {

        const fileName =
            getFileNameFromButton(
                button
            );

        if (
            !fileName ||
            !isSupportedFile(
                fileName
            )
        ) {

            // Images and unsupported files ignored.

            continue;
        }

        const key =
            createDocumentKey(
                button,
                fileName
            );

        // ----------------------------------------------------
        // Already imported in this run.
        // ----------------------------------------------------

        if (
            importedDocuments.has(
                key
            )
        ) {

            continue;
        }

        console.log(
            "📥 Sortly importing:",
            fileName,
            "| Group:",
            groupName
        );

        await processDownloadButton(
            button,
            true
        );

        // ----------------------------------------------------
        // Small delay between downloads.
        // ----------------------------------------------------

        await new Promise(
            resolve =>
                setTimeout(
                    resolve,
                    1000
                )
        );
    }

    // --------------------------------------------------------
    // Return to LIVE.
    // --------------------------------------------------------

    sortlyMode =
        "LIVE";

    initialImportRunning =
        false;

    console.log(
        "✅ Sortly Initial Import finished."
    );

    console.log(
        "👀 Sortly is back in LIVE mode."
    );
}

// ============================================================
// HANDLE NEW DOCUMENTS
// ============================================================

function processVisibleNewDocuments() {

    if (!baselineReady) {
        return;
    }

    if (initialImportRunning) {
        return;
    }

    if (sortlyMode !== "LIVE") {
        return;
    }

    const groupName =
        findGroup();

    if (
        !groupName ||
        groupName === "Unknown"
    ) {

        return;
    }

    const buttons =
        getDocumentButtons();

    for (
        const button of buttons
    ) {

        const fileName =
            getFileNameFromButton(
                button
            );

        if (
            !fileName ||
            !isSupportedFile(
                fileName
            )
        ) {

            continue;
        }

        const key =
            createDocumentKey(
                button,
                fileName
            );

        // ----------------------------------------------------
        // Existing baseline document.
        // ----------------------------------------------------

        if (
            baselineDocuments.has(
                key
            )
        ) {

            continue;
        }

        // ----------------------------------------------------
        // Already processed.
        // ----------------------------------------------------

        if (
            processedDocuments.has(
                key
            )
        ) {

            continue;
        }

        processDownloadButton(
            button,
            false
        );
    }
}

// ============================================================
// MUTATION OBSERVER
// ============================================================

const observer =
    new MutationObserver(
        mutations => {

            let foundDocument =
                false;

            for (
                const mutation of mutations
            ) {

                for (
                    const node of mutation.addedNodes
                ) {

                    if (
                        node.nodeType !==
                        Node.ELEMENT_NODE
                    ) {

                        continue;
                    }

                    // Direct document button.

                    if (
                        node.matches &&
                        node.matches(
                            '[data-testid="document-thumb"]'
                        )
                    ) {

                        foundDocument = true;
                    }

                    // Document button somewhere inside
                    // the newly-added node.

                    if (
                        node.querySelector &&
                        node.querySelector(
                            '[data-testid="document-thumb"]'
                        )
                    ) {

                        foundDocument = true;
                    }
                }
            }

            if (!foundDocument) {
                return;
            }

            // ------------------------------------------------
            // Before baseline:
            // only learn existing documents.
            // ------------------------------------------------

            if (!baselineReady) {

                buildInitialBaseline();

                return;
            }

            // ------------------------------------------------
            // LIVE:
            // process new documents.
            // ------------------------------------------------

            if (
                sortlyMode === "LIVE" &&
                !initialImportRunning
            ) {

                // Small delay gives WhatsApp time to finish
                // constructing the message DOM.

                setTimeout(
                    () => {
                        processVisibleNewDocuments();
                    },
                    300
                );
            }
        }
    );

// ============================================================
// START OBSERVER
// ============================================================

observer.observe(
    document.body,
    {
        childList: true,
        subtree: true
    }
);

// ============================================================
// STARTUP
// ============================================================

console.log(
    "👀 Sortly is watching for NEW college documents."
);

console.log(
    "🔄 LIVE MODE: existing documents will not be downloaded."
);

console.log(
    "🖼️ Images are excluded."
);

console.log(
    "📁 Supported: PDF, DOC, DOCX, PPT, PPTX, XLS, XLSX, TXT, ZIP."
);

// ============================================================
// BUILD BASELINE AFTER WHATSAPP LOADS
// ============================================================

setTimeout(
    () => {

        buildInitialBaseline();

    },
    2500
);

// ============================================================
// OPTIONAL GLOBAL FUNCTION
// ============================================================
//
// NOTE:
// This function lives inside the content-script world.
//
// It normally cannot be called directly from the normal PAGE
// DevTools console because Chrome isolates content scripts.
//
// A proper extension popup/button can call this later.
//
// ============================================================

window.SortlyInitialImport =
    function () {

        console.log(
            "📥 Sortly Initial Import requested."
        );

        startInitialImport();
    };

// ============================================================
// FINAL STARTUP MESSAGE
// ============================================================

console.log(
    "✅ Sortly content.js ready."
);

console.log(
    "📌 Initial Import function prepared."
);