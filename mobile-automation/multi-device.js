const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { TARGET_URL, MOBILE_DEVICES, AUTOMATION_CONFIG } = require('./config');

const screenshotDir = path.resolve(__dirname, AUTOMATION_CONFIG.screenshotDir);
if (!fs.existsSync(screenshotDir)) fs.mkdirSync(screenshotDir, { recursive: true });

function log(deviceName, msg) {
  console.log(`[${new Date().toISOString()}] [${deviceName}] ${msg}`);
}

async function runOnDevice(browser, deviceName, deviceConfig) {
  const context = await browser.newContext({
    ...deviceConfig,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  });
  context.setDefaultTimeout(AUTOMATION_CONFIG.timeout);
  const page = await context.newPage();

  const result = { device: deviceName, url: TARGET_URL, screenshots: [], error: null };

  try {
    log(deviceName, `Navigating to ${TARGET_URL}...`);
    await page.goto(TARGET_URL, { waitUntil: 'domcontentloaded', timeout: AUTOMATION_CONFIG.navigationTimeout });
    await page.waitForLoadState('networkidle').catch(() => {});

    const safeName = deviceName.replace(/\s+/g, '_').toLowerCase();
    const screenshotPath = path.join(screenshotDir, `${safeName}-fullpage.png`);
    await page.screenshot({ path: screenshotPath, fullPage: true });
    result.screenshots.push(screenshotPath);
    log(deviceName, `Screenshot saved: ${path.basename(screenshotPath)}`);

    result.title = await page.title();
    result.viewport = deviceConfig.viewport;

    // Scroll test
    await page.evaluate(() => window.scrollTo({ top: 500, behavior: 'smooth' }));
    await page.waitForTimeout(700);

    const scrollPath = path.join(screenshotDir, `${safeName}-scroll.png`);
    await page.screenshot({ path: scrollPath, fullPage: false });
    result.screenshots.push(scrollPath);

    log(deviceName, `Done. Title: "${result.title}"`);

  } catch (err) {
    result.error = err.message;
    log(deviceName, `ERROR: ${err.message}`);
    await page.screenshot({
      path: path.join(screenshotDir, `${deviceName.replace(/\s+/g, '_').toLowerCase()}-error.png`),
    }).catch(() => {});
  } finally {
    await context.close();
  }

  return result;
}

async function runAllDevices() {
  console.log(`\nStarting multi-device automation for ${TARGET_URL}`);
  console.log(`Devices: ${Object.keys(MOBILE_DEVICES).join(', ')}\n`);

  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_BROWSERS_PATH
      ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`
      : undefined,
    headless: AUTOMATION_CONFIG.headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const results = [];

  for (const [name, config] of Object.entries(MOBILE_DEVICES)) {
    const result = await runOnDevice(browser, name, config);
    results.push(result);
  }

  await browser.close();

  const reportPath = path.join(__dirname, 'multi-device-report.json');
  fs.writeFileSync(reportPath, JSON.stringify(results, null, 2));

  console.log('\n=== MULTI-DEVICE SUMMARY ===');
  for (const r of results) {
    const status = r.error ? `FAILED: ${r.error}` : `OK - "${r.title}"`;
    console.log(`  ${r.device} (${r.viewport?.width}x${r.viewport?.height}): ${status}`);
  }
  console.log(`Report: ${reportPath}`);
  console.log('============================\n');
}

runAllDevices().catch(err => {
  console.error('Multi-device run failed:', err.message);
  process.exit(1);
});
