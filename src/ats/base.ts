import type { DetectedField, FieldFillRequest, UserProfile } from "@/lib/messaging";

/**
 * Base interface for all ATS-specific form fillers.
 * Each ATS implementation provides field detection and filling logic.
 */
export interface ATSHandler {
  /** The platform identifier. */
  platform: string;

  /**
   * Scan the current page and return all detected form fields
   * with their proposed profile key mappings.
   */
  detectFields(doc: Document, profile: UserProfile): DetectedField[];

  /**
   * Fill a set of fields on the page.
   * Returns the number of successfully filled fields.
   */
  fillFields(
    doc: Document,
    fields: FieldFillRequest[],
  ): Promise<number>;
}

// ─── Shared Utilities ───────────────────────────────────────────────

/**
 * Set a value on an input/textarea and dispatch the events that
 * React, Angular, and vanilla forms expect.
 */
export function setFieldValue(
  element: HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement,
  value: string,
): void {
  if (element instanceof HTMLSelectElement) {
    setSelectValue(element, value);
    return;
  }

  // Use the native setter to bypass React's synthetic event system
  const descriptor =
    element instanceof HTMLInputElement
      ? Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")
      : Object.getOwnPropertyDescriptor(
          HTMLTextAreaElement.prototype,
          "value",
        );

  if (descriptor?.set) {
    descriptor.set.call(element, value);
  } else {
    element.value = value;
  }

  // React 16+ _valueTracker reset — required for React controlled inputs
  if ((element as any)._valueTracker) {
    (element as any)._valueTracker.setValue(value + " ");
  }

  // Dispatch events in the order a real user would trigger them
  element.dispatchEvent(new Event("focus", { bubbles: true }));
  element.dispatchEvent(new KeyboardEvent("keydown", { bubbles: true, key: "a" }));
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  element.dispatchEvent(new KeyboardEvent("keyup", { bubbles: true, key: "a" }));
  element.dispatchEvent(new Event("blur", { bubbles: true }));
}

/**
 * Common abbreviations / aliases for values that appear in <select> dropdowns.
 * Each key is a canonical value (what Vetidia stores); the array contains
 * alternative strings that an ATS option might use.
 */
