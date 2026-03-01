/**
 * Tier 1: Deterministic field filling.
 * Maps detected fields to profile values using ATS-specific field mappings + generic regex patterns.
 * Returns FieldFillResult or null if no match.
 */

import type { FieldFillResult, DetectedFieldInfo } from "./types";
import type { UserProfile } from "@/lib/messaging";

// Map of label regex patterns → profile key
const LABEL_TO_PROFILE: Array<[RegExp, string]> = [
  // Identity
  [/^(first\s*name|given\s*name|fname)$/i, "first_name"],
  [/^(last\s*name|family\s*name|surname|lname)$/i, "last_name"],
  [/^(full\s*name|name|your\s*name)$/i, "name"],
  [/^(email|e-mail|email\s*address)$/i, "email"],
  [/^(phone|phone\s*number|mobile|telephone|cell)$/i, "phone"],

  // Location
  [/^(city|town)$/i, "city"],
  [/^(state|province|region)$/i, "state"],
  [/^(country)$/i, "country"],
  [/^(zip|zip\s*code|postal\s*code|postcode)$/i, "zip_code"],
  [/^(address|street\s*address|address\s*line\s*1)$/i, "address"],
  [/^(location)$/i, "location"],

  // Links
  [/^(linkedin|linkedin\s*(url|profile))$/i, "linkedin_url"],
  [/^(portfolio|portfolio\s*(url|website|link))$/i, "portfolio_url"],
  [/^(github|github\s*(url|profile))$/i, "github_url"],
  [/^(website|personal\s*website|web\s*url)$/i, "website_url"],

  // Employment
  [/^(current\s*title|job\s*title|title|position)$/i, "current_title"],
  [/^(current\s*company|company|employer|organization)$/i, "current_company"],
  [/^(years?\s*(of\s*)?(experience|exp))$/i, "years_of_experience"],
  [/^(summary|professional\s*summary|cover\s*letter|about)$/i, "summary"],

  // Education
  [/^(university|school|institution|college)$/i, "university"],
  [/^(degree|education\s*level)$/i, "education_level"],
  [/^(field\s*of\s*study|major|discipline|area\s*of\s*study)$/i, "field_of_study"],
  [/^(gpa|grade\s*point\s*average)$/i, "gpa"],
  [/^(graduation\s*(year|date))$/i, "graduation_year"],

  // Skills
  [/^(skills|technical\s*skills|key\s*skills)$/i, "skills"],

  // Work auth
  [/^(work\s*authorization|authorized\s*to\s*work)$/i, "work_authorization"],

  // Salary
  [/^(salary|salary\s*expect|desired\s*salary|compensation|expected\s*compensation)$/i, "salary_expectation"],
  [/^(start\s*date|earliest\s*start|available\s*from|availability)$/i, "start_date"],
  [/^(notice\s*period)$/i, "notice_period"],

  // Diversity (EEOC)
  [/^(gender|gender\s*identity)$/i, "gender"],
  [/^(pronoun|preferred\s*pronoun)$/i, "pronouns"],
  [/^(race|ethnicity|race\/ethnicity)$/i, "race_ethnicity"],
  [/^(veteran|veteran\s*status)$/i, "veteran_status"],
  [/^(disability|disability\s*status)$/i, "disability_status"],

  // Other
  [/^(referral|referred\s*by|how\s*did\s*you\s*hear|source)$/i, "referral_source"],
];

export function tier1Match(
  field: DetectedFieldInfo,
  profile: UserProfile,
): FieldFillResult | null {
  const label = field.label.trim();
  if (!label) return null;

  // Try label→profile mapping
  for (const [pattern, key] of LABEL_TO_PROFILE) {
    if (pattern.test(label)) {
      const value = (profile as Record<string, unknown>)[key];
      if (value && typeof value === "string" && value.trim()) {
        return {
          fieldId: field.id,
          label: field.label,
          selector: field.selector,
          tier: 1,
          confidence: "high",
          value: value.trim(),
          profileKey: key,
          autoFilled: true,
          element: field.element,
          originalValue: getFieldValue(field.element),
        };
      }
    }
  }

  // Try name attribute matching
  const nameAttr = field.element.getAttribute("name")?.toLowerCase() ?? "";
  const idAttr = field.element.getAttribute("id")?.toLowerCase() ?? "";

  for (const attr of [nameAttr, idAttr]) {
    if (!attr) continue;
    for (const [pattern, key] of LABEL_TO_PROFILE) {
      if (pattern.test(attr)) {
        const value = (profile as Record<string, unknown>)[key];
        if (value && typeof value === "string" && value.trim()) {
          return {
            fieldId: field.id,
            label: field.label,
            selector: field.selector,
            tier: 1,
            confidence: "high",
            value: value.trim(),
            profileKey: key,
            autoFilled: true,
            element: field.element,
            originalValue: getFieldValue(field.element),
          };
        }
      }
    }
  }

  return null;
}

function getFieldValue(el: HTMLElement): string {
  if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement || el instanceof HTMLSelectElement) {
    return el.value;
  }
  if (el.isContentEditable) return el.textContent ?? "";
  return "";
}
