import fs from "node:fs/promises";
import path from "node:path";
import { google } from "googleapis";
import { authenticate } from "@google-cloud/local-auth";
import { CONFIG_DIR, TOKEN_PATH, credentialsPath } from "./paths.js";

export const SCOPES = ["https://www.googleapis.com/auth/drive.file"];

type AuthClient = InstanceType<typeof google.auth.OAuth2>;

interface ClientSecrets {
  client_id: string;
  client_secret: string;
}

async function readClientSecrets(file: string): Promise<ClientSecrets> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch {
    throw new Error(
      `OAuth client file not found: ${file}\n` +
        `Create a "Desktop app" OAuth client in Google Cloud Console, download its JSON and save it there ` +
        `(or pass --credentials <path> / set SPODRIVE_CREDENTIALS).`,
    );
  }
  const json = JSON.parse(raw) as { installed?: ClientSecrets; web?: ClientSecrets };
  const c = json.installed ?? json.web;
  if (!c?.client_id || !c.client_secret) throw new Error(`Unrecognised credentials file format: ${file}`);
  return c;
}

/**
 * Returns an authorized OAuth2 client. Reuses ~/.spodrive/token.json when present,
 * otherwise runs the browser (loopback) flow and saves the refresh token.
 */
export async function getAuthClient(): Promise<AuthClient> {
  const keyfilePath = credentialsPath();
  const secrets = await readClientSecrets(keyfilePath);

  try {
    const saved = JSON.parse(await fs.readFile(TOKEN_PATH, "utf8")) as { refresh_token?: string };
    if (saved.refresh_token) {
      const client = google.auth.fromJSON({
        type: "authorized_user",
        client_id: secrets.client_id,
        client_secret: secrets.client_secret,
        refresh_token: saved.refresh_token,
      }) as unknown as AuthClient;
      try {
        await client.getAccessToken();
        return client;
      } catch (e) {
        // Refresh tokens expire after 7 days while the OAuth app is in "Testing", or when access is revoked.
        if (!/invalid_grant/i.test(String((e as { message?: string })?.message ?? e))) throw e;
        console.warn("Saved Google login has expired or was revoked; opening the browser to sign in again.");
        await fs.rm(TOKEN_PATH, { force: true });
      }
    }
  } catch (e) {
    if ((e as { code?: string })?.code !== "ENOENT" && !(e instanceof SyntaxError)) throw e;
    // no usable token, fall through to interactive login
  }

  const client = (await authenticate({ scopes: SCOPES, keyfilePath })) as unknown as AuthClient;
  const refresh = client.credentials.refresh_token;
  if (!refresh) {
    throw new Error("Google did not return a refresh token. Revoke app access in your Google account and retry.");
  }
  await fs.mkdir(path.dirname(TOKEN_PATH) || CONFIG_DIR, { recursive: true });
  await fs.writeFile(
    TOKEN_PATH,
    JSON.stringify(
      { type: "authorized_user", client_id: secrets.client_id, client_secret: secrets.client_secret, refresh_token: refresh },
      null,
      2,
    ),
    { mode: 0o600 },
  );
  return client;
}
