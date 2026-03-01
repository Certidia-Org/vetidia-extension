import type { DetectedField, UserProfile, DocumentRecord } from "@/lib/messaging";
import { uploadFileToInput } from "@/content/file-upload";
import widgetStyles from "./styles.css?inline";

export interface WidgetField extends DetectedField {
  value: string;
  filled: boolean;
}

/** A detected file input on the page (resume, cover letter). */
export interface FileInputField {
  label: string;
  selector: string;
  type: "resume" | "cover_letter";
}

interface WidgetState {
  platform: string | null;
  fields: WidgetField[];
  fileInputs: FileInputField[];
  documents: DocumentRecord[];
  selectedFiles: Record<string, string>; // fileInput selector → document ID
  panelOpen: boolean;
  filling: boolean;
  uploading: boolean;
  status: { message: string; type: "success" | "error" } | null;
  fileStatus: { message: string; type: "success" | "error" | "uploading" } | null;
}

// SVG icon strings
const ICONS = {
  zap: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>',
  x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>',
  check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="20 6 9 17 4 12"/></svg>',
  spinner: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 1 1-6.219-8.56"/></svg>',
};

/**
 * Creates and manages the floating co-pilot widget.
 * Rendered inside a Shadow DOM to isolate styles from the host page.
 */
export class CopilotWidget {
  private host: HTMLElement;
  private shadow: ShadowRoot;
  private state: WidgetState;
  private onFill: ((fields: WidgetField[]) => Promise<number>) | null = null;

  constructor() {
    this.state = {
      platform: null,
      fields: [],
      fileInputs: [],
      documents: [],
      selectedFiles: {},
      panelOpen: false,
      filling: false,
      uploading: false,
      status: null,
      fileStatus: null,
    };

    // Create host element
    this.host = document.createElement("div");
    this.host.id = "vetidia-copilot-root";
    this.host.style.cssText = "all: initial !important; position: fixed !important; z-index: 2147483647 !important;";
    document.body.appendChild(this.host);

    // Attach shadow DOM
    this.shadow = this.host.attachShadow({ mode: "closed" });

    // Inject styles
    const style = document.createElement("style");
    style.textContent = widgetStyles;
    this.shadow.appendChild(style);

    this.render();
  }

  /** Set the fill handler that gets called when user clicks "Fill All". */
  setFillHandler(handler: (fields: WidgetField[]) => Promise<number>) {
    this.onFill = handler;
  }

  /** Update the widget with detected fields. */
  update(platform: string | null, detectedFields: DetectedField[], profile: UserProfile) {
    this.state.platform = platform;
    this.state.fields = detectedFields
      .filter((f) => f.profileKey !== null)
      .map((f) => ({
        ...f,
        value: f.profileKey ? getProfileValue(profile, f.profileKey) : "",
        filled: false,
      }))
      .filter((f) => f.value); // Only show fields with profile data

    // Detect file inputs from the detected fields
    this.state.fileInputs = detectedFields
      .filter((f) => f.type === "file")
      .map((f) => ({
        label: f.label,
        selector: f.selector,
        type: /cover/i.test(f.label) ? "cover_letter" as const : "resume" as const,
      }));

    // Fetch available documents if there are file inputs
    if (this.state.fileInputs.length > 0 && this.state.documents.length === 0) {
      this.loadDocuments();
    }

    this.state.status = null;
    this.render();
  }

  /** Load available documents from Supabase via background. */
  private async loadDocuments() {
    try {
      const resp = await chrome.runtime.sendMessage({
        type: "GET_DOCUMENTS",
        payload: { fileType: "resume" },
      });
      this.state.documents = resp?.documents ?? [];
      this.render();
    } catch {
      // Silently fail — documents section just won't show
    }
  }

  /** Mark specific fields as filled after a fill operation. */
  markFilled(filledCount: number) {
    let count = 0;
    for (const field of this.state.fields) {
      if (count >= filledCount) break;
      field.filled = true;
      count++;
    }
    this.render();
  }

  /** Remove the widget from the page. */
  destroy() {
    this.host.remove();
  }

  /** Show or hide the widget. */
  setVisible(visible: boolean) {
    this.host.style.display = visible ? "" : "none";
  }

