/**
 * AI classifier client — calls the Supabase Edge Function to:
 * 1. Classify unknown form fields → profile key mappings (Claude Haiku)
 * 2. Generate answers for open-ended questions (Claude Sonnet)
 *
 * The Edge Function holds the Anthropic API key server-side;
 * requests are authenticated with the user's Supabase JWT.
 */

import { getSupabase } from "./supabase";
import { SUPABASE_URL } from "./constants";

const EDGE_FN_BASE = `${SUPABASE_URL}/functions/v1/ai-copilot`;

// ─── Types ──────────────────────────────────────────────────────────

export interface DOMFieldInfo {
  index: number;
  label: string;
  tagName: string;
  type?: string;
  name?: string;
  id?: string;
  placeholder?: string;
  ariaLabel?: string;
  options?: string[];
}

export interface ClassifiedField {
  index: number;
  profileKey: string | null;
  confidence: "high" | "medium" | "low";
}

export interface GeneratedAnswer {
  answer: string;
  confidence: "high" | "medium" | "low";
}

// ─── Helpers ────────────────────────────────────────────────────────

async function getAuthHeaders(): Promise<Record<string, string>> {
  const supabase = getSupabase();
  const { data } = await supabase.auth.getSession();
  const token = data.session?.access_token;
  if (!token) throw new Error("Not authenticated");

  return {
    "Content-Type": "application/json",
    Authorization: `Bearer ${token}`,
  };
}

/**
 * Extract a clean error message from a failed response.
 * Supabase may return HTML error pages; we avoid leaking minified JS.
 */
async function extractErrorMessage(resp: Response): Promise<string> {
  try {
    const text = await resp.text();
    // Try to parse as JSON (Edge Function error format)
    try {
      const json = JSON.parse(text);
      return json.error ?? json.message ?? json.msg ?? `HTTP ${resp.status}`;
    } catch {
      // Not JSON — likely an HTML error page; return a clean message
    }
    if (resp.status === 401) return "Unauthorized — session may have expired";
    if (resp.status === 404) return "Edge Function not found";
    return `HTTP ${resp.status}`;
  } catch {
    return `HTTP ${resp.status}`;
  }
}

// ─── API ────────────────────────────────────────────────────────────

/**
 * Classify unknown form fields into profile key mappings using Claude Haiku.
 * Send only the fields that couldn't be matched deterministically.
 */
export async function classifyFields(
  fields: DOMFieldInfo[],
): Promise<ClassifiedField[]> {
  if (fields.length === 0) return [];

  const headers = await getAuthHeaders();
  const resp = await fetch(`${EDGE_FN_BASE}/classify-fields`, {
    method: "POST",
    headers,
    body: JSON.stringify({ fields }),
  });

  if (!resp.ok) {
    throw new Error(`AI classify failed (${resp.status}): ${await extractErrorMessage(resp)}`);
  }

  const data = await resp.json();
  return data.classifications ?? [];
}

/**
 * Generate an answer for an open-ended application question using Claude Sonnet.
 */
export async function generateAnswer(
  question: string,
  profileContext: string,
  jobContext?: string,
  maxLength?: number,
): Promise<GeneratedAnswer> {
  const headers = await getAuthHeaders();
  const resp = await fetch(`${EDGE_FN_BASE}/generate-answer`, {
    method: "POST",
    headers,
    body: JSON.stringify({ question, profileContext, jobContext, maxLength }),
  });

  if (!resp.ok) {
    throw new Error(`AI answer generation failed (${resp.status}): ${await extractErrorMessage(resp)}`);
  }

  const data = await resp.json();
  return {
    answer: data.answer ?? "",
    confidence: data.confidence ?? "low",
  };
}
