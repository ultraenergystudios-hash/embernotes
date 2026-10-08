const assert = require('assert');
// parse.js is a browser UMD file in an ESM package, so evaluate it with a CommonJS shim
const fs = require('fs');
const path = require('path');
const mod = { exports: {} };
new Function('module', fs.readFileSync(path.join(__dirname, '../src/parse.js'), 'utf8'))(mod);
const { parse, unparse } = mod.exports;

// Wednesday 7 Oct 2026, 10:30 local
const now = new Date(2026, 9, 7, 10, 30);
const P = (s) => parse(s, { now });
const at = (y, mo, d, h = 0, m = 0) => new Date(y, mo - 1, d, h, m).toISOString();

const cases = [
  ['Buy milk', { title: 'Buy milk', due: null, remindAt: null }],
  ['Send budget to @Alex fri 14 #onboarding !', { title: 'Send budget to Alex', person: 'Alex', due: at(2026, 10, 9, 14), tags: ['onboarding'], star: true }],
  ['call IT tomorrow at 9', { title: 'Call IT', due: at(2026, 10, 8, 9), remindAt: at(2026, 10, 8, 9) }],
  ['Review top 10 risks tomorrow', { title: 'Review top 10 risks', due: at(2026, 10, 8), remindAt: null, hasTime: false }],
  ['remind me to book 1:1s next week', { title: 'Book 1:1s', due: at(2026, 10, 12), remindAt: at(2026, 10, 12, 9) }],
  ['check build in 20m', { title: 'Check build', due: new Date(now.getTime() + 20 * 6e4).toISOString() }],
  ['follow up on laptop in 2h', { title: 'Follow up on laptop', due: new Date(now.getTime() + 2 * 36e5).toISOString() }],
  ['wait: @Sam access to Jira', { title: 'Sam access to Jira', person: 'Sam', waiting: true }],
  ['prep offsite 12/10', { title: 'Prep offsite', due: at(2026, 10, 12) }],
  ['prep offsite 3 nov 13:30', { title: 'Prep offsite', due: at(2026, 11, 3, 13, 30) }],
  ['standup notes at 9', { title: 'Standup notes', due: at(2026, 10, 8, 9) }], // 9 already passed -> tomorrow
  ['pizza tonight', { title: 'Pizza', due: at(2026, 10, 7, 18) }],
  ['ring til HR i morgen kl 10', { title: 'Ring til HR', due: at(2026, 10, 8, 10) }],
  ['Q4 plan eow', { title: 'Q4 plan', due: at(2026, 10, 9, 15) }],
  ['Talk to the man about wed meeting', { title: 'Talk to the man about meeting', due: at(2026, 10, 14) }],
  ['Present at 2pm', { title: 'Present', due: at(2026, 10, 7, 14) }],
  ['1:1 with @Mary-Jo next mon 10:15', { title: '1:1 with Mary-Jo', due: at(2026, 10, 19, 10, 15) }],
];

let fail = 0;
for (const [input, exp] of cases) {
  const got = P(input);
  try {
    for (const k of Object.keys(exp)) assert.deepStrictEqual(got[k], exp[k], `${k}`);
    // round-trip
    const rt = parse(unparse(got), { now });
    for (const k of ['title', 'due', 'person', 'tags', 'star', 'waiting', 'remindAt']) assert.deepStrictEqual(rt[k], got[k], `roundtrip ${k}`);
    console.log('ok  ', input);
  } catch (e) {
    fail++;
    console.log('FAIL', input, '->', e.message, '\n     got', JSON.stringify(got));
  }
}
console.log(fail ? `${fail} failed` : 'all passed');
process.exit(fail ? 1 : 0);
