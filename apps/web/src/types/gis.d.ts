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
        }): GisTokenClient;
        revoke(token: string, done?: () => void): void;
      };
    };
  };
}
