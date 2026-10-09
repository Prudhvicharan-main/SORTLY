from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import re
import shutil
import hashlib
import time
from datetime import datetime

# ============================================================
# MAIN FOLDER & DOWNLOADS (DYNAMIC CONFIG SUPPORT)
# ============================================================

DEFAULT_BASE_FOLDER = r"E:\College Files"
DOWNLOADS_FOLDER = os.path.expanduser(r"~\Downloads")

DEFAULT_SUBJECT_MAPPINGS = {
    "9968_OOPJ_25SC2006L_S:2-L-2026-2027-ODDSEM": "Java",
    "ESD&IoT LE": "IoT",
    "Y25-Mathematics for Data Science": "Maths DS",
    "25CS2102L": "OS",
    "AIML le 2k26": "AIML",
    "S-3 MFE Lateral": "MATHS FOR ENGINER"
}

CONFIG_FILE = os.path.join(os.path.dirname(os.path.abspath(__file__)), "sortly_config.json")

BASE_FOLDER = DEFAULT_BASE_FOLDER
SUBJECT_MAPPINGS = dict(DEFAULT_SUBJECT_MAPPINGS)
SUBJECT_FOLDERS = {}

def load_config():
    global BASE_FOLDER, SUBJECT_MAPPINGS, SUBJECT_FOLDERS
    base = DEFAULT_BASE_FOLDER
    mappings = dict(DEFAULT_SUBJECT_MAPPINGS)
    if os.path.isfile(CONFIG_FILE):
        try:
            with open(CONFIG_FILE, "r", encoding="utf-8") as f:
                data = json.load(f)
                if data.get("base_folder"):
                    base = data["base_folder"].strip()
                if isinstance(data.get("subject_folders"), dict):
                    mappings.update(data["subject_folders"])
        except Exception as e:
            print(f"Warning: could not load {CONFIG_FILE}: {e}")
    BASE_FOLDER = base
    SUBJECT_MAPPINGS = mappings
    SUBJECT_FOLDERS = {}
    for group, folder in mappings.items():
        dest = os.path.join(BASE_FOLDER, folder)
        SUBJECT_FOLDERS[group] = dest
        try:
            os.makedirs(dest, exist_ok=True)
        except Exception:
            pass
    return base, mappings

def save_config(new_base=None, new_mappings=None):
    global BASE_FOLDER, SUBJECT_MAPPINGS, SUBJECT_FOLDERS
    if new_base:
        BASE_FOLDER = new_base.strip()
    if isinstance(new_mappings, dict):
        SUBJECT_MAPPINGS = new_mappings
    SUBJECT_FOLDERS = {}
    for group, folder in SUBJECT_MAPPINGS.items():
        dest = os.path.join(BASE_FOLDER, folder)
        SUBJECT_FOLDERS[group] = dest
        try:
            os.makedirs(dest, exist_ok=True)
        except Exception:
            pass
    try:
        with open(CONFIG_FILE, "w", encoding="utf-8") as f:
            json.dump({
                "base_folder": BASE_FOLDER,
                "subject_folders": SUBJECT_MAPPINGS
            }, f, indent=4, ensure_ascii=False)
    except Exception as e:
        print(f"Warning: could not save {CONFIG_FILE}: {e}")

# Initialize config
load_config()

# ============================================================
# SUPPORTED FILE TYPES
# ============================================================

SUPPORTED_EXTENSIONS = {
    ".pdf",
    ".doc",
    ".docx",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
    ".txt",
    ".zip"
}

# ============================================================
# LOG FILE & LOGGING
# ============================================================

LOG_FILE = os.path.join(
    BASE_FOLDER,
    "WhatsAppOrganizer",
    "bridge.log"
)

def log(message):
    timestamp = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    line = f"[{timestamp}] {message}"
    print(line)
    try:
        with open(LOG_FILE, "a", encoding="utf-8") as file:
            file.write(line + "\n")
    except Exception:
        pass

# ============================================================
# SHA-256 HASH
# ============================================================

def calculate_sha256(file_path):
    sha256 = hashlib.sha256()
    with open(file_path, "rb") as file:
        while True:
            data = file.read(1024 * 1024)
            if not data:
                break
            sha256.update(data)
    return sha256.hexdigest()

# ============================================================
# FILE HELPERS
# ============================================================

