/**
 * A starter compromised-password list (SECURITY.md §1: "checked against a
 * compromised-password list at set time").
 *
 * Scope, stated honestly: the minimum password length is 12, which already
 * excludes the overwhelming majority of published breach corpora — those are
 * dominated by entries of 6–10 characters. What remains dangerous at length ≥12
 * is the long-but-predictable tail, which is what this list holds: keyboard
 * runs, repeated words, and the familiar passphrases.
 *
 * This is not a substitute for a full corpus. Phase 11 (Security) should either
 * bundle a filtered extract of a real breach list — the entries of length ≥12,
 * a few hundred KB — or check against the Have I Been Pwned range API, whose
 * k-anonymity model never transmits the password or its full hash. Recorded
 * here so the limitation is visible rather than assumed away.
 *
 * Entries are compared after NFKC normalisation and lower-casing.
 */

const ENTRIES = [
  // Long keyboard runs
  'qwertyuiopasdfghjkl',
  'qwertyuiopasdfgh',
  'qwertyuiop123456',
  'qwertyuiopqwertyuiop',
  '1qaz2wsx3edc4rfv',
  '1q2w3e4r5t6y7u8i',
  'qazwsxedcrfvtgby',
  'asdfghjklzxcvbnm',
  'zaq12wsxcde34rfv',
  '!qaz2wsx#edc4rfv',

  // Long digit runs
  '123456789012',
  '1234567890123',
  '12345678901234',
  '123456789012345',
  '1234567890abcdef',
  '112233445566',
  '123123123123',
  '121212121212',
  '111111111111',
  '000000000000',
  '098765432109',
  '147258369147',

  // Common words padded to length
  'password1234',
  'password123456',
  'passwordpassword',
  'password@123456',
  'p@ssw0rd12345',
  'p@ssword12345',
  'passw0rd12345',
  'welcome123456',
  'letmein123456',
  'iloveyou12345',
  'sunshine12345',
  'princess12345',
  'football12345',
  'baseball12345',
  'superman12345',
  'batman1234567',
  'trustno1trustno1',
  'qwerty123456789',
  'admin1234567',
  'administrator',
  'administrator1',
  'changeme12345',
  'secretsecret',
  'whatever12345',
  'starwars12345',
  'pokemon123456',
  'liverpool1234',
  'manchester123',
  'chelsea123456',
  'arsenal123456',

  // Familiar passphrases
  'correcthorsebatterystaple',
  'thequickbrownfox',
  'thequickbrownfoxjumps',
  'tobeornottobe',
  'letmeinplease',
  'openthedoorplease',
  'iamnotarobot123',
  'thisisapassword',
  'thisismypassword',
  'mypasswordis123',
  'nobodywillguessthis',
  'youwillneverguess',
  'ihatepasswords',
  'ilovepasswords',
  'passwordisapassword',
  'nothingtoseehere',
  'allyourbasearebelongtous',
  'winteriscoming',
  'maytheforcebewithyou',
  'thereisnospoon',
  'hunter2hunter2',
  'iloveyouforever',
  'jesusislord123',
  'godisgood1234',
  'familyfirst123',

  // India-specific patterns common in local breach data
  'bharatmatakijai',
  'jaishreeram123',
  'indiaindia123',
  'mumbai1234567',
  'delhi12345678',
  'chennai123456',
  'bangalore1234',
  'hyderabad1234',
  'sachintendulkar',
  'cricket123456',

  // Application-flavoured guesses
  'financeos1234',
  'financeospassword',
  'moneymoney123',
  'mymoneymymoney',
  'bankaccount123',
  'investment123456',
  'portfolio12345',
] as const;

export const COMMON_PASSWORDS: ReadonlySet<string> = new Set(ENTRIES);
