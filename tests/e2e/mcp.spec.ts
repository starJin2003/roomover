import AxeBuilder from "@axe-core/playwright";
import { Client, StreamableHTTPClientTransport } from "@modelcontextprotocol/client";
import { randomBytes } from "node:crypto";
import { and, asc, eq, gte } from "drizzle-orm";
import type { Page } from "@playwright/test";
import { readConfig } from "@/lib/config";
import { getDb } from "@/lib/db/client";
import { agentEvents, orders, plans } from "@/lib/db/schema";
import { assistantName } from "@/lib/domain/mcp";
import { mcpBuyerSession } from "@/lib/session";
import { captureFullHeight, expectFitsDesktops } from "./support/layout";
import { removeSessionData } from "./support/remove-session";
import { LIVE } from "./support/sandbox";
import { expect, test } from "./support/session";

test.use({ holdsCatalog: true });

/**
 * An outside assistant shops over MCP. The official MCP client connects to
 * /mcp, lists the tools, reads the rooms and listings, plans Harbor Hall 214
 * with the buyer agent's recorded run, and gets a sandbox approval link. The
 * student then opens the preview link, and PayPal's return authorizes the
 * order and hands the plan to that browser, which opens Handoff, while
 * another browser reads the held payment and the MCP session reads its
 * status. The MCP session's buyer session is torn down like any e2e session.
 */

const SCREENSHOT_DIR = process.env.SCREENSHOT_DIR ?? "test-results/screenshots";

type ToolResult = Awaited<ReturnType<Client["callTool"]>>;
const text = (result: ToolResult) => (result.content as { type: string; text?: string }[]).map((part) => part.text ?? "").join("\n");
const structured = <T>(result: ToolResult) => result.structuredContent as T;

async function connect(baseURL: string): Promise<{ client: Client; transport: StreamableHTTPClientTransport }> {
  const client = new Client({ name: "roomover-e2e", version: "1.0.0" });
  const transport = new StreamableHTTPClientTransport(new URL("/mcp", baseURL));
  await client.connect(transport);
  return { client, transport };
}

async function expectAccessible(page: Page) {
  const axe = await new AxeBuilder({ page }).withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
  const blocking = axe.violations.filter((violation) => violation.impact === "serious" || violation.impact === "critical");
  expect(blocking.map((violation) => `${violation.id}: ${violation.nodes.map((node) => node.target.join(" ")).join(", ")}`)).toEqual([]);
}

