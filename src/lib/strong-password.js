const CHARACTER_GROUPS = [
  "ABCDEFGHJKLMNPQRSTUVWXYZ",
  "abcdefghijkmnopqrstuvwxyz",
  "23456789",
  "!@#$%*+-_=.?",
];
const ALL_CHARACTERS = CHARACTER_GROUPS.join("");

function secureRandomIndex(max) {
  if (!globalThis.crypto?.getRandomValues) throw new Error("Secure password generation is unavailable in this browser.");
  const range = 0x1_0000_0000;
  const limit = Math.floor(range / max) * max;
  const values = new Uint32Array(1);
  do { globalThis.crypto.getRandomValues(values); } while (values[0] >= limit);
  return values[0] % max;
}

export function generateStrongPassword(length = 20) {
  const passwordLength = Math.max(length, CHARACTER_GROUPS.length);
  const characters = CHARACTER_GROUPS.map((group) => group[secureRandomIndex(group.length)]);
  while (characters.length < passwordLength) characters.push(ALL_CHARACTERS[secureRandomIndex(ALL_CHARACTERS.length)]);
  for (let index = characters.length - 1; index > 0; index -= 1) {
    const swapIndex = secureRandomIndex(index + 1);
    [characters[index], characters[swapIndex]] = [characters[swapIndex], characters[index]];
  }
  return characters.join("");
}
