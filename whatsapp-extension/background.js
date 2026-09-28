const BRIDGE_URL =
    "http://127.0.0.1:8765/organize";


console.log(
    "🚀 Sortly background service worker started."
);


// ============================================================
// CURRENT DOWNLOAD CONTEXT
// ============================================================

const pendingDownloads =
    new Map();


// ============================================================
// SUPPORTED FILE TYPES
// ============================================================

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


function isSupportedFile(
    fileName
) {

    if (!fileName) {
        return false;
    }


    const lowerName =
        fileName
            .toLowerCase()
            .trim();


    return supportedExtensions.some(
        extension =>
            lowerName.endsWith(
                extension
            )
    );
}


// ============================================================
// MESSAGE FROM CONTENT.JS
// ============================================================

chrome.runtime.onMessage.addListener(
    (
        message,
        sender,
        sendResponse
    ) => {

        if (
            !message ||
            message.type !==
            "WHATSAPP_DOWNLOAD_STARTED"
        ) {
            return;
        }


        const groupName =
            message.groupName ||
            "Unknown";


        const fileName =
            message.fileName ||
            "";


        console.log(
            "📚 Sortly group:",
            groupName
        );


        console.log(
            "📄 Expected file:",
            fileName
        );


        /*
         * Store the context temporarily.
         *
         * We use the tab ID because multiple
         * WhatsApp tabs should not overwrite
         * each other's group information.
         */

        const tabId =
            sender.tab
                ? sender.tab.id
                : null;


        if (
            tabId !== null
        ) {

            pendingDownloads.set(
                tabId,
                {
                    groupName:
                        groupName,

                    fileName:
                        fileName,

                    createdAt:
                        Date.now()
                }
            );
        }


        sendResponse({
            ok: true
        });


        return true;
    }
);


// ============================================================
// DOWNLOAD CREATED
// ============================================================

chrome.downloads.onCreated.addListener(
    downloadItem => {

        console.log(
            "📥 Chrome download created:",
            downloadItem.id
        );


        console.log(
            "📄 Chrome filename:",
            downloadItem.filename
        );


        /*
         * We deliberately DO NOT organize
         * here.
         *
         * The file may still be downloading.
         */
    }
);


// ============================================================
// DOWNLOAD COMPLETE
// ============================================================

chrome.downloads.onChanged.addListener(
    delta => {

        if (
            !delta.state ||
            delta.state.current !==
            "complete"
        ) {
            return;
        }


        chrome.downloads.search(
            {
                id: delta.id
            },

            results => {

                if (
                    !results ||
                    results.length === 0
                ) {
                    return;
                }


                const item =
                    results[0];


                console.log(
                    "✅ DOWNLOAD COMPLETE:",
                    item.filename
                );


                if (
                    !isSupportedFile(
                        item.filename
                    )
                ) {

                    console.log(
                        "⏭️ Sortly ignored:",
                        item.filename
                    );

                    return;
                }


                /*
                 * Find the matching pending
                 * WhatsApp context.
                 */

                const context =
                    findMatchingContext(
                        item.filename
                    );


                if (!context) {

                    console.log(
                        "⚠️ Sortly could not match download to a WhatsApp group:",
                        item.filename
                    );

                    return;
                }


                organizeDownload(
                    item.id,
                    item.filename,
                    context.groupName
                );
            }
        );
    }
);


// ============================================================
// FIND MATCHING WHATSAPP CONTEXT
// ============================================================

function findMatchingContext(
    actualFileName
) {

    const now =
        Date.now();


    /*
     * Remove contexts older than 2 minutes.
     */

    for (
        const [
            tabId,
            context
        ]
        of pendingDownloads
    ) {

        if (
            now -
            context.createdAt
            >
            120000
        ) {

            pendingDownloads.delete(
                tabId
            );
        }
    }


    /*
     * First try exact filename.
     */

    for (
        const [
            tabId,
            context
        ]
        of pendingDownloads
    ) {

        if (
            context.fileName &&
            context.fileName ===
            actualFileName
        ) {

            pendingDownloads.delete(
                tabId
            );

            return context;
        }
    }


    /*
     * Fallback:
     * use the newest WhatsApp context.
     */

    let newest =
        null;

    let newestTab =
        null;


    for (
        const [
            tabId,
            context
        ]
        of pendingDownloads
    ) {

        if (
            !newest ||
            context.createdAt >
            newest.createdAt
        ) {

            newest =
                context;

            newestTab =
                tabId;
        }
    }


    if (
        newest &&
        newestTab !== null
    ) {

        pendingDownloads.delete(
            newestTab
        );

        return newest;
    }


    return null;
}


// ============================================================
// SEND TO PYTHON BRIDGE
// ============================================================

function organizeDownload(
    downloadId,
    fileName,
    groupName
) {

    if (
        !groupName ||
        groupName === "Unknown"
    ) {

        console.log(
            "⚠️ Cannot organize - unknown group."
        );

        return;
    }


    console.log(
        "📦 Sending completed file to Python bridge:",
        groupName,
        fileName
    );


    fetch(
        BRIDGE_URL,
        {
            method: "POST",

            headers: {
                "Content-Type":
                    "application/json"
            },

            body: JSON.stringify({
                groupName:
                    groupName,

                fileName:
                    fileName
            })
        }
    )

    .then(
        response =>
            response.json()
    )

    .then(
        result => {

            console.log(
                "🐍 Python bridge:",
                result
            );
        }
    )

    .catch(
        error => {

            console.error(
                "❌ Python bridge error:",
                error
            );
        }
    );
}