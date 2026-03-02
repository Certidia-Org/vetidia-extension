/**
 * Type-safe message passing between popup ↔ service worker ↔ content scripts.
 */

// ─── Message Types ──────────────────────────────────────────────────

export type MessageType =
  | "GET_AUTH_STATE"
  | "SIGN_IN"
  | "SIGN_OUT"
  | "GET_PROFILE"
  | "GET_CACHED_PROFILE"
  | "SYNC_PROFILE"
  | "GET_DOCUMENTS"
  | "GET_FILE_DATA"
  | "AI_CLASSIFY_FIELDS"
  | "AI_GENERATE_ANSWER"
  | "MATCH_ANSWER_VAULT"
  | "SAVE_ANSWER"
  | "UPDATE_LEARNING"
  | "LOG_SUBMISSION"
  | "GET_APPLICATION_PROFILE"
  | "GET_ANSWER_VAULT"
  | "GET_ANSWER_VAULT_STATS"
  | "GET_FILL_HISTORY"
  | "OPEN_SIDE_PANEL"
  | "FILL_STATE_UPDATE"
  | "UPDATE_FIELD"
  | "DETECT_ATS"
  | "FILL_FIELDS"
  | "GET_FILL_PREVIEW"
  | "BACKFILL_EMBEDDINGS"
  | "ATS_PAGE_DETECTED"
  | "SCAN_STATUS"
  | "JOB_PAGE_DETECTED";

export interface BaseMessage {
  type: MessageType;
}

// Requests from popup / content script → service worker

export interface GetAuthStateMessage extends BaseMessage {
  type: "GET_AUTH_STATE";
}

export interface SignInMessage extends BaseMessage {
  type: "SIGN_IN";
}

export interface SignOutMessage extends BaseMessage {
  type: "SIGN_OUT";
}

export interface GetProfileMessage extends BaseMessage {
  type: "GET_PROFILE";
}

export interface GetCachedProfileMessage extends BaseMessage {
  type: "GET_CACHED_PROFILE";
}

export interface SyncProfileMessage extends BaseMessage {
  type: "SYNC_PROFILE";
}

export interface GetDocumentsMessage extends BaseMessage {
  type: "GET_DOCUMENTS";
  payload?: { fileType?: string };
}

export interface GetFileDataMessage extends BaseMessage {
  type: "GET_FILE_DATA";
  payload: { fileUrl: string; fileName: string };
}

export interface AIClassifyFieldsMessage extends BaseMessage {
  type: "AI_CLASSIFY_FIELDS";
  payload: {
    fields: Array<{
      index: number;
      label: string;
      tagName: string;
      type?: string;
      name?: string;
      id?: string;
      placeholder?: string;
      ariaLabel?: string;
      options?: string[];
    }>;
  };
}

export interface AIGenerateAnswerMessage extends BaseMessage {
  type: "AI_GENERATE_ANSWER";
  payload: {
    question: string;
    profileContext: string;
    jobContext?: string;
    maxLength?: number;
  };
}

export interface MatchAnswerVaultMessage extends BaseMessage {
  type: "MATCH_ANSWER_VAULT";
  questionText: string;
}

export interface SaveAnswerMessage extends BaseMessage {
  type: "SAVE_ANSWER";
  questionText: string;
  answerText: string;
  category?: string;
  atsType?: string;
  pageUrl?: string;
}

export interface UpdateLearningMessage extends BaseMessage {
  type: "UPDATE_LEARNING";
  answerId: string;
  action: "accepted" | "edited" | "rejected";
  editedText?: string;
}

export interface LogSubmissionMessage extends BaseMessage {
  type: "LOG_SUBMISSION";
  atsType: string;
  pageUrl: string;
  fieldsAttempted: number;
  fieldsFilled: number;
  fieldsSkipped: number;
  fieldDetails: Record<string, unknown>[];
}

export interface GetApplicationProfileMessage extends BaseMessage {
  type: "GET_APPLICATION_PROFILE";
}

export interface GetAnswerVaultMessage extends BaseMessage {
  type: "GET_ANSWER_VAULT";
}

export interface GetAnswerVaultStatsMessage extends BaseMessage {
  type: "GET_ANSWER_VAULT_STATS";
}

export interface BackfillEmbeddingsMessage extends BaseMessage {
  type: "BACKFILL_EMBEDDINGS";
}

export interface GetFillHistoryMessage extends BaseMessage {
  type: "GET_FILL_HISTORY";
}

export interface OpenSidePanelMessage extends BaseMessage {
  type: "OPEN_SIDE_PANEL";
}

export interface JobPageDetectedMessage extends BaseMessage {
  type: "JOB_PAGE_DETECTED";
  payload: {
    ats: string;
    atsDisplayName?: string;
    company: string;
    jobTitle?: string;
    url: string;
    fieldCount: number;
  };
}

