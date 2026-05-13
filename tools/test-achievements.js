/* End-to-end audit: walks every achievement definition and checks whether
 * a hand-crafted stats object would unlock it. Uses the same `passes()`
 * logic as gamify.js (re-implemented inline so this script needs no DOM).
 * Run: node tools/test-achievements.js
 */
const fs = require('fs');
const path = require('path');

const defs = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'data', 'achievements.json'), 'utf8')).achievements;

function passes(test, s) {
  if (!test) return false;
  if (test.includes('>=')) {
    const [key, val] = test.split('>=').map((x) => x.trim());
    const v = Number(val);
    switch (key) {
      case 'totalCompleted':       return s.totalCompleted >= v;
      case 'documentsCompleted':   return s.documentsCompleted >= v;
      case 'coursesVisited':       return s.coursesVisited >= v;
      case 'coursesWithTicks':     return s.coursesWithTicks >= v;
      case 'coursesWithDocTicks':  return s.coursesWithDocTicks >= v;
      case 'coursesDone':          return s.coursesDone >= v;
      case 'anyCourse':            return s.anyCoursePct >= v;
      case 'hintsRevealed':        return s.hintsRevealed >= v;
      case 'rapidStreak':          return s.rapidStreak >= v;
      default: return false;
    }
  }
  if (test.startsWith('tierDone:')) {
    const t = test.slice('tierDone:'.length);
    return Boolean(s.tierDone[t]);
  }
  if (test.startsWith('courseDone:')) {
    const id = test.slice('courseDone:'.length);
    return s.courseStats[id] && s.courseStats[id].pct === 100;
  }
  if (test === 'tierTrifecta') return s.tierTrifecta;
  return false;
}

/* Generate a stats object that triggers a specific achievement. */
function statsFor(achievementId) {
  const base = {
    totalCompleted: 0, documentsCompleted: 0, coursesVisited: 0,
    coursesWithTicks: 0, coursesWithDocTicks: 0, coursesDone: 0,
    anyCoursePct: 0, tierTicks: { bronze: 0, silver: 0, gold: 0 },
    tierDone: { bronze: false, silver: false, gold: false },
    tierTrifecta: false, rapidStreak: 0, hintsRevealed: 0,
    courseStats: {}
  };
  switch (achievementId) {
    case 'first_steps':      base.totalCompleted = 1; break;
    case 'getting_started':  base.totalCompleted = 5; break;
    case 'page_turner':      base.documentsCompleted = 1; break;
    case 'hint_seeker':      base.hintsRevealed = 1; break;
    case 'on_a_roll':        base.rapidStreak = 3; break;
    case 'halfway_there':    base.anyCoursePct = 50; break;
    case 'bronze_champion':  base.tierDone.bronze = true; break;
    case 'silver_champion':  base.tierDone.silver = true; break;
    case 'gold_champion':    base.tierDone.gold = true; break;
    case 'tier_trifecta':    base.tierTrifecta = true; break;
    case 'perfectionist':    base.anyCoursePct = 100; break;
    case 'course_master':    base.anyCoursePct = 100; break;
    case 'explorer':         base.coursesVisited = 2; break;
    case 'multi_discipline': base.coursesWithTicks = 2; break;
    case 'double_trouble':   base.coursesWithDocTicks = 2; break;
    case 'embedded_expert':  base.courseStats['CO0002'] = { pct: 100, total: 1 }; break;
    case 'aviation_ace':     base.courseStats['CO0003'] = { pct: 100, total: 1 }; break;
    case 'course_collector': base.coursesDone = 2; break;
    case 'dedicated':        base.totalCompleted = 50; break;
    case 'century_club':     base.totalCompleted = 100; break;
  }
  return base;
}

let failures = 0;
console.log('Auditing ' + defs.length + ' achievements:\n');
for (const a of defs) {
  const ok = passes(a.test, statsFor(a.id));
  const tag = ok ? '✓ FIRES   ' : '✗ BROKEN  ';
  if (!ok) failures += 1;
  console.log(tag + a.id.padEnd(18) + ' | test=' + a.test);
}
console.log('\n' + (failures === 0 ? 'ALL ACHIEVEMENTS WIRED ✓' : failures + ' BROKEN'));
process.exit(failures === 0 ? 0 : 1);
