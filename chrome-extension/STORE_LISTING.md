# Chrome Web Store listing copy

Paste these strings into the Chrome Web Store developer dashboard
(Item → Store listing). Do **not** list third-party platform names
inside the description — Chrome's "Keyword Spam" rule treats brand
enumeration as policy violation even when the extension legitimately
works with those platforms. Reference: [Yellow Argon violation].

Last violation: enumerating "LinkedIn, Greenhouse, Lever, Ashby,
Workday, iCIMS, SmartRecruiters, BambooHR, Glassdoor, Indeed,
Handshake" in the description.

---

## Short description (max 132 chars)

```
Save job listings to Hireoven and auto-fill applications across major career sites — one click.
```

(126 chars — under the cap, no platform names.)

---

## Detailed description (paste-replace)

This is the closest tight rewrite of the rejected copy that keeps the
same structure but removes the brand enumeration that triggered the
Keyword Spam violation.

```
Hireoven Scout Bridge detects job listings as you browse and saves them to your Hireoven dashboard in one click.

Works on any company career page and every major job board or applicant tracking system — no setup, no manual copy-paste.

Features:
• One-click save from any job posting you have open
• Auto-detects job title, company, and location
• Syncs instantly to your Hireoven job tracker
• Track applications through your hiring pipeline

Requires a free Hireoven account at hireoven.com
```

### What changed vs the rejected version

- Deleted the line `Works on LinkedIn, Greenhouse, Lever, Ashby,
  Workday, iCIMS, SmartRecruiters, BambooHR, Glassdoor, Indeed,
  Handshake, and any company career page.` — this was the violation.
- Replaced with a generic equivalent: `Works on any company career page
  and every major job board or applicant tracking system`. Same
  promise, zero brand names.
- Tightened the first feature bullet so it doesn't repeat "ATS or job
  board" (also a keyword-density signal).
- Everything else is verbatim.

---

## Notes for future updates

- Never enumerate platform names in the description body, even
  alphabetically or as a "supports" list. Chrome's automated review
  flags this as keyword spam.
- Don't repeat the same word more than ~3 times across the listing.
- Don't put "best", "top", "#1" superlatives in the description.
- Screenshots themselves can show platform UI (that's fine); the
  textual description should stay generic.
- `manifest.json` `description` is separate and currently fine:
  `"Detect and save job listings to Hireoven from any ATS."`


  sudo tee /etc/cron.d/hireoven >/dev/null <<'EOF'
SHELL=/bin/bash
PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin
MAILTO=""

# ── Critical loop (frequent) ─────────────────────────────────────────────────
0 * * * *    root /usr/local/bin/hireoven-cron alerts/recent-jobs 120      >> /var/log/hireoven-cron.log 2>&1
0 */2 * * *  root /usr/local/bin/hireoven-cron crawl 1800                  >> /var/log/hireoven-cron.log 2>&1
0 */6 * * *  root /usr/local/bin/hireoven-cron cron/dice-ingest 600        >> /var/log/hireoven-cron.log 2>&1
0 */6 * * *  root /usr/local/bin/hireoven-cron cron/timing-refresh 600     >> /var/log/hireoven-cron.log 2>&1

# ── ATS discovery (no more 5-min wall) ───────────────────────────────────────
0 4 * * *    root /usr/local/bin/hireoven-cron 'cron/career-crawl?mode=resolve&limit=500' 1800 >> /var/log/hireoven-cron.log 2>&1
0 5 * * 3    root /usr/local/bin/hireoven-cron 'cron/career-crawl?mode=deep&limit=200'    1800 >> /var/log/hireoven-cron.log 2>&1

# ── Daily intelligence ───────────────────────────────────────────────────────
0 3 * * *    root /usr/local/bin/hireoven-cron cron/cohort-aggregate 300   >> /var/log/hireoven-cron.log 2>&1
0 4 * * *    root /usr/local/bin/hireoven-cron cron/cohort-match 300       >> /var/log/hireoven-cron.log 2>&1
0 4 * * *    root /usr/local/bin/hireoven-cron cron/ghost-scan 600         >> /var/log/hireoven-cron.log 2>&1
0 5 * * *    root /usr/local/bin/hireoven-cron cron/health-scores 600      >> /var/log/hireoven-cron.log 2>&1
0 7 * * *    root /usr/local/bin/hireoven-cron cron/layoffs-fyi 300        >> /var/log/hireoven-cron.log 2>&1
0 8 * * *    root /usr/local/bin/hireoven-cron alerts/digest 300           >> /var/log/hireoven-cron.log 2>&1
0 8 * * *    root /usr/local/bin/hireoven-cron cron/warn-act 300           >> /var/log/hireoven-cron.log 2>&1
0 9 * * *    root /usr/local/bin/hireoven-cron cron/deliver-checkins 300   >> /var/log/hireoven-cron.log 2>&1

# ── Weekly ──────────────────────────────────────────────────────────────────
0 2 * * 0    root /usr/local/bin/hireoven-cron cron/cohort-detect 600      >> /var/log/hireoven-cron.log 2>&1
0 5 * * 0    root /usr/local/bin/hireoven-cron cron/rejection-patterns 600 >> /var/log/hireoven-cron.log 2>&1
0 9 * * 1    root /usr/local/bin/hireoven-cron alerts/weekly 600           >> /var/log/hireoven-cron.log 2>&1

0 6 * * *    root /usr/local/bin/hireoven-cron cron/burnout-classify 300   >> /var/log/hireoven-cron.log 2>&1

0 8 * * 1    root /usr/local/bin/hireoven-cron cron/salary-digest 600      >> /var/log/hireoven-cron.log 2>&1

EOF

# Reload cron so it picks up the new file
sudo systemctl reload cron 2>/dev/null || sudo systemctl reload crond 2>/dev/null || sudo service cron reload
