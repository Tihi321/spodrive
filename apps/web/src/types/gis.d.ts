interface GisTokenResponse {
  access_token?: string;
  expires_in?: number | string;
  error?: string;
  error_description?: string;
  scope?: string;
}
interface GisTokenClient {
  requestAccessToken(overrides?: { prompt?: string; hint?: string; scope?: string }): void;
}
interface GisCodeResponse {
  code?: string;
  scope?: string;
  error?: string;
  error_description?: string;
}
interface GisCodeClient {
  requestCode(): void;
}
interface GisErrorShape {
  type: "popup_failed_to_open" | "popup_closed" | "unknown" | string;
  message?: string;
}
interface Window {
  google?: {
    picker?: GooglePicker;
    accounts: {
      oauth2: {
        initTokenClient(config: {
          client_id: string;
          scope: string;
          callback: (r: GisTokenResponse) => void;
          error_callback?: (e: GisErrorShape) => void;
          prompt?: string;
          hint?: string;
          include_granted_scopes?: boolean;
        }): GisTokenClient;
        initCodeClient(config: {
          client_id: string;
          scope: string;
          ux_mode?: "popup" | "redirect";
          select_account?: boolean;
          login_hint?: string;
          callback: (r: GisCodeResponse) => void;
          error_callback?: (e: GisErrorShape) => void;
        }): GisCodeClient;
        revoke(token: string, done?: () => void): void;
      };
    };
  };
}