def get_clean_file_name(file_name):
    if not file_name:
        return ""
    file_name = file_name.replace("/", "\\")
    return os.path.basename(file_name).strip()

def strip_chrome_duplicate_suffix(file_name):
    clean = get_clean_file_name(file_name)
    name, ext = os.path.splitext(clean)
    stripped = re.sub(r"\s*\(\d+\)$", "", name).strip()
    return f"{stripped}{ext}"

def is_supported_file(file_name):
    if not file_name:
        return False
    extension = os.path.splitext(file_name)[1].lower()
    return extension in SUPPORTED_EXTENSIONS

# ============================================================
# FIND FILE IN DOWNLOADS (HANDLES ABSOLUTE, EXACT, AND DUPLICATE SUFFIXES)
# ============================================================

def find_download_file(file_name):
    if not file_name:
        return None

    # 1. Direct absolute path provided by Chrome API
    if os.path.isabs(file_name) and os.path.isfile(file_name):
        return file_name

    clean_name = get_clean_file_name(file_name)
    if not clean_name:
        return None

    # 2. Exact match in Downloads
    exact_path = os.path.join(DOWNLOADS_FOLDER, clean_name)
    if os.path.isfile(exact_path):
        return exact_path

    # 3. Case-insensitive search & Chrome duplicate suffix matching
    target_clean = clean_name.lower()
    name_part, ext_part = os.path.splitext(clean_name)
    pattern = re.compile(rf"^{re.escape(name_part)}(\s*\(\d+\))?{re.escape(ext_part)}$", re.IGNORECASE)

    try:
        candidates = []
        for current_name in os.listdir(DOWNLOADS_FOLDER):
            if current_name.lower() == target_clean:
                candidate_path = os.path.join(DOWNLOADS_FOLDER, current_name)
                if os.path.isfile(candidate_path):
                    return candidate_path
            elif pattern.match(current_name):
                candidate_path = os.path.join(DOWNLOADS_FOLDER, current_name)
                if os.path.isfile(candidate_path):
                    candidates.append((candidate_path, os.path.getmtime(candidate_path)))

        if candidates:
            # Pick the most recently modified candidate
            candidates.sort(key=lambda x: x[1], reverse=True)
            return candidates[0][0]

    except Exception as error:
        log(f"ERROR searching Downloads: {error}")

    return None

# ============================================================
# WAIT FOR FILE IN DOWNLOADS
# ============================================================

def wait_for_file(file_name, timeout=15):
    clean_name = get_clean_file_name(file_name)
    end_time = time.time() + timeout
    while time.time() < end_time:
        source_file = find_download_file(file_name)
        if source_file:
            return source_file
        time.sleep(0.05)

    log(f"TIMEOUT: File not found: {clean_name}")
    return None

# ============================================================
# WAIT UNTIL DOWNLOAD IS COMPLETE & STABLE (FAST VERIFICATION)
# ============================================================

def wait_until_download_complete(file_path, timeout=15):
    if not file_path:
        return False
    end_time = time.time() + timeout

    while time.time() < end_time:
        if not os.path.exists(file_path):
            time.sleep(0.05)
            continue

        # Check for Chrome temporary download extension
        if file_path.endswith(".crdownload") or os.path.exists(file_path + ".crdownload"):
            time.sleep(0.05)
            continue

        try:
            current_size = os.path.getsize(file_path)
        except OSError:
            time.sleep(0.05)
            continue

        if current_size > 0:
            time.sleep(0.05)
            try:
                if os.path.getsize(file_path) == current_size:
                    return True
            except OSError:
                pass

        time.sleep(0.05)

    log(f"TIMEOUT waiting for download completion: {file_path}")
    return False

# ============================================================
# SAFE COPY (PRESERVES SOURCE, PREVENTS OVERWRITE, CHECKS SHA-256)
# ============================================================

