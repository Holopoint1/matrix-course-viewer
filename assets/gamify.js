/* Matrix LMS — gamification layer
 * Provides:
 *  - Achievement evaluation + persistence
 *  - Completion toasts (dopamine feedback)
 *  - Achievement-unlock confetti + slide-in toast
 *  - Streak tracking (distinct days)
 *  - Course-visit tracking
 */
window.Gamify = (function () {
  'use strict';

  const PROGRESS_PREFIX = 'matrix-lms:progress:';
  const UNLOCKED_KEY = 'matrix-lms:unlocked';
  const VISITED_KEY = 'matrix-lms:visited-courses';
  const STREAK_KEY = 'matrix-lms:streak';
  const COMPLIMENTS = [
    'Nice!', 'Smashed it!', 'Keep going!', 'Boom!', 'Locked in!',
    'On fire!', 'Brilliant!', 'Onto the next!', '+1 XP', 'Crushing it!'
  ];

  let achievementDefs = null;
  let coursesData = null;

  /* ---------- Public API ---------- */
  async function init() {
    if (!achievementDefs) {
      const [a, c] = await Promise.all([
        fetch('data/achievements.json').then((r) => r.json()),
        fetch('data/courses.json').then((r) => r.json())
      ]);
      achievementDefs = a.achievements;
      coursesData = c.courses;
    }
    bumpStreak();
    ensureToastRoot();
  }

  function trackCourseVisit(courseId) {
    const v = JSON.parse(localStorage.getItem(VISITED_KEY) || '[]');
    if (!v.includes(courseId)) {
      v.push(courseId);
      localStorage.setItem(VISITED_KEY, JSON.stringify(v));
    }
  }

  function onComplete(courseId, screen) {
    if (!achievementDefs) return;
    showCompletionToast(screen);
    pulseAnyActive();
    const newly = evaluateAndPersist();
    newly.forEach((a, i) => setTimeout(() => unlockAchievement(a), 600 + i * 1200));
  }

  function onUncomplete(courseId, screen) {
    /* No toast on uncomplete — but re-evaluate to potentially lock back if you wanted; here we keep unlocks permanent */
  }

  function getAchievements() {
    return achievementDefs || [];
  }

  function isUnlocked(id) {
    const u = JSON.parse(localStorage.getItem(UNLOCKED_KEY) || '{}');
    return Boolean(u[id]);
  }

  function getStats() {
    return computeStats();
  }

  /* ---------- Stats ---------- */
  function computeStats() {
    const courseStats = {};
    let totalCompleted = 0;
    let documentsCompleted = 0;
    const coursesWithTicks = new Set();
    const coursesWithDocTicks = new Set();
    const tierTicks = { bronze: 0, silver: 0, gold: 0 };

    for (const course of (coursesData || [])) {
      const progress = JSON.parse(localStorage.getItem(PROGRESS_PREFIX + course.id) || '{}');
      let cdone = 0;
      let cdoneDocs = 0;
      for (const screen of course.screens) {
        if (progress[screen.id]) {
          totalCompleted += 1;
          cdone += 1;
          coursesWithTicks.add(course.id);
          if (screen.type === 'document') {
            documentsCompleted += 1;
            cdoneDocs += 1;
            coursesWithDocTicks.add(course.id);
          }
          const tier = inferTier(screen);
          if (tier) tierTicks[tier] = (tierTicks[tier] || 0) + 1;
        }
      }
      courseStats[course.id] = {
        completed: cdone,
        total: course.screens.length,
        pct: course.screens.length ? Math.round((cdone / course.screens.length) * 100) : 0,
        documentsCompleted: cdoneDocs
      };
    }

    const visited = JSON.parse(localStorage.getItem(VISITED_KEY) || '[]');
    const coursesDone = Object.values(courseStats).filter((s) => s.pct === 100 && s.total > 0).length;
    const anyCoursePct = Math.max(0, ...Object.values(courseStats).map((s) => s.pct));
    const totalUniqueDocs = sumUniqueDocsByTier();

    return {
      totalCompleted,
      documentsCompleted,
      coursesVisited: visited.length,
      coursesWithTicks: coursesWithTicks.size,
      coursesWithDocTicks: coursesWithDocTicks.size,
      coursesDone,
      anyCoursePct,
      tierTicks,
      tierDone: {
        bronze: tierTicks.bronze >= totalUniqueDocs.bronze && totalUniqueDocs.bronze > 0,
        silver: tierTicks.silver >= totalUniqueDocs.silver && totalUniqueDocs.silver > 0,
        gold:   tierTicks.gold   >= totalUniqueDocs.gold   && totalUniqueDocs.gold   > 0
      },
      tierTrifecta: tierTicks.bronze > 0 && tierTicks.silver > 0 && tierTicks.gold > 0,
      courseStats
    };
  }

  function sumUniqueDocsByTier() {
    /* Count distinct tier worksheets that exist anywhere in coursesData */
    const tally = { bronze: new Set(), silver: new Set(), gold: new Set() };
    for (const course of (coursesData || [])) {
      for (const screen of course.screens) {
        if (screen.type !== 'document') continue;
        if (screen.missing) continue;
        const t = inferTier(screen);
        if (t && tally[t]) tally[t].add(screen.src);
      }
    }
    return { bronze: tally.bronze.size, silver: tally.silver.size, gold: tally.gold.size };
  }

  /* ---------- Tier inference (from filename) ---------- */
  function inferTier(screen) {
    const src = String(screen.src || '');
    /* CP4807 worksheets: 1-7 = bronze, 8-10 = silver, 11-12 = gold */
    let m = src.match(/CP4807-(\d+)\.docx$/i);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 7) return 'bronze';
      if (n >= 8 && n <= 10) return 'silver';
      if (n >= 11 && n <= 12) return 'gold';
    }
    /* CP1972 sensors: 1-5 = bronze, 6 = silver, 7+ = gold */
    m = src.match(/CP1972-(\d+)\.docx$/i);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 5) return 'bronze';
      if (n === 6) return 'silver';
      if (n >= 7) return 'gold';
    }
    /* CP0507 motors: 1-4 = bronze, 5 = gold */
    m = src.match(/CP0507-(\d+)\.docx$/i);
    if (m) {
      const n = Number(m[1]);
      if (n >= 1 && n <= 4) return 'bronze';
      if (n === 5) return 'gold';
    }
    return null;
  }

  /* Section for sidebar grouping (broader than tier) */
  function inferSection(screen) {
    const tier = inferTier(screen);
    if (tier) return tier;
    const title = String(screen.title || '').toLowerCase();
    if (screen.type === 'document') return 'bronze'; /* fallback for any doc not matched */
    if (/assessment/.test(title)) return 'assessment';
    if (/homework/.test(title)) return 'homework';
    return 'intro';
  }

  /* ---------- Evaluation ---------- */
  function evaluateAndPersist() {
    const unlocked = JSON.parse(localStorage.getItem(UNLOCKED_KEY) || '{}');
    const stats = computeStats();
    const newlyUnlocked = [];
    for (const ach of achievementDefs) {
      if (unlocked[ach.id]) continue;
      if (passes(ach.test, stats)) {
        unlocked[ach.id] = { ts: Date.now() };
        newlyUnlocked.push(ach);
      }
    }
    localStorage.setItem(UNLOCKED_KEY, JSON.stringify(unlocked));
    return newlyUnlocked;
  }

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
        case 'hintsRevealed':        return false; /* hint feature not yet implemented */
        case 'rapidStreak':          return false; /* TODO */
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

  /* ---------- Streaks (distinct calendar days) ---------- */
  function bumpStreak() {
    const today = todayKey();
    let s = JSON.parse(localStorage.getItem(STREAK_KEY) || 'null') || { last: null, days: 0, longest: 0 };
    if (s.last === today) return s;
    if (s.last && isYesterday(s.last)) {
      s.days = (s.days || 0) + 1;
    } else {
      s.days = 1;
    }
    s.last = today;
    s.longest = Math.max(s.longest || 0, s.days);
    localStorage.setItem(STREAK_KEY, JSON.stringify(s));
    return s;
  }
  function getStreak() {
    return JSON.parse(localStorage.getItem(STREAK_KEY) || 'null') || { last: null, days: 0, longest: 0 };
  }
  function todayKey() {
    const d = new Date();
    return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0');
  }
  function isYesterday(key) {
    const y = new Date();
    y.setDate(y.getDate() - 1);
    return key === (y.getFullYear() + '-' + String(y.getMonth() + 1).padStart(2, '0') + '-' + String(y.getDate()).padStart(2, '0'));
  }

  /* ---------- Toasts & confetti ---------- */
  function ensureToastRoot() {
    if (document.getElementById('gamify-toast-root')) return;
    const root = document.createElement('div');
    root.id = 'gamify-toast-root';
    root.className = 'toast-root';
    document.body.appendChild(root);
  }

  function showCompletionToast(screen) {
    const root = document.getElementById('gamify-toast-root');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'toast toast-complete';
    const compliment = COMPLIMENTS[Math.floor(Math.random() * COMPLIMENTS.length)];
    el.innerHTML = `
      <div class="toast-icon">✓</div>
      <div class="toast-body">
        <div class="toast-title">${compliment}</div>
        <div class="toast-msg">${escapeHtml(screen && screen.title || 'Challenge')} complete &middot; <strong>+1</strong></div>
      </div>
    `;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    setTimeout(() => {
      el.classList.remove('in');
      el.classList.add('out');
      setTimeout(() => el.remove(), 380);
    }, 1800);
  }

  function unlockAchievement(ach) {
    const root = document.getElementById('gamify-toast-root');
    if (!root) return;
    const el = document.createElement('div');
    el.className = 'toast toast-achievement';
    el.innerHTML = `
      <div class="toast-icon glow">${ach.icon || '🏆'}</div>
      <div class="toast-body">
        <div class="toast-eyebrow">Achievement unlocked</div>
        <div class="toast-title">${escapeHtml(ach.title)}</div>
        <div class="toast-msg">${escapeHtml(ach.desc)}</div>
      </div>
    `;
    root.appendChild(el);
    requestAnimationFrame(() => el.classList.add('in'));
    burstConfetti();
    setTimeout(() => {
      el.classList.remove('in');
      el.classList.add('out');
      setTimeout(() => el.remove(), 460);
    }, 4500);
  }

  function burstConfetti() {
    const root = document.body;
    const colors = ['#7c3aed', '#a78bfa', '#f59e0b', '#22c55e', '#ec4899', '#06b6d4'];
    for (let i = 0; i < 50; i++) {
      const piece = document.createElement('div');
      piece.className = 'confetti-piece';
      piece.style.background = colors[i % colors.length];
      piece.style.left = (45 + Math.random() * 10) + '%';
      piece.style.top = '0';
      const tx = (Math.random() - 0.5) * 800;
      const ty = 200 + Math.random() * 600;
      const rot = (Math.random() - 0.5) * 720;
      const dur = 1100 + Math.random() * 900;
      piece.style.setProperty('--tx', tx + 'px');
      piece.style.setProperty('--ty', ty + 'px');
      piece.style.setProperty('--rot', rot + 'deg');
      piece.style.animationDuration = dur + 'ms';
      root.appendChild(piece);
      setTimeout(() => piece.remove(), dur + 100);
    }
  }

  function pulseAnyActive() {
    const el = document.querySelector('.screen-item.active .screen-checkbox');
    if (!el) return;
    el.classList.remove('pulse');
    /* trigger reflow */
    void el.offsetWidth;
    el.classList.add('pulse');
  }

  function escapeHtml(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
    }[c]));
  }

  /* ---------- Time stats ---------- */
  function getCourseTime(courseId) {
    try {
      const data = JSON.parse(localStorage.getItem('matrix-lms:time:' + courseId) || '{}');
      return data;
    } catch (_) { return {}; }
  }
  function getCourseTotalSeconds(courseId) {
    const data = getCourseTime(courseId);
    return Object.values(data).reduce((a, v) => a + (Number(v) || 0), 0);
  }
  function getTotalSecondsAllCourses() {
    if (!coursesData) return 0;
    return coursesData.reduce((a, c) => a + getCourseTotalSeconds(c.id), 0);
  }
  function formatDuration(secs) {
    secs = Math.max(0, Math.floor(secs || 0));
    const h = Math.floor(secs / 3600);
    const m = Math.floor((secs % 3600) / 60);
    const s = secs % 60;
    if (h > 0) return h + 'h ' + String(m).padStart(2, '0') + 'm';
    if (m > 0) return m + 'm ' + String(s).padStart(2, '0') + 's';
    return s + 's';
  }

  /* ---------- Reset ---------- */
  function resetAll() {
    Object.keys(localStorage)
      .filter((k) => k.indexOf('matrix-lms:') === 0)
      .forEach((k) => localStorage.removeItem(k));
  }

  return {
    init,
    onComplete,
    onUncomplete,
    trackCourseVisit,
    getAchievements,
    isUnlocked,
    getStats,
    getStreak,
    inferTier,
    inferSection,
    getCourseTime,
    getCourseTotalSeconds,
    getTotalSecondsAllCourses,
    formatDuration,
    resetAll
  };
})();
