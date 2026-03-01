/**
 * DOM field filler — applies values to form fields.
 * React-friendly: dispatches input/change events for controlled components.
 */

import type { FieldFillResult } from "./types";

export function applyFill(result: FieldFillResult): boolean {
  try {
    const el = result.element;
    if (!el || !el.isConnected) return false;

    const tag = el.tagName.toLowerCase();

    if (tag === "select") {
      return fillSelect(el as HTMLSelectElement, result.value);
    }

    if (tag === "input") {
      const input = el as HTMLInputElement;
      const type = input.type.toLowerCase();

      if (type === "checkbox") {
        return fillCheckbox(input, result.value);
      }
      if (type === "radio") {
        return fillRadio(input, result.value);
      }
      if (type === "file") {
        return false; // File uploads handled separately
      }
      return fillTextInput(input, result.value);
    }

    if (tag === "textarea") {
      return fillTextInput(el as HTMLTextAreaElement, result.value);
    }

    if (el.isContentEditable) {
      return fillContentEditable(el, result.value);
    }

    return false;
  } catch {
    return false;
  }
}

function fillTextInput(el: HTMLInputElement | HTMLTextAreaElement, value: string): boolean {
  // React-friendly value setter
  const nativeInputValueSetter = Object.getOwnPropertyDescriptor(
    el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype,
    "value",
  )?.set;

  if (nativeInputValueSetter) {
    nativeInputValueSetter.call(el, value);
  } else {
    el.value = value;
  }

  // Dispatch events in correct order for React/Angular/Vue
  el.dispatchEvent(new Event("input", { bubbles: true }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  el.dispatchEvent(new Event("blur", { bubbles: true }));

  return true;
}

function fillSelect(el: HTMLSelectElement, value: string): boolean {
  const lowerValue = value.toLowerCase();

  // Try exact value match
  for (const opt of Array.from(el.options)) {
    if (opt.value.toLowerCase() === lowerValue || opt.text.toLowerCase() === lowerValue) {
      el.value = opt.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
  }

  // Try partial text match
  for (const opt of Array.from(el.options)) {
    if (opt.text.toLowerCase().includes(lowerValue) || lowerValue.includes(opt.text.toLowerCase())) {
      el.value = opt.value;
      el.dispatchEvent(new Event("change", { bubbles: true }));
      return true;
    }
  }

  return false;
}

function fillCheckbox(el: HTMLInputElement, value: string): boolean {
  const shouldCheck = /^(yes|true|1|on|y)$/i.test(value);
  if (el.checked !== shouldCheck) {
    el.checked = shouldCheck;
    el.dispatchEvent(new Event("change", { bubbles: true }));
    el.dispatchEvent(new Event("click", { bubbles: true }));
  }
  return true;
}

function fillRadio(el: HTMLInputElement, value: string): boolean {
  const name = el.name;
  if (!name) return false;

  const radios = document.querySelectorAll<HTMLInputElement>(`input[type="radio"][name="${name}"]`);
  const lowerValue = value.toLowerCase();

  for (const radio of radios) {
    const radioLabel = radio.labels?.[0]?.textContent?.trim().toLowerCase() ?? "";
    const radioValue = radio.value.toLowerCase();

    if (radioValue === lowerValue || radioLabel === lowerValue ||
        radioLabel.includes(lowerValue) || lowerValue.includes(radioLabel)) {
      radio.checked = true;
      radio.dispatchEvent(new Event("change", { bubbles: true }));
      radio.dispatchEvent(new Event("click", { bubbles: true }));
      return true;
    }
  }

  return false;
}

function fillContentEditable(el: HTMLElement, value: string): boolean {
  el.textContent = value;
  el.dispatchEvent(new InputEvent("input", { bubbles: true, data: value }));
  el.dispatchEvent(new Event("change", { bubbles: true }));
  return true;
}
