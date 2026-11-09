// warmup.mjs: how many cold emails one cold mailbox may send today. Deliverability comes before volume.
//
// A real ramp per cold mailbox, counted in whole Lagos weeks from the day the mailbox was added (the mailbox add command
// stamps mailbox.warmup_started_at): week 1 none, week 2 four a day, week 3 eight, week 4 and after ten. Follow-ups
// count. Never above max_per_mailbox. A client mailbox (hello@growveloper.com) and a paused mailbox send no cold mail.
// A mailbox with no start date is in week one. config/sending.json holds the ramp and the maximum.
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { PROJECT_ROOT, now } from './db.mjs';
import { lagosDayStartMs } from './conversation.mjs';
import { isColdMailbox } from './mailboxes.mjs';

export const RAMP = [0, 4, 8, 10];
export const MAX_PER_MAILBOX = 10;
export const SENDING_FILE = resolve(PROJECT_ROOT, 'config', 'sending.json');

const DAY = 86_400_000;

const validRamp = (r) => Array.isArray(r) && r.length > 0 && r.every((n) => Number.isFinite(n) && n >= 0);

/** config/sending.json as { ramp, max_per_mailbox }; a missing or broken file means the defaults. */
export function readSending({ file } = {}) {
  const defaults = { ramp: [...RAMP], max_per_mailbox: MAX_PER_MAILBOX };
  try {
    const data = JSON.parse(readFileSync(file ?? process.env.POPS_SENDING_FILE ?? SENDING_FILE, 'utf8'));
    if (!data || typeof data !== 'object' || Array.isArray(data)) return defaults;
    return {
      ramp: validRamp(data.ramp) ? data.ramp : defaults.ramp,
      max_per_mailbox: Number.isFinite(data.max_per_mailbox) && data.max_per_mailbox >= 0 ? data.max_per_mailbox : defaults.max_per_mailbox,
    };
  } catch {
    return defaults;
  }
}

/** Whole Lagos days since the mailbox was added (0 on the first day). Null when it has no start date. */
export function daysSinceStart(mailbox, at) {
  if (!mailbox?.warmup_started_at) return null;
  const start = lagosDayStartMs(new Date(mailbox.warmup_started_at).getTime());
  const today = lagosDayStartMs(new Date(now(at)).getTime());
  return Math.max(0, Math.round((today - start) / DAY));
}

/** The ramp step for the day, before the maximum: 0, 4, 8, then 10. */
export function rampFor(mailbox, at, { sendingFile } = {}) {
  const ramp = readSending({ file: sendingFile }).ramp;
  const days = daysSinceStart(mailbox, at) ?? 0;
  return ramp[Math.min(Math.floor(days / 7), ramp.length - 1)];
}

/** Cold emails this mailbox may send in the Lagos day of `at`: 0 for a client mailbox or while paused, else the ramp capped. */
export function capFor(mailbox, at = now(), { sendingFile } = {}) {
  const stamp = now(at);
  if (!isColdMailbox(mailbox)) return 0;
  if (mailbox?.paused_until && Date.parse(mailbox.paused_until) > Date.parse(stamp)) return 0;
  const raw = mailbox?.daily_cap;
  const own = raw === null || raw === undefined || raw === '' || !Number.isFinite(Number(raw)) ? Infinity : Number(raw);
  return Math.min(rampFor(mailbox, stamp, { sendingFile }), readSending({ file: sendingFile }).max_per_mailbox, own);
}
