from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import os
import shutil
import hashlib
import time
from datetime import datetime


# ============================================================
# MAIN FOLDER
# ============================================================

BASE_FOLDER = r"E:\College Files"


# ============================================================
# DOWNLOADS FOLDER
# ============================================================

DOWNLOADS_FOLDER = os.path.expanduser(r"~\Downloads")


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
    ".zip",
    ".jpg",
    ".jpeg",
    ".png"
}


# ============================================================
# WHATSAPP GROUP → SUBJECT FOLDER
# ============================================================

SUBJECT_FOLDERS = {
    "9968_OOPJ_25SC2006L_S:2-L-2026-2027-ODDSEM":
        os.path.join(BASE_FOLDER, "Java"),

    "ESD&IoT LE":
        os.path.join(BASE_FOLDER, "IoT"),

    "Y25-Mathematics for Data Science":
        os.path.join(BASE_FOLDER, "Maths DS"),

    "25CS2102L":
        os.path.join(BASE_FOLDER, "OS"),

    "AIML le 2k26":
        os.path.join(BASE_FOLDER, "AIML"),

    "S-3 MFE Lateral":
        os.path.join(BASE_FOLDER, "MATHS FOR ENGINER")
}


# ============================================================
# LOG FILE
# ============================================================

LOG_FILE = os.path.join(
    BASE_FOLDER,
    "WhatsAppOrganizer",
    "bridge.log"
)


# ============================================================
# LOGGING
# ============================================================

def log(message):
    timestamp = datetime.now().strftime(
        "%Y-%m-%d %H:%M:%S"
    )

    line = f"[{timestamp}] {message}"

    print(line)

    try:
        with open(
            LOG_FILE,
            "a",
            encoding="utf-8"
        ) as file:
            file.write(line + "\n")
    except Exception:
        pass


# ============================================================
# SHA-256
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
# GET ONLY THE FILENAME
# ============================================================

def get_clean_file_name(file_name):
    if not file_name:
        return ""

    # Chrome may send:
    # C:\Users\Charan\Downloads\example.pdf
    #
    # We only need:
    # example.pdf

    file_name = file_name.replace("/", "\\")

    return os.path.basename(file_name).strip()


# ============================================================
# CHECK FILE TYPE
# ============================================================

def is_supported_file(file_name):
    extension = os.path.splitext(file_name)[1].lower()

    return extension in SUPPORTED_EXTENSIONS


# ============================================================
# FIND FILE IN DOWNLOADS
# ============================================================

def find_download_file(file_name):
    clean_name = get_clean_file_name(file_name)

    if not clean_name:
        return None

    exact_path = os.path.join(
        DOWNLOADS_FOLDER,
        clean_name
    )

    if os.path.isfile(exact_path):
        return exact_path

    target = clean_name.lower()

    try:
        for current_name in os.listdir(
            DOWNLOADS_FOLDER
        ):
            if current_name.lower() == target:
                possible_path = os.path.join(
                    DOWNLOADS_FOLDER,
                    current_name
                )

                if os.path.isfile(possible_path):
                    return possible_path

    except Exception as error:
        log(
            f"ERROR searching Downloads: {error}"
        )

    return None


# ============================================================
# WAIT FOR FILE
# ============================================================

def wait_for_file(file_name, timeout=30):
    clean_name = get_clean_file_name(file_name)

    log(
        f"Waiting for file in Downloads: {clean_name}"
    )

    end_time = time.time() + timeout

    while time.time() < end_time:
        source_file = find_download_file(
            clean_name
        )

        if source_file:
            log(
                f"File found: {source_file}"
            )

            return source_file

        time.sleep(1)

    log(
        f"TIMEOUT: File not found: {clean_name}"
    )

    return None


# ============================================================
# WAIT UNTIL DOWNLOAD IS COMPLETE
# ============================================================

def wait_until_download_complete(
    file_path,
    timeout=60
):
    log(
        f"Checking download completion: {file_path}"
    )

    end_time = time.time() + timeout

    previous_size = -1
    stable_count = 0

    while time.time() < end_time:

        if not os.path.exists(file_path):
            time.sleep(1)
            continue

        try:
            current_size = os.path.getsize(
                file_path
            )
        except OSError:
            time.sleep(1)
            continue

        if current_size == previous_size:
            stable_count += 1
        else:
            stable_count = 0

        previous_size = current_size

        if stable_count >= 2:
            log(
                f"Download complete: {file_path}"
            )

            return True

        time.sleep(1)

    log(
        f"TIMEOUT waiting for download: {file_path}"
    )

    return False


# ============================================================
# SAFE COPY
# ============================================================

def safe_copy(source, destination_folder):
    os.makedirs(
        destination_folder,
        exist_ok=True
    )

    original_name = os.path.basename(source)

    destination = os.path.join(
        destination_folder,
        original_name
    )

    # --------------------------------------------------------
    # Same filename already exists
    # --------------------------------------------------------

    if os.path.exists(destination):

        log(
            f"Same filename exists: {destination}"
        )

        source_hash = calculate_sha256(
            source
        )

        try:
            destination_hash = calculate_sha256(
                destination
            )

            # Same file content
            if source_hash == destination_hash:

                log(
                    "DUPLICATE CONTENT - "
                    f"already exists: {destination}"
                )

                return destination

        except Exception as error:
            log(
                f"Hash comparison error: {error}"
            )

        # Different content with same filename
        name, extension = os.path.splitext(
            original_name
        )

        counter = 1

        while os.path.exists(destination):

            new_name = (
                f"{name} ({counter}){extension}"
            )

            destination = os.path.join(
                destination_folder,
                new_name
            )

            counter += 1

    # --------------------------------------------------------
    # COPY ONLY
    # --------------------------------------------------------

    shutil.copy2(
        source,
        destination
    )

    log(
        f"COPIED: {source} -> {destination}"
    )

    return destination


