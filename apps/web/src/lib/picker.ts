/** Google Picker: lets the user hand individual folders/files to the app (drive.file scope). */
import { getAccessToken } from "./auth";
import { ensureUploadsFolderId } from "./drive";
import { PICKER_MIME_TYPES } from "./tags";
import type { PickedDoc } from "./sources";

export const API_KEY: string = ((import.meta.env.VITE_GOOGLE_API_KEY as string | undefined) ?? "").trim();
export const APP_ID: string = ((import.meta.env.VITE_GOOGLE_APP_ID as string | undefined) ?? "").trim();

export const pickerConfigured = () => API_KEY.length > 0 && APP_ID.length > 0;

function assertConfigured(): void {
  if (!pickerConfigured()) {
    throw new Error("Google Picker is not configured. Set VITE_GOOGLE_API_KEY and VITE_GOOGLE_APP_ID (see apps/web/.env.example).");
  }
}

let pickerPromise: Promise<void> | null = null;
function loadPicker(): Promise<void> {
  if (window.google?.picker) return Promise.resolve();
  pickerPromise ??= new Promise<void>((resolve, reject) => {
    const fail = () => {
      pickerPromise = null;
      reject(new Error("Could not load the Google Picker (offline?)"));
    };
    const onApi = () => window.gapi!.load("picker", () => resolve());
    if (window.gapi) return onApi();
    const s = document.createElement("script");
    s.src = "https://apis.google.com/js/api.js";
    s.async = true;
    s.onload = onApi;
    s.onerror = fail;
    document.head.appendChild(s);
  });
  return pickerPromise;
}

/**
 * Open the Picker with two tabs: browse Drive, and upload from this device into Spodrive/Music.
 * Uploaded files come back as picked files, so drive.file covers them like any other pick.
 * Resolves with the picked (or uploaded) folders/files, or [] when cancelled.
 */
export async function pickFromDrive(): Promise<PickedDoc[]> {
  assertConfigured();
  // without the folder, uploads still work and land in the root of My Drive
  const uploadsId = await ensureUploadsFolderId().catch(() => undefined);
  return openPicker("Add music to Spodrive", (picker) => {
    const view = new picker.DocsView(picker.ViewId.DOCS)
      .setMimeTypes(PICKER_MIME_TYPES)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMode(picker.DocsViewMode.LIST);
    const upload = new picker.DocsUploadView().setIncludeFolders(false);
    if (uploadsId) upload.setParent(uploadsId);
    return [view, upload];
  });
}

/** Step 1 of "Add folders": a multi-select Picker that shows folders only. */
export function pickFolders(): Promise<PickedDoc[]> {
  return openPicker("Choose folders to add", (picker) => [
    new picker.DocsView(picker.ViewId.FOLDERS)
      .setIncludeFolders(true)
      .setSelectFolderEnabled(true)
      .setMode(picker.DocsViewMode.LIST),
  ]);
}

/**
 * Step 2 of "Add folders": a Picker opened inside `folder`, audio only, no subfolders.
 * With drive.file, selecting the songs is what gives Spodrive access to them.
 */
export function pickSongsIn(folder: { id: string; name: string }): Promise<PickedDoc[]> {
  return openPicker(`Select the songs in "${folder.name}"`, (picker) => [
    new picker.DocsView(picker.ViewId.DOCS)
      .setParent(folder.id)
      .setMimeTypes(PICKER_MIME_TYPES)
      .setIncludeFolders(false)
      .setMode(picker.DocsViewMode.LIST),
  ]);
}

/** Shared Picker setup: token, key, app id, multi-select. Resolves with the picked docs, or [] when cancelled. */
async function openPicker(title: string, makeViews: (picker: GooglePicker) => Array<PickerDocsView | PickerDocsUploadView>): Promise<PickedDoc[]> {
  assertConfigured();
  const [token] = await Promise.all([getAccessToken(), loadPicker()]);
  const picker = window.google!.picker!;
  return new Promise<PickedDoc[]>((resolve) => {
    const builder = new picker.PickerBuilder();
    for (const view of makeViews(picker)) builder.addView(view);
    builder
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .setAppId(APP_ID)
      .setTitle(title)
      .setCallback((r) => {
        if (r.action === picker.Action.PICKED) resolve((r.docs ?? []).map((d) => ({ id: d.id, name: d.name, mimeType: d.mimeType })));
        else if (r.action === picker.Action.CANCEL) resolve([]);
      })
      .build()
      .setVisible(true);
  });
}
