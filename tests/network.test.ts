import test from "node:test";
import assert from "node:assert/strict";
import { io, type Socket } from "socket.io-client";
import { createGameServer } from "../src/server/index.js";
import { TERMINALS } from "../src/shared/world.js";

const PASSWORD = "tests-only-long-admin-secret";
type Client = Socket & { latest?: any };
async function request(socket: Socket, event: string, data: any): Promise<any> {
  return new Promise((resolve, reject) =>
    socket
      .timeout(2500)
      .emit(event, data, (error: any, response: any) =>
        error ? reject(error) : resolve(response),
      ),
  );
}
async function waitFor(
  socket: Client,
  predicate: (s: any) => boolean,
  timeout = 8000,
): Promise<any> {
  if (socket.latest && predicate(socket.latest)) return socket.latest;
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      socket.off("state", listener);
      reject(new Error("Timed out waiting for state"));
    }, timeout);
    function listener(s: any) {
      if (predicate(s)) {
        clearTimeout(timer);
        socket.off("state", listener);
        resolve(s);
      }
    }
    socket.on("state", listener);
  });
}
async function fixture() {
  const app = createGameServer({ adminPassword: PASSWORD });
  const port = await app.listen(0);
  const clients: Client[] = [];
  async function client() {
    const socket = io(`http://127.0.0.1:${port}`, {
      transports: ["websocket"],
      reconnection: false,
      forceNew: true,
    }) as Client;
    clients.push(socket);
    socket.on("state", (s) => (socket.latest = s));
    await new Promise<void>((resolve, reject) => {
      socket.once("connect", () => resolve());
      socket.once("connect_error", reject);
    });
    return socket;
  }
  return {
    app,
    client,
    cleanup: async () => {
      for (const s of clients) s.disconnect();
      await app.close();
    },
  };
}

