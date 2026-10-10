import { Command } from "commander";
import { runAdd } from "./commands/add.js";
import { runInit } from "./commands/init.js";
import { runList, runPasswd, runRemove, runStatus, runVerify } from "./commands/library.js";

const program = new Command();
program
  .name("spodrive")
  .description("Encrypt music and store it on Google Drive for the Spodrive player")
  .option("--credentials <path>", "Google OAuth desktop client JSON (default ~/.spodrive/credentials.json)")
  .hook("preAction", () => {
    const c = (program.opts() as { credentials?: string }).credentials;
    if (c) process.env.SPODRIVE_CREDENTIALS = c;
  });

program
  .command("init")
  .description("Authenticate with Google and create the Spodrive folder tree and vault")
  .option("--force", "create a new tree even if one exists (never deletes anything)")
  .action((o: { force?: boolean }) => runInit(o));

program
  .command("add")
  .description("Encrypt and upload .mp3/.m4a/.flac files from one or more folders")
  .argument("<folder...>", "folders (or files) to scan recursively")
  .option("--concurrency <n>", "parallel uploads", "3")
  .option("--dry-run <outDir>", "no Google calls: write the encrypted layout to a local directory")
  .action((folders: string[], o: { concurrency?: string; dryRun?: string }) => runAdd(folders, o).then(() => undefined));

program.command("list").description("List tracks in the library").action(() => runList());

program
  .command("remove")
  .description("Delete tracks whose title/artist/album contains <query>")
  .argument("<query>")
  .action((q: string) => runRemove(q));

program.command("passwd").description("Change the passphrase (re-seals library and playlists only)").action(() => runPasswd());

program
  .command("verify")
  .description("Download tracks, decrypt them and check sha256 against the library")
  .option("--sample <n>", "only check n random tracks")
  .action((o: { sample?: string }) => runVerify(o));

program.command("status").description("Show root folder, track count and total size").action(() => runStatus());

program.parseAsync(process.argv).catch((e: unknown) => {
  const err = e as Error;
  if (err.name === "ExitPromptError") {
    process.exit(130);
  }
  console.error(`Error: ${err.message}`);
  process.exit(1);
});
