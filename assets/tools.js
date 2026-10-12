/* Shared helpers for the /tools/ calculators.
   Everything runs in the reader's browser. Nothing they type is stored or sent anywhere.
   "Keep your copy" offers two ways out:
     1. Print or save as PDF (the browser's own print dialog).
     2. Email it to yourself: opens the reader's own mail app with the plan addressed to them.
        If SUBSCRIBE_URL is set and they tick the box, ONLY their email address goes to the
        newsletter signup page. Their numbers never leave the browser either way. */
(function () {
  // Set this to the newsletter's subscribe page when it exists,
  // e.g. 'https://NAME.substack.com/subscribe'. Empty = the newsletter option stays hidden.
  const SUBSCRIBE_URL = '';

  const fmt = (n) => (n < 0 ? '−$' : '$') + Math.round(Math.abs(n)).toLocaleString('en-US');
  const pct = (n, d = 1) => (n < 0 ? '−' : '') + Math.abs(n).toFixed(d) + '%';
  const num = (el) => { const v = parseFloat((typeof el === 'string' ? document.getElementById(el) : el).value); return isFinite(v) ? v : 0; };
  const pos = (el) => Math.max(0, num(el));
  const monthLabel = (monthsFromNow) => {
    const d = new Date(); d.setDate(1); d.setMonth(d.getMonth() + monthsFromNow);
    return d.toLocaleString('en-US', { month: 'short', year: 'numeric' });
  };
  const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // getText() returns the plain-text plan; title is the email subject and the printout heading.
  function wireKeep(root, getText, title) {
    root.innerHTML =
      '<div class="label" style="margin-bottom:6px">Keep your copy</div>' +
      '<p class="small">Your numbers stay with you. I never see them.</p>' +
      '<div class="row"><button class="btn" type="button" data-act="print">Print or save as PDF</button></div>' +
      '<div class="row"><input type="email" placeholder="you@example.com" aria-label="Your email address" data-el="email">' +
      '<button class="btn solid" type="button" data-act="mail">Email me my copy</button></div>' +
      (SUBSCRIBE_URL ? '<label class="check" style="margin-top:12px"><input type="checkbox" data-el="sub" checked> <span>Also send me the free newsletter. Only your email address goes to the signup page, never your numbers. Unsubscribe anytime.</span></label>' : '') +
      '<p class="small" data-el="msg" style="margin-top:10px"></p>';
    const q = (sel) => root.querySelector(sel);
    let printout = document.getElementById('printout');
    if (!printout) { printout = document.createElement('div'); printout.id = 'printout'; document.body.appendChild(printout); }

    q('[data-act="print"]').addEventListener('click', () => {
      printout.textContent = title + '\n' + 'stephendugger.com\n\n' + getText();
      window.print();
    });
    q('[data-act="mail"]').addEventListener('click', () => {
      const email = q('[data-el="email"]').value.trim();
      const msg = q('[data-el="msg"]');
      if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) { msg.textContent = 'Enter your email address first.'; return; }
      let body = getText() + '\n\nMade with the free tools at stephendugger.com/tools/\nYour numbers were never sent anywhere. This email is from you, to you.';
      if (body.length > 1800) body = body.slice(0, 1780) + '\n[...] Use "Print or save as PDF" for the full plan.';
      if (SUBSCRIBE_URL && q('[data-el="sub"]') && q('[data-el="sub"]').checked) {
        window.open(SUBSCRIBE_URL + '?email=' + encodeURIComponent(email), '_blank', 'noopener');
      }
      window.location.href = 'mailto:' + encodeURIComponent(email) + '?subject=' + encodeURIComponent(title) + '&body=' + encodeURIComponent(body);
      msg.textContent = 'Your mail app should open with your plan addressed to you. Hit send to keep it.';
    });
  }

  window.Tools = { fmt, pct, num, pos, monthLabel, esc, wireKeep };
})();