  private render() {
    // Clear existing content (keep style)
    const style = this.shadow.querySelector("style");
    while (this.shadow.lastChild && this.shadow.lastChild !== style) {
      this.shadow.removeChild(this.shadow.lastChild);
    }

    const container = document.createElement("div");

    // Only show if we have fields
    if (this.state.fields.length === 0) {
      this.shadow.appendChild(container);
      return;
    }

    // FAB (Floating Action Button)
    const fab = document.createElement("button");
    fab.className = "vetidia-fab";
    fab.title = "Vetidia Copilot";
    fab.innerHTML = ICONS.zap;

    // Badge with field count
    const badge = document.createElement("span");
    badge.className = "badge";
    badge.textContent = String(this.state.fields.length);
    fab.appendChild(badge);

    fab.addEventListener("click", () => {
      this.state.panelOpen = !this.state.panelOpen;
      this.render();
    });

    container.appendChild(fab);

    // Panel (when open)
    if (this.state.panelOpen) {
      const panel = this.buildPanel();
      container.appendChild(panel);
    }

    this.shadow.appendChild(container);
  }

  private buildPanel(): HTMLElement {
    const panel = document.createElement("div");
    panel.className = "vetidia-panel";

    // Header
    const header = document.createElement("div");
    header.className = "vetidia-panel-header";
    header.innerHTML = `
      <h2>${ICONS.zap} Vetidia Copilot</h2>
    `;

    if (this.state.platform) {
      const platformBadge = document.createElement("span");
      platformBadge.className = "platform-badge";
      platformBadge.textContent = this.state.platform.charAt(0).toUpperCase() + this.state.platform.slice(1);
      header.querySelector("h2")!.appendChild(platformBadge);
    }

    const closeBtn = document.createElement("button");
    closeBtn.className = "close-btn";
    closeBtn.innerHTML = ICONS.x;
    closeBtn.addEventListener("click", () => {
      this.state.panelOpen = false;
      this.render();
    });
    header.appendChild(closeBtn);
    panel.appendChild(header);

    // Field list
    const fieldList = document.createElement("div");
    fieldList.className = "vetidia-fields";

    if (this.state.fields.length === 0) {
      fieldList.innerHTML = '<div class="vetidia-empty">No fillable fields detected.</div>';
    } else {
      for (const field of this.state.fields) {
        const row = document.createElement("div");
        row.className = `vetidia-field-row${field.filled ? " filled" : ""}`;

        // Confidence dot
        const conf = document.createElement("span");
        conf.className = `vetidia-conf ${field.confidence}`;
        conf.title = `${field.confidence} confidence`;
        row.appendChild(conf);

        // Field info
        const info = document.createElement("div");
        info.className = "vetidia-field-info";
        info.innerHTML = `
          <div class="vetidia-field-label">${escapeHtml(field.label)}</div>
          <div class="vetidia-field-value" title="${escapeHtml(field.value)}">${escapeHtml(field.value)}</div>
        `;
        row.appendChild(info);

        // AI badge for AI-classified fields
        if (field.confidence !== "high") {
          const aiBadge = document.createElement("span");
          aiBadge.className = "vetidia-ai-badge";
          aiBadge.textContent = "AI";
          row.appendChild(aiBadge);
        }

        // Check mark for filled fields
        if (field.filled) {
          const check = document.createElement("span");
          check.className = "vetidia-field-check";
          check.innerHTML = ICONS.check;
          row.appendChild(check);
        }

        fieldList.appendChild(row);
      }
    }

    panel.appendChild(fieldList);

    // File upload section (if file inputs detected)
    if (this.state.fileInputs.length > 0 && this.state.documents.length > 0) {
      const filesSection = this.buildFilesSection();
      panel.appendChild(filesSection);
    }

    // Footer
    const footer = document.createElement("div");
    footer.className = "vetidia-panel-footer";

    const fillableCount = this.state.fields.filter((f) => !f.filled).length;
    const allFilled = fillableCount === 0;

    const fillBtn = document.createElement("button");
    fillBtn.className = "vetidia-fill-btn";
    fillBtn.disabled = this.state.filling || allFilled;

    if (this.state.filling) {
      fillBtn.innerHTML = `<span class="vetidia-spinner">${ICONS.spinner}</span> Filling...`;
    } else if (allFilled) {
      fillBtn.innerHTML = `${ICONS.check} All Fields Filled`;
    } else {
      fillBtn.innerHTML = `${ICONS.zap} Fill ${fillableCount} Field${fillableCount !== 1 ? "s" : ""}`;
    }

    fillBtn.addEventListener("click", () => this.handleFill());
    footer.appendChild(fillBtn);

    // Status message
    if (this.state.status) {
      const status = document.createElement("div");
      status.className = `vetidia-status ${this.state.status.type}`;
      status.textContent = this.state.status.message;
      footer.appendChild(status);
    }

    panel.appendChild(footer);

    return panel;
  }

