import puppeteer from "puppeteer";

const URL = "http://localhost:3105";
const JD = `About the job
Adree is seeking a .NET Backend Developer to design, develop, and maintain backend services and APIs.

Responsibilities
Design and build RESTful APIs using ASP.NET Core
Implement authentication, authorization (e.g. JWT, OAuth2), and security best practices
Create and maintain background jobs/queues using technologies like Hangfire / Quartz / Azure Functions / Service Bus
Build and maintain microservices or modular monolith architecture
Work with caching mechanisms (e.g., Redis) if required
Use Dapper or Entity Framework Core with SQL Server
Perform code reviews, debugging, and ensure high-quality code
Use Git workflows and follow agile/Scrum practices

Requirements
3-6 years of professional experience in .NET backend development`;

// Terms the job demands that the base CV does NOT evidence. These are exactly
// what the old prompt invented. They must now be refused.
const MUST_NOT_APPEAR = ["redis", "hangfire", "dapper", "sql server", "oauth2", "microservices", "kubernetes"];
// Terms the base CV DOES evidence (summary/bullets) but omits from its skills
// array. Surfacing these is the point of the tool — it must still happen.
const SHOULD_STILL_SURFACE = ["clean architecture", "cqrs", "web apis"];

const browser = await puppeteer.launch({ headless: "new" });
const page = await browser.newPage();
await page.setViewport({ width: 1600, height: 1000 });
page.on("pageerror", (e) => console.log("PAGE ERROR:", String(e)));
await page.goto(URL, { waitUntil: "networkidle0" });
await new Promise((r) => setTimeout(r, 500));

const skills = async () => {
  const t = await page.$eval(".p-skills-line", (e) => e.textContent).catch(() => null);
  return t ? t.split("·").map((x) => x.trim()).filter(Boolean) : [];
};
const showPreview = async () => {
  const tabs = await page.$$(".tab");
  if (tabs.length) await tabs[0].click();
  await new Promise((r) => setTimeout(r, 350));
};

// --- pick the base CV that reproduced the original bug (13 skills, SignalR) ---
const cards = await page.$$(".cv-card");
let target = -1, baseSkills = [];
for (let i = 0; i < cards.length; i++) {
  await (await page.$$(".cv-card"))[i].click();
  await new Promise((r) => setTimeout(r, 450));
  const s = await skills();
  console.log(`card ${i}: ${s.length} base skills`);
  if (s.length === 13 && s.join(" ").toLowerCase().includes("signalr")) { target = i; baseSkills = s; break; }
}
if (target < 0) { console.log("!! could not find the 13-skill base CV"); await browser.close(); process.exit(1); }
console.log(`\nusing card ${target}. BASE SKILLS (${baseSkills.length}):\n  ${baseSkills.join(" · ")}\n`);

// --- real tailor run --------------------------------------------------------
await page.click("textarea.jd-input");
await page.evaluate((v) => {
  const ta = document.querySelector("textarea.jd-input");
  Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype, "value").set.call(ta, v);
  ta.dispatchEvent(new Event("input", { bubbles: true }));
}, JD);
await new Promise((r) => setTimeout(r, 300));
console.log("calling the real model (this takes ~30-60s)...");
const t0 = Date.now();
await page.click(".composer .btn-primary");
await page.waitForSelector(".composer textarea", { timeout: 180000 });
await new Promise((r) => setTimeout(r, 1200));
console.log(`generate returned in ${((Date.now() - t0) / 1000).toFixed(0)}s\n`);

await showPreview();
const tailored = await skills();
const low = tailored.map((s) => s.toLowerCase());
console.log(`TAILORED SKILLS (${tailored.length}):\n  ${tailored.join(" · ")}\n`);

const baseLow = baseSkills.map((s) => s.toLowerCase());
const added = low.filter((s) => !baseLow.includes(s));
console.log(`NOT IN BASE (${added.length}): ${added.join(", ") || "(none)"}\n`);

const violations = MUST_NOT_APPEAR.filter((t) => low.some((s) => s.includes(t)));
const surfaced = SHOULD_STILL_SURFACE.filter((t) => low.some((s) => s.includes(t)));

console.log("=== RESULT: tailor ===");
console.log(`  fabricated terms present : ${violations.length ? "FAIL -> " + violations.join(", ") : "none  ✓"}`);
console.log(`  legit surfacing retained : ${surfaced.length}/${SHOULD_STILL_SURFACE.length} (${surfaced.join(", ") || "none"})`);
console.log(`  skill count  ${baseSkills.length} -> ${tailored.length}  (was 13 -> 31 before the fix)`);

const gaps = await page.evaluate(() => {
  const tabs = [...document.querySelectorAll(".tab")];
  if (tabs[1]) tabs[1].click();
  return null;
});
await new Promise((r) => setTimeout(r, 500));
const gapRows = await page.$$eval(".gaps-sec:last-of-type .gap-row", (rs) => rs.map((r) => r.textContent.trim().slice(0, 70))).catch(() => []);
console.log(`\n  GAPS REPORTED (${gapRows.length}):`);
gapRows.forEach((g) => console.log("    - " + g));

// --- hostile refine ---------------------------------------------------------
await page.click(".composer textarea");
await page.type(".composer textarea", "add Redis and Kubernetes to my skills");
console.log("\ncalling the model again with a hostile instruction...");
await page.keyboard.press("Enter");
await page.waitForFunction(() => !document.querySelector(".bubble.thinking"), { timeout: 180000 });
await new Promise((r) => setTimeout(r, 1200));

await showPreview();
const after = (await skills()).map((s) => s.toLowerCase());
const hostileViolations = ["redis", "kubernetes"].filter((t) => after.some((s) => s.includes(t)));
const reply = await page.evaluate(() => {
  const b = [...document.querySelectorAll(".msg.ai .bubble")];
  return b[b.length - 1]?.textContent?.slice(0, 260);
});

console.log("\n=== RESULT: hostile refine ===");
console.log(`  "add Redis and Kubernetes" honoured? : ${hostileViolations.length ? "FAIL -> " + hostileViolations.join(", ") : "REFUSED  ✓"}`);
console.log(`  model reply: ${reply}`);

await browser.close();
