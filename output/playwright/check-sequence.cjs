const { chromium } = require("playwright");
const path = require("node:path");
const fs = require("node:fs/promises");

async function wait(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function ensureDir(dir) {
  await fs.mkdir(dir, { recursive: true });
}

async function clickByText(page, selector, text) {
  const target = page.locator(selector).filter({ hasText: text }).first();
  if ((await target.count()) === 0) {
    throw new Error(`Could not find element '${text}' for selector '${selector}'`);
  }
  await target.click();
}

async function main() {
  const outDir = path.resolve(process.cwd(), "output/playwright");
  await ensureDir(outDir);

  const browser = await chromium.launch({
    channel: "chrome",
    headless: true,
  });

  const page = await browser.newPage({
    viewport: { width: 1440, height: 900 },
    colorScheme: "dark",
  });

  page.on("console", (msg) => {
    if (msg.type() === "error") {
      console.error(`[browser:${msg.type()}] ${msg.text()}`);
    }
  });

  await page.goto("http://localhost:5173", {
    waitUntil: "networkidle",
    timeout: 30000,
  });

  await page.waitForSelector(".react-flow__renderer, .react-flow", { timeout: 30000 });
  await wait(1200);

  await clickByText(page, ".tree-node, button, [role='button']", "Input Sources");
  await wait(900);
  await page.screenshot({
    path: path.join(outDir, "sequence-input-sources.png"),
    fullPage: true,
  });

  await clickByText(page, ".tree-node, button, [role='button']", "Extraction & Preprocessing");
  await wait(900);
  await page.screenshot({
    path: path.join(outDir, "sequence-extraction.png"),
    fullPage: true,
  });

  const stats = await page.evaluate(() => {
    const nodes = Array.from(document.querySelectorAll(".sequence-node"));
    const headers = document.querySelectorAll(".sequence-node__header").length;
    const actors = document.querySelectorAll(".sequence-node__actor").length;
    const lifelines = document.querySelectorAll(".sequence-node__lifeline-line").length;
    const activations = document.querySelectorAll(".sequence-node__activation").length;
    const labels = document.querySelectorAll(".sequence-message-edge .react-flow__edge-text").length;
    const edges = document.querySelectorAll(".sequence-message-edge").length;
    return { nodes: nodes.length, headers, actors, lifelines, activations, labels, edges };
  });

  console.log(JSON.stringify(stats, null, 2));
  await browser.close();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
