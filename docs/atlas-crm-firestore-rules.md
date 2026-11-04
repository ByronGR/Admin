# Atlas CRM — Firestore rules to publish

Version 1.32.0 adds five collections. Until these rules are published, the new
CRM screens load empty and every save shows "Permission denied: the Firestore
rules for this section are not published yet."

## How to publish

1. Open the Firebase console → project **nearwork-97e3c** → Firestore Database → **Rules**.
2. Paste the block below inside `match /databases/{database}/documents { … }`,
   next to the other staff-only collections (for example just above `match /mail/{mailId}`).
3. Click **Publish**.

All five are staff-only, the same as `engagements`: clients never see them.

```
    // ── Atlas CRM (Admin v1.32.0) ───────────────────────────────────────────
    // Deals, people, service orders (MRR/ARR), activity and tasks.
    // Staff-only: nothing here is ever shown in the client portal.
    match /deals/{dealId} {
      allow read, write: if isStaff();
    }
    match /contacts/{contactId} {
      allow read, write: if isStaff();
    }
    match /serviceOrders/{orderId} {
      allow read, write: if isStaff();
    }
    match /crmActivities/{activityId} {
      allow read, write: if isStaff();
    }
    match /crmTasks/{taskId} {
      allow read, write: if isStaff();
    }
```

## Also copy into the App repo

The canonical copy of the rules lives in `App/firestore.rules`. Add the same
block there so the repo matches what is live.