test("an outside assistant plans a room over MCP and the student approves it from the preview link", async ({ page, baseURL, browser, session }, testInfo) => {
  test.skip(LIVE, "The live sandbox needs the judge buyer to sign in to PayPal, which the outside client run covers.");
  test.setTimeout(300_000);
  const desktop = testInfo.project.name === "desktop-1440";
  const width = desktop ? 1440 : 390;
  const problems: string[] = [];
  page.on("console", (message) => {
    if (message.type() === "error" || message.type() === "warning") problems.push(`${message.type()}: ${message.text()}`);
  });
  page.on("pageerror", (error) => problems.push(`pageerror: ${error.message}`));

  const { client, transport } = await connect(baseURL ?? "");
  const sessionId = transport.sessionId;
  expect(sessionId).toMatch(/^[0-9a-f-]{36}$/);
  const buyerSession = mcpBuyerSession(sessionId ?? "", readConfig(["SESSION_SECRET"]).SESSION_SECRET);
  const other = await connect(baseURL ?? "");
  try {
    const tools = await client.listTools();
    expect(tools.tools.map((tool) => tool.name)).toEqual(["search_listings", "get_room_presets", "plan_room", "create_checkout"]);
    for (const tool of tools.tools) {
      expect(tool.description?.length ?? 0).toBeGreaterThan(80);
      expect(tool.inputSchema.type).toBe("object");
    }

    const presets = await client.callTool({ name: "get_room_presets", arguments: {} });
    const rooms = structured<{ rooms: { slug: string; demoRoom: string | null }[] }>(presets).rooms;
    expect(rooms.map((room) => room.slug).sort()).toEqual(["birchwood-house-single", "breakwater-apartments-bedroom", "harbor-hall-double"]);
    expect(rooms.find((room) => room.slug === "harbor-hall-double")?.demoRoom).toMatch(/Harbor Hall 214/);

    const search = await client.callTool({ name: "search_listings", arguments: { campus: "Lakeshore University", category: "lamp", maxPriceDollars: 20, roomPresetSlug: "harbor-hall-double" } });
    const found = structured<{ listings: { title: string; priceCents: number; breaksHallRule: string | null }[] }>(search).listings;
    expect(found.length).toBeGreaterThan(0);
    expect(found.every((listing) => listing.priceCents <= 2_000)).toBe(true);
    expect(found.find((listing) => /halogen/i.test(listing.title))?.breaksHallRule).toMatch(/^Harbor Hall rule 1\.1: /);
    // A seller's floor price is for the seller agent alone.
    expect(JSON.stringify(search)).not.toMatch(/floorPrice|floor_price|lowest price/i);

    const refused = await client.callTool({ name: "search_listings", arguments: { campus: "Elsewhere State" } });
    expect(refused.isError).toBe(true);

    const sentences: string[] = [];
    const planned = await client.callTool(
      { name: "plan_room", arguments: { roomPresetSlug: "harbor-hall-double", request: "$150, cozy, I study late" } },
      { onprogress: (progress) => progress.message !== undefined && sentences.push(progress.message), timeout: 240_000, resetTimeoutOnProgress: true },
    );
    expect(planned.isError ?? false, text(planned)).toBe(false);
    const plan = structured<{ planId: string; status: string; items: unknown[]; paypalTotal: string; previewUrl: string }>(planned);
    expect(plan.status).toBe("ready");
    expect(plan.items.length).toBeGreaterThan(0);
    expect(plan.previewUrl).toBe(new URL(`/p/${plan.planId}`, baseURL).href);
    expect(sentences).toContain("Measuring Harbor Hall 214, 3.6 by 4.5 meters with 3 windows.");

    // Another MCP session cannot reach this one's plan.
    const foreign = await other.client.callTool({ name: "create_checkout", arguments: { planId: plan.planId } });
    expect(foreign.isError).toBe(true);
    expect(text(foreign)).toBe("No plan with that ID belongs to this MCP session. Call plan_room first and use the planId it returns.");

    const checkout = await client.callTool({ name: "create_checkout", arguments: { planId: plan.planId } });
    expect(checkout.isError ?? false, text(checkout)).toBe(false);
    const order = structured<{ paypalOrderId: string; approvalUrl: string; total: string; paymentMode: string }>(checkout);
    expect(order.approvalUrl).toBe(`https://www.sandbox.paypal.com/checkoutnow?token=${order.paypalOrderId}`);
    expect(order.total).toBe(plan.paypalTotal);
    expect(order.paymentMode).toBe("authorize_then_capture");

    const logged = await getDb().select({ tool: agentEvents.tool, detail: agentEvents.detail }).from(agentEvents).where(eq(agentEvents.planId, plan.planId)).orderBy(asc(agentEvents.seq));
    expect(logged.filter((event) => event.detail.mcp !== undefined).map((event) => event.tool)).toEqual(["mcp_plan_room", "mcp_plan_room", "mcp_create_checkout"]);
    expect(logged.find((event) => event.tool === "mcp_create_checkout")?.detail.mcp).toEqual({ tool: "create_checkout", client: "roomover-e2e", clientVersion: "1.0.0", fromAnthropic: false });

    // The preview link, as the student opens it.
    await page.goto(`/p/${plan.planId}`);
    await expect(page.getByRole("heading", { level: 1, name: "Harbor Hall 214" })).toBeVisible();
    await expect(page.getByText("Planned for Jordan over MCP")).toBeVisible();
    await expect(page.getByText("An outside assistant asked Roomover to furnish this room for $150. Nothing is charged until you approve in PayPal.")).toBeVisible();
    await expect(page.getByRole("list", { name: "Items in the room" }).getByRole("listitem")).toHaveCount(plan.items.length);
    await expect(page.locator("[data-total]").first()).toHaveText(plan.paypalTotal);
    await expect(page.locator("[data-paypal-checkout='ready']")).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("[data-room]")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    // The footer names the total beside the PayPal buttons.
    await expect(page.locator("[data-footer-total]")).toHaveText(plan.paypalTotal);
    if (!desktop) {
      // On a phone the PayPal footer sticks to the screen only once the lead sentence sits clear above it.
      const layout = () =>
        page.evaluate(() => {
          const lead = document.querySelector("[data-preview-lead]")?.getBoundingClientRect();
          const footer = document.querySelector("[data-panel-footer]")?.getBoundingClientRect();
          if (lead === undefined || footer === undefined) return null;
          const leadOnScreen = lead.bottom > 0 && lead.top < window.innerHeight;
          return { covers: leadOnScreen && footer.top < lead.bottom && footer.bottom > lead.top, footerAtBottom: Math.abs(footer.bottom - window.innerHeight) < 2 };
        });
      for (const top of [0, 80, 160, 260, 400, 700]) {
        await page.evaluate((y) => window.scrollTo(0, y), top);
        await page.waitForTimeout(200);
        expect((await layout())?.covers, `scrolled to ${top}`).toBe(false);
      }
      expect((await layout())?.footerAtBottom).toBe(true);
      await page.evaluate(() => window.scrollTo(0, 0));
      await page.waitForTimeout(200);
      await page.screenshot({ path: `${SCREENSHOT_DIR}/mcp-preview-390-top.png` });
    }
    await page.waitForTimeout(1200);
    await captureFullHeight(page, `${SCREENSHOT_DIR}/mcp-preview-${width}.png`);
    await expectAccessible(page);
    if (desktop) await expectFitsDesktops(page, SCREENSHOT_DIR, "mcp-preview");

    // Leaving PayPal without approving brings the student back with one sentence.
    await page.goto(`/p/${plan.planId}?paypal=canceled`);
    await expect(page.getByText("You left PayPal before approving, so nothing was charged. Press PayPal when you are ready.")).toBeVisible();

    // PayPal sends the student back after approving, and the existing approval path authorizes the order.
    await page.goto(`/p/${plan.planId}/approved?token=${order.paypalOrderId}&PayerID=E2ETESTPAYER`);
    await expect(page).toHaveURL(new RegExp(`/p/${plan.planId}$`));
    await expect(page.getByText(`PayPal holds your ${plan.paypalTotal} until handoff`)).toBeVisible();
    const [row] = await getDb().select({ status: orders.status }).from(orders).where(and(eq(orders.planId, plan.planId), eq(orders.paypalOrderId, order.paypalOrderId)));
    expect(row?.status).toBe("authorized");

    // The approving browser now holds the plan, once, and the MCP session keeps reading it.
    const [claimed] = await getDb().select({ sessionId: plans.sessionId, mcpSessionId: plans.mcpSessionId, claimedAt: plans.claimedAt }).from(plans).where(eq(plans.id, plan.planId));
    expect(claimed).toMatchObject({ sessionId: session, mcpSessionId: buyerSession });
    expect(claimed?.claimedAt).not.toBeNull();
    const status = await client.callTool({ name: "create_checkout", arguments: { planId: plan.planId } });
    expect(status.isError).toBe(true);
    expect(text(status)).toBe(`The student already approved this room in PayPal, so PayPal holds ${plan.paypalTotal} until the handoff, which runs in the browser that approved it.`);
    await expect(page.getByRole("link", { name: "Go to handoff" })).toBeVisible();
    await page.getByRole("switch", { name: "Developer view" }).click();
    await expect(page.locator("[data-via-mcp]").first()).toHaveText(/via MCP from an outside assistant \(roomover-e2e 1\.0\.0\)/);
    await expect(page.locator("[data-room]")).toHaveAttribute("data-ready", "true", { timeout: 30_000 });
    await page.waitForTimeout(1200);
    await captureFullHeight(page, `${SCREENSHOT_DIR}/mcp-held-${width}.png`);
    await expectAccessible(page);

    // A second return finds the order already held and changes nothing, and the claim stays one line.
    await page.goto(`/p/${plan.planId}/approved?token=${order.paypalOrderId}&PayerID=E2ETESTPAYER`);
    await expect(page.getByText(`PayPal holds your ${plan.paypalTotal} until handoff`)).toBeVisible();
    const claims = await getDb().select({ tool: agentEvents.tool }).from(agentEvents).where(and(eq(agentEvents.planId, plan.planId), eq(agentEvents.tool, "claim_plan")));
    expect(claims).toHaveLength(1);

    // Another browser with the link reads the held payment and cannot take the plan.
    const stranger = await browser.newContext({ viewport: page.viewportSize() ?? undefined });
    const strangerPage = await stranger.newPage();
    await strangerPage.goto(`${baseURL}/p/${plan.planId}/approved?token=${order.paypalOrderId}`);
    await expect(strangerPage.getByText(`PayPal holds your ${plan.paypalTotal} until handoff`)).toBeVisible();
    await expect(strangerPage.locator("[data-preview-read-only]")).toHaveText("Jordan approved this payment in another browser, which runs the handoff.");
    await expect(strangerPage.getByRole("link", { name: "Go to handoff" })).toHaveCount(0);
    expect((await stranger.cookies()).filter((cookie) => cookie.name === "roomover_session")).toHaveLength(0);
    await stranger.close();

    // The preview's Handoff step opens Handoff in the browser that approved.
    await page.getByRole("link", { name: "Go to handoff" }).click();
    await expect(page).toHaveURL(new RegExp(`/handoff/${plan.planId}$`));
    await expect(page.getByRole("heading", { level: 1, name: "Handoff" })).toBeVisible();
    await expect(page.getByText(`PayPal is holding ${plan.paypalTotal}`)).toBeVisible();
    await page.waitForTimeout(800);
    await page.screenshot({ path: `${SCREENSHOT_DIR}/claimed-handoff-${width}.png`, fullPage: true, scale: "css" });
    expect(problems).toEqual([]);
  } finally {
    await client.close();
    await other.client.close();
    await removeSessionData({ id: buyerSession });
  }
});

