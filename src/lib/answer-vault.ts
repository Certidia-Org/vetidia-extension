import { getSupabase } from "./supabase";

export interface VaultAnswer {
  id: string;
  questionText: string;
  answerText: string;
  confidence: number;
  source: "vault" | "ai_generated";
  category: string;
  timesUsed: number;
  autoFillEnabled: boolean;
}

// Tier 2: Match a question against the answer vault using text matching
export async function matchAnswerFromVault(
  questionText: string,
  userId: string,
): Promise<VaultAnswer | null> {
  const supabase = getSupabase();

  // Normalize the question
  const normalized = questionText.toLowerCase().trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");

  // First try exact hash match
  const questionHash = await hashQuestion(normalized);

  const { data: exactMatch } = await supabase
    .from("answer_vault")
    .select("*")
    .eq("user_id", userId)
    .eq("question_hash", questionHash)
    .eq("is_current", true)
    .maybeSingle();

  if (exactMatch) {
    return {
      id: exactMatch.id,
      questionText: exactMatch.question_text,
      answerText: exactMatch.answer_text,
      confidence: exactMatch.confidence_score,
      source: "vault",
      category: exactMatch.category,
      timesUsed: exactMatch.times_used,
      autoFillEnabled: exactMatch.auto_fill_enabled,
    };
  }

  // Fuzzy match: search for similar questions
  const { data: fuzzyMatches } = await supabase
    .from("answer_vault")
    .select("*")
    .eq("user_id", userId)
    .eq("is_current", true)
    .ilike("question_normalized", `%${normalized.slice(0, 50)}%`)
    .limit(5);

  if (fuzzyMatches && fuzzyMatches.length > 0) {
    // Return best match (highest confidence)
    const best = fuzzyMatches.sort((a, b) => b.confidence_score - a.confidence_score)[0];
    return {
      id: best.id,
      questionText: best.question_text,
      answerText: best.answer_text,
      confidence: Math.min(best.confidence_score, 0.8), // Cap fuzzy matches at 0.8
      source: "vault",
      category: best.category,
      timesUsed: best.times_used,
      autoFillEnabled: best.auto_fill_enabled,
    };
  }

  return null;
}

// Save an answer to the vault
export async function saveAnswerToVault(
  userId: string,
  questionText: string,
  answerText: string,
  category: string = "general",
  sourceAts: string | null = null,
  sourceUrl: string | null = null,
): Promise<void> {
  const supabase = getSupabase();

  const normalized = questionText.toLowerCase().trim()
    .replace(/[^a-z0-9\s]/g, "")
    .replace(/\s+/g, " ");
  const questionHash = await hashQuestion(normalized);

  await supabase
    .from("answer_vault")
    .upsert({
      user_id: userId,
      question_text: questionText,
      question_normalized: normalized,
      question_hash: questionHash,
      answer_text: answerText,
      category,
      source_ats: sourceAts,
      source_url: sourceUrl,
      confidence_score: 0.7, // Initial confidence for user-provided answers
      is_current: true,
      is_universal: false,
      auto_fill_enabled: false, // Requires 3+ uses to auto-fill
    }, { onConflict: "user_id,question_hash" });
}

// Update learning signals when a filled answer is accepted/edited/rejected
export async function updateLearningSignal(
  answerId: string,
  action: "accepted" | "edited" | "rejected",
  editedText?: string,
): Promise<void> {
  const supabase = getSupabase();

  if (action === "accepted") {
    const { data } = await supabase
      .from("answer_vault")
      .select("times_used, times_accepted, confidence_score")
      .eq("id", answerId)
      .single();

    if (data) {
      const newUsed = (data.times_used || 0) + 1;
      const newAccepted = (data.times_accepted || 0) + 1;
      const newConfidence = Math.min(1.0, data.confidence_score + 0.05);
      const autoFill = newAccepted >= 3;

      await supabase
        .from("answer_vault")
        .update({
          times_used: newUsed,
          times_accepted: newAccepted,
          confidence_score: newConfidence,
          auto_fill_enabled: autoFill,
        })
        .eq("id", answerId);
    }
  } else if (action === "edited" && editedText) {
    const { data } = await supabase
      .from("answer_vault")
      .select("times_used, times_edited, confidence_score")
      .eq("id", answerId)
      .single();

    if (data) {
      await supabase
        .from("answer_vault")
        .update({
          times_used: (data.times_used || 0) + 1,
          times_edited: (data.times_edited || 0) + 1,
          answer_text: editedText,
          confidence_score: Math.max(0.5, data.confidence_score - 0.02),
        })
        .eq("id", answerId);
    }
  } else if (action === "rejected") {
    const { data } = await supabase
      .from("answer_vault")
      .select("times_used, times_rejected, confidence_score")
      .eq("id", answerId)
      .single();

    if (data) {
      await supabase
        .from("answer_vault")
        .update({
          times_used: (data.times_used || 0) + 1,
          times_rejected: (data.times_rejected || 0) + 1,
          confidence_score: Math.max(0.1, data.confidence_score - 0.1),
        })
        .eq("id", answerId);
    }
  }
}

// Log a form submission for audit
export async function logFormSubmission(
  userId: string,
  atsType: string,
  pageUrl: string,
  fieldsAttempted: number,
  fieldsFilled: number,
  fieldsSkipped: number,
  fieldDetails: Record<string, unknown>[],
): Promise<void> {
  const supabase = getSupabase();

  await supabase
    .from("form_submissions")
    .insert({
      user_id: userId,
      ats_type: atsType,
      page_url: pageUrl,
      fields_attempted: fieldsAttempted,
      fields_filled: fieldsFilled,
      fields_skipped: fieldsSkipped,
      field_details: fieldDetails,
    });
}

// Hash a normalized question for dedup
async function hashQuestion(normalized: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(normalized);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map(b => b.toString(16).padStart(2, "0")).join("");
}
