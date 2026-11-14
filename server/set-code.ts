// Sets (or changes) the trip code. The code is read from the keyboard, so it never ends up
// in your shell history, and only a scrypt hash of it is stored in the database.
//
// On the server:   npm run server:set-code     (from your computer; it connects to Hertz)
// Locally:         DATA_DIR=./data node --experimental-strip-types server/set-code.ts
//
// Phones that already joined stay joined. To sign every phone out, add --logout-all.

import { randomBytes, scryptSync } from "node:crypto";
import { createInterface } from "node:readline";
import { join } from "node:path";
import { openDatabase, setSetting } from "./db.ts";

const db = openDatabase(process.env.DATA_DIR ?? join(process.cwd(), "data"));

async function ask(question: string): Promise<string> {
  // If a code is piped in (e.g. in tests), read it from there.
  const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: process.stdin.isTTY });
  return new Promise((resolve) => rl.question(question, (answer) => (rl.close(), resolve(answer))));
}

const code = (await ask("New trip code (use 4+ random words): ")).trim().toLowerCase();
if (code.split(/\s+/).length < 3 || code.length < 12) {
  console.error("Too short: use at least 3–4 words, e.g. 'kayak mango lantern sushi'.");
  process.exit(1);
}
const salt = randomBytes(16);
const hash = scryptSync(code, salt, 32);
setSetting(db, "code_hash", `${salt.toString("hex")}:${hash.toString("hex")}`);
if (process.argv.includes("--logout-all")) {
  db.exec("DELETE FROM devices");
  console.log("All phones signed out; they need the new code.");
}
console.log("Trip code saved.");
