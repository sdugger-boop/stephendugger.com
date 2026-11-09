/* CalPERS Leave Date: the calculation engine for /tools/calpers-leave-date/.
   Public version of tools/retirement-paths/leave.py, with every input typed in by the reader.
   Pure functions, no DOM. Runs in the browser (window.CalpersLeave) and under node for tests
   (tools/website/tests/calpers-leave.test.js). Nothing is stored or sent anywhere.

   Sources (checked 2026-11-09):
   - Benefit factors: CalPERS "Retirement Formulas and Benefit Factors, Local Safety Members" charts
     for 2.7%@57, 2.5%@57, 2%@57 (PEPRA) and 3%@50, 3%@55, 2%@50, 2%@55 (classic), quarter-year rows.
     Classic formulas cap at 90% of final compensation; the PEPRA charts carry no cap.
   - PEPRA pensionable pay caps, 2026: $191,679 (no Social Security), $159,733 (with Social Security),
     CalPERS Circular Letter 200-001-26.
   - Retiree health: GC 22893 vesting (0 under 10 credited years, 50% at 10, +5%/yr, 100% at 20,
     at least 5 years with the agency retired from). PEMHCA minimum $162/mo in 2026 (Circular Letter
     600-023-25). The 120-day separation-to-retirement rule: CalPERS Health Program Guide.
   - Sick leave: 2,000 hours = 1 year of service credit, only when retiring within 120 days.
   - COLA: first paid May 1 of the second calendar year after retirement (PUB 1 / PUB 5). */
