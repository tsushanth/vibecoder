#!/usr/bin/env python3
"""Bundles v1.1 + both subscriptions into a single reviewSubmission for VibeBuild.

Run AFTER build 31 finishes processing in App Store Connect (5–15 min after upload).
Apple will email you when processing completes.

Steps performed:
  1. Confirms v1.1 has a build attached (sanity check)
  2. Creates a new reviewSubmission scoped to the app + iOS
  3. Adds 3 items: appStoreVersion + pro.monthly subscription + pro.yearly subscription
  4. PATCHes submission with submitted=true → state moves to WAITING_FOR_REVIEW
"""
import jwt, time, requests, sys

KEY_ID = "3WHS49Y787"
ISSUER = "17f51aa8-305f-48b3-acbe-fd8ed3dd5fb6"
APP_ID = "6759273439"
VERSION_ID = "0e826219-3830-4b9f-b988-d06defef7440"  # v1.1
SUB_MONTHLY = "6759275198"
SUB_YEARLY = "6759275329"

with open("/Users/sushanthtiruvaipati/private_keys/AuthKey_3WHS49Y787.p8") as f:
    pk = f.read()
token = jwt.encode(
    {"iss": ISSUER, "exp": int(time.time()) + 1200, "aud": "appstoreconnect-v1"},
    pk, algorithm="ES256", headers={"kid": KEY_ID, "typ": "JWT"}
)
H = {"Authorization": f"Bearer {token}", "Content-Type": "application/json"}

# Sanity: is a build attached?
r = requests.get(
    f"https://api.appstoreconnect.apple.com/v1/appStoreVersions/{VERSION_ID}/build",
    headers=H
)
build_data = r.json().get("data")
if not build_data:
    print("⚠️  No build attached to v1.1 yet.")
    print("   Wait for build 31 to finish processing, then attach it in ASC web UI:")
    print("   App Store > 1.1 > Build > Add Build > select 1.1 (31)")
    print("   Then re-run this script.")
    sys.exit(1)
print(f"✓ Build attached: {build_data['id']}")

# 1. Create reviewSubmission
r = requests.post(
    "https://api.appstoreconnect.apple.com/v1/reviewSubmissions",
    headers=H,
    json={
        "data": {
            "type": "reviewSubmissions",
            "attributes": {"platform": "IOS"},
            "relationships": {"app": {"data": {"type": "apps", "id": APP_ID}}}
        }
    }
)
if r.status_code not in (200, 201):
    print(f"❌ Create submission failed: {r.status_code} {r.text[:500]}")
    sys.exit(1)
sub_id = r.json()["data"]["id"]
print(f"✓ Created reviewSubmission {sub_id}")

# 2. Attach the 3 items
items = [
    ("appStoreVersions", VERSION_ID, "v1.1 app version"),
    ("subscriptions", SUB_MONTHLY, "pro.monthly subscription"),
    ("subscriptions", SUB_YEARLY, "pro.yearly subscription"),
]
for itype, iid, label in items:
    r = requests.post(
        "https://api.appstoreconnect.apple.com/v1/reviewSubmissionItems",
        headers=H,
        json={
            "data": {
                "type": "reviewSubmissionItems",
                "relationships": {
                    "reviewSubmission": {"data": {"type": "reviewSubmissions", "id": sub_id}},
                    itype[:-1] if itype != "appStoreVersions" else "appStoreVersion": {
                        "data": {"type": itype, "id": iid}
                    }
                }
            }
        }
    )
    if r.status_code not in (200, 201):
        print(f"❌ Attach {label} failed: {r.status_code} {r.text[:500]}")
        sys.exit(1)
    print(f"✓ Attached {label}")

# 3. Submit
r = requests.patch(
    f"https://api.appstoreconnect.apple.com/v1/reviewSubmissions/{sub_id}",
    headers=H,
    json={
        "data": {
            "type": "reviewSubmissions",
            "id": sub_id,
            "attributes": {"submitted": True}
        }
    }
)
if r.status_code not in (200, 204):
    print(f"❌ Submit failed: {r.status_code} {r.text[:500]}")
    sys.exit(1)
print(f"\n🎉 Submitted! State should now be WAITING_FOR_REVIEW.")
print(f"   submission id: {sub_id}")
