import os
import shutil
import zipfile
import sys

# Ensure UTF-8 output
if sys.stdout.encoding != 'utf-8':
    try:
        sys.stdout.reconfigure(encoding='utf-8')
    except Exception:
        pass

PROJECT_DIR = r"E:\College Files\WhatsAppOrganizer"
RELEASE_DIR = os.path.join(PROJECT_DIR, "release")
EXE_PATH = os.path.join(RELEASE_DIR, "SortlyBridge.exe")
ROOT_EXE_PATH = os.path.join(PROJECT_DIR, "SortlyBridge.exe")
ZIP_PATH = os.path.join(PROJECT_DIR, "Sortly-v1.0-Windows.zip")

print("Packaging Sortly Release for Route A...")

# Copy SortlyBridge.exe to project root if it exists in release/
if os.path.isfile(EXE_PATH):
    shutil.copy2(EXE_PATH, ROOT_EXE_PATH)
    print(f"Copied SortlyBridge.exe to {ROOT_EXE_PATH}")

# Files and directories to include in zip
included_items = [
    ("SortlyBridge.exe", "SortlyBridge.exe"),
    ("start_organizer.bat", "start_organizer.bat"),
    ("bridge.py", "bridge.py"),
    ("sortly_config.json", "sortly_config.json"),
    ("README.md", "README.md"),
    ("whatsapp-extension", "whatsapp-extension")
]

with zipfile.ZipFile(ZIP_PATH, "w", zipfile.ZIP_DEFLATED) as zipf:
    for rel_src, rel_dest in included_items:
        full_src = os.path.join(PROJECT_DIR, rel_src)
        if os.path.isfile(full_src):
            zipf.write(full_src, rel_dest)
            print(f"  + Added file: {rel_dest}")
        elif os.path.isdir(full_src):
            for root, dirs, files in os.walk(full_src):
                if "__pycache__" in root:
                    continue
                for file in files:
                    file_full = os.path.join(root, file)
                    rel_to_proj = os.path.relpath(file_full, full_src)
                    dest_in_zip = os.path.join(rel_dest, rel_to_proj)
                    zipf.write(file_full, dest_in_zip)
            print(f"  + Added directory: {rel_dest}")

zip_size_mb = os.path.getsize(ZIP_PATH) / (1024 * 1024)
print(f"Successfully created release package: {ZIP_PATH} ({zip_size_mb:.2f} MB)")
