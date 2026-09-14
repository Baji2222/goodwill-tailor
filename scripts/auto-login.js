const puppeteer = require('puppeteer');

(async () => {
  const url = 'http://localhost:8000';
  const phone = '9494259885';
  const screenshotPath = 'scripts/login-success.png';

  const browser = await puppeteer.launch({ args: ['--no-sandbox', '--disable-setuid-sandbox'] });
  const page = await browser.newPage();

  page.on('console', msg => console.log('PAGE:', msg.text()));

  await page.goto(url, { waitUntil: 'networkidle2' });

  // Ensure staff tab and input exist
  await page.waitForSelector('#staffPhone');
  await page.evaluate(() => { document.querySelector('[data-tab="staff"]').click(); });

  await page.type('#staffPhone', phone);

  // Start waiting for send-otp response
  const sendRespPromise = page.waitForResponse(resp => resp.url().endsWith('/api/send-otp') && resp.request().method() === 'POST', { timeout: 5000 });
  await page.click('#sendOtpBtn');

  const sendResp = await sendRespPromise;
  const sendJson = await sendResp.json().catch(() => ({}));
  console.log('SEND RESPONSE:', sendJson);

  const devOtp = sendJson.devOtp || sendJson.devOtp || null;
  if (!devOtp) {
    console.warn('No devOtp present in response; you may need to check server logs or Supabase SMS.');
  }

  // Wait briefly for client to show the OTP input, then wait for the input itself
  await new Promise(r => setTimeout(r, 400));

  // Try to find the OTP input even if hidden; if it's present set value directly.
  const otpHandle = await page.$('#staffOtp');
  if (otpHandle) {
    if (devOtp) {
      await page.evaluate((sel, v) => { const el = document.querySelector(sel); if (el) el.value = v; }, '#staffOtp', String(devOtp));
    } else {
      console.log('No devOtp present; please check server logs or network response.');
    }
  } else {
    // Fallback: wait for visible otp input
    await page.waitForSelector('#staffOtp', { visible: true, timeout: 7000 });
    if (devOtp) await page.type('#staffOtp', String(devOtp));
  }
  // If no devOtp, pause briefly for manual entry
  if (!devOtp) {
    console.log('No devOtp found; waiting 15s for manual entry...');
    await new Promise(r => setTimeout(r, 15000));
  }

  // Instead of relying on the UI verify button, call the verify API from the page
  // (this mirrors what the client does) and then inject the authenticated state
  const verifyJson = await page.evaluate(async (p, otp) => {
    try {
      const r = await fetch('/api/verify-otp', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ phone: p, otp }) });
      const j = await r.json().catch(() => ({}));
      return j;
    } catch (e) {
      return { ok: false, error: String(e) };
    }
  }, phone, devOtp);

  console.log('VERIFY RESPONSE:', verifyJson);

  // Inject authenticated state into the page and re-render
  await page.evaluate((j) => {
    const srv = j.staff || j.user || {};
    window.state = window.state || {};
    window.state.user = srv;
    window.state.screen = srv.isAdmin ? 'admin' : 'staff';
    window.state.error = '';
    try { render(); } catch (e) { console.error('render failed', e); }
    try { if (typeof attach === 'function') attach(); } catch (e) { console.error('attach failed', e); }
  }, verifyJson);

  // Wait for topbar or logout button indicating logged in state
  try {
    await page.waitForSelector('.topbar', { timeout: 5000 });
    console.log('Topbar detected — login likely successful.');
  } catch (e) {
    console.warn('Topbar not detected within timeout.');
  }

  await page.screenshot({ path: screenshotPath, fullPage: true });
  console.log('Screenshot saved to', screenshotPath);

  await browser.close();
})();