const VALUE_ALIASES: Record<string, string[]> = {
  // ─── Countries ──────────────────────────────────────────────
  "united states": ["us", "usa", "u.s.", "u.s.a.", "united states of america"],
  "canada": ["ca", "can"],
  "united kingdom": ["uk", "gb", "gbr", "great britain", "britain"],
  "australia": ["au", "aus"],
  "germany": ["de", "deu", "deutschland"],
  "france": ["fr", "fra"],
  "india": ["in", "ind"],
  "china": ["cn", "chn"],
  "japan": ["jp", "jpn"],
  "brazil": ["br", "bra"],
  "mexico": ["mx", "mex"],
  "nigeria": ["ng", "nga"],
  "south korea": ["kr", "kor", "korea"],
  "spain": ["es", "esp"],
  "italy": ["it", "ita"],
  "netherlands": ["nl", "nld", "holland"],
  "sweden": ["se", "swe"],
  "switzerland": ["ch", "che"],
  "singapore": ["sg", "sgp"],
  "ireland": ["ie", "irl"],
  "new zealand": ["nz", "nzl"],
  "israel": ["il", "isr"],
  "south africa": ["za", "zaf"],
  "philippines": ["ph", "phl"],

  // ─── US States ──────────────────────────────────────────────
  "alabama": ["al"], "alaska": ["ak"], "arizona": ["az"], "arkansas": ["ar"],
  "california": ["ca"], "colorado": ["co"], "connecticut": ["ct"],
  "delaware": ["de"], "florida": ["fl"], "georgia": ["ga"], "hawaii": ["hi"],
  "idaho": ["id"], "illinois": ["il"], "indiana": ["in"], "iowa": ["ia"],
  "kansas": ["ks"], "kentucky": ["ky"], "louisiana": ["la"], "maine": ["me"],
  "maryland": ["md"], "massachusetts": ["ma"], "michigan": ["mi"],
  "minnesota": ["mn"], "mississippi": ["ms"], "missouri": ["mo"],
  "montana": ["mt"], "nebraska": ["ne"], "nevada": ["nv"],
  "new hampshire": ["nh"], "new jersey": ["nj"], "new mexico": ["nm"],
  "new york": ["ny"], "north carolina": ["nc"], "north dakota": ["nd"],
  "ohio": ["oh"], "oklahoma": ["ok"], "oregon": ["or"], "pennsylvania": ["pa"],
  "rhode island": ["ri"], "south carolina": ["sc"], "south dakota": ["sd"],
  "tennessee": ["tn"], "texas": ["tx"], "utah": ["ut"], "vermont": ["vt"],
  "virginia": ["va"], "washington": ["wa"], "west virginia": ["wv"],
  "wisconsin": ["wi"], "wyoming": ["wy"], "district of columbia": ["dc", "d.c."],

  // ─── Canadian Provinces ─────────────────────────────────────
  "ontario": ["on"], "quebec": ["qc"], "british columbia": ["bc"],
  "alberta": ["ab"], "manitoba": ["mb"], "saskatchewan": ["sk"],
  "nova scotia": ["ns"], "new brunswick": ["nb"],
  "newfoundland and labrador": ["nl", "newfoundland"],
  "prince edward island": ["pe", "pei"],

  // ─── Gender ─────────────────────────────────────────────────
  "male": ["m"], "female": ["f"],
  "non-binary": ["nb", "nonbinary", "non binary", "enby"],
  "prefer not to say": ["decline", "decline to self-identify", "decline to answer", "prefer not to disclose", "i don't wish to answer"],

  // ─── Yes / No ───────────────────────────────────────────────
  "yes": ["y", "true", "1", "si"],
  "no": ["n", "false", "0"],

  // ─── Education ──────────────────────────────────────────────
  "bachelor's": ["bachelor", "bachelors", "ba", "bs", "b.a.", "b.s.", "bsc", "b.sc.", "undergraduate"],
  "master's": ["master", "masters", "ma", "ms", "m.a.", "m.s.", "msc", "m.sc.", "mba", "m.b.a.", "graduate"],
  "doctorate": ["phd", "ph.d.", "doctoral", "doctor of philosophy"],
  "associate's": ["associate", "associates", "aa", "as", "a.a.", "a.s."],
  "high school": ["hs", "high school diploma", "ged", "secondary", "secondary school"],

  // ─── Veteran Status ─────────────────────────────────────────
  "i am not a protected veteran": ["not a veteran", "no", "non-veteran", "i am not a protected veteran"],
  "i identify as one or more of the classifications of a protected veteran": ["veteran", "yes", "protected veteran"],

  // ─── Disability ─────────────────────────────────────────────
  "no, i do not have a disability": ["no", "no disability"],
  "yes, i have a disability": ["yes", "disabled"],
  "i do not wish to answer": ["decline", "prefer not to say", "decline to self-identify"],
};

/**
 * Build a reverse lookup: alias → canonical values.
 * E.g. "us" → ["united states"], "m" → ["male"]
 */
function buildAliasLookup(): Map<string, string[]> {
  const map = new Map<string, string[]>();
  for (const [canonical, aliases] of Object.entries(VALUE_ALIASES)) {
    // Map canonical → itself
    const existing = map.get(canonical) ?? [];
    existing.push(canonical);
    map.set(canonical, existing);

    for (const alias of aliases) {
      const lower = alias.toLowerCase();
      const list = map.get(lower) ?? [];
      list.push(canonical);
      map.set(lower, list);
    }
  }
  return map;
}

const ALIAS_LOOKUP = buildAliasLookup();

/**
 * Given a user value, return all equivalent forms (canonical + all aliases).
 * E.g. "Canada" → ["canada", "ca", "can"]
 */