test("26 real students plus independent teacher; capacity, isolation and role secrecy", async () => {
  const f = await fixture();
  try {
    const admin = await f.client();
    const created = await request(admin, "admin:create", {
      password: PASSWORD,
    });
    assert.equal(created.ok, true);
    assert.match(created.code, /^[A-Z0-9]{8,}$/);
    const students = await Promise.all(
      Array.from({ length: 26 }, () => f.client()),
    );
    const joins = await Promise.all(
      students.map((s, i) =>
        request(s, "join", {
          code: created.code,
          name: `Tripulante ${i + 1}`,
          color: i,
        }),
      ),
    );
    for (const j of joins) {
      assert.equal(j.ok, true);
      assert.ok(j.token);
      assert.ok(j.id);
    }
    assert.equal(new Set(joins.map((j) => j.id)).size, 26);
    const snapshot = await waitFor(admin, (s) => s.players.length === 26);
    assert.equal(snapshot.players.filter((p: any) => p.connected).length, 26);
    const extra = await f.client();
    assert.equal(
      (
        await request(extra, "join", {
          code: created.code,
          name: "Exceso",
          color: 0,
        })
      ).ok,
      false,
    );
    assert.equal(
      (await request(students[0], "admin", { action: "start" })).ok,
      false,
    );
    assert.equal((await request(admin, "admin", { action: "start" })).ok, true);
    const playing = await waitFor(admin, (s) => s.phase === "playing");
    assert.equal(
      playing.players.filter((p: any) => p.role === "impostor").length,
      3,
    );
    assert.equal(playing.players.length, 26);
    for (let i = 0; i < students.length; i++) {
      const state = await waitFor(students[i], (s) => s.phase === "playing");
      const self = state.players.find((p: any) => p.id === joins[i].id);
      assert.ok(self);
      assert.ok(["crew", "impostor"].includes(self.role));
      for (const other of state.players.filter((p: any) => p.id !== self.id)) {
        if (self.role === "crew")
          assert.equal(
            other.role,
            undefined,
            "Crew received another player role",
          );
        if (other.role !== undefined) assert.equal(other.role, "impostor");
        assert.equal(other.token, undefined);
        assert.equal(other.tasks, undefined);
      }
      assert.equal(state.token, undefined);
      assert.equal(state.adminToken, undefined);
    }
    const model = f.app.rooms.get(created.code)!;
    // Simultaneous intentions are resolved server-side, not client-supplied coordinates.
    const positions = new Map(playing.players.map((p: any) => [p.id, p.x]));
    await Promise.all(students.map((s) => request(s, "move", { x: 1, y: 0 })));
    const movementRefresh = setInterval(
      () => students.forEach((s) => s.emit("move", { x: 1, y: 0 })),
      100,
    );
    let moved: any;
    try {
      moved = await waitFor(admin, (s) =>
        s.players.every((p: any) => p.x > Number(positions.get(p.id)) + 10),
      );
    } finally {
      clearInterval(movementRefresh);
      await Promise.all(
        students.map((s) => request(s, "move", { x: 0, y: 0 })),
      );
    }
    assert.equal(moved.players.length, 26);
    for (const p of moved.players)
      assert.ok(
        p.x - Number(positions.get(p.id)) < 100,
        "Movement exceeded server speed",
      );
    await request(admin, "admin", { action: "pause" });
    const paused = await waitFor(admin, (s) => s.paused);
    const time = paused.remaining;
    students.forEach((s) => s.emit("move", { x: 1e9, y: 1e9 }));
    await new Promise((resolve) => setTimeout(resolve, 220));
    assert.equal(admin.latest.remaining, time, "Pause must freeze game time");
    assert.deepEqual(
      admin.latest.players.map((p: any) => [p.x, p.y]),
      paused.players.map((p: any) => [p.x, p.y]),
    );
    students.forEach((s) => s.emit("move", { x: 0, y: 0 }));
    await request(admin, "admin", { action: "resume" });
    const actor = (id: string) => students[joins.findIndex((j) => j.id === id)];
    const impostors = [...model.players.values()].filter(
      (p) => p.role === "impostor",
    );
    const crew = [...model.players.values()].filter((p) => p.role === "crew");
    model.sabotageCooldown = 0;
    assert.equal(
      (
        await request(actor(impostors[0].id), "action", {
          type: "sabotage",
          kind: "lights",
        })
      ).ok,
      true,
    );
    await Promise.all(
      students.map((s) =>
        waitFor(s, (state) => state.sabotage?.kind === "lights"),
      ),
    );
    const panel = TERMINALS[0];
    Object.assign(crew[0], { x: panel.x, y: panel.y });
    assert.equal(
      (
        await request(actor(crew[0].id), "action", {
          type: "repair",
          target: panel.id,
        })
      ).ok,
      true,
    );
    await waitFor(admin, (s) => s.sabotage === null);
    Object.assign(impostors[0], { x: 1200, y: 300, killCooldown: 0 });
    Object.assign(crew[0], { x: 2000, y: 800 });
    assert.equal(
      (
        await request(actor(impostors[0].id), "action", {
          type: "kill",
          target: crew[0].id,
        })
      ).ok,
      false,
      "Out of range kill accepted",
    );
    Object.assign(crew[0], { x: 1210, y: 300 });
    assert.equal(
      (
        await request(actor(impostors[0].id), "action", {
          type: "kill",
          target: crew[0].id,
        })
      ).ok,
      true,
    );
    assert.equal(crew[0].alive, false);
    assert.equal(model.bodies.length, 1);
    assert.equal(
      (await request(actor(crew[0].id), "action", { type: "emergency" })).ok,
      false,
    );
    Object.assign(crew[1], { x: 1200, y: 300 });
    assert.equal(
      (await request(actor(crew[1].id), "action", { type: "report" })).ok,
      true,
    );
    await Promise.all(
      students.map((s) => waitFor(s, (state) => state.phase === "meeting")),
    );
    model.meeting!.stage = "voting";
    model.meeting!.remaining = 60;
    assert.equal(
      (await request(actor(crew[0].id), "vote", { target: impostors[0].id }))
        .ok,
      false,
      "Ghost vote accepted",
    );
    const alive = [...model.players.values()].filter((p) => p.alive);
    const votes = await Promise.all(
      alive.map((p) =>
        request(actor(p.id), "vote", { target: impostors[0].id }),
      ),
    );
    votes.forEach((v) => assert.equal(v.ok, true));
    assert.equal(model.meeting!.votes.size, 25);
    assert.equal(
      (await request(actor(crew[1].id), "vote", { target: null })).ok,
      false,
      "Duplicate vote accepted",
    );
    model.meeting!.remaining = 0.01;
    await waitFor(
      admin,
      (s) =>
        s.phase === "playing" &&
        !s.players.find((p: any) => p.id === impostors[0].id).alive,
    );
    assert.equal((await request(admin, "admin", { action: "end" })).ok, true);
    await waitFor(admin, (s) => s.phase === "ended");
    assert.equal((await request(admin, "admin", { action: "reset" })).ok, true);
    await waitFor(admin, (s) => s.phase === "lobby");
    assert.equal((await request(admin, "admin", { action: "start" })).ok, true);
    await waitFor(
      admin,
      (s) => s.phase === "playing" && s.players.every((p: any) => p.alive),
    );
    // A second independent room neither contains nor inherits the first room's participants.
    const admin2 = await f.client();
    const room2 = await request(admin2, "admin:create", { password: PASSWORD });
    assert.equal(room2.ok, true);
    assert.notEqual(room2.code, created.code);
    const isolated = await f.client();
    assert.equal(
      (
        await request(isolated, "join", {
          code: room2.code,
          name: "Otra sala",
          color: 0,
        })
      ).ok,
      true,
    );
    const second = await waitFor(admin2, (s) => s.players.length === 1);
    assert.equal(second.phase, "lobby");
    assert.equal(second.players[0].name, "Otra sala");
  } finally {
    await f.cleanup();
  }
});