def safe_copy(source, destination_folder, target_name=None):
    os.makedirs(destination_folder, exist_ok=True)

    # Use original clean name if provided, or strip Chrome's duplicate suffix
    if target_name:
        clean_target_name = get_clean_file_name(target_name)
    else:
        clean_target_name = strip_chrome_duplicate_suffix(os.path.basename(source))

    destination = os.path.join(destination_folder, clean_target_name)

    # 1. Same filename already exists in destination
    if os.path.exists(destination):
        log(f"Same filename exists in destination: {destination}")
        source_hash = calculate_sha256(source)

        try:
            destination_hash = calculate_sha256(destination)
            # Identical content: safe duplicate
            if source_hash == destination_hash:
                log(f"DUPLICATE CONTENT - already exists: {destination}")
                return destination
        except Exception as error:
            log(f"Hash comparison error: {error}")

        # Different content with same name: rename with counter (1), (2), etc.
        name, extension = os.path.splitext(clean_target_name)
        counter = 1
        while os.path.exists(destination):
            # Check if an existing numbered file matches SHA-256
            try:
                if calculate_sha256(destination) == source_hash:
                    log(f"DUPLICATE CONTENT matching numbered file: {destination}")
                    return destination
            except Exception:
                pass

            new_name = f"{name} ({counter}){extension}"
            destination = os.path.join(destination_folder, new_name)
            counter += 1

    # 2. COPY ONLY (never move or delete source)
    shutil.copy2(source, destination)
    log(f"COPIED: {source} -> {destination}")
    return destination

# ============================================================
# HTTP SERVER & API
# ============================================================

class BridgeHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        return

    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.end_headers()

    # --------------------------------------------------------
    # GET (Health Check & Config)
    # --------------------------------------------------------

    def do_GET(self):
        if self.path == "/config":
            self.send_json({
                "ok": True,
                "base_folder": BASE_FOLDER,
                "subject_folders": SUBJECT_MAPPINGS,
                "supported_extensions": sorted(list(SUPPORTED_EXTENSIONS))
            }, 200)
            return

        self.send_json({
            "ok": True,
            "status": "online",
            "message": "Sortly bridge is running",
            "base_folder": BASE_FOLDER,
            "configured_groups_count": len(SUBJECT_FOLDERS),
            "timestamp": int(time.time() * 1000)
        }, 200)

    # --------------------------------------------------------
    # POST (/check, /organize, /config)
    # --------------------------------------------------------

    def do_POST(self):
        # 0. /config endpoint: update base folder and subject mappings dynamically
        if self.path == "/config":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length)
                data = json.loads(body.decode("utf-8"))
                new_base = data.get("base_folder") or data.get("baseFolder")
                new_mappings = data.get("subject_folders") or data.get("mappings")
                save_config(new_base, new_mappings)
                log(f"CONFIG UPDATED: Base='{BASE_FOLDER}', {len(SUBJECT_MAPPINGS)} mappings saved.")
                self.send_json({
                    "ok": True,
                    "message": "Configuration updated successfully",
                    "base_folder": BASE_FOLDER,
                    "subject_folders": SUBJECT_MAPPINGS
                }, 200)
                return
            except Exception as e:
                log(f"CONFIG ERROR: {e}")
                self.send_json({"ok": False, "error": str(e)}, 500)
                return

        # 1. /check endpoint: check if file is already organized
        if self.path == "/check":
            try:
                content_length = int(self.headers.get("Content-Length", 0))
                body = self.rfile.read(content_length)
                data = json.loads(body.decode("utf-8"))
                group_name = data.get("groupName", "")
                raw_file_name = data.get("fileName", "")
                target_folder = data.get("targetFolder") or data.get("folderName")
                file_name = strip_chrome_duplicate_suffix(raw_file_name)

                dest_folder = None
                if group_name in SUBJECT_FOLDERS:
                    dest_folder = SUBJECT_FOLDERS[group_name]
                elif target_folder:
                    dest_folder = os.path.join(BASE_FOLDER, target_folder)

                if dest_folder and file_name:
                    target_path = os.path.join(dest_folder, file_name)
                    exists = os.path.isfile(target_path)

                    # Also check if a numbered variant exists with non-zero size
                    if not exists:
                        name_part, ext_part = os.path.splitext(file_name)
                        pattern = re.compile(rf"^{re.escape(name_part)}(\s*\(\d+\))?{re.escape(ext_part)}$", re.IGNORECASE)
                        if os.path.isdir(dest_folder):
                            for existing in os.listdir(dest_folder):
                                if pattern.match(existing):
                                    exists = True
                                    break

                    self.send_json({
                        "ok": True,
                        "exists": exists,
                        "groupName": group_name,
                        "fileName": file_name
                    }, 200)
                    return

                self.send_json({
                    "ok": False,
                    "exists": False,
                    "message": "Invalid group or filename"
                }, 400)
                return

            except Exception as error:
                self.send_json({
                    "ok": False,
                    "error": str(error)
                }, 500)
                return

        # 2. /organize endpoint: validate and copy file
        if self.path != "/organize":
            self.send_json({
                "ok": False,
                "message": f"Invalid endpoint: {self.path}"
            }, 404)
            return

        try:
            content_length = int(self.headers.get("Content-Length", 0))
            body = self.rfile.read(content_length)
            data = json.loads(body.decode("utf-8"))

            group_name = data.get("groupName", "")
            incoming_file_name = data.get("fileName", "")
            original_name = data.get("originalName", "") or get_clean_file_name(incoming_file_name)
            target_folder = data.get("targetFolder") or data.get("folderName")

            log(f"REQUEST: group='{group_name}', file='{incoming_file_name}', original='{original_name}', targetFolder='{target_folder}'")

            # Check / Register Group Dynamically
            if group_name not in SUBJECT_FOLDERS:
                if target_folder:
                    dest = os.path.join(BASE_FOLDER, target_folder)
                    SUBJECT_FOLDERS[group_name] = dest
                    SUBJECT_MAPPINGS[group_name] = target_folder
                    save_config()
                    log(f"DYNAMIC GROUP REGISTERED: '{group_name}' -> '{dest}'")
                else:
                    log(f"UNKNOWN GROUP: {group_name}")
                    self.send_json({
                        "ok": False,
                        "message": f"Unknown WhatsApp group: '{group_name}'"
                    }, 400)
                    return

            # Check Filename
            if not incoming_file_name:
                log("ERROR: Empty filename")
                self.send_json({
                    "ok": False,
                    "message": "Filename is empty"
                }, 400)
                return

            # Check Extension
            clean_original = strip_chrome_duplicate_suffix(original_name)
            if not is_supported_file(clean_original):
                log(f"UNSUPPORTED FILE TYPE: {clean_original}")
                self.send_json({
                    "ok": False,
                    "message": f"Unsupported file type: {clean_original}",
                    "fileName": clean_original
                }, 415)
                return

            # Find File in Downloads
            source_file = wait_for_file(incoming_file_name)
            if not source_file:
                log(f"FILE NOT FOUND: {incoming_file_name}")
                self.send_json({
                    "ok": False,
                    "message": "File was not found in Downloads",
                    "fileName": incoming_file_name
                }, 404)
                return

            # Wait until download is complete
            complete = wait_until_download_complete(source_file)
            if not complete:
                log(f"DOWNLOAD INCOMPLETE: {source_file}")
                self.send_json({
                    "ok": False,
                    "message": "Download did not finish correctly or was interrupted",
                    "fileName": incoming_file_name
                }, 409)
                return

            # Get Destination and Safe Copy
            destination_folder = SUBJECT_FOLDERS[group_name]
            destination = safe_copy(source_file, destination_folder, clean_original)

            response = {
                "ok": True,
                "groupName": group_name,
                "fileName": clean_original,
                "source": source_file,
                "destination": destination
            }

            log(f"SUCCESS: {destination}")
            self.send_json(response, 200)

        except Exception as error:
            log(f"ERROR: {error}")
            self.send_json({
                "ok": False,
                "message": str(error)
            }, 500)

    # --------------------------------------------------------
    # SEND JSON HELPER
    # --------------------------------------------------------

    def send_json(self, data, status=200):
        response = json.dumps(data, ensure_ascii=False).encode("utf-8")
        self.send_response(status)
        self.send_header("Content-Type", "application/json; charset=utf-8")
        self.send_header("Access-Control-Allow-Origin", "*")
        self.send_header("Access-Control-Allow-Methods", "GET, POST, OPTIONS")
        self.send_header("Access-Control-Allow-Headers", "Content-Type")
        self.send_header("Content-Length", str(len(response)))
        self.end_headers()
        self.wfile.write(response)

# ============================================================
# START BRIDGE
# ============================================================

if __name__ == "__main__":
    os.makedirs(BASE_FOLDER, exist_ok=True)
    os.makedirs(os.path.dirname(LOG_FILE), exist_ok=True)

    HOST = "127.0.0.1"
    PORT = 8765

    log("WhatsApp Organizer Bridge starting...")
    log(f"Listening on http://{HOST}:{PORT}")

    server = ThreadingHTTPServer((HOST, PORT), BridgeHandler)

    try:
        server.serve_forever()
    except KeyboardInterrupt:
        log("Bridge stopped by user.")
    finally:
        server.server_close()