# ============================================================
# HTTP SERVER
# ============================================================

class BridgeHandler(BaseHTTPRequestHandler):

    def log_message(self, format, *args):
        return

    # --------------------------------------------------------
    # OPTIONS
    # --------------------------------------------------------

    def do_OPTIONS(self):
        self.send_response(200)

        self.send_header(
            "Access-Control-Allow-Origin",
            "*"
        )

        self.send_header(
            "Access-Control-Allow-Methods",
            "POST, OPTIONS"
        )

        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type"
        )

        self.end_headers()

    # --------------------------------------------------------
    # POST
    # --------------------------------------------------------

    def do_POST(self):

        if self.path != "/organize":

            self.send_json(
                {
                    "ok": False,
                    "message": "Invalid endpoint"
                },
                404
            )

            return

        try:

            content_length = int(
                self.headers.get(
                    "Content-Length",
                    0
                )
            )

            body = self.rfile.read(
                content_length
            )

            data = json.loads(
                body.decode("utf-8")
            )

            group_name = data.get(
                "groupName",
                ""
            )

            incoming_file_name = data.get(
                "fileName",
                ""
            )

            # Convert full Chrome path
            # into filename only.
            file_name = get_clean_file_name(
                incoming_file_name
            )

            log(
                f"REQUEST: "
                f"group={group_name}, "
                f"file={file_name}"
            )

            # ------------------------------------------------
            # CHECK GROUP
            # ------------------------------------------------

            if group_name not in SUBJECT_FOLDERS:

                log(
                    f"UNKNOWN GROUP: {group_name}"
                )

                self.send_json(
                    {
                        "ok": False,
                        "message":
                            "Unknown WhatsApp group"
                    },
                    400
                )

                return

            # ------------------------------------------------
            # CHECK FILENAME
            # ------------------------------------------------

            if not file_name:

                log(
                    "ERROR: Empty filename"
                )

                self.send_json(
                    {
                        "ok": False,
                        "message":
                            "Filename is empty"
                    },
                    400
                )

                return

            # ------------------------------------------------
            # CHECK EXTENSION
            # ------------------------------------------------

            if not is_supported_file(
                file_name
            ):

                log(
                    "UNSUPPORTED FILE TYPE: "
                    f"{file_name}"
                )

                self.send_json(
                    {
                        "ok": False,
                        "message":
                            "Unsupported file type",
                        "fileName":
                            file_name
                    },
                    415
                )

                return

            # ------------------------------------------------
            # FIND FILE
            # ------------------------------------------------

            source_file = wait_for_file(
                file_name
            )

            if not source_file:

                self.send_json(
                    {
                        "ok": False,
                        "message":
                            "File was not found in Downloads",
                        "fileName":
                            file_name
                    },
                    404
                )

                return

            # ------------------------------------------------
            # WAIT FOR DOWNLOAD COMPLETION
            # ------------------------------------------------

            complete = (
                wait_until_download_complete(
                    source_file
                )
            )

            if not complete:

                self.send_json(
                    {
                        "ok": False,
                        "message":
                            "Download did not finish correctly",
                        "fileName":
                            file_name
                    },
                    409
                )

                return

            # ------------------------------------------------
            # GET DESTINATION
            # ------------------------------------------------

            destination_folder = (
                SUBJECT_FOLDERS[group_name]
            )

            # ------------------------------------------------
            # SAFE COPY
            # ------------------------------------------------

            destination = safe_copy(
                source_file,
                destination_folder
            )

            # ------------------------------------------------
            # SUCCESS
            # ------------------------------------------------

            response = {
                "ok": True,
                "groupName": group_name,
                "fileName": file_name,
                "destination": destination
            }

            log(
                f"SUCCESS: {destination}"
            )

            self.send_json(
                response,
                200
            )

        except Exception as error:

            log(
                f"ERROR: {error}"
            )

            self.send_json(
                {
                    "ok": False,
                    "message": str(error)
                },
                500
            )

    # --------------------------------------------------------
    # SEND JSON
    # --------------------------------------------------------

    def send_json(
        self,
        data,
        status=200
    ):

        response = json.dumps(
            data,
            ensure_ascii=False
        ).encode("utf-8")

        self.send_response(status)

        self.send_header(
            "Content-Type",
            "application/json; charset=utf-8"
        )

        self.send_header(
            "Access-Control-Allow-Origin",
            "*"
        )

        self.send_header(
            "Access-Control-Allow-Methods",
            "POST, OPTIONS"
        )

        self.send_header(
            "Access-Control-Allow-Headers",
            "Content-Type"
        )

        self.send_header(
            "Content-Length",
            str(len(response))
        )

        self.end_headers()

        self.wfile.write(response)


# ============================================================
# START BRIDGE
# ============================================================

if __name__ == "__main__":

    os.makedirs(
        BASE_FOLDER,
        exist_ok=True
    )

    os.makedirs(
        os.path.dirname(LOG_FILE),
        exist_ok=True
    )

    HOST = "127.0.0.1"
    PORT = 8765

    log(
        "WhatsApp Organizer Bridge starting..."
    )

    log(
        f"Listening on http://{HOST}:{PORT}"
    )

    server = ThreadingHTTPServer(
        (HOST, PORT),
        BridgeHandler
    )

    try:

        server.serve_forever()

    except KeyboardInterrupt:

        log(
            "Bridge stopped by user."
        )

    finally:

        server.server_close()