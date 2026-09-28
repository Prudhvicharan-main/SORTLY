import time
import hashlib
import shutil
from pathlib import Path
from datetime import datetime

# ============================================================
# SETTINGS
# ============================================================

DOWNLOADS = Path.home() / "Downloads"

BASE_FOLDER = Path(r"E:\College Files")

UNSORTED_FOLDER = BASE_FOLDER / "Unsorted"

LOG_FILE = Path(
    r"E:\College Files\WhatsAppOrganizer\organizer.log"
)

ALLOWED_EXTENSIONS = {
    ".pdf",
    ".doc",
    ".docx",
    ".ppt",
    ".pptx",
    ".xls",
    ".xlsx",
    ".txt",
    ".zip",
}

CHECK_INTERVAL = 3


# ============================================================
# LOGGING
# ============================================================

def write_log(message):

    timestamp = datetime.now().strftime(
        "%Y-%m-%d %H:%M:%S"
    )

    line = f"[{timestamp}] {message}"

    print(line)

    with open(LOG_FILE, "a", encoding="utf-8") as log:
        log.write(line + "\n")


# ============================================================
# HASH
# ============================================================

def get_file_hash(file_path):

    sha256 = hashlib.sha256()

    try:

        with open(file_path, "rb") as file:

            while True:

                data = file.read(1024 * 1024)

                if not data:
                    break

                sha256.update(data)

        return sha256.hexdigest()

    except (PermissionError, OSError):

        return None


# ============================================================
# DOWNLOAD COMPLETE CHECK
# ============================================================

def is_download_complete(file_path):

    try:

        size1 = file_path.stat().st_size

        time.sleep(1)

        size2 = file_path.stat().st_size

        return size1 == size2

    except (PermissionError, OSError):

        return False


# ============================================================
# GET FILES
# ============================================================

def get_current_files():

    files = set()

    try:

        for item in DOWNLOADS.iterdir():

            if not item.is_file():
                continue

            if item.suffix.lower() not in ALLOWED_EXTENSIONS:
                continue

            files.add(str(item.resolve()))

    except (PermissionError, OSError) as error:

        write_log(
            f"ERROR accessing Downloads: {error}"
        )

    return files


# ============================================================
# FIND DUPLICATE
# ============================================================

def find_duplicate(source_hash):

    try:

        for destination in UNSORTED_FOLDER.iterdir():

            if not destination.is_file():
                continue

            if destination.suffix.lower() not in ALLOWED_EXTENSIONS:
                continue

            destination_hash = get_file_hash(destination)

            if destination_hash == source_hash:

                return destination

    except (PermissionError, OSError):

        pass

    return None


# ============================================================
# SAFE COPY
# ============================================================

def copy_to_unsorted(source):

    try:

        source_hash = get_file_hash(source)

        if source_hash is None:

            write_log(
                f"ERROR reading: {source.name}"
            )

            return

        duplicate = find_duplicate(source_hash)

        if duplicate:

            write_log(
                f"DUPLICATE IGNORED: {source.name}"
            )

            write_log(
                f"Already exists as: {duplicate.name}"
            )

            return

        destination = UNSORTED_FOLDER / source.name

        # Handle same filename safely
        counter = 1

        while destination.exists():

            destination = (
                UNSORTED_FOLDER
                / f"{source.stem} ({counter}){source.suffix}"
            )

            counter += 1

        # COPY, never MOVE
        shutil.copy2(source, destination)

        write_log(
            f"COPIED: {source.name}"
        )

        write_log(
            f"TO: {destination}"
        )

    except Exception as error:

        write_log(
            f"ERROR copying {source.name}: {error}"
        )


# ============================================================
# STARTUP
# ============================================================

print()
print("================================================")
print(" WhatsApp College File Organizer")
print(" SAFE COPY MODE")
print("================================================")
print()

print(f"Watching:")
print(DOWNLOADS)

print()
print(f"Destination:")
print(UNSORTED_FOLDER)

print()
print("Existing files will be ignored.")
print("Only NEW files will be processed.")
print("Files will be COPIED, never moved.")
print("Press CTRL+C to stop.")
print()

# Make sure destination exists
UNSORTED_FOLDER.mkdir(
    parents=True,
    exist_ok=True
)

write_log("Organizer started in SAFE COPY MODE.")

# Snapshot existing files
known_files = get_current_files()

write_log(
    f"Ignoring {len(known_files)} existing supported files."
)

print()
print("Waiting for new files...")
print()

# ============================================================
# WATCH LOOP
# ============================================================

try:

    while True:

        current_files = get_current_files()

        new_files = current_files - known_files

        for file_string in new_files:

            file_path = Path(file_string)

            write_log(
                f"NEW FILE DETECTED: {file_path.name}"
            )

            # Wait until download finishes
            if not is_download_complete(file_path):

                write_log(
                    f"Download still changing: "
                    f"{file_path.name}"
                )

                continue

            write_log(
                f"Download complete: {file_path.name}"
            )

            copy_to_unsorted(file_path)

        known_files.update(current_files)

        time.sleep(CHECK_INTERVAL)

except KeyboardInterrupt:

    print()
    print("Organizer stopped.")

    write_log(
        "Organizer stopped by user."
    )