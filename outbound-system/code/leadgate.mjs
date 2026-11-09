// leadgate.mjs: who the nightly pipeline may write to. Nothing here loosens what the sending rules already
// codes; it asks the same questions in one place so read-business and write-line cannot disagree.
//
//   writableLead(db, personId, { at }) -> { ok: true, person, company } | { ok: false, reason }
//   chosenPerson(db, companyId, { at, needIndustry }) -> the ONE person a company's first email would go to (or null)
//
// A lead is writable when ALL of these hold:
//   - a named person: a full name and a first name (the greeting needs it), and a personal address, never a shared inbox (info@, office@);
//   - an address that is verified or published (lib/consent.mjs emailUsableForCold): a guessed, unknown or bounced address gets no cold email;
//   - the company is not a client (never_contact), not suppressed or parked, not a customer, and under 200 staff;
//   - the person, their address and their domain are not on the do-not-contact list;
//   - ONE PERSON PER COMPANY: nobody at the company has a first, follow-up or close that is checked, queued, sending or sent, or an open conversation;
//   - the person was not turned away lately: no first email of theirs stopped (declined, closed, parked, booked, replied) or failed in 90 days;
//   - the company industry is one of the tags the ICP uses (lib/tags.mjs INDUSTRIES);
//   - email is allowed to them by country (lib/consent.mjs).
import { emailUsableForCold, consentDecision } from './consent.mjs';
import { isRoleEmail } from './email-regex.mjs';
import { isSuppressed } from './suppress.mjs';
import { INDUSTRIES } from './tags.mjs';
import { MAX_SIZE } from './export.mjs';
import { loadThresholds, thresholdFor } from './thresholds.mjs';
import { now } from './db.mjs';

const SEQUENCE_STATUSES = ['checked', 'approved', 'queued', 'sending', 'sent', 'sent_unrecorded'];
const BLOCKED_COMPANY = new Set(['suppressed', 'parked', 'customer']);
export const TURNED_AWAY_DAYS = 90;
export const OLD_PARK_PREFIX = 'contacted before the rebuild';
/** A company the old import parked as "contacted before the rebuild": the only parked company a revisit may look at (lib/revisit.mjs). */
export const isOldParked = (company) => company?.status === 'parked' && String(company.park_reason ?? '').startsWith(OLD_PARK_PREFIX);
// Stops that say nothing about the person: a newer draft replaced it, the old system's drafts were set aside, the checker gave no word, or he said no to the TYPE.
const NOT_ABOUT_THE_PERSON = ['superseded', 'checker_gave_no_word', 'type_declined', 'skeleton_changed', 'desk_change_requested'];

/** The reason a company may not be read at all (before any person is considered), or null. */
export function companyProblem(company, { revisit = false } = {}) {
  if (!company) return 'no_company';
  if (company.never_contact) return 'never_contact';
  if (BLOCKED_COMPANY.has(company.status) && !(revisit && isOldParked(company))) return `company_${company.status}`;
  if (Number.isFinite(Number(company.size)) && company.size !== null && Number(company.size) >= MAX_SIZE) return 'too_big';
  return null;
}

/** The people at this company a first email could go to, best first: named, with a usable personal address. */
export function namedPeople(db, companyId, { revisit = false } = {}) {
  return db
    .prepare('SELECT * FROM person WHERE company_id = ? ORDER BY decider DESC, id')
    .all(companyId)
    .filter((p) => String(p.full_name ?? '').trim() && String(p.first_name ?? '').trim() && String(p.email ?? '').trim() && !isRoleEmail(p.email) && (revisit || emailUsableForCold(p)));
}

/** The people at this company a LinkedIn first touch could go to, best first: named, with a profile URL and NO address the email lane could use. */
export function namedLinkedInPeople(db, companyId) {
  return db
    .prepare('SELECT * FROM person WHERE company_id = ? ORDER BY decider DESC, id')
    .all(companyId)
    .filter((p) => String(p.full_name ?? '').trim() && String(p.first_name ?? '').trim() && String(p.linkedin_url ?? '').trim() && !hasEmailLane(p));
}

