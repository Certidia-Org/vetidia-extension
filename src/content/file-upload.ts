/**
 * File upload utility for attaching resumes/cover letters to ATS file inputs.
 *
 * Flow:
 * 1. Content script requests file data from background (Supabase storage → base64)
 * 2. This utility converts base64 → File object
 * 3. Uses DataTransfer API to programmatically set the file on the <input type="file">
 */

/**
 * Convert a base64 string to a File object.
 */
export function base64ToFile(
  base64: string,
  fileName: string,
  mimeType: string,
): File {
  const binaryStr = atob(base64);
  const bytes = new Uint8Array(binaryStr.length);
  for (let i = 0; i < binaryStr.length; i++) {
    bytes[i] = binaryStr.charCodeAt(i);
  }
  const blob = new Blob([bytes], { type: mimeType });
  return new File([blob], fileName, { type: mimeType, lastModified: Date.now() });
}

/**
 * Attach a File to an <input type="file"> element using the DataTransfer API.
 * Returns true if successful.
 */
export function setFileInput(
  input: HTMLInputElement,
  file: File,
): boolean {
  try {
    const dt = new DataTransfer();
    dt.items.add(file);
    input.files = dt.files;

    // Dispatch events so the ATS form recognizes the file
    input.dispatchEvent(new Event("input", { bubbles: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));

    return true;
  } catch {
    // DataTransfer API not supported (unlikely in modern browsers)
    return false;
  }
}

/**
 * Upload a resume to a detected file input on the page.
 * Fetches the file from the background service worker, then attaches it.
 */
export async function uploadFileToInput(
  input: HTMLInputElement,
  fileUrl: string,
  fileName: string,
): Promise<boolean> {
  // Request file data from background service worker
  const response = await chrome.runtime.sendMessage({
    type: "GET_FILE_DATA",
    payload: { fileUrl, fileName },
  });

  if (!response?.data) {
    console.error("[Vetidia] Failed to fetch file:", response?.error);
    return false;
  }

  const file = base64ToFile(response.data, response.fileName, response.mimeType);
  return setFileInput(input, file);
}
