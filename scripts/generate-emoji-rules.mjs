import fs from "node:fs";

const ALLOW = new Set([0xa9, 0xae, 0x2122]); // © ® ™ - not decorative emoji
const re = /\p{Extended_Pictographic}/u;
const emojiChars = [];
for (let cp = 0; cp <= 0x10ffff; cp++) {
  if (ALLOW.has(cp)) continue;
  const ch = String.fromCodePoint(cp);
  if (re.test(ch)) {
    emojiChars.push({
      char: ch,
      name: `EMOJI (U+${cp.toString(16).toUpperCase().padStart(4, "0")})`,
      severity: "warning",
      replacement: "",
    });
  }
}

const rcPath = ".llmsloprc.json";
const rc = JSON.parse(fs.readFileSync(rcPath, "utf8"));

rc.chars = (rc.chars || []).filter((c) => !String(c.name || "").startsWith("EMOJI (U+"));
rc.chars.push(...emojiChars);
rc.description =
  "Curated typography + high-precision LLM prose tells + ban all decorative emoji (Extended_Pictographic; excludes ©®™). Packs via .vscode/settings.json / fix-slop --pack.";
rc.version = "1.2.0";

fs.writeFileSync(rcPath, JSON.stringify(rc, null, 2) + "\n", "utf8");
console.log(`Wrote ${emojiChars.length} emoji char rules. Total chars: ${rc.chars.length}`);
console.log(`File size: ${(fs.statSync(rcPath).size / 1024).toFixed(1)} KB`);