// An address the email lane can write to: a personal one that is verified or published. Such a person gets email, never a LinkedIn first touch.
const hasEmailLane = (p) => Boolean(String(p.email ?? '').trim() && !isRoleEmail(p.email) && emailUsableForCold(p));

// channel 'linkedin' asks the LinkedIn lane's question: the same company, suppression, one-person-per-company and turned-away gates, but the person
// needs a profile URL, LinkedIn must be allowed to them, and a person the email lane can write to belongs to the email lane.
export function writableLead(db, personId, { at, needIndustry = false, ignoreLiveTouch = false, revisit = false, channel = 'email', needScore = false, messageChannel = null, thresholds = null } = {}) {
  const stamp = now(at);
  const person = db.prepare('SELECT * FROM person WHERE id = ?').get(personId);
  if (!person) return { ok: false, reason: 'no_person' };
  const company = person.company_id ? db.prepare('SELECT * FROM company WHERE id = ?').get(person.company_id) : null;
  const cp = companyProblem(company, { revisit });
  if (cp) return { ok: false, reason: cp };
  if (!String(person.full_name ?? '').trim() || !String(person.first_name ?? '').trim()) return { ok: false, reason: 'no_named_person' };
  if (channel === 'linkedin') {
    if (!String(person.linkedin_url ?? '').trim()) return { ok: false, reason: 'no_linkedin_url' };
    if (hasEmailLane(person)) return { ok: false, reason: 'has_email_channel' };
  } else {
    if (!String(person.email ?? '').trim()) return { ok: false, reason: 'no_email' };
    if (isRoleEmail(person.email)) return { ok: false, reason: 'shared_inbox' };
    // a revisit (lib/revisit.mjs) chooses the person BEFORE their address is checked; the write job still needs a verified or published one
    if (!revisit && !emailUsableForCold(person)) return { ok: false, reason: 'guessed_address' };
  }
  const sup = isSuppressed(db, { email: person.email, domain: company.domain, linkedin: person.linkedin_url }, stamp);
  if (sup.suppressed) return { ok: false, reason: 'suppressed' };
  if (needIndustry && !INDUSTRIES.includes(company.industry)) return { ok: false, reason: 'industry_missing' };
  if (channel === 'linkedin') {
    if (!consentDecision({ company, person }).channels.includes('linkedin')) return { ok: false, reason: 'no_linkedin_consent' };
  } else if (!consentDecision({ company, person }).channels.includes('email')) return { ok: false, reason: 'no_email_consent' };

  // the old system touched this company (or someone there) less than 90 days ago: held, like anyone touched in the last 90 days.
  // The old touches are source 'old_import' and never count as a live sequence below, so this is their one gate; 90 days or more ago they let go.
  const oldSince = new Date(Date.parse(stamp) - TURNED_AWAY_DAYS * 86_400_000).toISOString();
  const oldRecent = db.prepare("SELECT 1 FROM touch WHERE source = 'old_import' AND sent_at > ? AND (company_id = ? OR person_id IN (SELECT id FROM person WHERE company_id = ?)) LIMIT 1").get(oldSince, company.id, company.id);
  if (oldRecent) return { ok: false, reason: 'touched_lately_old_system' };

  // one person per company: anyone at the company in a conversation, or with a live or sent first, follow-up or close, keeps the rest out
  const conv = db.prepare("SELECT person_id FROM conversation WHERE (company_id = ? OR person_id IN (SELECT id FROM person WHERE company_id = ?)) AND state <> 'closed' LIMIT 1").get(company.id, company.id);
  if (conv) return { ok: false, reason: conv.person_id === person.id ? 'in_conversation' : 'company_in_conversation' };
  const live = db
    .prepare(`SELECT person_id FROM touch WHERE (company_id = ? OR person_id IN (SELECT id FROM person WHERE company_id = ?)) AND source = 'new' AND kind IN ('first', 'follow', 'close') AND status IN (${SEQUENCE_STATUSES.map(() => '?').join(', ')})`)
    .all(company.id, company.id, ...SEQUENCE_STATUSES)
    .filter((t) => !(ignoreLiveTouch && t.person_id === person.id));
  if (live.length) return { ok: false, reason: live.some((t) => t.person_id === person.id) ? 'in_sequence' : 'company_in_sequence' };

  // turned away lately: a first email of theirs was stopped (he said no, it was closed, the lead was parked) or failed
  const since = new Date(Date.parse(stamp) - TURNED_AWAY_DAYS * 86_400_000).toISOString();
  const away = db
    .prepare(
      `SELECT 1 FROM touch WHERE person_id = ? AND source = 'new' AND kind = 'first' AND updated_at > ?
          AND (status = 'failed' OR (status = 'stopped' AND COALESCE(stop_reason, '') NOT IN (${NOT_ABOUT_THE_PERSON.map(() => '?').join(', ')}) AND COALESCE(stop_reason, '') NOT LIKE 'old system%'))
        LIMIT 1`,
    )
    .get(person.id, since, ...NOT_ABOUT_THE_PERSON);
  if (away) return { ok: false, reason: 'declined_lately' };
  // The writers refuse a company with no score, or with a score under
  // the message type's line (config/thresholds.json). A hold, never a park: it is written once it is scored. A confirmed problem raises the pain part of the score; it does not skip it.
  if (needScore) {
    if (company.score === null || company.score === undefined || !Number.isFinite(Number(company.score))) return { ok: false, reason: 'not_scored' };
    // an Open Profile message is free (no InMail credit is spent), so it takes the note's line, not the credit InMail's
    const asked = messageChannel ?? (channel === 'linkedin' ? 'linkedin_note' : 'email');
    const line = thresholdFor(asked === 'linkedin_inmail' && person.open_profile ? 'linkedin_note' : asked, thresholds ?? loadThresholds());
    if (Number(company.score) < line) return { ok: false, reason: 'below_threshold', score: Number(company.score), threshold: line };
  }
  return { ok: true, person, company };
}

