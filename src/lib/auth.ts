import { getSupabase } from "./supabase";

/**
 * Launch Google OAuth flow using Chrome Identity API,
 * then exchange the id_token for a Supabase session.
 */
export async function signInWithGoogle(): Promise<{
  success: boolean;
  error?: string;
}> {
  try {
    const manifest = chrome.runtime.getManifest();
    const clientId = manifest.oauth2?.client_id;
    if (!clientId || clientId === "PLACEHOLDER_GOOGLE_CLIENT_ID") {
      return {
        success: false,
        error:
          "Google OAuth client ID not configured. Update wxt.config.ts with your Chrome extension client ID.",
      };
    }

    // Use the official Chrome Identity API to get the redirect URI
    const redirectUri = chrome.identity.getRedirectURL();
    console.log("[Vetidia] OAuth redirect URI (add this to Google Cloud Console):", redirectUri);
    console.log("[Vetidia] Extension ID:", chrome.runtime.id);

    const authUrl = new URL("https://accounts.google.com/o/oauth2/auth");
    authUrl.searchParams.set("client_id", clientId);
    authUrl.searchParams.set("response_type", "id_token");
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set(
      "scope",
      manifest.oauth2?.scopes?.join(" ") ?? "openid email profile",
    );
    // Nonce to prevent replay attacks
    authUrl.searchParams.set(
      "nonce",
      crypto.randomUUID(),
    );

    const redirectedTo = await new Promise<string>((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(
        { url: authUrl.href, interactive: true },
        (responseUrl) => {
          if (chrome.runtime.lastError) {
            reject(new Error(chrome.runtime.lastError.message));
          } else if (!responseUrl) {
            reject(new Error("No response URL received"));
          } else {
            resolve(responseUrl);
          }
        },
      );
    });

    // Extract the id_token from the redirect URL hash
    const url = new URL(redirectedTo);
    const hashParams = new URLSearchParams(url.hash.substring(1));
    const idToken = hashParams.get("id_token");

    if (!idToken) {
      return { success: false, error: "No id_token in OAuth response" };
    }

    // Exchange the id_token for a Supabase session
    const supabase = getSupabase();
    const { error } = await supabase.auth.signInWithIdToken({
      provider: "google",
      token: idToken,
    });

    if (error) {
      return { success: false, error: error.message };
    }

    return { success: true };
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";
    // If redirect_uri_mismatch, surface the URI to add
    if (message.includes("redirect_uri_mismatch") || message.includes("invalid")) {
      const uri = chrome.identity?.getRedirectURL?.() ?? `https://${chrome.runtime.id}.chromiumapp.org`;
      console.error(
        `[Vetidia] OAuth redirect_uri_mismatch. Add this URI to Google Cloud Console → OAuth client → Authorized redirect URIs:\n${uri}`
      );
    }
    return {
      success: false,
      error: message,
    };
  }
}

/** Sign out and clear stored session. */
export async function signOut(): Promise<void> {
  const supabase = getSupabase();
  await supabase.auth.signOut();
}

/** Get the current authenticated user, or null. */
export async function getCurrentUser() {
  const supabase = getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}