  private buildFilesSection(): HTMLElement {
    const section = document.createElement("div");
    section.className = "vetidia-files-section";

    const title = document.createElement("div");
    title.className = "vetidia-files-title";
    title.textContent = "File Uploads";
    section.appendChild(title);

    for (const fi of this.state.fileInputs) {
      const row = document.createElement("div");
      row.className = "vetidia-file-row";

      const label = document.createElement("span");
      label.className = "vetidia-file-label";
      label.textContent = fi.label;
      row.appendChild(label);

      const select = document.createElement("select");
      select.className = "vetidia-file-select";

      const defaultOpt = document.createElement("option");
      defaultOpt.value = "";
      defaultOpt.textContent = "Select a file...";
      select.appendChild(defaultOpt);

      for (const doc of this.state.documents) {
        const opt = document.createElement("option");
        opt.value = doc.id;
        opt.textContent = doc.file_name;
        if (this.state.selectedFiles[fi.selector] === doc.id) {
          opt.selected = true;
        }
        select.appendChild(opt);
      }

      select.addEventListener("change", () => {
        this.state.selectedFiles[fi.selector] = select.value;
      });

      row.appendChild(select);

      const uploadBtn = document.createElement("button");
      uploadBtn.className = "vetidia-upload-btn";
      uploadBtn.textContent = "Upload";
      uploadBtn.disabled = this.state.uploading;
      uploadBtn.addEventListener("click", () => this.handleFileUpload(fi));
      row.appendChild(uploadBtn);

      section.appendChild(row);
    }

    if (this.state.fileStatus) {
      const status = document.createElement("div");
      status.className = `vetidia-file-status ${this.state.fileStatus.type}`;
      status.textContent = this.state.fileStatus.message;
      section.appendChild(status);
    }

    return section;
  }

  private async handleFileUpload(fi: FileInputField) {
    const docId = this.state.selectedFiles[fi.selector];
    if (!docId) {
      this.state.fileStatus = { message: "Please select a file first.", type: "error" };
      this.render();
      return;
    }

    const doc = this.state.documents.find((d) => d.id === docId);
    if (!doc) return;

    this.state.uploading = true;
    this.state.fileStatus = { message: "Uploading...", type: "uploading" };
    this.render();

    try {
      // Find the file input on the page
      const input = document.querySelector<HTMLInputElement>(fi.selector);
      if (!input) {
        throw new Error("File input not found on page");
      }

      const success = await uploadFileToInput(input, doc.file_url, doc.file_name);
      if (success) {
        this.state.fileStatus = { message: `Uploaded ${doc.file_name}`, type: "success" };
      } else {
        this.state.fileStatus = { message: "Upload failed — try dragging the file manually.", type: "error" };
      }
    } catch (err) {
      this.state.fileStatus = {
        message: err instanceof Error ? err.message : "Upload failed",
        type: "error",
      };
    } finally {
      this.state.uploading = false;
      this.render();
    }
  }

  private async handleFill() {
    if (!this.onFill || this.state.filling) return;

    this.state.filling = true;
    this.state.status = null;
    this.render();

    try {
      const unfilled = this.state.fields.filter((f) => !f.filled);
      const filledCount = await this.onFill(unfilled);

      // Mark fields as filled
      let count = 0;
      for (const field of this.state.fields) {
        if (field.filled) continue;
        if (count >= filledCount) break;
        field.filled = true;
        count++;
      }

      this.state.status = {
        message: `Filled ${filledCount} field${filledCount !== 1 ? "s" : ""} successfully.`,
        type: "success",
      };
    } catch (err) {
      this.state.status = {
        message: err instanceof Error ? err.message : "Fill failed",
        type: "error",
      };
    } finally {
      this.state.filling = false;
      this.render();
    }
  }
}

function getProfileValue(profile: UserProfile, key: string): string {
  // Handle indexed experience keys: _exp_0_company, _exp_1_title, etc.
  const expMatch = key.match(/^_exp_(\d+)_(\w+)$/);
  if (expMatch) {
    const idx = parseInt(expMatch[1], 10);
    const field = expMatch[2] as keyof NonNullable<UserProfile["_experiences"]>[number];
    return profile._experiences?.[idx]?.[field] ?? "";
  }

  // Handle indexed education keys: _edu_0_institution, _edu_1_degree, etc.
  const eduMatch = key.match(/^_edu_(\d+)_(\w+)$/);
  if (eduMatch) {
    const idx = parseInt(eduMatch[1], 10);
    const field = eduMatch[2] as keyof NonNullable<UserProfile["_education"]>[number];
    return profile._education?.[idx]?.[field] ?? "";
  }

  return (profile[key as keyof UserProfile] as string) ?? "";
}

function escapeHtml(text: string): string {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}
