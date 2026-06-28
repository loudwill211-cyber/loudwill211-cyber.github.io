const { chromium } = require('playwright');
const path = require('path');
const fs = require('fs');
const { TARGET_URL, MOBILE_DEVICES, AUTOMATION_CONFIG } = require('./config');

const device = MOBILE_DEVICES['iPhone 14'];
const screenshotDir = path.resolve(__dirname, AUTOMATION_CONFIG.screenshotDir);

if (!fs.existsSync(screenshotDir)) {
  fs.mkdirSync(screenshotDir, { recursive: true });
}

function log(msg) {
  console.log(`[${new Date().toISOString()}] ${msg}`);
}

async function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry(fn, retries = AUTOMATION_CONFIG.retries) {
  for (let i = 0; i < retries; i++) {
    try {
      return await fn();
    } catch (err) {
      if (i === retries - 1) throw err;
      log(`Attempt ${i + 1} failed: ${err.message}. Retrying...`);
      await sleep(AUTOMATION_CONFIG.retryDelay);
    }
  }
}

async function automate() {
  log('Launching browser in mobile mode (iPhone 14)...');
  const browser = await chromium.launch({
    executablePath: process.env.PLAYWRIGHT_BROWSERS_PATH
      ? `${process.env.PLAYWRIGHT_BROWSERS_PATH}/chromium`
      : undefined,
    headless: AUTOMATION_CONFIG.headless,
    args: ['--no-sandbox', '--disable-setuid-sandbox'],
  });

  const context = await browser.newContext({
    ...device,
    locale: 'pt-BR',
    timezoneId: 'America/Sao_Paulo',
  });

  context.setDefaultTimeout(AUTOMATION_CONFIG.timeout);
  context.setDefaultNavigationTimeout(AUTOMATION_CONFIG.navigationTimeout);

  const page = await context.newPage();

  // Intercept and log requests/responses
  const requests = [];
  page.on('request', req => {
    requests.push({ url: req.url(), method: req.method(), type: req.resourceType() });
  });

  page.on('console', msg => {
    if (msg.type() === 'error') log(`[PAGE ERROR] ${msg.text()}`);
  });

  try {
    // Step 1: Navigate to the target URL
    log(`Navigating to ${TARGET_URL}...`);
    await withRetry(() => page.goto(TARGET_URL, { waitUntil: 'domcontentloaded' }));
    log('Page loaded.');

    await page.screenshot({
      path: path.join(screenshotDir, '01-initial-load.png'),
      fullPage: false,
    });
    log('Screenshot: 01-initial-load.png');

    // Step 2: Wait for page to fully render
    await page.waitForLoadState('networkidle').catch(() => {});
    await sleep(1500);

    await page.screenshot({
      path: path.join(screenshotDir, '02-after-load.png'),
      fullPage: true,
    });
    log('Screenshot: 02-after-load.png');

    // Step 3: Extract page metadata
    const meta = await page.evaluate(() => ({
      title: document.title,
      description: document.querySelector('meta[name="description"]')?.content || '',
      ogTitle: document.querySelector('meta[property="og:title"]')?.content || '',
      links: Array.from(document.querySelectorAll('a[href]'))
        .map(a => ({ text: a.innerText.trim(), href: a.href }))
        .filter(l => l.text)
        .slice(0, 20),
      images: Array.from(document.querySelectorAll('img[src]'))
        .map(img => img.src)
        .slice(0, 10),
      buttons: Array.from(document.querySelectorAll('button, [role="button"], input[type="submit"]'))
        .map(b => b.innerText?.trim() || b.value || b.getAttribute('aria-label') || '')
        .filter(Boolean),
      forms: Array.from(document.querySelectorAll('form')).map(f => ({
        action: f.action,
        method: f.method,
        fields: Array.from(f.querySelectorAll('input, select, textarea')).map(i => ({
          type: i.type,
          name: i.name,
          placeholder: i.placeholder,
        })),
      })),
    }));

    log(`Page title: "${meta.title}"`);
    log(`Links found: ${meta.links.length}`);
    log(`Buttons found: ${meta.buttons.length}`);
    log(`Forms found: ${meta.forms.length}`);

    // Step 4: Simulate mobile scroll
    log('Simulating mobile scroll...');
    await page.evaluate(() => window.scrollTo({ top: 300, behavior: 'smooth' }));
    await sleep(800);
    await page.screenshot({
      path: path.join(screenshotDir, '03-scroll-mid.png'),
      fullPage: false,
    });

    await page.evaluate(() => window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' }));
    await sleep(1000);
    await page.screenshot({
      path: path.join(screenshotDir, '04-scroll-bottom.png'),
      fullPage: false,
    });
    log('Screenshot: 04-scroll-bottom.png');

    // Step 5: Simulate touch tap on first interactive element
    const firstLink = await page.$('a[href]:not([href="#"])');
    if (firstLink) {
      const box = await firstLink.boundingBox();
      if (box) {
        log(`Tapping first link at (${Math.round(box.x + box.width / 2)}, ${Math.round(box.y + box.height / 2)})...`);
        await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
        await sleep(1500);
        await page.screenshot({
          path: path.join(screenshotDir, '05-after-tap.png'),
          fullPage: false,
        });
        log('Screenshot: 05-after-tap.png');
        await page.goBack().catch(() => {});
        await sleep(800);
      }
    }

    // Step 6: Check for login/register forms
    const loginSelectors = ['input[type="email"]', 'input[type="password"]', 'input[name="login"]', 'input[name="username"]'];
    for (const sel of loginSelectors) {
      const el = await page.$(sel);
      if (el) {
        log(`Found login field: ${sel}`);
        break;
      }
    }

    // Step 7: Save report
    const report = {
      timestamp: new Date().toISOString(),
      device: 'iPhone 14',
      url: TARGET_URL,
      finalUrl: page.url(),
      pageTitle: meta.title,
      description: meta.description,
      linksCount: meta.links.length,
      buttonsCount: meta.buttons.length,
      formsCount: meta.forms.length,
      requestsCount: requests.length,
      topLinks: meta.links.slice(0, 5),
      buttons: meta.buttons.slice(0, 10),
      networkRequests: requests
        .filter(r => ['document', 'xhr', 'fetch'].includes(r.type))
        .slice(0, 20),
      screenshots: fs.readdirSync(screenshotDir).filter(f => f.endsWith('.png')),
    };

    const reportPath = path.join(__dirname, 'report.json');
    fs.writeFileSync(reportPath, JSON.stringify(report, null, 2));
    log(`Report saved to ${reportPath}`);

    log('Automation completed successfully.');
    return report;

  } catch (err) {
    log(`ERROR: ${err.message}`);
    await page.screenshot({
      path: path.join(screenshotDir, 'error-state.png'),
      fullPage: false,
    }).catch(() => {});
    throw err;
  } finally {
    await context.close();
    await browser.close();
  }
}

automate()
  .then(report => {
    console.log('\n=== AUTOMATION SUMMARY ===');
    console.log(`URL: ${report.url}`);
    console.log(`Title: ${report.pageTitle}`);
    console.log(`Links: ${report.linksCount} | Buttons: ${report.buttonsCount} | Forms: ${report.formsCount}`);
    console.log(`Network requests: ${report.requestsCount}`);
    console.log(`Screenshots: ${report.screenshots.join(', ')}`);
    console.log('==========================\n');
  })
  .catch(err => {
    console.error('Automation failed:', err.message);
    process.exit(1);
  });
