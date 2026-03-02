/**
 * Vetidia Extension — ATS Platform Detection
 *
 * Design philosophy: If you're on an ATS domain, activate. Period.
 * False positives (showing on a job listing) are cheap.
 * False negatives (not showing on an application) are fatal.
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
  /** Display name shown in the side panel. */
  displayName: string;
  /** URL substring matches (any match = detected). */
  urlPatterns: string[];
  /** Optional DOM-based confirmation for platforms that need it (e.g. LinkedIn). */
  domCheck?: (doc: Document) => boolean;
}

const ATS_PATTERNS: ATSPattern[] = [
  {
    platform: "greenhouse",
    displayName: "Greenhouse",
    urlPatterns: ["greenhouse.io"],
  },
  {
    platform: "lever",
    displayName: "Lever",
    urlPatterns: ["lever.co"],
  },
  {
    platform: "workday",
    displayName: "Workday",
    urlPatterns: [
      "myworkdayjobs.com",
      "myworkdaysite.com",
      ".wd1.", ".wd2.", ".wd3.", ".wd4.", ".wd5.",
      ".wd12.", ".wd101.",
    ],
  },
  {
    platform: "ashby",
    displayName: "Ashby",
    urlPatterns: ["ashbyhq.com"],
  },
  {
    platform: "icims",
    displayName: "iCIMS",
    urlPatterns: [".icims.com"],
  },
  {
    platform: "smartrecruiters",
    displayName: "SmartRecruiters",
    urlPatterns: ["smartrecruiters.com"],
  },
  {
    platform: "linkedin",
    displayName: "LinkedIn",
    urlPatterns: ["linkedin.com/jobs"],
    // LinkedIn needs DOM check because Easy Apply is a modal overlay
    domCheck: (doc) =>
      doc.querySelector(".jobs-easy-apply-modal, .jobs-easy-apply-content") !== null,
  },
  {
    platform: "taleo",
    displayName: "Taleo",
    urlPatterns: [".taleo.net"],
  },
  {
    platform: "breezy",
    displayName: "Breezy HR",
    urlPatterns: [".breezy.hr"],
  },
  {
    platform: "bamboohr",
    displayName: "BambooHR",
    urlPatterns: [".bamboohr.com"],
  },
  {
    platform: "jazzhr",
    displayName: "JazzHR",
    urlPatterns: [".jazz.co", "app.jazz.co"],
  },
  {
    platform: "jobvite",
    displayName: "Jobvite",
    urlPatterns: [".jobvite.com"],
  },
  {
    platform: "recruitee",
    displayName: "Recruitee",
    urlPatterns: [".recruitee.com"],
  },
  {
    platform: "workable",
    displayName: "Workable",
    urlPatterns: [".workable.com"],
  },
];

/**
 * Detect the ATS platform from the current URL and optionally DOM.
 * Returns null if the page is not a recognized ATS.
 */
export function detectATS(url: string, doc?: Document): ATSPlatform | null {
  const lower = url.toLowerCase();
  for (const pattern of ATS_PATTERNS) {
    if (pattern.urlPatterns.some((p) => lower.includes(p))) {
      return pattern.platform;
    }
    if (doc && pattern.domCheck?.(doc)) {
      return pattern.platform;
    }
  }
  return null;
}

/**
 * Get the display name for an ATS platform.
 */
export function getATSDisplayName(platform: ATSPlatform): string {
  return ATS_PATTERNS.find((p) => p.platform === platform)?.displayName ?? platform;
}

/**
 * Extract basic job context from the page (no auth required).
 * Used to populate the side panel header immediately.
 */
export function extractPageContext(url: string, doc: Document): {
  company: string;
  jobTitle: string;
} {
  // Try to get company from common patterns
  let company = "";
  let jobTitle = "";

  // Greenhouse: title is usually "Job Title at Company"
  const title = doc.title || "";
  const atMatch = title.match(/^(.+?)\s+(?:at|@|-|–|—|·|\|)\s+(.+?)(?:\s*[-–—|·]|$)/);
  if (atMatch) {
    jobTitle = atMatch[1].trim();
    company = atMatch[2].trim();
  } else {
    // Fallback: use the full title, cleaned up
    company = title
      .replace(/\s*[-–—|·]\s*(?:Apply|Application|Job|Career|Hiring|Recruit).*$/i, "")
      .replace(/\s*[-–—|·]\s*(?:Greenhouse|Lever|Workday|Ashby|iCIMS|SmartRecruiters).*$/i, "")
      .trim();
  }

  // Try to extract job title from heading elements
  if (!jobTitle) {
    const h1 = doc.querySelector("h1");
    if (h1?.textContent) {
      jobTitle = h1.textContent.trim().slice(0, 100);
    }
  }

  return { company: company || "Unknown Company", jobTitle };
}

/**
 * Count visible form fields on the page (no auth required).
 * Gives the user an immediate sense of what was detected.
 */
export function countFormFields(doc: Document): number {
  const inputs = doc.querySelectorAll(
    'input:not([type="hidden"]):not([type="search"]):not([type="submit"]):not([type="button"]), textarea, select',
  );
  let count = 0;
  for (const el of inputs) {
    const htmlEl = el as HTMLElement;
    if (htmlEl.offsetParent !== null || htmlEl.style.position === "fixed") {
      const style = getComputedStyle(htmlEl);
      if (style.display !== "none" && style.visibility !== "hidden") {
        count++;
      }
    }
  }
  return count;
}
