/**
 * Detects which ATS platform the current page belongs to.
 * Returns null if the page is not a recognized ATS.
 */

export type ATSPlatform =
  | "greenhouse"
  | "lever"
  | "workday"
  | "ashby"
  | "icims"
  | "smartrecruiters"
  | "linkedin"
  | "taleo"
  | "breezy"
  | "bamboohr"
  | "jazzhr"
  | "jobvite"
  | "recruitee"
  | "workable";

interface ATSPattern {
  platform: ATSPlatform;
  /** URL substring matches (any match = detected). */
  urlPatterns: string[];
  /** Optional: Check meta tags or DOM elements for additional confirmation. */
  domCheck?: (doc: Document) => boolean;
}

const ATS_PATTERNS: ATSPattern[] = [
  {
    platform: "greenhouse",
    urlPatterns: ["boards.greenhouse.io", "job-boards.greenhouse.io"],
    domCheck: (doc) => {
      const meta = doc.querySelector('meta[name="generator"]');
      return meta?.getAttribute("content")?.includes("Greenhouse") ?? false;
    },
  },
  {
    platform: "lever",
    urlPatterns: ["jobs.lever.co"],
  },
  {
    platform: "workday",
    urlPatterns: [
      "myworkdayjobs.com",
      "myworkdaysite.com",
      ".wd1.", ".wd2.", ".wd3.", ".wd4.", ".wd5.",
      ".wd12.", ".wd101.",
    ],
  },
  {
    platform: "ashby",
    urlPatterns: ["ashbyhq.com"],
  },
  {
    platform: "icims",
    urlPatterns: [".icims.com"],
  },
  {
    platform: "smartrecruiters",
    urlPatterns: ["smartrecruiters.com"],
  },
  {
    platform: "linkedin",
    urlPatterns: ["linkedin.com/jobs"],
    domCheck: (doc) => doc.querySelector(".jobs-easy-apply-modal") !== null,
  },
  {
    platform: "taleo",
    urlPatterns: [".taleo.net"],
  },
  {
    platform: "breezy",
    urlPatterns: [".breezy.hr"],
  },
  {
    platform: "bamboohr",
    urlPatterns: [".bamboohr.com"],
  },
  {
    platform: "jazzhr",
    urlPatterns: [".jazz.co", "app.jazz.co"],
  },
  {
    platform: "jobvite",
    urlPatterns: [".jobvite.com"],
  },
  {
    platform: "recruitee",
    urlPatterns: [".recruitee.com"],
  },
  {
    platform: "workable",
    urlPatterns: [".workable.com"],
  },
];

/**
 * Detect the ATS platform from the current URL and optionally DOM.
 */
export function detectATS(
  url: string,
  doc?: Document,
): ATSPlatform | null {
  for (const pattern of ATS_PATTERNS) {
    // Check URL patterns first (fast path)
    const urlMatch = pattern.urlPatterns.some((p) =>
      url.toLowerCase().includes(p),
    );
    if (urlMatch) return pattern.platform;

    // Check DOM-based detection as fallback
    if (doc && pattern.domCheck?.(doc)) return pattern.platform;
  }

  return null;
}

/**
 * Check if the current page is likely an application form
 * (not just a job listing page).
 */
export function isApplicationPage(url: string, doc: Document): boolean {
  const lowerUrl = url.toLowerCase();

  // Generic URL path patterns that strongly indicate an application form
  if (/\/(apply|application)(\/|$|\?|#)/.test(lowerUrl)) return true;

  // ── Platform-specific URL checks (strict) ──

  // Greenhouse: boards.greenhouse.io/company/jobs/ID#app is the application anchor
  if (lowerUrl.includes("boards.greenhouse.io")) {
    // The #app fragment or presence of application form
    if (lowerUrl.includes("#app")) return true;
    // Greenhouse embeds the form on the job page — check DOM
    if (doc.querySelector("#application, #app_body, .application-form, form#application-form")) return true;
    // Greenhouse job pages have embedded forms, accept if form has email field
    return hasApplicationForm(doc);
  }

  // Lever: apply.lever.co is always an application; jobs.lever.co/company/id/apply
  if (lowerUrl.includes("apply.lever.co")) return true;
  if (lowerUrl.includes("jobs.lever.co") && lowerUrl.includes("/apply")) return true;
  // Lever job pages embed the form at bottom
  if (lowerUrl.includes("jobs.lever.co") && doc.querySelector(".application-page, .posting-apply")) return true;

  // Workday: /apply path within myworkdayjobs.com
  if (lowerUrl.includes("myworkdayjobs.com") && /\/(apply|login|create)/.test(lowerUrl)) return true;
  if (lowerUrl.includes("myworkdayjobs.com") && doc.querySelector('[data-automation-id="jobApplicationPage"]')) return true;

  // Ashby: /application path is the form
  if (lowerUrl.includes("ashbyhq.com") && lowerUrl.includes("/application")) return true;
  if (lowerUrl.includes("ashbyhq.com") && doc.querySelector('[class*="applicationForm"], form[class*="application"]')) return true;

  // iCIMS: look for application form
  if (lowerUrl.includes(".icims.com") && /\/apply|\/login/.test(lowerUrl)) return true;

  // LinkedIn: Easy Apply modal (appears dynamically)
  if (lowerUrl.includes("linkedin.com") && doc.querySelector(".jobs-easy-apply-modal, .jobs-easy-apply-content")) return true;

  // SmartRecruiters: /apply or /application
  if (lowerUrl.includes("smartrecruiters.com") && /\/apply|\/application/.test(lowerUrl)) return true;

  // For remaining ATS platforms, use DOM-based form detection
  if (lowerUrl.includes(".taleo.net") || lowerUrl.includes(".breezy.hr") ||
      lowerUrl.includes(".bamboohr.com") || lowerUrl.includes(".jazz.co") ||
      lowerUrl.includes(".jobvite.com") || lowerUrl.includes(".recruitee.com") ||
      lowerUrl.includes(".workable.com")) {
    return hasApplicationForm(doc);
  }

  // Final fallback: DOM-based form detection for unknown pages
  return hasApplicationForm(doc);
}

/** Check if the page has a form that looks like a job application. */
function hasApplicationForm(doc: Document): boolean {
  const forms = doc.querySelectorAll("form");
  for (const form of forms) {
    const inputs = form.querySelectorAll(
      'input:not([type="hidden"]):not([type="search"]):not([type="submit"]):not([type="button"]), textarea, select'
    );
    if (inputs.length >= 3) {
      const hasNameOrEmail = form.querySelector(
        'input[name*="name" i], input[name*="email" i], input[type="email"], ' +
        'input[autocomplete*="name"], input[autocomplete*="email"], ' +
        'input[id*="name" i], input[id*="email" i]'
      );
      if (hasNameOrEmail) return true;
    }
  }
  return false;
}