export interface ATSPageDetectedMessage extends BaseMessage {
  type: "ATS_PAGE_DETECTED";
  payload: {
    ats: string;
    atsDisplayName?: string;
    company: string;
    jobTitle?: string;
    url: string;
    fieldCount: number;
  };
}

export interface ScanStatusMessage extends BaseMessage {
  type: "SCAN_STATUS";
  payload: {
    status: "idle" | "scanning" | "needs_auth" | "complete" | "no_fields" | "error";
    step?: string;
    error?: string;
  };
}

export interface FieldsScannedMessage extends BaseMessage {
  type: "FIELDS_SCANNED";
  payload: {
    ats: string;
    fields: Array<{
      id: string;
      label: string;
      tier: number | null;
      confidence: string;
      value: string | null;
      selector: string;
      fieldType?: string;
      options?: string[];
      checked?: boolean;
      radioGroupName?: string;
      required?: boolean;
    }>;
    totalFieldCount: number;
  };
}

export interface FillCompleteMessage extends BaseMessage {
  type: "FILL_COMPLETE";
  payload: { ats: string; filledCount: number; totalCount: number; results: Array<{ fieldId: string; success: boolean; tier: number | null }> };
}

export interface GetTabStateMessage extends BaseMessage {
  type: "GET_TAB_STATE";
}

export interface PanelFillFieldsMessage extends BaseMessage {
  type: "PANEL_FILL_FIELDS";
  payload: {
    fields: Array<{
      selector: string;
      value: string;
      fieldType?: string;
      checked?: boolean;
      radioGroupName?: string;
    }>;
  };
}

export interface GetUserResumesMessage extends BaseMessage {
  type: "GET_USER_RESUMES";
  payload?: { jobUrl?: string };
}

export interface TriggerFileUploadMessage extends BaseMessage {
  type: "TRIGGER_FILE_UPLOAD";
  payload: { fileUrl: string; fileName: string; inputType: "resume" | "cover_letter" };
}

export interface FillStateUpdateMessage extends BaseMessage {
  type: "FILL_STATE_UPDATE";
  status: "idle" | "filling" | "complete";
  fields: Array<{
    id: string;
    label: string;
    type: string;
    section: string;
    tier: 1 | 2 | 3;
    confidence: string;
    value: string;
    original: string;
    similarity: number | null;
    selector?: string;
  }>;
  atsName: string;
  company: string;
  role: string;
  filledCount: number;
  totalFillable: number;
}

export interface UpdateFieldMessage extends BaseMessage {
  type: "UPDATE_FIELD";
  fieldId: string;
  newValue: string;
  selector?: string;
}

/** A document record from the `documents` table. */
export interface DocumentRecord {
  id: string;
  file_name: string;
  file_url: string;
  file_type: string | null;
  job_id: string | null;
  created_at: string;
}

export type BackgroundMessage =
  | GetAuthStateMessage
  | SignInMessage
  | SignOutMessage
  | GetProfileMessage
  | GetCachedProfileMessage
  | SyncProfileMessage
  | GetDocumentsMessage
  | GetFileDataMessage
  | AIClassifyFieldsMessage
  | AIGenerateAnswerMessage
  | MatchAnswerVaultMessage
  | SaveAnswerMessage
  | UpdateLearningMessage
  | LogSubmissionMessage
  | GetApplicationProfileMessage
  | GetAnswerVaultMessage
  | GetAnswerVaultStatsMessage
  | GetFillHistoryMessage
  | OpenSidePanelMessage
  | JobPageDetectedMessage
  | ATSPageDetectedMessage
  | ScanStatusMessage
  | FieldsScannedMessage
  | FillCompleteMessage
  | GetTabStateMessage
  | PanelFillFieldsMessage
  | GetUserResumesMessage
  | TriggerFileUploadMessage
  | BackfillEmbeddingsMessage;

// Requests from service worker → content script

export interface DetectATSMessage extends BaseMessage {
  type: "DETECT_ATS";
}

export interface FillFieldsMessage extends BaseMessage {
  type: "FILL_FIELDS";
  payload: { fields: FieldFillRequest[] };
}

export interface GetFillPreviewMessage extends BaseMessage {
  type: "GET_FILL_PREVIEW";
}

export type ContentMessage =
  | DetectATSMessage
  | FillFieldsMessage
  | GetFillPreviewMessage;

// ─── Payload Types ──────────────────────────────────────────────────