/** The one person at a company a LinkedIn first touch would go to, or null. Only people the email lane cannot write to are looked at. */
export function chosenLinkedInPerson(db, companyId, { at, needIndustry = false, revisit = false } = {}) {
  for (const p of namedLinkedInPeople(db, companyId)) {
    if (writableLead(db, p.id, { at, needIndustry, channel: 'linkedin', revisit }).ok) return p.id;
  }
  return null;
}

/** The one person at a company a first email would go to: the first named person who passes every gate. Read and write both ask here. */
export function chosenPerson(db, companyId, { at, needIndustry = false, revisit = false } = {}) {
  for (const p of namedPeople(db, companyId, { revisit })) {
    if (writableLead(db, p.id, { at, needIndustry, revisit }).ok) return p.id;
  }
  return null;
}

/** Signal types that come from an ad library (Meta, Google). The checker cannot open those pages, so they never carry a line. */
export const AD_SIGNAL_TYPES = ['google_ads', 'meta_ads'];

/** Is this fact a quote from the lead's OWN site (its domain or a subdomain), and not an ad-library signal? */
export function isOwnPageFact(signal, company) {
  if (!signal || AD_SIGNAL_TYPES.includes(signal.type)) return false;
  const domain = String(company?.domain ?? '').toLowerCase().replace(/^www\./, '');
  if (!domain) return false;
  let host;
  try {
    host = new URL(String(signal.evidence_url)).hostname.toLowerCase().replace(/^www\./, '');
  } catch {
    return false;
  }
  return host === domain || host.endsWith(`.${domain}`);
}
