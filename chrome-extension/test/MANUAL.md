# Manual Driver Test Steps

The Easy Apply drivers (`linkedin`, `indeed`, `handshake`) are integration-only
and not exercised in the Vitest suite — JSDOM can't replay LinkedIn's React
modal lifecycle, Indeed's iframe modal, or Handshake's authenticated flow.
Run these by hand against the live sites whenever you change a driver.

## Setup

1. Build the extension: `npm run build`
2. Load `chrome-extension/` as an unpacked extension in `chrome://extensions/`
3. Sign into hireoven.com (the dispatcher needs the `ho_session` cookie)
4. Open the browser DevTools console on the target tab so you can watch the
   `SCOUT_*` messages in the background service worker logs

## LinkedIn Easy Apply

1. Open any `linkedin.com/jobs/view/<id>/` posting that shows **Easy Apply**.
2. Verify the green "Apply with Scout · 3.1× boost" pill renders next to the
   Easy Apply button (or "Save to Scout queue" if the job is older than 24h).
3. Click the pill. Confirm `SCOUT_OPEN_APPLY_FLOW` fires in the background log
   and the dashboard tab receives the broadcast.
4. From the dashboard's BrowserContextRail, trigger the driver run.
5. Walk through each modal step:
   - **Contact**: phone/email pre-fill (from `prefs.phone`/`prefs.email`)
   - **Resume**: tailored resume uploads via the file input
   - **Screeners**: known questions (Jaccard >0.9 against `qaBank`) auto-fill;
     unknown questions fire `SCOUT_NEEDS_ANSWER` and pause until the rail responds
   - **Review**: driver STOPS. Confirm no auto-submit. The user must click
     "Submit application" themselves.
6. Edge case: trigger "Continue on company site" mid-flow — driver should
   return `aborted_external_redirect`.
7. Edge case: dismiss the pill 3× in one session — the 4th visit to a LinkedIn
   job page should not show a pill (CTA fatigue suppression).

## Indeed Apply

1. Open `indeed.com/viewjob?jk=<id>` showing **Easily apply** / **Apply now**.
2. Verify the green "Apply with Scout" pill renders below the apply button row
   (NOT inside the left-side search result cards).
3. Trigger the driver from the dashboard rail.
4. **Disqualifier scan**: load the disqualifier fixture-style flow (binary
   yes/no with a saved answer flagged `knownDisqualifier: true`). Confirm the
   driver pauses with `SCOUT_DISQUALIFY_WARNING` BEFORE filling. Test both
   user responses (proceed/abort).
5. Walk through contact → resume → screeners → review.
6. Confirm review step does NOT auto-submit.
7. **Country subdomains**: re-test on `uk.indeed.com`, `de.indeed.com`,
   `indeed.co.in` — `isJobPage()` should match all of them.
8. **External redirect**: on a job whose CTA is "Apply on company site", click
   it. The dispatcher's `SCOUT_RESOLVE_INDEED_REDIRECT` should follow the
   `indeed.com/rc/clk?...` chain and return the final ATS guess.

## Handshake apply

1. Sign into Handshake. Open `app.joinhandshake.com/jobs/<id>`.
2. **Auth gate**: sign out, reload the page. Confirm no pill renders and
   `SCOUT_CONNECTED` is NOT emitted.
3. Sign back in. Pill should read "Apply with Scout — tailored for {Major}"
   once `SCOUT_GET_USER_MAJOR` resolves (refresh the page to see the upgrade).
4. **Express Interest** flow: open a posting with "Express Interest" CTA.
   Verify pill copy is "Track interest in Scout" and clicking it fires
   `SCOUT_TRACK_INTEREST` (NOT `SCOUT_OPEN_APPLY_FLOW`).
5. Trigger driver. Walk through documents → cover letter → submit.
6. **Locked resume**: find a posting where the resume upload field is disabled
   by school profile. Driver should fire `SCOUT_LOCKED_RESUME` and pause.
   Test both proceed/abort responses.
7. Confirm the submit step does NOT auto-click.
8. **Feed refresh**: navigate within the Handshake feed without changing the
   URL (filter changes that re-fetch). Confirm the MutationObserver re-runs
   the handler and the pill re-injects when a new posting opens.

## Glassdoor enrichment

(No driver; verify the pill + enrichment side-channel)

1. Open a `glassdoor.com/job-listing/...` page with a typical employer rating.
2. Verify TWO pills render next to the apply button:
   - Primary green "Apply with Scout"
   - Secondary "Save company to Scout"
3. Open the background service-worker DevTools. Confirm `SCOUT_ENRICH_COMPANY`
   fires automatically with `signals` containing `rating`, `reviewCount`,
   `ceoApproval`, `recommendToFriend`, `roleSpecificSalaryRange`, `pros[]`,
   `cons[]`. Network tab should show a POST to `/api/scout/companies/enrich`.
4. Click "Save company to Scout". Confirm a second `SCOUT_ENRICH_COMPANY`
   fires with `explicit: true`.
5. **Give-to-get wall**: load a posting with the GTG signup wall. Confirm the
   handler scrapes only what's visible (no bypass attempt) and sets
   `metadata.givenToGetWalled: true`.

## Connection signal (Step 9)

1. Have at least one aggregator job tab open in the foreground.
2. From the dashboard, send a `SCOUT_PING_REQUEST` (this should be triggered by
   the dashboard's "extension connected?" indicator).
3. Verify the response includes the site name(s) of currently active job tabs.
4. Close all aggregator tabs. Re-trigger the ping. After 5s, the dashboard
   should mark the extension as disconnected.
