import type { UserProfile } from "@/lib/messaging";

/**
 * Shared label-to-profile-key mappings used across all ATS handlers.
 * Patterns are matched against field labels (from <label>, aria-label, placeholder, etc.)
 * to determine which UserProfile field should fill a given form field.
 *
 * Order matters — first match wins. More specific patterns should come before generic ones.
 */
export const LABEL_TO_PROFILE_KEY: Array<{
  patterns: RegExp[];
  profileKey: keyof UserProfile;
}> = [
  // ─── Identity ────────────────────────────────────────────────
  { patterns: [/first\s*name/i, /given\s*name/i, /prénom/i], profileKey: "first_name" },
  { patterns: [/last\s*name/i, /surname/i, /family\s*name/i, /nom\s*de\s*famille/i], profileKey: "last_name" },
  { patterns: [/full\s*name/i, /^name$/i, /your\s*name/i, /candidate\s*name/i], profileKey: "name" },
  { patterns: [/e-?mail\s*address/i, /e-?mail$/i, /email/i], profileKey: "email" },
  { patterns: [/phone\s*number/i, /phone/i, /mobile/i, /cell\s*phone/i, /telephone/i, /contact\s*number/i], profileKey: "phone" },

  // ─── Location ────────────────────────────────────────────────
  { patterns: [/^city$/i, /city.*live/i, /city.*reside/i], profileKey: "city" },
  { patterns: [/^state$/i, /state.*province/i, /province/i, /region/i], profileKey: "state" },
  { patterns: [/^country$/i, /country.*residence/i, /country.*living/i, /country.*located/i], profileKey: "country" },
  { patterns: [/zip\s*code/i, /postal\s*code/i, /zip/i, /postcode/i], profileKey: "zip_code" },
  { patterns: [/street\s*address/i, /^address$/i, /mailing\s*address/i, /home\s*address/i], profileKey: "address" },
  { patterns: [/location/i, /where.*based/i, /where.*located/i, /city.*state/i], profileKey: "location" },

  // ─── Links ───────────────────────────────────────────────────
  { patterns: [/linkedin/i], profileKey: "linkedin_url" },
  { patterns: [/github/i], profileKey: "github_url" },
  { patterns: [/portfolio/i, /personal\s*(site|page|website)/i], profileKey: "portfolio_url" },
  { patterns: [/^website$/i, /website\s*url/i, /^url$/i, /personal\s*url/i], profileKey: "website_url" },

  // ─── Current Employment ──────────────────────────────────────
  { patterns: [/current\s*(job\s*)?title/i, /^job\s*title$/i, /^title$/i, /^role$/i, /current\s*(role|position)/i], profileKey: "current_title" },
  { patterns: [/current\s*(company|employer|organization)/i, /company\s*name/i, /^company$/i, /^employer$/i, /^organization$/i], profileKey: "current_company" },
  { patterns: [/years?\s*of\s*experience/i, /total\s*experience/i, /how\s*many\s*years/i, /experience\s*\(years\)/i], profileKey: "years_of_experience" },
  { patterns: [/summary/i, /about\s*(you|yourself)/i, /cover\s*letter\s*text/i, /tell\s*us\s*about/i, /professional\s*summary/i, /brief\s*description/i], profileKey: "summary" },

  // ─── Previous Employment ─────────────────────────────────────
  { patterns: [/previous\s*(company|employer)/i, /last\s*(company|employer)/i, /most\s*recent\s*(company|employer)/i], profileKey: "previous_company" },
  { patterns: [/previous\s*(title|role|position)/i, /last\s*(title|role|position)/i], profileKey: "previous_title" },

  // ─── Education ───────────────────────────────────────────────
  { patterns: [/university|school|college|institution|alma\s*mater/i], profileKey: "university" },
  { patterns: [/field\s*of\s*study|major|area\s*of\s*study|concentration|discipline/i], profileKey: "field_of_study" },
  { patterns: [/graduation\s*(year|date)|year.*graduat/i, /expected\s*graduation/i, /^grad\s*year$/i], profileKey: "graduation_year" },
  { patterns: [/^gpa$/i, /grade\s*point/i, /cumulative\s*gpa/i], profileKey: "gpa" },
  { patterns: [/education\s*level/i, /^degree$/i, /degree\s*type/i, /highest.*education/i, /highest.*degree/i, /highest.*qualification/i, /^education$/i, /level\s*of\s*education/i], profileKey: "education_level" },

  // ─── Work Authorization / Legal ──────────────────────────────
  { patterns: [/sponsor/i, /require.*sponsor/i, /need.*sponsor/i, /visa\s*sponsor/i, /immigration\s*sponsor/i], profileKey: "work_authorization" },
  { patterns: [/authorized\s*to\s*work/i, /legally.*work/i, /legal\s*right\s*to\s*work/i, /eligible\s*to\s*work/i, /work\s*permit/i, /right\s*to\s*work/i, /legally\s*authorized/i], profileKey: "authorized_to_work" },
  { patterns: [/citizenship/i, /nationality/i], profileKey: "citizenship" },

  // ─── Diversity / EEOC ────────────────────────────────────────
  { patterns: [/^gender$/i, /gender\s*identity/i, /sex$/i], profileKey: "gender" },
  { patterns: [/pronouns/i, /preferred\s*pronouns/i], profileKey: "pronouns" },
  { patterns: [/race/i, /ethnicity/i, /racial/i, /ethnic\s*background/i], profileKey: "race_ethnicity" },
  { patterns: [/veteran/i, /military\s*service/i, /military\s*status/i, /protected\s*veteran/i], profileKey: "veteran_status" },
  { patterns: [/disability/i, /disabled/i, /handicap/i], profileKey: "disability_status" },

  // ─── Preferences / Logistics ─────────────────────────────────
  { patterns: [/salary\s*expectation/i, /expected\s*salary/i, /desired\s*salary/i, /salary\s*requirement/i, /compensation\s*expectation/i, /desired\s*compensation/i, /salary\s*range/i], profileKey: "salary_expectation" },
  { patterns: [/start\s*date/i, /available\s*to\s*start/i, /when.*start/i, /earliest\s*start/i, /date\s*of\s*availability/i, /availability/i], profileKey: "start_date" },
  { patterns: [/notice\s*period/i, /how\s*much\s*notice/i], profileKey: "notice_period" },
  { patterns: [/willing\s*to\s*relocate/i, /open\s*to\s*relocation/i, /relocation/i, /relocate/i], profileKey: "willing_to_relocate" },
  { patterns: [/remote/i, /work\s*arrangement/i, /work\s*location\s*preference/i, /on-?site|hybrid/i], profileKey: "remote_preference" },
  { patterns: [/how\s*did\s*you\s*hear/i, /referral/i, /source/i, /where\s*did\s*you\s*(hear|find|learn)/i, /how.*find.*position/i, /how.*learn.*about/i], profileKey: "referral_source" },

  // ─── Skills ──────────────────────────────────────────────────
  { patterns: [/^skills$/i, /key\s*skills/i, /technical\s*skills/i, /relevant\s*skills/i], profileKey: "skills" },
  { patterns: [/programming\s*language/i, /coding\s*language/i], profileKey: "languages_programming" },
  { patterns: [/spoken\s*language/i, /language.*speak/i, /language.*proficien/i, /fluent.*language/i, /^languages?$/i], profileKey: "languages_spoken" },
];

/**
 * Match a label string against the mapping table and return the corresponding profile key.
 */
export function labelToProfileKey(label: string): keyof UserProfile | null {
  for (const entry of LABEL_TO_PROFILE_KEY) {
    for (const pattern of entry.patterns) {
      if (pattern.test(label)) return entry.profileKey;
    }
  }
  return null;
}