test("reconnection preserves identity, duplicate sessions cannot impersonate with nickname", async () => {
  const f = await fixture();
  try {
    const admin = await f.client();
    const room = await request(admin, "admin:create", { password: PASSWORD });
    const old = await f.client();
    const joined = await request(old, "join", {
      code: room.code,
      name: "Cometa",
      color: 0,
    });
    assert.equal(joined.ok, true);
    old.disconnect();
    await waitFor(admin, (s) =>
      s.players.some((p: any) => p.id === joined.id && !p.connected),
    );
    const retry = await f.client();
    const resumed = await request(retry, "resume", {
      code: room.code,
      token: joined.token,
    });
    assert.equal(resumed.ok, true);
    assert.equal(resumed.id, joined.id);
    const state = await waitFor(admin, (s) =>
      s.players.some((p: any) => p.id === joined.id && p.connected),
    );
    assert.equal(state.players.length, 1);
    const thief = await f.client();
    assert.equal(
      (
        await request(thief, "resume", {
          code: room.code,
          token: "not-a-token",
        })
      ).ok,
      false,
    );
    assert.equal(
      (
        await request(thief, "admin:resume", {
          code: room.code,
          token: joined.token,
        })
      ).ok,
      false,
    );
    const sameName = await request(thief, "join", {
      code: room.code,
      name: "Cometa",
      color: 2,
    });
    if (sameName.ok) assert.notEqual(sameName.id, joined.id);
    // Fresh teacher token is separate from all player credentials.
    const teacherRetry = await f.client();
    const teacher = await request(teacherRetry, "admin:resume", {
      code: room.code,
      token: room.token,
    });
    assert.equal(teacher.ok, true);
  } finally {
    await f.cleanup();
  }
});

test("administrative authentication, lock and malformed packets fail safely", async () => {
  const f = await fixture();
  try {
    const attacker = await f.client();
    assert.equal(
      (await request(attacker, "admin:create", { password: "wrong" })).ok,
      false,
    );
    assert.equal(
      (
        await request(attacker, "join", {
          code: null,
          name: { bad: 1 },
          color: NaN,
        })
      ).ok,
      false,
    );
    assert.equal(
      (await request(attacker, "admin", { action: "start" })).ok,
      false,
    );
    assert.equal(
      (await request(attacker, "vote", { target: "nobody" })).ok,
      false,
    );
    const admin = await f.client();
    const room = await request(admin, "admin:create", { password: PASSWORD });
    assert.equal(room.ok, true);
    assert.equal((await request(admin, "admin", { action: "lock" })).ok, true);
    assert.equal(
      (
        await request(attacker, "join", {
          code: room.code,
          name: "Cerrada",
          color: 1,
        })
      ).ok,
      false,
    );
    assert.equal(
      (await request(admin, "admin", { action: "unlock" })).ok,
      true,
    );
    const student = await f.client();
    assert.equal(
      (
        await request(student, "join", {
          code: room.code,
          name: "Seguro",
          color: 1,
        })
      ).ok,
      true,
    );
    for (const event of [
      "action",
      "task:start",
      "task:input",
      "vote",
      "chat",
      "admin",
    ]) {
      const result = await request(student, event, null);
      assert.equal(result.ok, false, `${event} accepted null payload`);
    }
    student.emit("move", { x: Infinity, y: "bad" });
    student.emit("move", null);
    const state = await waitFor(admin, (s) => s.players.length === 1);
    assert.ok(Number.isFinite(state.players[0].x));
    assert.ok(Number.isFinite(state.players[0].y));
  } finally {
    await f.cleanup();
  }
});

export { PASSWORD, request, waitFor, fixture };

