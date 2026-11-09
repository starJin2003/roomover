import { McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { MCP_TOOL_NAMES, type McpToolName } from "@/lib/domain/mcp";
import { roomPresets, roomPresetsInput, roomPresetsOutput, searchCatalog, searchListingsInput, searchListingsOutput, campusMatches, type RoomPresetsOutput, type SearchListingsOutput } from "./catalog";
import { createCheckout, createCheckoutInput, createCheckoutOutput, planRoom, planRoomInput, planRoomOutput, type McpCaller, type McpRecord, type ToolOutcome } from "./shopping";
import type { McpDeps } from "./deps";

export const MCP_INSTRUCTIONS = [
  "Roomover is a campus marketplace where students who move out sell furniture and dorm essentials to students who move in.",
  "To shop for a student, read get_room_presets, look through search_listings if useful, then call plan_room with the room and the student's budget and mood in their words.",
  "plan_room runs Roomover's buyer agent, which negotiates with seller agents and checks the hall's rules, and it returns a preview link for the student.",
  "When the student wants the room, call create_checkout with the planId and give the student the approvalUrl.",
  "Money moves only after the student approves in PayPal. You never approve a payment yourself.",
].join(" ");

const ok = <T extends Record<string, unknown>>(data: T, text: string): CallToolResult => ({ content: [{ type: "text", text }], structuredContent: data });
const failed = (message: string): CallToolResult => ({ content: [{ type: "text", text: message }], isError: true });

/**
 * One MCP server per MCP session. Each tool call writes one line to
 * agent_events with the tool, the client, and how long it took, so the
 * plan's Under the hood shows what came in over MCP.
 */
export function buildMcpServer(deps: McpDeps, session: { buyerSession: string; clientHash: string; logRunId: string }): McpServer {
  const planRoomDeps = deps.planRoom(session.logRunId);
  const checkoutDeps = deps.createCheckout();
  const server = new McpServer({ name: "roomover", title: "Roomover", version: "1.0.0" }, { capabilities: { tools: {} }, instructions: MCP_INSTRUCTIONS });
  const caller = (): McpCaller => ({ buyerSession: session.buyerSession, clientHash: session.clientHash, clientName: server.server.getClientVersion()?.name });

  const run = async <T extends Record<string, unknown>>(tool: McpToolName, work: (who: McpCaller) => Promise<ToolOutcome<T>>): Promise<CallToolResult> => {
    const who = caller();
    const started = Date.now();
    let outcome: ToolOutcome<T> | null = null;
    try {
      outcome = await work(who);
      return outcome.ok ? ok(outcome.data, outcome.text) : failed(outcome.message);
    } catch (error) {
      console.error("mcp: tool call failed", { tool, error: error instanceof Error ? error.name : "unknown" });
      return failed("Roomover hit an unexpected error. Nothing was charged. Try again in a moment.");
    } finally {
      const record: McpRecord = outcome?.record ?? { planId: null, summary: `${tool} failed with an unexpected error.` };
      await deps
        .recordCall(session.logRunId, record, { tool, client: who.clientName ?? "unnamed", latencyMs: Date.now() - started, blocked: outcome?.ok !== true })
        .catch((error: unknown) => console.error("mcp: could not record a tool call", { tool, error: error instanceof Error ? error.name : "unknown" }));
    }
  };

  server.registerTool(
    MCP_TOOL_NAMES[0],
    {
      title: "Search used listings",
      description:
        "Search the used furniture and dorm essentials students on campus have listed. Filter by campus, category, words, the most one item may cost, and the largest size one piece may be in inches. Each result names the item, its condition, price, seller, size, how and when it is handed over, and a photo. Pass roomPresetSlug to see only what that room can take.",
      inputSchema: searchListingsInput,
      outputSchema: searchListingsOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) =>
      run<SearchListingsOutput>("search_listings", async () => {
        const scope = await deps.searchScope(input.roomPresetSlug);
        if (!campusMatches(input.campus, scope)) return { ok: false, message: `Roomover's demo runs at ${scope.campusName} only.`, record: { planId: null, summary: `search_listings refused campus "${input.campus}".` } };
        if (input.roomPresetSlug !== undefined && scope.room === null) {
          return { ok: false, message: `There is no room called ${input.roomPresetSlug}. Call get_room_presets for the room slugs.`, record: { planId: null, summary: `search_listings named an unknown room ${input.roomPresetSlug}.` } };
        }
        const { catalog, extras } = await deps.catalog();
        const listings = searchCatalog(catalog, extras, scope, input, scope.roomLabel);
        const data = { campus: scope.campusName, count: listings.length, listings };
        const text = listings.length === 0 ? "No listing matches. Try fewer filters." : listings.map((item) => `${item.title}, ${item.condition}, ${item.price} from ${item.seller}, ${item.size}. ${item.handoff}.${item.breaksHallRule === null ? "" : ` Breaks ${item.breaksHallRule}`} listingId ${item.listingId}`).join("\n");
        const filters = [input.category, input.query === undefined ? undefined : `"${input.query}"`, input.maxPriceDollars === undefined ? undefined : `up to $${input.maxPriceDollars}`].filter(Boolean).join(", ");
        return { ok: true, data, text, record: { planId: null, summary: `search_listings${filters === "" ? "" : ` for ${filters}`} found ${listings.length}.`, detail: { count: listings.length, listingIds: listings.map((item) => item.listingId) } } };
      }),
  );

  server.registerTool(
    MCP_TOOL_NAMES[1],
    {
      title: "Read room presets",
      description:
        "List the residence hall rooms Roomover can furnish, with each room's slug, size in meters and feet, windows, doors, the furniture the university provides, and the hall's rules (for example no halogen lamps and a size cap on refrigerators). Use a slug with plan_room or search_listings.",
      inputSchema: roomPresetsInput,
      outputSchema: roomPresetsOutput,
      annotations: { readOnlyHint: true, openWorldHint: false },
    },
    (input) =>
      run<RoomPresetsOutput>("get_room_presets", async () => {
        const presets = await deps.presets();
        const rooms = roomPresets(presets, input, deps.demoRoom(presets));
        const text = rooms.length === 0 ? "No room matches that hall." : rooms.map((room) => `${room.slug}: ${room.name} in ${room.hall}, ${room.size}, provides ${room.provided.join(", ")}.${room.demoRoom === null ? "" : ` ${room.demoRoom}`}`).join("\n");
        return { ok: true, data: { rooms }, text, record: { planId: null, summary: `get_room_presets returned ${rooms.length} rooms.`, detail: { count: rooms.length } } };
      }),
  );

  server.registerTool(
    MCP_TOOL_NAMES[2],
    {
      title: "Plan a room",
      description:
        "Furnish a room for the student with Roomover's buyer agent. It reads the room and the hall's rules, searches used listings, negotiates prices and handoff times with each seller's agent, places every item in the 3D room so it fits, and fills gaps with new products from Channel3. Takes 20 to 60 seconds and reports progress. Returns the items with prices and sellers, the PayPal total, and a preview link that shows the room in 3D. One MCP session can plan 3 rooms an hour.",
      inputSchema: planRoomInput,
      outputSchema: planRoomOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: true },
    },
    (input, ctx) =>
      run("plan_room", async (who) => {
        const token = ctx.mcpReq._meta?.progressToken;
        let step = 0;
        const progress = (sentence: string) => {
          if (token === undefined) return;
          step += 1;
          void ctx.mcpReq.notify({ method: "notifications/progress", params: { progressToken: token, progress: step, message: sentence } }).catch(() => undefined);
        };
        return planRoom(planRoomDeps, who, input, progress, ctx.mcpReq.signal);
      }),
  );

  server.registerTool(
    MCP_TOOL_NAMES[3],
    {
      title: "Prepare PayPal checkout",
      description:
        "Prepare the PayPal order for a room plan_room planned in this session and return the approval link. Give the link to the student, who signs in to PayPal and approves. This tool never approves or charges anything. After approval PayPal returns the student to the plan's preview page, where Roomover authorizes the payment, and PayPal pays each seller after the handoff.",
      inputSchema: createCheckoutInput,
      outputSchema: createCheckoutOutput,
      annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: true },
    },
    (input) => run("create_checkout", (who) => createCheckout(checkoutDeps, who, input)),
  );

  return server;
}
