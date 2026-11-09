// consent.mjs: which channels the law lets prospect-ops use for a cold message to this person (spec 8.14, 4.2, 3).
// Pure: no database, no config file. channelsAllowed() is stored on person.channels_allowed and re-read by
// checkMessage(), which refuses a cold message on a channel that is not in the list.
//
//   US                                   email and linkedin
//   UK limited company, LLP, PLC         email and linkedin
//   UK sole trader, partnership, or a    linkedin only, both once warm (PECR: a UK corporate subscriber may be emailed
//     legal form nobody has verified       cold, an individual may not; LinkedIn opened everywhere by his 6 Nov ruling)
//   Germany and the rest of the EU/EEA   linkedin only, both once warm (his 6 Nov ruling, "yes on LinkedIn in every country")
//   Canada                               email only to an address the business published itself with no "no
//                                          solicitation" note; linkedin at any degree (his 2 Nov ruling); no override
//   UAE                                  linkedin only
//   Nigeria                              linkedin; email only to an address the business published
//   anything else or unknown             linkedin only, both once warm (his 6 Nov ruling)
//
// A person is warm when he knows them or they wrote back (person.warm = 1).

const BOTH = ['email', 'linkedin'];

export const EU_CODES = [
  'AT', 'BE', 'BG', 'HR', 'CY', 'CZ', 'DK', 'EE', 'FI', 'FR', 'DE', 'GR', 'HU', 'IE', 'IT', 'LV', 'LT', 'LU', 'MT',
  'NL', 'PL', 'PT', 'RO', 'SK', 'SI', 'ES', 'SE',
];
// The EEA and Switzerland carry the same kind of consent rules, so they are held to the EU line too.
const EUROPE_NO_CONSENT = new Set([...EU_CODES, 'IS', 'LI', 'NO', 'CH']);

// Companies House types that make a UK business a corporate subscriber (old lib/rules.mjs UK_CORPORATE_TYPES, plus
// the plain spellings used in the person/company rows).
const UK_CORPORATE_FORMS = new Set([
  'ltd', 'limited', 'plc', 'llp',
  'private-limited-guarant-nsc', 'private-limited-guarant-nsc-limited-exemption',
  'private-limited-shares-section-30-exemption', 'private-unlimited', 'private-unlimited-nsc',
]);

const COUNTRY_NAMES = {
  UK: 'GB', 'UNITED KINGDOM': 'GB', 'GREAT BRITAIN': 'GB', ENGLAND: 'GB', SCOTLAND: 'GB', WALES: 'GB',
  USA: 'US', 'UNITED STATES': 'US', 'UNITED STATES OF AMERICA': 'US',
  CANADA: 'CA', GERMANY: 'DE', DEUTSCHLAND: 'DE', NIGERIA: 'NG',
  UAE: 'AE', 'UNITED ARAB EMIRATES': 'AE', EL: 'GR', IRELAND: 'IE',
};

/** Upper-case ISO 3166-1 alpha-2 for the spellings that turn up in rows ('uk', 'United Kingdom', 'EL'). '' when unknown. */
export function normalizeCountry(value) {
  const s = String(value ?? '').trim().toUpperCase();
  return COUNTRY_NAMES[s] ?? s;
}

const flag = (v) => v === true || v === 1 || v === '1' || (typeof v === 'string' && /^(true|yes|y)$/i.test(v.trim()));

function ukCorporate(legalForm) {
  const f = String(legalForm ?? '').trim().toLowerCase().replace(/[\s_]+/g, '-');
  return UK_CORPORATE_FORMS.has(f);
}

/**
 * The channels allowed and the rule that decided it, for the evidence trail.
 * @returns {{ channels: string[], rule: string }}  channels is a fresh array, a subset of ['email','linkedin'] in that order
 */
export function consentDecision({ company, person } = {}) {
  const country = normalizeCountry(company?.country ?? person?.country);
  const warm = flag(person?.warm);
  const published = flag(person?.email_published ?? company?.email_published);
  const decide = (channels, rule) => ({ channels: [...channels], rule });
  // His 6 Nov 2026 ruling, "yes on LinkedIn in every country": a cold LinkedIn message to a business owner or decision maker is allowed
  // everywhere; where cold email is not allowed, the person gets LinkedIn only (both channels once warm).
  const linkedinOr = (rule) => (warm ? decide(BOTH, 'warm') : decide(['linkedin'], rule));

  if (country === 'US') return decide(BOTH, 'us');

  if (country === 'GB') {
    if (ukCorporate(company?.legal_form)) return decide(BOTH, 'uk_corporate');
    return linkedinOr('uk_individual_linkedin_only');
  }

  if (EUROPE_NO_CONSENT.has(country)) return linkedinOr('eu_linkedin_only');

  if (country === 'CA') {
    if (flag(company?.no_solicitation)) return decide([], 'ca_no_solicitation');
    // Cold email only to a published address (CASL). LinkedIn is not limited by degree: his 2 Nov ruling, "No CASL rule on LinkedIn".
    return decide(published ? BOTH : ['linkedin'], 'ca');
  }

  if (country === 'AE') return decide(['linkedin'], 'ae_linkedin_only');

  if (country === 'NG') return decide(published ? BOTH : ['linkedin'], 'ng');

  return linkedinOr('other_linkedin_only');
}

/** Subset of ['email','linkedin'] a cold message to this person may use. */
export function channelsAllowed({ company, person } = {}) {
  return consentDecision({ company, person }).channels;
}

/**
 * Is this person's address one cold email may go to? Only a verified or a published one (5 Nov: named owners with a verified address,
 * never guessed or shared). A guessed, unknown or bounced address gets no cold email, whatever the score.
 */
export function emailUsableForCold(person) {
  if (!String(person?.email ?? '').trim()) return false;
  if (flag(person?.email_published)) return true;
  return ['verified', 'published'].includes(String(person?.email_status ?? '').trim().toLowerCase());
}