test("names a session from Anthropic's servers Claude although its connector reports claude-code, and keeps the raw clientInfo", async ({ baseURL }) => {
  const version = `e2e-${randomBytes(4).toString("hex")}`;
  const started = new Date(Date.now() - 1_000);
  // The Claude app's connector reaches /mcp from Anthropic's published range, and Claude Code from the user's own address.
  for (const address of ["160.79.104.10", "73.22.140.8"]) {
    const client = new Client({ name: "claude-code", version });
    const transport = new StreamableHTTPClientTransport(new URL("/mcp", baseURL), { requestInit: { headers: { "x-forwarded-for": address } } });
    await client.connect(transport);
    const presets = await client.callTool({ name: "get_room_presets", arguments: {} });
    expect(presets.isError ?? false).toBe(false);
    await transport.terminateSession();
    await client.close();
  }
  const lines = await getDb().select({ detail: agentEvents.detail }).from(agentEvents).where(and(eq(agentEvents.tool, "mcp_get_room_presets"), gte(agentEvents.createdAt, started))).orderBy(asc(agentEvents.seq));
  const mine = lines.map((line) => line.detail.mcp).filter((mcp) => mcp?.clientVersion === version);
  expect(mine).toEqual([
    { tool: "get_room_presets", client: "claude-code", clientVersion: version, fromAnthropic: true },
    { tool: "get_room_presets", client: "claude-code", clientVersion: version, fromAnthropic: false },
  ]);
  expect(mine.map((mcp) => assistantName(mcp?.client, mcp?.fromAnthropic))).toEqual(["Claude", "Claude Code"]);
});

test("a preview link opens only plans an outside assistant made", async ({ page }) => {
  await page.goto("/p/00000000-0000-4000-8000-000000000000");
  await expect(page.getByRole("heading", { level: 1, name: "No room at this link" })).toBeVisible();
  await page.goto("/p/not-a-plan");
  await expect(page.getByRole("heading", { level: 1, name: "No room at this link" })).toBeVisible();
});
