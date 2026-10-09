# 📦 Sortly — WhatsApp College File Organizer

Automatically download and organize college documents from WhatsApp Web into clean subject folders on your computer.

---

## ⚡ 60-Second Quick Start

Sortly consists of two lightweight parts that work together:
1. **Sortly Chrome Extension** (runs inside WhatsApp Web to detect files).
2. **Sortly Bridge** (`SortlyBridge.exe` — runs locally in the background to safely copy files into your subject folders).

### Step 1: Run Sortly Bridge
* Double-click **`SortlyBridge.exe`** (or `start_organizer.bat` if you have Python installed).
* A small window will open confirming: `Listening on http://127.0.0.1:8765`.
* Keep it open while using WhatsApp Web.

### Step 2: Install Sortly in Chrome
1. Open Google Chrome and go to: `chrome://extensions`
2. Enable **Developer mode** (toggle switch in the top-right corner).
3. Click **"Load unpacked"** in the top-left corner.
4. Select the **`whatsapp-extension`** folder inside this directory.
5. Open or refresh [WhatsApp Web](https://web.whatsapp.com/).

You will see the floating **Sortly widget** at the bottom-right corner of WhatsApp Web!

---

## ⚙️ How to Add Your Own College Groups & Folders

Sortly makes it easy for anyone to map their own college subjects:

1. Click the **⚙ (Settings)** icon in the top header of the Sortly floating card.
2. **Base Storage Folder**: Set your main folder (e.g. `C:\Users\YourName\Documents\College` or `E:\College Files`).
3. **Add a Subject**:
   - Open your college group in WhatsApp.
   - In Sortly Settings, click **"Detect Active Chat"** (auto-fills the group name).
   - Enter your target subfolder name (e.g. `Physics`, `Maths`, `Assignments`).
   - Click **Add**.
4. Click **"Save & Sync Bridge"**.

Sortly will automatically create the subfolder and monitor that group for new documents!

---

## 🚀 How It Works

* **Live Mode**: When someone sends a document (`.pdf`, `.docx`, `.pptx`, `.xlsx`, `.zip`, `.txt`) in a configured group, Sortly automatically downloads it, identifies the group, and safely copies it into the designated subject folder.
* **Initial Import**: Joining a group or want past files? Open the group and click **"Initial Import"** — Sortly will safely download and organize all eligible past files without creating duplicates.
* **Duplicate Protection**: Uses SHA-256 cryptographic hashing to ensure no file is ever duplicated.
* **Safety First**: Only copies files — never moves, alters, or deletes anything from your `Downloads` folder. Non-document media (photos, audio, video) and personal chats are strictly ignored.
* **Draggable Widget**: You can drag the Sortly widget anywhere on your screen by mouse or minimize it into a compact pill with the `−` button.

---

## 📁 Supported File Types
* `.pdf`, `.doc`, `.docx`, `.ppt`, `.pptx`, `.xls`, `.xlsx`, `.txt`, `.zip`

*(Images, photos, voice notes, and videos are automatically ignored).*