function expandAliases(value: string): string[] {
  const lower = value.toLowerCase().trim();
  const results = new Set<string>([lower]);

  // If the value IS a canonical key, add all its aliases
  const directAliases = VALUE_ALIASES[lower];
  if (directAliases) {
    for (const a of directAliases) results.add(a.toLowerCase());
  }

  // If the value IS an alias, find the canonical and add all its aliases
  const canonicals = ALIAS_LOOKUP.get(lower);
  if (canonicals) {
    for (const c of canonicals) {
      results.add(c);
      const moreAliases = VALUE_ALIASES[c];
      if (moreAliases) {
        for (const a of moreAliases) results.add(a.toLowerCase());
      }
    }
  }

  return [...results];
}

/**
 * Set a native <select> dropdown value by matching option text or value.
 * Tries exact match first, then aliases, then fuzzy substring.
 */
function setSelectValue(select: HTMLSelectElement, value: string): void {
  const options = Array.from(select.options);
  const lower = value.toLowerCase().trim();

  // 1. Exact value match
  const exactValue = options.find((o) => o.value === value);
  if (exactValue) {
    select.value = exactValue.value;
    dispatchSelectEvents(select);
    return;
  }

  // 2. Exact text match (case-insensitive)
  const exactText = options.find(
    (o) => o.textContent?.trim().toLowerCase() === lower,
  );
  if (exactText) {
    select.value = exactText.value;
    dispatchSelectEvents(select);
    return;
  }

  // 3. Alias / abbreviation matching — expand our value to all equivalents
  const aliases = expandAliases(value);
  for (const alias of aliases) {
    const match = options.find((o) => {
      const optText = o.textContent?.trim().toLowerCase() ?? "";
      const optVal = o.value.toLowerCase();
      return optText === alias || optVal === alias;
    });
    if (match) {
      select.value = match.value;
      dispatchSelectEvents(select);
      return;
    }
  }

  // 4. Reverse alias: check if any option text/value IS an alias of our value
  for (const opt of options) {
    const optText = opt.textContent?.trim().toLowerCase() ?? "";
    const optVal = opt.value.toLowerCase();
    const optAliases = expandAliases(optText);
    if (optAliases.includes(lower)) {
      select.value = opt.value;
      dispatchSelectEvents(select);
      return;
    }
    if (optVal !== optText) {
      const valAliases = expandAliases(optVal);
      if (valAliases.includes(lower)) {
        select.value = opt.value;
        dispatchSelectEvents(select);
        return;
      }
    }
  }

  // 5. Text starts with value
  const startsWith = options.find((o) =>
    o.textContent?.trim().toLowerCase().startsWith(lower),
  );
  if (startsWith) {
    select.value = startsWith.value;
    dispatchSelectEvents(select);
    return;
  }

  // 6. Text contains value
  const contains = options.find((o) =>
    o.textContent?.trim().toLowerCase().includes(lower),
  );
  if (contains) {
    select.value = contains.value;
    dispatchSelectEvents(select);
    return;
  }

  // 7. Value contains option text (e.g., "Winnipeg, Manitoba, Canada" contains "Canada")
  const reverseContains = options.find((o) => {
    const optText = o.textContent?.trim().toLowerCase();
    return optText && optText.length > 1 && lower.includes(optText);
  });
  if (reverseContains) {
    select.value = reverseContains.value;
    dispatchSelectEvents(select);
    return;
  }
}

function dispatchSelectEvents(select: HTMLSelectElement): void {
  // Use native setter for React compatibility
  const descriptor = Object.getOwnPropertyDescriptor(
    HTMLSelectElement.prototype,
    "value",
  );
  if (descriptor?.set) {
    descriptor.set.call(select, select.value);
  }

  select.dispatchEvent(new Event("focus", { bubbles: true }));
  select.dispatchEvent(new Event("input", { bubbles: true }));
  select.dispatchEvent(new Event("change", { bubbles: true }));
  select.dispatchEvent(new Event("blur", { bubbles: true }));
}

/**
 * Fill a custom (non-native) dropdown component.
 * Works for div-based selects like those used in Greenhouse and Lever.
 *
 * Strategy: click the trigger → wait for options → click matching option.
 */
