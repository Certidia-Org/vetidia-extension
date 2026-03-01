/**
 * Shared types for the fill pipeline.
 */

export type FillTier = 1 | 2 | 3;
export type FillConfidence = "high" | "medium" | "low" | "none";

export interface FieldFillResult {
  fieldId: string;
  label: string;
  selector: string;
  tier: FillTier;
  confidence: FillConfidence;
  value: string;
  similarity?: number;        // Tier 2 only: 0–1
  vaultAnswerId?: string;     // Tier 2 only
  aiGenerated?: boolean;      // Tier 3 only
  profileKey?: string;        // Tier 1: the profile key used
  autoFilled: boolean;        // Was it auto-filled (no user review needed)?
  element: HTMLElement;
  originalValue: string;      // Value before fill, for edit detection
}

export interface DetectedFieldInfo {
  id: string;
  label: string;
  selector: string;
  element: HTMLElement;
  tagName: string;
  inputType?: string;
  fieldType?: "text" | "textarea" | "select" | "checkbox" | "radio";
  section?: string;
  required?: boolean;
  options?: string[];         // For select/radio/checkbox-group
  checked?: boolean;          // For checkbox/radio
  radioGroupName?: string;    // For radio groups
}