export interface FieldFillRequest {
  profileKey: string;
  value: string;
  selector?: string;
  confidence: "high" | "medium" | "low";
  /** How to fill: "input" | "select" | "custom-dropdown" | "checkbox" | "radio-group" | "file" */
  fieldType?: "input" | "select" | "custom-dropdown" | "checkbox" | "radio-group" | "file";
  /** For checkboxes: whether to check or uncheck */
  checked?: boolean;
  /** Radio group name attribute (for radio-group fieldType) */
  radioGroupName?: string;
}

export interface DetectedField {
  profileKey: string | null;
  label: string;
  tagName: string;
  type: string;
  currentValue: string;
  selector: string;
  confidence: "high" | "medium" | "low";
  /** How to fill: "input" | "select" | "custom-dropdown" | "checkbox" | "radio-group" | "file" */
  fieldType?: "input" | "select" | "custom-dropdown" | "checkbox" | "radio-group" | "file";
  /** Available options for select/radio-group fields */
  options?: string[];
  /** For checkbox: current checked state */
  checked?: boolean;
  /** For radio-group: the name attribute */
  radioGroupName?: string;
  required?: boolean;
}

export interface ATSDetectionResult {
  platform: string | null; // e.g. "greenhouse", "lever", "workday", null = unknown
  url: string;
  fields: DetectedField[];
  isApplicationPage: boolean;
}

/**
 * Flattened profile for form filling — derived from the
 * `master_profiles` JSONB columns (personal_info, experiences, education, skills).
 *
 * Every field that commonly appears on ATS application forms is represented here.
 * Values are pre-extracted so the content script doesn't need database access.
 */
export interface UserProfile {
  // ─── Identity ────────────────────────────────────────────────
  name: string;
  first_name: string;
  last_name: string;
  email: string | null;
  phone: string | null;

  // ─── Location ────────────────────────────────────────────────
  /** Full location string, e.g. "Winnipeg, Manitoba, Canada" */
  location: string | null;
  city: string | null;
  state: string | null;
  country: string | null;
  zip_code: string | null;
  address: string | null;

  // ─── Links ───────────────────────────────────────────────────
  linkedin_url: string | null;
  portfolio_url: string | null;
  github_url: string | null;
  website_url: string | null;

  // ─── Current Employment ──────────────────────────────────────
  current_title: string | null;
  current_company: string | null;
  years_of_experience: string | null;
  summary: string | null;

  // ─── Education ───────────────────────────────────────────────
  education_level: string | null;
  university: string | null;
  field_of_study: string | null;
  graduation_year: string | null;
  gpa: string | null;

  // ─── Work Authorization / Legal ──────────────────────────────
  /** "Yes" or "No" — requires sponsorship? */
  work_authorization: string | null;
  /** "Yes" or "No" — legally authorized to work in this country? */
  authorized_to_work: string | null;
  citizenship: string | null;

  // ─── Diversity / EEOC (optional, user-controlled) ────────────
  gender: string | null;
  pronouns: string | null;
  race_ethnicity: string | null;
  veteran_status: string | null;
  disability_status: string | null;

  // ─── Preferences / Logistics ─────────────────────────────────
  salary_expectation: string | null;
  desired_salary: string | null;
  start_date: string | null;
  notice_period: string | null;
  willing_to_relocate: string | null;
  remote_preference: string | null;
  referral_source: string | null;

  // ─── Skills ──────────────────────────────────────────────────
  /** Comma-separated list of top skills. */
  skills: string | null;
  /** Comma-separated list of programming languages. */
  languages_programming: string | null;
  /** Comma-separated list of spoken languages. */
  languages_spoken: string | null;

  // ─── Previous Employment ─────────────────────────────────────
  previous_company: string | null;
  previous_title: string | null;

  // ─── Raw experience/education arrays for multi-entry ATS forms ──
  /** Full experience array from master_profiles (title, company, startDate, endDate, description, location). */
  _experiences?: Array<{
    title?: string;
    company?: string;
    startDate?: string;
    endDate?: string;
    description?: string;
    location?: string;
  }>;
  /** Full education array from master_profiles (institution, degree, field, startDate, endDate, gpa). */
  _education?: Array<{
    institution?: string;
    degree?: string;
    field?: string;
    startDate?: string;
    endDate?: string;
    gpa?: string;
  }>;
}

// ─── Helper ─────────────────────────────────────────────────────────

/** Send a message to the background service worker and get a typed response. */
export function sendToBackground<T>(message: BackgroundMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.runtime.sendMessage(message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response as T);
      }
    });
  });
}

/** Send a message to a specific tab's content script and get a typed response. */
export function sendToTab<T>(tabId: number, message: ContentMessage): Promise<T> {
  return new Promise((resolve, reject) => {
    chrome.tabs.sendMessage(tabId, message, (response) => {
      if (chrome.runtime.lastError) {
        reject(new Error(chrome.runtime.lastError.message));
      } else {
        resolve(response as T);
      }
    });
  });
}
