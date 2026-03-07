#!/usr/bin/env python3
"""Upload screenshots to App Store Connect via API."""

import jwt, time, json, os, hashlib, requests

# Config
KEY_ID = "3WHS49Y787"
ISSUER_ID = "17f51aa8-305f-48b3-acbe-fd8ed3dd5fb6"
KEY_FILE = "/Users/sushanthtiruvaipati/private_keys/AuthKey_3WHS49Y787.p8"
LOCALIZATION_ID = "f8238be6-5fb1-4165-84fe-cf77fa38abd6"
OLD_SET_ID = "9cad5af6-bbb7-4a26-93d3-08c14ee2511a"  # 6.5" set

SCREENSHOTS_DIR = "/Users/sushanthtiruvaipati/Documents/GitHub/VibeBuild/ios/fastlane/screenshots"

# Screenshots to upload in order
SCREENSHOTS = [
    "01_describe.png",
    "02_generating.png",
    "03_preview.png",
    "04_safari.png",
    "05_projects.png",
    "06_learn.png",
]

def get_token():
    with open(KEY_FILE, "r") as f:
        private_key = f.read()
    now = int(time.time())
    payload = {
        "iss": ISSUER_ID,
        "iat": now,
        "exp": now + 1200,
        "aud": "appstoreconnect-v1"
    }
    return jwt.encode(payload, private_key, algorithm="ES256", headers={"kid": KEY_ID})

def headers():
    return {
        "Authorization": f"Bearer {get_token()}",
        "Content-Type": "application/json"
    }

BASE = "https://api.appstoreconnect.apple.com/v1"

# Step 1: Delete old screenshots from 6.5" set
print("Step 1: Deleting old 6.5\" screenshots...")
resp = requests.get(f"{BASE}/appScreenshotSets/{OLD_SET_ID}/appScreenshots", headers=headers())
old_screenshots = resp.json().get("data", [])
for ss in old_screenshots:
    ss_id = ss["id"]
    r = requests.delete(f"{BASE}/appScreenshots/{ss_id}", headers=headers())
    print(f"  Deleted {ss_id}: {r.status_code}")

# Step 2: Create 6.7" screenshot set
print("\nStep 2: Creating 6.7\" screenshot set...")
create_set_payload = {
    "data": {
        "type": "appScreenshotSets",
        "attributes": {
            "screenshotDisplayType": "APP_IPHONE_67"
        },
        "relationships": {
            "appStoreVersionLocalization": {
                "data": {
                    "type": "appStoreVersionLocalizations",
                    "id": LOCALIZATION_ID
                }
            }
        }
    }
}
resp = requests.post(f"{BASE}/appScreenshotSets", headers=headers(), json=create_set_payload)
if resp.status_code == 201:
    new_set_id = resp.json()["data"]["id"]
    print(f"  Created 6.7\" set: {new_set_id}")
elif resp.status_code == 409:
    # Set already exists, find it
    print("  6.7\" set already exists, finding it...")
    resp2 = requests.get(
        f"{BASE}/appStoreVersionLocalizations/{LOCALIZATION_ID}/appScreenshotSets",
        headers=headers()
    )
    for s in resp2.json().get("data", []):
        if s["attributes"]["screenshotDisplayType"] == "APP_IPHONE_67":
            new_set_id = s["id"]
            print(f"  Found existing 6.7\" set: {new_set_id}")
            # Delete any existing screenshots in it
            resp3 = requests.get(f"{BASE}/appScreenshotSets/{new_set_id}/appScreenshots", headers=headers())
            for ss in resp3.json().get("data", []):
                requests.delete(f"{BASE}/appScreenshots/{ss['id']}", headers=headers())
                print(f"  Cleared old screenshot: {ss['id']}")
            break
    else:
        print(f"  Error: {resp.status_code} {resp.text}")
        exit(1)
else:
    print(f"  Error: {resp.status_code} {resp.text}")
    exit(1)

# Step 3: Upload each screenshot
print(f"\nStep 3: Uploading {len(SCREENSHOTS)} screenshots to set {new_set_id}...")

for i, filename in enumerate(SCREENSHOTS):
    filepath = os.path.join(SCREENSHOTS_DIR, filename)
    filesize = os.path.getsize(filepath)

    with open(filepath, "rb") as f:
        file_data = f.read()
    checksum = hashlib.md5(file_data).hexdigest()

    print(f"\n  [{i+1}/{len(SCREENSHOTS)}] Uploading {filename} ({filesize} bytes)...")

    # Create screenshot reservation
    reserve_payload = {
        "data": {
            "type": "appScreenshots",
            "attributes": {
                "fileName": filename,
                "fileSize": filesize
            },
            "relationships": {
                "appScreenshotSet": {
                    "data": {
                        "type": "appScreenshotSets",
                        "id": new_set_id
                    }
                }
            }
        }
    }

    resp = requests.post(f"{BASE}/appScreenshots", headers=headers(), json=reserve_payload)
    if resp.status_code != 201:
        print(f"    Error creating reservation: {resp.status_code} {resp.text}")
        continue

    ss_data = resp.json()["data"]
    ss_id = ss_data["id"]
    upload_ops = ss_data["attributes"]["uploadOperations"]

    print(f"    Reserved: {ss_id}, {len(upload_ops)} upload part(s)")

    # Upload file parts
    for op in upload_ops:
        url = op["url"]
        offset = op["offset"]
        length = op["length"]
        method = op["method"]
        req_headers = {h["name"]: h["value"] for h in op["requestHeaders"]}

        chunk = file_data[offset:offset + length]

        if method == "PUT":
            r = requests.put(url, headers=req_headers, data=chunk)
        else:
            r = requests.request(method, url, headers=req_headers, data=chunk)

        print(f"    Uploaded part (offset={offset}, length={length}): {r.status_code}")

    # Commit the upload
    commit_payload = {
        "data": {
            "type": "appScreenshots",
            "id": ss_id,
            "attributes": {
                "uploaded": True,
                "sourceFileChecksum": checksum
            }
        }
    }

    resp = requests.patch(f"{BASE}/appScreenshots/{ss_id}", headers=headers(), json=commit_payload)
    if resp.status_code == 200:
        state = resp.json()["data"]["attributes"]["assetDeliveryState"]["state"]
        print(f"    Committed: {state}")
    else:
        print(f"    Commit error: {resp.status_code} {resp.text}")

print("\nDone! All screenshots uploaded.")
