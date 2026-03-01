/**
 * Field detector — finds fillable form fields on the page.
 * Uses 7-strategy label extraction per spec:
 * 1. Explicit <label for="id">
 * 2. Wrapping <label>
 * 3. aria-label attribute
 * 4. aria-labelledby reference
 * 5. placeholder attribute
 * 6. Previous sibling text
 * 7. Parent container text
 *
 * Also detects sections, visibility, and generates stable selectors.
 */

import type { DetectedFieldInfo } from "../filler/types";

const IGNORE_TYPES = new Set(["hidden", "submit", "button", "reset", "image"]);

export function detectFields(root: Document | HTMLElement = document): DetectedFieldInfo[] {
  const fields: DetectedFieldInfo[] = [];
  const seen = new Set<HTMLElement>();

  // Find all fillable inputs, textareas, selects
  const elements = root.querySelectorAll<HTMLElement>(
    'input:not([type="hidden"]):not([type="submit"]):not([type="button"]):not([type="reset"]):not([type="image"]), textarea, select, [contenteditable="true"]'
  );

  for (const el of elements) {
    if (seen.has(el)) continue;
    if (!isVisible(el)) continue;

    const tag = el.tagName.toLowerCase();
    const inputType = (el as HTMLInputElement).type?.toLowerCase();
    if (tag === "input" && IGNORE_TYPES.has(inputType)) continue;

    seen.add(el);

    const label = extractLabel(el);
    const id = generateFieldId(el, fields.length);
    const selector = generateSelector(el);
    const section = detectSection(el);
    const required = isRequired(el);
    const options = tag === "select" ? getSelectOptions(el as HTMLSelectElement) : undefined;

    // Determine fieldType, checkbox/radio state, and radio group name
    let fieldType: DetectedFieldInfo["fieldType"];
    let checked: boolean | undefined;
    let radioGroupName: string | undefined;
    if (tag === "select") {
      fieldType = "select";
    } else if (tag === "textarea") {
      fieldType = "textarea";
    } else if (tag === "input") {
      if (inputType === "checkbox") {
        fieldType = "checkbox";
        checked = (el as HTMLInputElement).checked;
      } else if (inputType === "radio") {
        fieldType = "radio";
        checked = (el as HTMLInputElement).checked;
        radioGroupName = (el as HTMLInputElement).name || undefined;
      } else {
        fieldType = "text";
      }
    } else {
      fieldType = "text"; // contenteditable
    }

    // For radio groups, collect option labels
    let radioOptions = options;
    if (fieldType === "radio" && radioGroupName) {
      const radios = root.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${CSS.escape(radioGroupName)}"]`);
      radioOptions = Array.from(radios).map(r => {
        const lbl = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(r.id)}"]`);
        return lbl?.textContent?.trim() || r.value || "";
      }).filter(Boolean);
    }

    fields.push({
      id,
      label: label || "",
      selector,
      element: el,
      tagName: tag,
      inputType: tag === "input" ? inputType : undefined,
      fieldType,
      section,
      required,
      options: radioOptions || options,
      checked,
      radioGroupName,
    });
  }

  return fields;
}

// ─── Label extraction (7 strategies) ──────────────────────────

function extractLabel(el: HTMLElement): string {
  // 1. Explicit <label for="id">
  const id = el.id;
  if (id) {
    const label = document.querySelector<HTMLLabelElement>(`label[for="${CSS.escape(id)}"]`);
    if (label) return cleanLabel(label.textContent ?? "");
  }

  // 2. Wrapping <label>
  const parentLabel = el.closest("label");
  if (parentLabel) {
    const text = getDirectText(parentLabel, el);
    if (text) return cleanLabel(text);
  }

  // 3. aria-label
  const ariaLabel = el.getAttribute("aria-label");
  if (ariaLabel) return cleanLabel(ariaLabel);

  // 4. aria-labelledby
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const parts = labelledBy.split(/\s+/).map(id => {
      const ref = document.getElementById(id);
      return ref?.textContent?.trim() ?? "";
    }).filter(Boolean);
    if (parts.length > 0) return cleanLabel(parts.join(" "));
  }

  // 5. placeholder
  const placeholder = el.getAttribute("placeholder");
  if (placeholder) return cleanLabel(placeholder);

  // 6. Previous sibling text
  const prev = el.previousElementSibling;
  if (prev) {
    const tag = prev.tagName.toLowerCase();
    if (["label", "span", "div", "p", "h3", "h4", "h5", "legend"].includes(tag)) {
      const text = prev.textContent?.trim();
      if (text && text.length < 100) return cleanLabel(text);
    }
  }

  // 7. Parent container text
  const parent = el.parentElement;
  if (parent) {
    const text = getDirectText(parent, el);
    if (text && text.length < 100) return cleanLabel(text);
  }

  // Fallback: name or id attribute
  const name = el.getAttribute("name");
  if (name) return cleanLabel(humanizeName(name));
  if (id) return cleanLabel(humanizeName(id));

  return "";
}

