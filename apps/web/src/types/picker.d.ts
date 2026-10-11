interface PickerDoc {
  id: string;
  name: string;
  mimeType: string;
}
interface PickerResponse {
  action: string;
  docs?: PickerDoc[];
}
interface PickerDocsView {
  setMimeTypes(types: string): PickerDocsView;
  setIncludeFolders(v: boolean): PickerDocsView;
  setSelectFolderEnabled(v: boolean): PickerDocsView;
  setMode(mode: unknown): PickerDocsView;
}
interface PickerBuilder {
  addView(view: PickerDocsView): PickerBuilder;
  enableFeature(feature: unknown): PickerBuilder;
  setOAuthToken(token: string): PickerBuilder;
  setDeveloperKey(key: string): PickerBuilder;
  setAppId(appId: string): PickerBuilder;
  setCallback(cb: (r: PickerResponse) => void): PickerBuilder;
  setTitle(title: string): PickerBuilder;
  build(): { setVisible(v: boolean): void };
}
interface GooglePicker {
  DocsView: new (viewId?: unknown) => PickerDocsView;
  PickerBuilder: new () => PickerBuilder;
  ViewId: { DOCS: unknown };
  DocsViewMode: { LIST: unknown };
  Feature: { MULTISELECT_ENABLED: unknown };
  Action: { PICKED: string; CANCEL: string };
}
interface Window {
  gapi?: {
    load(api: string, cb: () => void): void;
  };
}
