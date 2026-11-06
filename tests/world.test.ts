import { test } from "node:test";
import assert from "node:assert/strict";
import {
  walkable,
  TERMINALS,
  VENTS,
  ROOMS,
  WORLD,
  lineOfSight,
} from "../src/shared/world.js";
test("all rooms, tasks and vents reachable through collision-safe corridors", () => {
  const step = 10;
  const start = { x: 1200, y: 300 };
  const queue = [start];
  const seen = new Set(["1200,300"]);
  for (let i = 0; i < queue.length; i++) {
    const p = queue[i];
    for (const [dx, dy] of [
      [step, 0],
      [-step, 0],
      [0, step],
      [0, -step],
    ]) {
      const x = p.x + dx,
        y = p.y + dy,
        k = `${x},${y}`;
      if (!seen.has(k) && walkable(x, y)) {
        seen.add(k);
        queue.push({ x, y });
      }
    }
  }
  for (const p of [
    ...TERMINALS,
    ...VENTS,
    ...ROOMS.map((r) => ({ id: r.id, x: r.x + r.w / 2, y: r.y + r.h / 2 })),
  ]) {
    assert.ok(
      [...seen].some((k) => {
        const [x, y] = k.split(",").map(Number);
        return Math.hypot(x - p.x, y - p.y) < 20;
      }),
      `Unreachable ${p.id}`,
    );
  }
  assert.equal(walkable(0, 0), false);
  assert.equal(walkable(WORLD.width, WORLD.height), false);
  assert.equal(lineOfSight(start, { x: 0, y: 0 }), false);
});

test("lighting rays stop at walls and shrink with sabotaged vision", async () => {
  const { visibilityRays, distance } = await import("../src/shared/world.js");
  for (const room of ROOMS) {
    const origin = { x: room.x + room.w / 2, y: room.y + room.h / 2 };
    const normal = visibilityRays(origin, 400);
    const dark = visibilityRays(origin, 140);
    assert.equal(normal.length, 128);
    for (let i = 0; i < normal.length; i++) {
      assert.ok(distance(origin, normal[i]) <= 400.00001);
      assert.ok(distance(origin, dark[i]) <= 140.00001);
      assert.ok(
        distance(origin, dark[i]) <= distance(origin, normal[i]) + 0.00001,
      );
    }
  }
  const origin = { x: ROOMS[0].x + 20, y: ROOMS[0].y + 20 };
  assert.ok(visibilityRays(origin, 400).some((p) => distance(origin, p) < 40));
  assert.ok(visibilityRays(origin, 0).every((p) => distance(origin, p) === 0));
});
