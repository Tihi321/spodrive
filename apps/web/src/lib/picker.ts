/** Google Picker: lets the user hand individual folders/files to the app (drive.file scope). */
import { getAccessToken } from "./auth";
import { PICKER_MIME_TYPES } from "./tags";
import type { PickedDoc } from "./sources";

export const API_KEY: string = ((import.meta.env.VITE_GOOGLE_API_KEY as string | undefined) ?? "").trim();
export const APP_ID: string = ((import.meta.env.VITE_GOOGLE_APP_ID as string | undefined) ?? "").trim();

export const pickerConfigured = () => API_KEY.length > 0 && APP_ID.length > 0;

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

/** Open the Picker. Resolves with the picked folders/files, or [] when cancelled. */
export async function pickFromDrive(): Promise<PickedDoc[]> {
  if (!pickerConfigured()) {
    throw new Error("Google Picker is not configured. Set VITE_GOOGLE_API_KEY and VITE_GOOGLE_APP_ID (see apps/web/.env.example).");
  }
  const [token] = await Promise.all([getAccessToken(), loadPicker()]);
  const picker = window.google!.picker!;
  const view = new picker.DocsView(picker.ViewId.DOCS)
    .setMimeTypes(PICKER_MIME_TYPES)
    .setIncludeFolders(true)
    .setSelectFolderEnabled(true)
    .setMode(picker.DocsViewMode.LIST);
  return new Promise<PickedDoc[]>((resolve) => {
    new picker.PickerBuilder()
      .addView(view)
      .enableFeature(picker.Feature.MULTISELECT_ENABLED)
      .setOAuthToken(token)
      .setDeveloperKey(API_KEY)
      .setAppId(APP_ID)
      .setTitle("Add music to Spodrive")
      .setCallback((r) => {
        if (r.action === picker.Action.PICKED) resolve((r.docs ?? []).map((d) => ({ id: d.id, name: d.name, mimeType: d.mimeType })));
        else if (r.action === picker.Action.CANCEL) resolve([]);
      })
      .build()
      .setVisible(true);
  });
}