export async function fillCustomDropdown(
  trigger: HTMLElement,
  value: string,
  doc: Document,
): Promise<boolean> {
  // Click to open the dropdown
  trigger.click();
  trigger.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
  trigger.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));

  // Wait for options to appear
  await new Promise((r) => setTimeout(r, 200));

  const lower = value.toLowerCase().trim();

  // Look for option elements near the trigger (listbox pattern)
  const listboxId = trigger.getAttribute("aria-controls") || trigger.getAttribute("aria-owns");
  let optionContainer: Element | null = null;

  if (listboxId) {
    optionContainer = doc.getElementById(listboxId);
  }

  // Fallback: look for a role="listbox" or common dropdown classes
  if (!optionContainer) {
    optionContainer =
      doc.querySelector('[role="listbox"]') ??
      doc.querySelector(".select__menu") ??
      doc.querySelector(".dropdown-menu:not([style*='display: none'])") ??
      doc.querySelector("[class*='dropdown'][class*='open']") ??
      doc.querySelector("[class*='select'][class*='menu']");
  }

  if (!optionContainer) {
    // Close dropdown if we couldn't find options
    trigger.click();
    return false;
  }

  // Find options with role="option", <li>, or common class patterns
  const candidates = optionContainer.querySelectorAll(
    '[role="option"], li, [class*="option"], [class*="item"]',
  );

  let matched: Element | null = null;

  // Exact text match
  for (const opt of candidates) {
    const text = opt.textContent?.trim().toLowerCase() ?? "";
    if (text === lower) {
      matched = opt;
      break;
    }
  }

  // Alias / abbreviation matching
  if (!matched) {
    const aliases = expandAliases(value);
    for (const opt of candidates) {
      const text = opt.textContent?.trim().toLowerCase() ?? "";
      if (aliases.includes(text)) {
        matched = opt;
        break;
      }
      // Also check reverse: option text might expand to match our value
      const optAliases = expandAliases(text);
      if (optAliases.includes(lower)) {
        matched = opt;
        break;
      }
    }
  }

  // Fuzzy: starts with or contains
  if (!matched) {
    for (const opt of candidates) {
      const text = opt.textContent?.trim().toLowerCase() ?? "";
      if (text.startsWith(lower) || text.includes(lower) || lower.includes(text)) {
        matched = opt;
        break;
      }
    }
  }

  if (matched) {
    (matched as HTMLElement).click();
    matched.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    matched.dispatchEvent(new MouseEvent("mouseup", { bubbles: true }));
    return true;
  }

  // Close dropdown if no match
  trigger.click();
  return false;
}

/**
 * Detect custom dropdown elements on the page.
 * Returns elements that act as dropdown triggers.
 */
export function findCustomDropdowns(
  container: Element,
): HTMLElement[] {
  const selectors = [
    '[role="combobox"]',
    '[role="listbox"]',
    '[aria-haspopup="listbox"]',
    '[class*="select__control"]',
    '[class*="Select-control"]',
    '[data-testid*="select"]',
    'div[class*="dropdown"][tabindex]',
  ];

  const results: HTMLElement[] = [];
  for (const sel of selectors) {
    const els = container.querySelectorAll<HTMLElement>(sel);
    for (const el of els) {
      if (!results.includes(el)) results.push(el);
    }
  }
  return results;
}

/**
 * Find the label text associated with a form element.
 * Tries multiple strategies in priority order.
 */
export function findLabelForElement(
  element: HTMLElement,
  doc: Document,
): string {
  // 1. Explicit <label for="...">
  const id = element.getAttribute("id");
  if (id) {
    const label = doc.querySelector(`label[for="${CSS.escape(id)}"]`);
    if (label?.textContent) return label.textContent.trim();
  }

  // 2. aria-label
  const ariaLabel = element.getAttribute("aria-label");
  if (ariaLabel) return ariaLabel;

  // 3. aria-labelledby
  const labelledBy = element.getAttribute("aria-labelledby");
  if (labelledBy) {
    const el = doc.getElementById(labelledBy);
    if (el?.textContent) return el.textContent.trim();
  }

  // 4. Wrapping <label>
  const parentLabel = element.closest("label");
  if (parentLabel?.textContent) return parentLabel.textContent.trim();

  // 5. Previous sibling label
  const prev = element.previousElementSibling;
  if (prev?.tagName === "LABEL" && prev.textContent) {
    return prev.textContent.trim();
  }

  // 6. Closest field wrapper with a label
  const fieldWrapper = element.closest(
    ".field, .form-field, .form-group, [class*='field'], [class*='question']",
  );
  if (fieldWrapper) {
    const wrapperLabel = fieldWrapper.querySelector("label, legend, [class*='label']");
    if (wrapperLabel?.textContent) return wrapperLabel.textContent.trim();
  }

  // 7. Placeholder
  if (element instanceof HTMLInputElement && element.placeholder) {
    return element.placeholder;
  }

  // 8. Name attribute heuristic
  const name = element.getAttribute("name");
  if (name) {
    return name.replace(/[_-]/g, " ").replace(/([A-Z])/g, " $1").trim();
  }

  return "";
}