function getDirectText(container: HTMLElement, excludeEl: HTMLElement): string {
  let text = "";
  for (const node of container.childNodes) {
    if (node === excludeEl) continue;
    if (node.nodeType === Node.TEXT_NODE) {
      text += node.textContent ?? "";
    } else if (node.nodeType === Node.ELEMENT_NODE) {
      const el = node as HTMLElement;
      if (el !== excludeEl && !el.contains(excludeEl)) {
        const tag = el.tagName.toLowerCase();
        if (["label", "span", "legend", "div"].includes(tag)) {
          text += el.textContent ?? "";
        }
      }
    }
  }
  return text.trim();
}

function cleanLabel(text: string): string {
  return text
    .replace(/\*/g, "")          // Remove required asterisks
    .replace(/\s+/g, " ")        // Normalize whitespace
    .replace(/^\s*[-–—:]\s*/, "") // Remove leading dashes/colons
    .trim();
}

function humanizeName(name: string): string {
  return name
    .replace(/[_\-]/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/\[\]$/, "")
    .trim();
}

// ─── Selector generation ──────────────────────────────────────

function generateSelector(el: HTMLElement): string {
  if (el.id) return `#${CSS.escape(el.id)}`;

  const name = el.getAttribute("name");
  const tag = el.tagName.toLowerCase();
  if (name) return `${tag}[name="${CSS.escape(name)}"]`;

  // Build path selector
  const parts: string[] = [];
  let current: HTMLElement | null = el;
  while (current && current !== document.body && parts.length < 4) {
    let selector = current.tagName.toLowerCase();
    if (current.id) {
      parts.unshift(`#${CSS.escape(current.id)}`);
      break;
    }
    const parent = current.parentElement;
    if (parent) {
      const siblings = Array.from(parent.children).filter(c => c.tagName === current!.tagName);
      if (siblings.length > 1) {
        const idx = siblings.indexOf(current) + 1;
        selector += `:nth-of-type(${idx})`;
      }
    }
    parts.unshift(selector);
    current = current.parentElement;
  }
  return parts.join(" > ");
}

function generateFieldId(el: HTMLElement, index: number): string {
  return el.id || el.getAttribute("name") || `field-${index}`;
}

// ─── Section detection ─────────────────────────────────────────

function detectSection(el: HTMLElement): string | undefined {
  // Walk up to find section headings
  let current: HTMLElement | null = el;
  for (let i = 0; i < 6 && current; i++) {
    current = current.parentElement;
    if (!current) break;

    // Check for section heading
    const heading = current.querySelector("h1, h2, h3, h4, legend, [class*='section']");
    if (heading) {
      const text = heading.textContent?.trim();
      if (text && text.length < 50) return text;
    }
  }
  return undefined;
}

// ─── Utilities ─────────────────────────────────────────────────

function isVisible(el: HTMLElement): boolean {
  if (el.offsetParent === null && el.style.position !== "fixed") return false;
  const style = getComputedStyle(el);
  return style.display !== "none" && style.visibility !== "hidden" && style.opacity !== "0";
}

function isRequired(el: HTMLElement): boolean {
  if ((el as HTMLInputElement).required) return true;
  if (el.getAttribute("aria-required") === "true") return true;
  // Check for asterisk in label
  const label = el.closest("label") ?? (el.id ? document.querySelector(`label[for="${el.id}"]`) : null);
  if (label?.textContent?.includes("*")) return true;
  return false;
}

function getSelectOptions(el: HTMLSelectElement): string[] {
  return Array.from(el.options).map(o => o.text.trim()).filter(Boolean);
}
