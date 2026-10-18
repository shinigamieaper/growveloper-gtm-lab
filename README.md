# growveloper-gtm-lab

## Problem
Does a free Clay waterfall find more named, verified owners than my own open-data chain, per hour and per credit?

## Constraints
- Clay Free plan (read on clay.com/pricing, 2026-10-08): 500 actions and 100 data credits a month, up to 200 rows per table, multi-provider waterfalls, Claygent, bring your own API key. The next plan up (Launch) is US$185 a month for 15,000 actions and 2,500 data credits.
- This run used Clay's 14-day trial (1,000 credits).
- Free tools only in October 2026. No lead's personal data is committed here.

## Decisions
- Find, Enrich, Transform, Export, in that order, and clean before paying: searches are free, emails cost credits.
- Two sources: 1,000 companies from my own lead bank that had no contact, and small companies (2 to 50 staff) hiring right now for a marketing, growth or web role.
- Connected Clay to Claude Code through Clay's connector, so the owner search could ask for a person whose current job is founder or owner at that exact company.
- Emails asked only for people who passed that check. Emails on a different domain from the company were held back for a manual check.

## Result
| | Companies searched | Owner found | Usable email |
|---|---|---|---|
| My existing leads | 1,000 | 272 (27%) | 232 |
| Hiring-signal companies | 837 | 449 (54%) | 357 |
| Total | 1,837 | 721 | 589 |

- About 1 credit per email asked, about 1.3 per usable email (805.8 credits in all).
- Local trades (HVAC, from Google Maps): people data found almost nobody; Claygent reading each website named 7 of 20 owners at about 11 credits per owner.
- Still to measure: reply rate from these leads against my other lead sources, and the same 20 test companies run through my own chain.

## What failed
- The app's seniority filter alone: 8 of 14 people it returned were founders or investors elsewhere, only linked to the company.
- 597 of my 1,000 existing leads returned nobody: small local businesses are thin in people data.
- Clay's job table stopped at 50 rows on the trial plan, from 7,681 matching posts.
- Clay's AI chat summary once listed owners against the wrong businesses; the rows themselves were right.
