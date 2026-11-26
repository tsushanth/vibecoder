# "Your app is ready" notifications (Android)

A notice reaches a phone only when all four hold:

| need | state on 2026-11-26 |
|---|---|
| the server has a key to send with (`FCM_SERVICE_ACCOUNT_JSON` on Fly `vibecoder-api`) | not set |
| the phone's token is stored (`users.fcm_token`) | app 2.7.5 (20% rollout) uploads it at each start; 2.7.4 and older upload it only from a sign-in screen that closes first, so effectively never for new accounts |
| the phone allows notifications (Android 13+) | no released version asks; fixed in the next release |
| the build finishes after the three above | |

What happens to each notice is counted: see "Notices" in `docs/analytics.md`.

## Adding the key (needs the owner's approval: it turns sending on)

From then on, a person with a stored token gets "ready" and "did not finish" notices about their own builds. Nothing is sent
for past builds, and no email is turned on (`ALERT_EMAIL_PASS` stays unset). Tokens stored before October 2026 are tried
too; dead ones are cleared at the first attempt.

Firebase project `vibebuild-kk` (the one in `android/app/google-services.json`). Its Firebase Cloud Messaging API is already
enabled. Use a new service account that can only send messages, not the existing `firebase-adminsdk` account.

```bash
OWNER=<a Google account with Owner on vibebuild-kk>
P=vibebuild-kk
SA=vibebuild-fcm-sender@$P.iam.gserviceaccount.com

# 1. A role with the single permission needed to send
gcloud iam roles create vibebuildFcmSender --project=$P --account=$OWNER \
  --title="VibeBuild FCM sender" --permissions=cloudmessaging.messages.create --stage=GA

# 2. The service account, bound to that role only
gcloud iam service-accounts create vibebuild-fcm-sender --project=$P --account=$OWNER \
  --display-name="VibeBuild API: send Android notifications"
gcloud projects add-iam-policy-binding $P --account=$OWNER --condition=None \
  --member="serviceAccount:$SA" --role="projects/$P/roles/vibebuildFcmSender"

# 3. Check no build is running: both must be 0
curl -s https://vibecoder-api.fly.dev/api/status        # activeBuildCount
#    and no projects row with status 'building' created in the last 30 minutes

# 4. Key straight into Fly (a new secret; this restarts the API), then delete the file
umask 077; D=$(mktemp -d)
gcloud iam service-accounts keys create "$D/fcm.json" --iam-account=$SA --project=$P --account=$OWNER
printf 'FCM_SERVICE_ACCOUNT_JSON=%s\n' "$(jq -c . "$D/fcm.json")" | flyctl secrets import -a vibecoder-api
rm -P "$D/fcm.json"; rmdir "$D"

# 5. Verify
flyctl logs -a vibecoder-api --no-tail | grep '\[push\] Android notifications'   # "configured"
```

After the next build by a person with a token, `push_result` shows `sent`.

Rollback: `flyctl secrets unset FCM_SERVICE_ACCOUNT_JSON -a vibecoder-api`, then delete the key
(`gcloud iam service-accounts keys list` / `keys delete`) or the service account.
