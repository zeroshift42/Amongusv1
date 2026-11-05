import test from "node:test";
import assert from "node:assert/strict";
import {
  createRoom,
  start,
  tick,
  act,
  newChallenge,
  taskInput,
  snapshot,
  resolveMeeting,
  beginMeeting,
  type Player,
  type Room,
} from "../src/server/game.js";
import { TERMINALS, ROOMS } from "../src/shared/world.js";
function game() {
  const room = createRoom("TESTCODE", "teacher", { impostors: 1, tasks: 10 });
  for (let i = 0; i < 5; i++) {
    const p: Player = {
      id: `p${i}`,
      token: `secret${i}`,
      name: `Jugador ${i}`,
      color: i,
      x: 1200,
      y: 300,
      alive: true,
      connected: true,
      role: "crew",
      socketId: `s${i}`,
      dx: 0,
      dy: 0,
      inputAt: Date.now(),
      disconnectedAt: 0,
      tasks: [],
      killCooldown: 0,
      emergency: 1,
      vented: false,
      lastChat: 0,
    };
    room.players.set(p.id, p);
  }
  start(room);
  const players = [...room.players.values()];
  return {
    room,
    players,
    crew: players.filter((p) => p.role === "crew"),
    impostor: players.find((p) => p.role === "impostor")!,
  };
}
test("all ten task protocols reject invalid actions then complete server-validated sequences", () => {
  const { room, crew } = game();
  const p = crew[0];
  for (const terminal of TERMINALS) {
    Object.assign(p, { x: terminal.x, y: terminal.y });
    const c = newChallenge(room, p, terminal.id);
    assert.throws(() =>
      taskInput(room, p, { id: terminal.id, action: { value: "bogus" } }),
    );
    const count =
      terminal.kind === "asteroids"
        ? 8
        : terminal.kind === "filter"
          ? 6
          : terminal.kind === "distributor"
            ? 3
            : ["wires", "shields"].includes(terminal.kind)
              ? 4
              : 1;
    for (let i = 0; i < count; i++) {
      room.time += 7;
      const action =
        terminal.kind === "card"
          ? { duration: 1 }
          : terminal.kind === "download"
            ? { value: "confirm" }
            : terminal.kind === "samples"
              ? { value: c.seed[0] }
              : ["engines", "navigation"].includes(terminal.kind)
                ? { value: c.seed[0] * 25 }
                : terminal.kind === "distributor"
                  ? { value: 50 }
                  : ["asteroids", "filter"].includes(terminal.kind)
                    ? { value: i }
                    : { value: c.seed[i] };
      const result = taskInput(room, p, { id: terminal.id, action });
      assert.equal(result.complete, i === count - 1);
    }
    assert.equal(p.tasks.find((t) => t.id === terminal.id)?.done, true);
    assert.throws(
      () => newChallenge(room, p, terminal.id),
      "Completed task restarted",
    );
  }
  assert.equal(p.tasks.filter((t) => t.done).length, 10);
});
test("task range, fake completion, pause, impersonation of assignment and ghost work", () => {
  const { room, crew, impostor } = game();
  const p = crew[0],
    terminal = TERMINALS[0];
  assert.throws(() => newChallenge(room, p, terminal.id));
  Object.assign(p, { x: terminal.x, y: terminal.y });
  Object.assign(impostor, { x: terminal.x, y: terminal.y });
  assert.throws(() => newChallenge(room, impostor, terminal.id));
  const c = newChallenge(room, p, terminal.id);
  room.time += 1;
  assert.throws(() => taskInput(room, p, { id: terminal.id, complete: true }));
  room.paused = true;
  assert.throws(() =>
    taskInput(room, p, { id: terminal.id, action: { value: c.seed[0] } }),
  );
  room.paused = false;
  p.alive = false;
  const result = taskInput(room, p, {
    id: terminal.id,
    action: { value: c.seed[0] },
  });
  assert.equal(result.complete, false);
  Object.assign(p, { x: 1200, y: 300 });
  room.time += 1;
  assert.throws(() =>
    taskInput(room, p, { id: terminal.id, action: { value: c.seed[1] } }),
  );
  room.paused = true;
  assert.equal(
    taskInput(room, p, { id: terminal.id, action: { type: "cancel" } })
      .complete,
    false,
  );
  assert.equal(
    p.challenge,
    undefined,
    "Cancel during teacher pause must release the movement lock",
  );
});
test("critical sabotage needs distinct players, freezes on pause, and expired deadline declares impostors", () => {
  const { room, crew, impostor } = game();
  room.sabotageCooldown = 0;
  act(room, impostor, { type: "sabotage", kind: "reactor" });
  const a = TERMINALS[0],
    b = TERMINALS[1];
  Object.assign(crew[0], { x: a.x, y: a.y });
  act(room, crew[0], { type: "repair", target: a.id });
  Object.assign(crew[0], { x: b.x, y: b.y });
  act(room, crew[0], { type: "repair", target: b.id });
  assert.ok(room.sabotage, "Same player repaired collective sabotage");
  Object.assign(crew[1], { x: a.x, y: a.y });
  act(room, crew[1], { type: "repair", target: a.id });
  assert.equal(room.sabotage, null);
  room.sabotageCooldown = 0;
  act(room, impostor, { type: "sabotage", kind: "oxygen" });
  room.paused = true;
  const before = (room as Room).sabotage!.remaining;
  tick(room, 30);
  assert.equal((room as Room).sabotage!.remaining, before);
  room.paused = false;
  tick(room, 61);
  assert.equal(room.phase, "ended");
  assert.equal(room.winner, "Impostores");
});
test("wall and distance visibility, alive clients cannot see ghosts, roles private until results", () => {
  const { room, crew, impostor } = game();
  const p = crew[0],
    q = crew[1];
  Object.assign(p, { x: 1200, y: 300 });
  Object.assign(q, { x: 190, y: 1410 });
  assert.equal(
    snapshot(room, p).players.some((v) => v.id === q.id),
    false,
  );
  Object.assign(q, { x: 1210, y: 300, alive: false });
  assert.equal(
    snapshot(room, p).players.some((v) => v.id === q.id),
    false,
  );
  q.alive = true;
  Object.assign(impostor, { x: 1220, y: 300 });
  assert.equal(
    snapshot(room, p).players.find((v) => v.id === impostor.id)?.role,
    undefined,
  );
  assert.ok(snapshot(room).players.every((v) => v.role));
});
test("vote ties and skip do not eject, all impostors removed ends game, all tasks completed wins", () => {
  const { room, crew, impostor } = game();
  beginMeeting(room, "Prueba");
  room.meeting!.votes.set(crew[0].id, impostor.id);
  room.meeting!.votes.set(crew[1].id, null);
  resolveMeeting(room);
  assert.equal(impostor.alive, true);
  beginMeeting(room, "Prueba");
  room.meeting!.votes.set(crew[0].id, impostor.id);
  resolveMeeting(room);
  assert.equal(room.phase, "ended");
  assert.equal(room.winner, "Tripulantes");
  const another = game();
  another.crew.forEach((p) => p.tasks.forEach((t) => (t.done = true)));
  tick(another.room, 0.05);
  assert.equal(another.room.winner, "Tripulantes");
});

test("ejection presentation reveals no secret role and clears on a new game", () => {
  const { room, crew, impostor } = game();
  beginMeeting(room, "Reunión");
  for (const p of room.players.values())
    room.meeting!.votes.set(p.id, crew[0].id);
  resolveMeeting(room);
  const result = snapshot(room, crew[1]).meetingResult!;
  assert.deepEqual(Object.keys(result.player!).sort(), ["color", "id", "name"]);
  assert.equal(result.player!.id, crew[0].id);
  assert.ok(result.id);
  const previousId = result.id;
  beginMeeting(room, "Otra reunión");
  for (const p of room.players.values())
    if (p.alive) room.meeting!.votes.set(p.id, null);
  resolveMeeting(room);
  assert.equal(room.meetingResult!.player, null);
  assert.notEqual(room.meetingResult!.id, previousId);
  room.phase = "lobby";
  start(room);
  assert.equal(snapshot(room, impostor).meetingResult, undefined);
});
