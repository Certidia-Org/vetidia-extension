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
    urlPatterns: ["boards.greenhouse.io", "greenhouse.io/"],
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
      ".wd1.",
      ".wd5.",
      ".wd3.",
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

  // URL-based heuristics — generous matching (false positives are cheap)
  if (lowerUrl.includes("/apply")) return true;
  if (lowerUrl.includes("/application")) return true;

  // Greenhouse: any job page (listing pages also have forms embedded)
  if (lowerUrl.includes("greenhouse.io")) return true;

  // Lever: listings AND apply pages
  if (lowerUrl.includes("jobs.lever.co") || lowerUrl.includes("apply.lever.co")) return true;

  // Workday: most pages on myworkdayjobs.com are application flows
  if (lowerUrl.includes("myworkdayjobs.com")) return true;

  // Ashby: any page
  if (lowerUrl.includes("ashbyhq.com")) return true;

  // iCIMS: job pages
  if (lowerUrl.includes(".icims.com")) return true;

  // LinkedIn Easy Apply modal
  if (lowerUrl.includes("linkedin.com") && doc.querySelector(".jobs-easy-apply-modal"))
    return true;

  // Taleo
  if (lowerUrl.includes(".taleo.net")) return true;

  // Breezy HR
  if (lowerUrl.includes(".breezy.hr")) return true;

  // BambooHR
  if (lowerUrl.includes(".bamboohr.com")) return true;

  // JazzHR
  if (lowerUrl.includes(".jazz.co")) return true;

  // Jobvite
  if (lowerUrl.includes(".jobvite.com")) return true;

  // Recruitee
  if (lowerUrl.includes(".recruitee.com")) return true;

  // Workable
  if (lowerUrl.includes(".workable.com")) return true;

  // SmartRecruiters
  if (lowerUrl.includes("smartrecruiters.com")) return true;

  // DOM-based: check if there's a form with common application fields
  const forms = doc.querySelectorAll("form");
  for (const form of forms) {
    const inputs = form.querySelectorAll('input, textarea, select');
    if (inputs.length >= 3) {
      const fieldNames = Array.from(inputs).map(
        (el) =>
          (el.getAttribute("name") ?? "") +
          (el.getAttribute("id") ?? "") +
          (el.getAttribute("placeholder") ?? ""),
      );
      const combined = fieldNames.join(" ").toLowerCase();
      const applicationKeywords = [
        "name",
        "email",
        "phone",
        "resume",
        "cover",
        "linkedin",
      ];
      const matchCount = applicationKeywords.filter((kw) =>
        combined.includes(kw),
      ).length;
      if (matchCount >= 2) return true;
    }
  }

  return false;
}
