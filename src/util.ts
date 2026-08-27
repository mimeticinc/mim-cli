import { spawn } from "node:child_process";

export function readValue(args: string[], index: number, flag: string): [string, number] {
  const value = args[index + 1];
  if (!value || value.startsWith("-")) throw new Error(`${flag} requires a value`);
  return [value, index + 1];
}

export function homeDir(env: NodeJS.ProcessEnv = process.env): string {
  return env.HOME || env.USERPROFILE || "";
}

export function openBrowser(url: string): void {
  // Best effort, and never fatal. On a headless box, a container, an SSH
  // session or CI there is no xdg-open, and spawn raises an 'error' event that
  // takes the whole process down if nothing listens for it. Login still works
  // there: the caller has already printed the URL and the code for the user to
  // open somewhere else, so a missing browser must not end the run.
  try {
    const platform = process.platform;
    const command = platform === "darwin" ? "open" : platform === "win32" ? "cmd" : "xdg-open";
    const args = platform === "win32" ? ["/c", "start", "", url] : [url];
    const child = spawn(command, args, { stdio: "ignore", detached: true });
    child.on("error", () => {});
    child.unref();
  } catch {
    // no browser available; the printed URL is the fallback
  }
}
