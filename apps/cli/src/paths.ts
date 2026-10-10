import os from "node:os";
import path from "node:path";

export const CONFIG_DIR = process.env.SPODRIVE_HOME ?? path.join(os.homedir(), ".spodrive");
export const TOKEN_PATH = path.join(CONFIG_DIR, "token.json");
export const CONFIG_PATH = path.join(CONFIG_DIR, "config.json");

export function credentialsPath(): string {
  return process.env.SPODRIVE_CREDENTIALS ?? path.join(CONFIG_DIR, "credentials.json");
}