/**
 * Wait for a DOM element matching a selector to appear.
 * Resolves with the element, or null after timeout.
 */
export function waitForElement(
  selector: string,
  doc: Document,
  timeoutMs = 5000,
): Promise<HTMLElement | null> {
  return new Promise((resolve) => {
    const existing = doc.querySelector<HTMLElement>(selector);
    if (existing) {
      resolve(existing);
      return;
    }

    const timeout = setTimeout(() => {
      observer.disconnect();
      resolve(null);
    }, timeoutMs);

    const observer = new MutationObserver(() => {
      const el = doc.querySelector<HTMLElement>(selector);
      if (el) {
        clearTimeout(timeout);
        observer.disconnect();
        resolve(el);
      }
    });

    observer.observe(doc.body, { childList: true, subtree: true });
  });
}

/**
 * Add a small delay to mimic human typing speed.
 * Helps avoid bot detection on some ATS platforms.
 */
export function humanDelay(minMs = 50, maxMs = 150): Promise<void> {
  const ms = Math.floor(Math.random() * (maxMs - minMs + 1)) + minMs;
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Set the checked state of a checkbox input and dispatch React-compatible events.
 */
export function setCheckboxValue(element: HTMLInputElement, checked: boolean): void {
  if (element.checked === checked) return;

  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
  if (descriptor?.set) {
    descriptor.set.call(element, checked);
  } else {
    element.checked = checked;
  }

  if ((element as any)._valueTracker) {
    (element as any)._valueTracker.setValue(String(!checked));
  }

  element.dispatchEvent(new Event("click", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
}

/**
 * Select a radio button in a group by matching the value (or label text).
 * Searches within `container` (defaults to document).
 */
export function setRadioGroupValue(
  name: string,
  value: string,
  container: Document | Element = document,
): boolean {
  const radios = Array.from(
    container.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(name)}"]`),
  );
  if (radios.length === 0) return false;

  const lower = value.toLowerCase().trim();

  // Try to match by value attribute first, then by label text
  const target =
    radios.find((r) => r.value.toLowerCase().trim() === lower) ??
    radios.find((r) => {
      const label = r.closest("label") ?? document.querySelector(`label[for="${CSS.escape(r.id)}"]`);
      return label?.textContent?.toLowerCase().trim().includes(lower);
    });

  if (!target) return false;

  const descriptor = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "checked");
  if (descriptor?.set) {
    descriptor.set.call(target, true);
  } else {
    target.checked = true;
  }

  if ((target as any)._valueTracker) {
    (target as any)._valueTracker.setValue("");
  }

  target.dispatchEvent(new Event("click", { bubbles: true }));
  target.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}

/**
 * Extract the list of option labels from a native <select> element.
 */
export function getSelectOptions(el: HTMLSelectElement): string[] {
  return Array.from(el.options)
    .filter((o) => o.value !== "" && o.value !== "0")
    .map((o) => o.text.trim());
}

/**
 * Extract radio group options as label strings for a given input[name].
 */
export function getRadioGroupOptions(
  name: string,
  container: Document | Element = document,
): string[] {
  const radios = Array.from(
    container.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(name)}"]`),
  );
  return radios.map((r) => {
    const label =
      r.closest("label") ??
      container.querySelector(`label[for="${CSS.escape(r.id)}"]`);
    return label?.textContent?.trim() ?? r.value;
  }).filter(Boolean);
}