test("five-second sustained 26-client movement load records loopback metrics", async (t) => {
  const f = await fixture();
  try {
    const admin = await f.client();
    const room = await request(admin, "admin:create", { password: PASSWORD });
    const students = await Promise.all(
      Array.from({ length: 26 }, () => f.client()),
    );
    await Promise.all(
      students.map((s, i) =>
        request(s, "join", { code: room.code, name: `Carga ${i}`, color: i }),
      ),
    );
    assert.equal((await request(admin, "admin", { action: "start" })).ok, true);
    await waitFor(admin, (s) => s.phase === "playing");
    let packets = 0,
      bytes = 0,
      peakRss = process.memoryUsage().rss;
    const latencies: number[] = [];
    students.forEach((s) =>
      s.on("state", (state) => {
        packets++;
        bytes += Buffer.byteLength(JSON.stringify(state));
      }),
    );
    const cpuBefore = process.cpuUsage(),
      begin = performance.now();
    for (let frame = 0; frame < 100; frame++) {
      await Promise.all(
        students.map(async (s) => {
          const start = performance.now();
          const result = await request(s, "move", {
            x: frame % 40 < 20 ? 1 : -1,
            y: 0,
          });
          assert.equal(result.ok, true);
          latencies.push(performance.now() - start);
        }),
      );
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
    const elapsed = performance.now() - begin,
      cpu = process.cpuUsage(cpuBefore);
    latencies.sort((a, b) => a - b);
    assert.ok(
      packets >= 26 * 40,
      `Expected at least 40 snapshots per client; received ${packets}`,
    );
    assert.ok(students.every((s) => s.connected));
    assert.ok(students.every((s) => s.latest.phase === "playing"));
    t.diagnostic(
      JSON.stringify({
        scope:
          "single-process loopback server plus 26 clients; not Internet/device benchmark",
        students: 26,
        teacher: 1,
        movementAcks: latencies.length,
        elapsedMs: Math.round(elapsed),
        ackP50Ms: +latencies[Math.floor(latencies.length * 0.5)].toFixed(2),
        ackP95Ms: +latencies[Math.floor(latencies.length * 0.95)].toFixed(2),
        snapshots: packets,
        receivedSnapshotBytes: bytes,
        peakRssMiB: +(peakRss / 1048576).toFixed(2),
        processCpuMs: +((cpu.user + cpu.system) / 1000).toFixed(2),
      }),
    );
  } finally {
    await f.cleanup();
  }
});

test("reconnect during sabotage and meeting preserves role/tasks/vote; simultaneous resumes keep one identity", async () => {
  const f = await fixture();
  try {
    const admin = await f.client();
    const room = await request(admin, "admin:create", {
      password: PASSWORD,
      settings: { impostors: 1 },
    });
    const sockets = await Promise.all(
      Array.from({ length: 5 }, () => f.client()),
    );
    const joined = await Promise.all(
      sockets.map((s, i) =>
        request(s, "join", { code: room.code, name: `Sesión ${i}`, color: i }),
      ),
    );
    await request(admin, "admin", { action: "start" });
    const model = f.app.rooms.get(room.code)!;
    const imp = [...model.players.values()].find((p) => p.role === "impostor")!,
      crew = [...model.players.values()].find((p) => p.role === "crew")!;
    const impSocket = sockets[joined.findIndex((j) => j.id === imp.id)],
      index = joined.findIndex((j) => j.id === crew.id),
      credential = joined[index];
    model.sabotageCooldown = 0;
    await request(impSocket, "action", { type: "sabotage", kind: "oxygen" });
    const tasks = JSON.stringify(crew.tasks);
    sockets[index].disconnect();
    await waitFor(
      admin,
      (s) =>
        s.sabotage?.kind === "oxygen" &&
        !s.players.find((p: any) => p.id === crew.id).connected,
    );
    const retry = await f.client();
    assert.equal(
      (
        await request(retry, "resume", {
          code: room.code,
          token: credential.token,
        })
      ).ok,
      true,
    );
    const repairedSession = await waitFor(
      retry,
      (s) => s.sabotage?.kind === "oxygen",
    );
    assert.equal(
      repairedSession.players.find((p: any) => p.id === crew.id).role,
      "crew",
    );
    assert.equal(JSON.stringify(crew.tasks), tasks);
    model.sabotage = null;
    Object.assign(crew, { x: 1200, y: 300 });
    assert.equal(
      (await request(retry, "action", { type: "emergency" })).ok,
      true,
    );
    model.meeting!.stage = "voting";
    model.meeting!.remaining = 60;
    assert.equal((await request(retry, "vote", { target: null })).ok, true);
    retry.disconnect();
    const a = await f.client(),
      b = await f.client();
    const attempts = await Promise.all([
      request(a, "resume", { code: room.code, token: credential.token }),
      request(b, "resume", { code: room.code, token: credential.token }),
    ]);
    attempts.forEach((r) => assert.equal(r.ok, true));
    const surviving = b.connected ? b : a;
    const resumed = await waitFor(
      surviving,
      (s) => s.phase === "meeting" && s.meeting.voted === true,
    );
    assert.equal(model.players.size, 5);
    assert.equal(model.meeting!.votes.size, 1);
    assert.equal(resumed.meeting.voted, true);
    assert.equal(
      (await request(surviving, "vote", { target: imp.id })).ok,
      false,
    );
  } finally {
    await f.cleanup();
  }
});
