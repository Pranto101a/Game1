import { io } from "socket.io-client";

const URL = "http://localhost:3000";
const PATH = "/api/socket.io";

function wait(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

async function run() {
  const host = io(URL, { path: PATH, transports: ["websocket"] });
  const p2 = io(URL, { path: PATH, transports: ["websocket"] });

  const state = { roomId: null };

  for (const [name, s] of [
    ["host", host],
    ["p2", p2]
  ]) {
    s.on("connect", () => console.log(`[${name}] connected`, s.id));
    s.on("disconnect", (reason) => console.log(`[${name}] disconnected:`, reason));
    s.on("connect_error", (e) => console.log(`[${name}] connect_error:`, e?.message || e));
    s.on("error", (e) => console.log(`[${name}] error event:`, e));
    s.on("room_created", (p) => console.log(`[${name}] room_created`, p));
    s.on("room_joined", (p) => console.log(`[${name}] room_joined`, p));
    s.on("lobby_update", (p) => console.log(`[${name}] lobby_update`, p));
    s.on("game_state", (p) =>
      console.log(`[${name}] game_state phase=`, p?.state?.phase, "step=", p?.state?.playStep)
    );
    s.on("game_action_ack", (p) =>
      console.log(`[${name}] game_action_ack phase=`, p?.state?.phase, "step=", p?.state?.playStep)
    );
  }

  await new Promise((r) => host.once("connect", r));
  console.log("[host] emit create_room");
  host.emit("create_room", { playerName: "Host" });
  const created = await new Promise((r) => host.once("room_created", r));
  state.roomId = created.roomId;

  if (!p2.connected) await new Promise((r) => p2.once("connect", r));
  console.log("[p2] emit join_room", state.roomId);
  p2.emit("join_room", { roomId: state.roomId, playerName: "P2" });
  await Promise.race([
    new Promise((r) => p2.once("room_joined", r)),
    wait(1500).then(() => {
      throw new Error("timeout waiting for room_joined");
    })
  ]);

  await wait(200);
  // Start game as host
  console.log("[host] emit start_game", state.roomId);
  host.emit("start_game", {
    roomId: state.roomId,
    playerId: 0,
    cardCounts: { guard: 6, merchant: 2 },
    tokensToWinOverride: null
  });

  await wait(500);

  host.disconnect();
  p2.disconnect();
  await wait(100);
  process.exit(0);
}

run().catch((e) => {
  console.error(e);
  process.exit(1);
});
