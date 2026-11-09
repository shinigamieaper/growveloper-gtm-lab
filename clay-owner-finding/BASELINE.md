# Baseline: the lead bank before any change

The "before" number for this lab. Every build here is measured against it.

## Lead-bank counts

| Count | Value | Date |
|---|---|---|
| Leads in the bank | 40 | 2026-10-02 |
| Ready to send | 5 | 2026-10-02 |
| With a named owner | to fill | |
| With a verified personal inbox | to fill | |
| Shared inbox only (info@, hello@) | to fill | |

Source: Growveloper's own outreach system, counts only. The 2026-10-02 figures are the last recorded ones. Refresh all five on the day the first test runs.

## What the gap looks like

Only 5 of 40 leads were ready to send. Finding the business owner by name, and a personal inbox for them, is the bottleneck. This lab tests whether an enrichment waterfall (try one data source, then the next until one returns a verified hit) closes that gap, and at what cost in credits and minutes.

## Test set

20 companies from the bank, company name and website only, kept in `data/` (not published). No personal data about any lead is ever committed to this repo.