(function (root) {
  'use strict';

  // Quarter-year factor rows (% of pay per year of service), age 50 up to the formula's top age.
  const FORMULAS = {
    p27: { name: 'PEPRA 2.7% at 57', pepra: true, cap: null, rows: {
      50: [2.000, 2.025, 2.050, 2.075], 51: [2.100, 2.125, 2.150, 2.175], 52: [2.200, 2.225, 2.250, 2.275],
      53: [2.300, 2.325, 2.350, 2.375], 54: [2.400, 2.425, 2.450, 2.475], 55: [2.500, 2.525, 2.550, 2.575],
      56: [2.600, 2.625, 2.650, 2.675], 57: [2.700, 2.700, 2.700, 2.700] } },
    p25: { name: 'PEPRA 2.5% at 57', pepra: true, cap: null, rows: {
      50: [2.000, 2.018, 2.036, 2.054], 51: [2.071, 2.089, 2.107, 2.125], 52: [2.143, 2.161, 2.179, 2.196],
      53: [2.214, 2.232, 2.250, 2.268], 54: [2.286, 2.304, 2.321, 2.339], 55: [2.357, 2.375, 2.393, 2.411],
      56: [2.429, 2.446, 2.464, 2.482], 57: [2.500, 2.500, 2.500, 2.500] } },
    p20: { name: 'PEPRA 2% at 57', pepra: true, cap: null, rows: {
      50: [1.426, 1.447, 1.467, 1.488], 51: [1.508, 1.529, 1.549, 1.570], 52: [1.590, 1.611, 1.631, 1.652],
      53: [1.672, 1.693, 1.713, 1.734], 54: [1.754, 1.775, 1.795, 1.816], 55: [1.836, 1.857, 1.877, 1.898],
      56: [1.918, 1.939, 1.959, 1.980], 57: [2.000, 2.000, 2.000, 2.000] } },
    c350: { name: 'Classic 3% at 50', pepra: false, cap: 90, rows: {
      50: [3.000, 3.000, 3.000, 3.000] } },
    c355: { name: 'Classic 3% at 55', pepra: false, cap: 90, rows: {
      50: [2.400, 2.430, 2.460, 2.490], 51: [2.520, 2.550, 2.580, 2.610], 52: [2.640, 2.670, 2.700, 2.730],
      53: [2.760, 2.790, 2.820, 2.850], 54: [2.880, 2.910, 2.940, 2.970], 55: [3.000, 3.000, 3.000, 3.000] } },
    c250: { name: 'Classic 2% at 50', pepra: false, cap: 90, rows: {
      50: [2.000, 2.035, 2.070, 2.105], 51: [2.140, 2.175, 2.210, 2.245], 52: [2.280, 2.315, 2.350, 2.385],
      53: [2.420, 2.455, 2.490, 2.525], 54: [2.560, 2.595, 2.630, 2.665], 55: [2.700, 2.700, 2.700, 2.700] } },
    c255: { name: 'Classic 2% at 55', pepra: false, cap: 90, rows: {
      50: [1.426, 1.450, 1.474, 1.498], 51: [1.522, 1.550, 1.576, 1.602], 52: [1.628, 1.656, 1.686, 1.714],
      53: [1.742, 1.772, 1.804, 1.834], 54: [1.866, 1.900, 1.932, 1.966], 55: [2.000, 2.000, 2.000, 2.000] } },
  };
  const PEPRA_CAP_2026 = { noSS: 191679, ss: 159733 };   // annual pensionable pay
  const PEMHCA_MIN_2026 = 162;
  const HEALTH_BASE_2026 = 1084;                          // 100/90 single amount, 2026
  const DAY = 86400000;

  // ---- dates (all UTC, day precision) ----
  function parse(s) {
    if (!s) return null;
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(s).trim());
    if (!m) return null;
    const d = new Date(Date.UTC(+m[1], +m[2] - 1, +m[3]));
    return isNaN(d) ? null : d;
  }
  const iso = (d) => d.toISOString().slice(0, 10);
  function addMonths(d, n) {
    const y = d.getUTCFullYear(), m = d.getUTCMonth() + n, day = d.getUTCDate();
    const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
    return new Date(Date.UTC(y, m, Math.min(day, last)));
  }
  const addDays = (d, n) => new Date(d.getTime() + n * DAY);
  const daysBetween = (a, b) => Math.round((b - a) / DAY);
  // Completed whole months from a to b.
  function monthsBetween(a, b) {
    let m = (b.getUTCFullYear() - a.getUTCFullYear()) * 12 + (b.getUTCMonth() - a.getUTCMonth());
    if (b.getUTCDate() < a.getUTCDate()) m -= 1;
    return m;
  }
  function ageParts(birth, d) {
    const m = monthsBetween(birth, d);
    return { years: Math.floor(m / 12), quarter: Math.floor((m % 12) / 3), exact: m / 12 };
  }
  const birthday = (birth, age) => addMonths(birth, 12 * age);
  // Calendar years from a to b: whole months, plus the days into the next month as a fraction.
  // A full-time anniversary lands on an exact whole year.
  function calYears(a, b) {
    if (b < a) return -calYears(b, a);
    const m = monthsBetween(a, b), from = addMonths(a, m), next = addMonths(a, m + 1);
    return (m + (b - from) / (next - from)) / 12;
  }
  // The date on which calYears(a, d) reaches y.
  function afterYears(a, y) {
    const m = Math.floor(y * 12 + 1e-9), from = addMonths(a, m), next = addMonths(a, m + 1);
    return new Date(from.getTime() + Math.ceil((y * 12 - m) * (next - from) / DAY - 1e-9) * DAY);
  }

  // ---- the pieces ----
  function factor(formula, birth, retire) {
    const f = FORMULAS[formula], a = ageParts(birth, retire);
    if (a.years < 50) return 0;
    const ages = Object.keys(f.rows).map(Number), top = Math.max.apply(null, ages);
    return a.years >= top ? f.rows[top][0] : f.rows[a.years][a.quarter];
  }
  // Credited service at date d, assuming full-time work from the statement date on.
  // After separation, service stops growing.
  function credit(inp, d) {
    const end = inp.sep && d > inp.sep ? inp.sep : d;
    return Math.max(0, inp.credit + calYears(inp.creditAsOf, end));
  }
  // Monthly pensionable pay in effect on date d (today's pay times any steps already reached).
  function payAt(inp, d) {
    let p = inp.pay;
    (inp.steps || []).forEach((s) => { if (s.date && d >= s.date) p *= 1 + s.pct / 100; });
    return p;
  }
  // Final compensation (monthly): the average of the last N months before separation.
  // Pay only rises in this model, so the last N months are the highest N.
  function finalComp(inp, sep) {
    const n = inp.compMonths || 36;
    let sum = 0;
    for (let k = 1; k <= n; k++) sum += payAt(inp, addMonths(sep, -k));
    let fc = sum / n;
    if (FORMULAS[inp.formula].pepra) {
      const cap = (inp.socialSecurity ? PEPRA_CAP_2026.ss : PEPRA_CAP_2026.noSS) / 12;
      fc = Math.min(fc, cap);
    }
    return fc;
  }
  function vest22893(years) {
    if (years < 10) return 0;
    return Math.min(1, 0.5 + 0.05 * Math.floor(years - 10 + 1e-9));
  }

  // One plan: separate on `sep`, start the pension on `ret` (same day or later).
  function outcome(inp, sep, ret) {
    ret = ret && ret > sep ? ret : sep;
    const x = Object.assign({}, inp, { sep: sep });
    const age = ageParts(inp.birth, ret), ageSep = ageParts(inp.birth, sep);
    const gap = daysBetween(sep, ret);
    const canRetire = age.years >= 50;
    const within120 = gap <= 120;
    const years = credit(x, sep);
    const sickYears = canRetire && within120 ? (inp.sickHours || 0) / 2000 : 0;
    const f = canRetire ? factor(inp.formula, inp.birth, ret) : 0;
    let pctOfPay = f * (years + sickYears);
    const cap = FORMULAS[inp.formula].cap;
    const capped = cap !== null && pctOfPay > cap;
    if (capped) pctOfPay = cap;
    const fc = finalComp(x, sep);
    const pension = pctOfPay / 100 * fc;

    // Retiree health: only if the pension starts within 120 days of separating.
    const keepsHealth = canRetire && within120 && inp.healthType !== 'none';
    const agencyYears = inp.agencyHire ? calYears(inp.agencyHire, sep) : null;
    let healthPct = 0, healthShare = 0;
    if (keepsHealth) {
      if (inp.healthType === '22893') {
        healthPct = agencyYears !== null && agencyYears < 5 ? 0 : vest22893(years);
        healthShare = healthPct * inp.healthBase;
      } else if (inp.healthType === 'flat') {
        healthShare = inp.healthFlat || 0;
        healthPct = inp.healthBase ? healthShare / inp.healthBase : 0;
      } else if (inp.healthType === 'min') {
        healthShare = PEMHCA_MIN_2026;
        healthPct = inp.healthBase ? healthShare / inp.healthBase : 0;
      }
    }
    return {
      sep: sep, ret: ret, gap: gap, age: age, ageSep: ageSep, canRetire: canRetire, within120: within120,
      years: years, sickYears: sickYears, factor: f, pctOfPay: pctOfPay, capped: capped, finalComp: fc,
      pension: pension, keepsHealth: keepsHealth, agencyYears: agencyYears, healthPct: healthPct,
      healthShare: healthShare, total: pension + healthShare,
    };
  }

  // Dates in (from, to] where something steps up: age-factor quarters, age 50, health-vesting years,
  // 5 years with the agency, pay steps. Each with a plain-words reason.
  function stepDates(inp, from, to) {
    const ev = [];
    const push = (d, why) => { if (d > from && d <= to) ev.push({ date: d, why: why }); };
    const f = FORMULAS[inp.formula];
    const top = Math.max.apply(null, Object.keys(f.rows).map(Number));
    for (let q = 50 * 4; q <= top * 4; q++) {
      const d = addMonths(inp.birth, q * 3), a = Math.floor(q / 4), qq = q % 4;
      if (a >= top && qq > 0) break;
      const val = a >= top ? f.rows[top][0] : f.rows[a][qq];
      push(d, a === 50 && qq === 0 ? 'You turn 50: the earliest you can retire' : 'Age factor rises to ' + val.toFixed(3) + '%');
    }
    if (inp.healthType === '22893') {
      for (let y = 10; y <= 20; y++) {
        const d = afterYears(inp.creditAsOf, y - inp.credit);
        push(d, y + ' years of service: health share ' + Math.round(vest22893(y) * 100) + '%');
      }
      if (inp.agencyHire) push(addMonths(inp.agencyHire, 60), '5 years with your agency (needed for the health share)');
    }
    (inp.steps || []).forEach((s) => { if (s.date) push(s.date, 'Pay step +' + s.pct + '% (enters your final compensation a month at a time)'); });
    ev.sort((a, b) => a.date - b.date);
    // Merge same-day events.
    const out = [];
    ev.forEach((e) => {
      const last = out[out.length - 1];
      if (last && iso(last.date) === iso(e.date)) last.why += '; ' + e.why.charAt(0).toLowerCase() + e.why.slice(1);
      else out.push({ date: e.date, why: e.why });
    });
    return out;
  }

  // Lifetime streams: when does a later, bigger pension catch up with an earlier, smaller one?
  // COLA first paid May 1 of the second calendar year after the start, then every May.
  function catchUp(birth, startA, amtA, startB, amtB, cola) {
    if (!(amtB > amtA) || !(startB > startA)) return null;
    const colaFactor = (start, d) => {
      let n = 0;
      for (let y = start.getUTCFullYear() + 2; ; y++) {
        const may = new Date(Date.UTC(y, 4, 1));
        if (may > d) break;
        n++;
      }
      return Math.pow(1 + cola, n);
    };
    let cumA = 0, cumB = 0;
    for (let d = new Date(startA.getTime()); ageParts(birth, d).exact < 110; d = addMonths(d, 1)) {
      cumA += amtA * colaFactor(startA, d);
      if (d >= startB) cumB += amtB * colaFactor(startB, d);
      if (d >= startB && cumB >= cumA) return { date: d, age: ageParts(birth, d).exact };
    }
    return null;
  }

  // Everything the page shows, from one set of inputs.
  function run(inp) {
    const plan = outcome(inp, inp.sep, inp.ret);
    const warnings = [];
    if (!plan.canRetire) {
      warnings.push(plan.ageSep.years < 50 && plan.age.years < 50
        ? 'You would be under 50 on your retirement date. A safety member can\'t retire for service before 50, so this plan can\'t start a pension on that date.'
        : 'Your pension can\'t start before 50.');
    }
    if (plan.ageSep.years < 50 && daysBetween(inp.sep, birthday(inp.birth, 50)) > 120) {
      warnings.push('You would separate before 50 and can\'t retire within 120 days, so CalPERS retiree health is gone for good (unless you go to another CalPERS employer and retire from there). Your pension waits, and can start at 50 or later.');
    } else if (!plan.within120) {
      warnings.push('Your retirement date is ' + plan.gap + ' days after you separate. Over 120 days, CalPERS retiree health ends for good and can\'t be reinstated. Your unused sick leave also stops counting.');
    }
    if (inp.healthType === '22893' && plan.keepsHealth) {
      if (plan.agencyYears !== null && plan.agencyYears < 5) warnings.push('You\'d have under 5 years with your agency, so GC 22893 pays no health share even with 10+ years of total service.');
      else if (plan.years < 10) warnings.push('You\'d have under 10 years of credited service, so the GC 22893 health share is zero.');
    }
    if (plan.capped) warnings.push('You hit the 90% maximum for your formula. More years add nothing to the pension.');

    // Steps in the 12 months after your separation date (same gap to retirement as your plan).
    const gapDays = plan.gap;
    const steps = stepDates(inp, inp.sep, addMonths(inp.sep, 12)).map((e) => {
      const o = outcome(inp, e.date, addDays(e.date, gapDays));
      return { date: e.date, why: e.why, outcome: o, gain: o.total - plan.total, gainPension: o.pension - plan.pension, gainHealth: o.healthShare - plan.healthShare };
    });

    // Keep working to each birthday from 50 to 57 (separate and retire the same day).
    const table = [];
    for (let a = 50; a <= 57; a++) {
      const d = birthday(inp.birth, a);
      if (d < inp.today) continue;
      table.push(Object.assign({ label: 'Age ' + a }, outcome(inp, d, d)));
    }

    // Retire on your date vs leave the money and start it at 57.
    let defer = null;
    if (plan.canRetire && plan.age.years < 57) {
      const at57 = birthday(inp.birth, 57);
      const later = outcome(inp, inp.sep, at57);
      defer = { now: plan, later: later,
        catchFlat: catchUp(inp.birth, plan.ret, plan.pension, later.ret, later.pension, 0),
        catchCola: catchUp(inp.birth, plan.ret, plan.pension, later.ret, later.pension, inp.cola / 100) };
    }

    // Side income needed after leaving, if bills are given.
    let need = null;
    if (inp.bills > 0) {
      // The month after you leave: the pension counts only if it has started (retire the day you separate).
      const healthYouPay = Math.max(0, inp.healthBase - plan.healthShare);
      const pensionNow = plan.canRetire && plan.gap === 0 ? plan.pension : 0;
      const netNeed = Math.max(0, inp.bills + healthYouPay - pensionNow);
      need = { bills: inp.bills, healthYouPay: healthYouPay, pension: pensionNow, net: netNeed,
        grossMonth: netNeed / (inp.keep / 100), grossYear: netNeed / (inp.keep / 100) * 12, waitingOnPension: !pensionNow };
    }
    return { plan: plan, warnings: warnings, steps: steps, table: table, defer: defer, need: need };
  }

  const api = { FORMULAS, PEPRA_CAP_2026, PEMHCA_MIN_2026, HEALTH_BASE_2026, parse, iso, addMonths, addDays,
    daysBetween, ageParts, birthday, calYears, afterYears, factor, credit, payAt, finalComp, vest22893, outcome, stepDates, catchUp, run };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.CalpersLeave = api;
})(typeof window !== 'undefined' ? window : this);
