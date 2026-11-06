import {
  randomBytes,
  randomInt,
  randomUUID,
  timingSafeEqual,
} from "node:crypto";
import {
  ROOMS,
  TERMINALS,
  VENTS,
  COLORS,
  walkable,
  lineOfSight,
  distance,
} from "../shared/world.js";
export type Role = "crew" | "impostor";
export interface Player {
  id: string;
  token: string;
  name: string;
  color: number;
  x: number;
  y: number;
  alive: boolean;
  connected: boolean;
  role: Role;
  socketId: string;
  dx: number;
  dy: number;
  inputAt: number;
  disconnectedAt: number;
  tasks: { id: string; done: boolean }[];
  killCooldown: number;
  emergency: number;
  vented: boolean;
  challenge?: Challenge;
  lastChat: number;
}
export interface Challenge {
  id: string;
  kind: string;
  seed: number[];
  step: number;
  startedAt: number;
  lastAt: number;
}
export interface Settings {
  impostors: number;
  tasks: number;
  discussion: number;
  voting: number;
  killCooldown: number;
  duration: number;
  chat: boolean;
}
export interface Room {
  code: string;
  adminToken: string;
  adminSocket: string;
  players: Map<string, Player>;
  phase: "lobby" | "playing" | "meeting" | "ended";
  paused: boolean;
  locked: boolean;
  settings: Settings;
  time: number;
  remaining: number;
  createdAt: number;
  lastActive: number;
  bodies: { id: string; x: number; y: number; color: number }[];
  sabotage: null | {
    kind: string;
    remaining: number;
    panels: string[];
    repairs: Map<string, { player: string; time: number }>;
  };
  sabotageCooldown: number;
  meeting: null | {
    remaining: number;
    stage: "discussion" | "voting";
    votes: Map<string, string | null>;
    messages: { name: string; text: string }[];
  };
  winner?: string;
  reason?: string;
  notice?: string;
  meetingResult?: {
    id: string;
    player: { id: string; name: string; color: number } | null;
  };
}
export const DOORS = [
  { x: 930, y: 505, w: 130, h: 24 },
  { x: 1635, y: 270, w: 24, h: 130 },
  { x: 310, y: 475, w: 130, h: 24 },
  { x: 1200, y: 1080, w: 130, h: 24 },
];
export const defaults: Settings = {
  impostors: 3,
  tasks: 3,
  discussion: 60,
  voting: 45,
  killCooldown: 30,
  duration: 1200,
  chat: true,
};
export const token = () => randomBytes(24).toString("hex");
export function validSettings(raw: unknown, base = defaults): Settings {
  if (!raw || typeof raw !== "object") return { ...base };
  const r = raw as Record<string, unknown>;
  const out = { ...base };
  for (const [key, min, max] of [
    ["impostors", 1, 4],
    ["tasks", 1, 10],
    ["discussion", 5, 120],
    ["voting", 5, 90],
    ["killCooldown", 10, 90],
    ["duration", 300, 2400],
  ] as const) {
    if (r[key] !== undefined) {
      if (
        !Number.isInteger(r[key]) ||
        Number(r[key]) < min ||
        Number(r[key]) > max
      )
        throw Error(`Configuración inválida: ${key}`);
      out[key] = Number(r[key]);
    }
  }
  if (r.chat !== undefined) {
    if (typeof r.chat !== "boolean") throw Error("Comunicación inválida");
    out.chat = r.chat;
  }
  return out;
}
export function passwordMatches(a: unknown, b: string) {
  if (typeof a !== "string" || a.length > 256) return false;
  const aa = Buffer.from(a),
    bb = Buffer.from(b);
  return aa.length === bb.length && timingSafeEqual(aa, bb);
}
export function spawn() {
  const c = ROOMS[0];
  return { x: c.x + c.w / 2, y: c.y + c.h / 2 };
}
export function createRoom(
  code: string,
  adminSocket: string,
  settings: unknown,
): Room {
  return {
    code,
    adminToken: token(),
    adminSocket,
    players: new Map(),
    phase: "lobby",
    paused: false,
    locked: false,
    settings: validSettings(settings),
    time: 0,
    remaining: 1200,
    createdAt: Date.now(),
    lastActive: Date.now(),
    bodies: [],
    sabotage: null,
    sabotageCooldown: 20,
    meeting: null,
  };
}
export function shuffle<T>(a: T[]): T[] {
  for (let i = a.length - 1; i > 0; i--) {
    const j = randomInt(i + 1);
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}
export function start(r: Room) {
  if (r.phase !== "lobby") throw Error("La partida ya comenzó");
  const ps = [...r.players.values()];
  if (ps.length < 4) throw Error("Se necesitan al menos 4 jugadores");
  if (ps.some((p) => !p.connected))
    throw Error("Reconectá o expulsá a los jugadores desconectados");
  if (r.settings.impostors * 2 >= ps.length)
    throw Error("Debe haber más tripulantes que impostores");
  const order = shuffle([...ps]);
  for (const [i, p] of order.entries()) {
    p.role = i < r.settings.impostors ? "impostor" : "crew";
    p.alive = true;
    p.vented = false;
    p.dx = p.dy = 0;
    p.killCooldown = r.settings.killCooldown;
    p.emergency = 1;
    p.challenge = undefined;
    const at = spawn();
    p.x = at.x + ((i % 6) - 2.5) * 35;
    p.y = at.y + (Math.floor(i / 6) - 2) * 35;
    p.tasks =
      p.role === "crew"
        ? shuffle([...TERMINALS])
            .slice(0, r.settings.tasks)
            .map((t) => ({ id: t.id, done: false }))
        : [];
  }
  r.phase = "playing";
  r.paused = false;
  r.time = 0;
  r.remaining = r.settings.duration;
  r.bodies = [];
  r.sabotage = null;
  r.sabotageCooldown = 20;
  r.meeting = null;
  r.winner = r.reason = undefined;
  r.meetingResult = undefined;
  r.notice = "¡Comienza la misión!";
}
export function finish(r: Room, winner: string, reason: string) {
  r.phase = "ended";
  r.paused = false;
  r.winner = winner;
  r.reason = reason;
  r.meeting = null;
  r.sabotage = null;
  for (const p of r.players.values()) {
    p.dx = p.dy = 0;
    p.challenge = undefined;
  }
}
export function evaluate(r: Room) {
  if (r.phase !== "playing") return;
  const ps = [...r.players.values()];
  const imp = ps.filter((p) => p.alive && p.role === "impostor").length,
    crew = ps.filter((p) => p.alive && p.role === "crew").length;
  if (!imp)
    return finish(r, "Tripulantes", "Todos los impostores fueron expulsados.");
  if (imp >= crew)
    return finish(
      r,
      "Impostores",
      "Los impostores igualaron a la tripulación.",
    );
  const ts = ps.filter((p) => p.role === "crew").flatMap((p) => p.tasks);
  if (ts.length && ts.every((t) => t.done))
    finish(r, "Tripulantes", "Todas las tareas fueron completadas.");
}
function movingAllowed(r: Room, p: Player) {
  return r.phase === "playing" && !r.paused && !p.vented && !p.challenge;
}
export function tick(r: Room, dt: number) {
  if (r.paused || r.phase === "ended") return;
  if (r.phase === "lobby") return;
  r.time += dt;
  r.remaining = Math.max(0, r.remaining - dt);
  if (r.remaining <= 0)
    return finish(r, "Sin ganador", "Se alcanzó el tiempo máximo de clase.");
  if (r.phase === "meeting") {
    const m = r.meeting!;
    m.remaining -= dt;
    if (m.remaining <= 0) {
      if (m.stage === "discussion") {
        m.stage = "voting";
        m.remaining = r.settings.voting;
      } else resolveMeeting(r);
    }
    return;
  }
  r.sabotageCooldown = Math.max(0, r.sabotageCooldown - dt);
  if (r.sabotage) {
    r.sabotage.remaining = Math.max(0, r.sabotage.remaining - dt);
    for (const [k, v] of r.sabotage.repairs)
      if (r.time - v.time > 8) r.sabotage.repairs.delete(k);
    r.sabotage.panels = [...r.sabotage.repairs.keys()];
    if (r.sabotage.remaining <= 0) {
      if (["oxygen", "reactor"].includes(r.sabotage.kind))
        return finish(
          r,
          "Impostores",
          "La emergencia no fue reparada a tiempo.",
        );
      r.sabotage = null;
    }
  }
  for (const p of r.players.values()) {
    p.killCooldown = Math.max(0, p.killCooldown - dt);
    if (!movingAllowed(r, p) || !p.connected) continue;
    if (Date.now() - p.inputAt > 350) {
      p.dx = p.dy = 0;
    }
    const norm = Math.max(1, Math.hypot(p.dx, p.dy));
    const x = p.x + (p.dx / norm) * 185 * dt,
      y = p.y + (p.dy / norm) * 185 * dt;
    const allowed = (x: number, y: number) =>
      walkable(x, y) &&
      (!p.alive ||
        r.sabotage?.kind !== "doors" ||
        !DOORS.some(
          (d) =>
            x > d.x - 15 &&
            x < d.x + d.w + 15 &&
            y > d.y - 15 &&
            y < d.y + d.h + 15,
        ));
    if (allowed(x, p.y)) p.x = x;
    if (allowed(p.x, y)) p.y = y;
  }
  evaluate(r);
}
export function beginMeeting(r: Room, notice: string) {
  r.phase = "meeting";
  r.notice = notice;
  r.meeting = {
    stage: "discussion",
    remaining: r.settings.discussion,
    votes: new Map(),
    messages: [],
  };
  r.bodies = [];
  r.sabotage = null;
  for (const p of r.players.values()) {
    p.dx = p.dy = 0;
    p.vented = false;
    p.challenge = undefined;
  }
}
export function resolveMeeting(r: Room) {
  const counts = new Map<string, number>();
  for (const v of r.meeting!.votes.values()) {
    const key = v ?? "skip";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  const sorted = [...counts].sort((a, b) => b[1] - a[1]);
  let out: Player | undefined;
  if (
    sorted[0] &&
    sorted[0][0] !== "skip" &&
    (!sorted[1] || sorted[0][1] > sorted[1][1])
  )
    out = r.players.get(sorted[0][0]);
  if (out) {
    out.alive = false;
    r.notice = `${out.name} fue expulsado al espacio.`;
  } else r.notice = "Nadie fue expulsado.";
  r.meetingResult = {
    id: randomUUID(),
    player: out ? { id: out.id, name: out.name, color: out.color } : null,
  };
  r.phase = "playing";
  r.meeting = null;
  for (const p of r.players.values()) {
    Object.assign(p, spawn());
    p.killCooldown = r.settings.killCooldown;
  }
  evaluate(r);
}
export function requirePlay(r: Room, p: Player, alive = true) {
  if (r.phase !== "playing" || r.paused)
    throw Error("Acción no disponible ahora");
  if (alive && !p.alive)
    throw Error("Los fantasmas no pueden realizar esta acción");
  if (p.vented) throw Error("Salí del conducto primero");
}
export function act(r: Room, p: Player, data: any) {
  if (!data || typeof data.type !== "string") throw Error("Acción inválida");
  if (data.type === "vent") {
    if (r.phase !== "playing" || r.paused || !p.alive || p.role !== "impostor")
      throw Error("Conducto no disponible");
    if (p.vented) {
      const target = VENTS.find((v) => v.id === data.target);
      if (target) {
        p.x = target.x;
        p.y = target.y;
      }
      p.vented = false;
    } else {
      if (!VENTS.some((v) => distance(p, v) < 65 && lineOfSight(p, v)))
        throw Error("Acercate a un conducto");
      p.vented = true;
      p.dx = p.dy = 0;
    }
    return;
  }
  requirePlay(r, p);
  if (data.type === "kill") {
    if (p.role !== "impostor" || p.killCooldown > 0)
      throw Error("Habilidad no disponible");
    const target = r.players.get(data.target);
    if (
      !target ||
      !target.alive ||
      target.role === "impostor" ||
      target.vented ||
      distance(p, target) > 85 ||
      !lineOfSight(p, target)
    )
      throw Error("Objetivo fuera de alcance");
    target.alive = false;
    target.challenge = undefined;
    r.bodies.push({
      id: target.id,
      x: target.x,
      y: target.y,
      color: target.color,
    });
    p.killCooldown = r.settings.killCooldown;
    evaluate(r);
    return;
  }
  if (data.type === "report") {
    if (!r.bodies.some((b) => distance(p, b) < 110 && lineOfSight(p, b)))
      throw Error("No hay un cuerpo cercano");
    beginMeeting(r, `${p.name} encontró un cuerpo.`);
    return;
  }
  if (data.type === "emergency") {
    if (p.emergency <= 0 || r.sabotage || distance(p, spawn()) > 120)
      throw Error("El botón no está disponible");
    p.emergency--;
    beginMeeting(r, `${p.name} convocó una reunión.`);
    return;
  }
  if (data.type === "sabotage") {
    if (p.role !== "impostor" || r.sabotage || r.sabotageCooldown > 0)
      throw Error("Sabotaje no disponible");
    if (
      !["lights", "oxygen", "reactor", "communications", "doors"].includes(
        data.kind,
      )
    )
      throw Error("Sabotaje inválido");
    r.sabotage = {
      kind: data.kind,
      remaining: ["oxygen", "reactor"].includes(data.kind)
        ? 60
        : data.kind === "doors"
          ? 15
          : 90,
      panels: [],
      repairs: new Map(),
    };
    r.sabotageCooldown = 45;
    return;
  }
  if (data.type === "repair") {
    if (!r.sabotage) throw Error("No hay sabotaje");
    const terminal = TERMINALS.find((t) => t.id === data.target);
    if (!terminal || distance(p, terminal) > 90 || !lineOfSight(p, terminal))
      throw Error("Acercate a un panel");
    const s = r.sabotage;
    s.repairs.set(terminal.id, { player: p.id, time: r.time });
    const critical = ["oxygen", "reactor"].includes(s.kind);
    s.panels = [...s.repairs.keys()];
    if (
      !critical ||
      (s.repairs.size >= 2 &&
        new Set([...s.repairs.values()].map((v) => v.player)).size >= 2)
    ) {
      r.sabotage = null;
      r.notice = "Sabotaje reparado.";
    }
    return;
  }
  throw Error("Acción desconocida");
}
export function newChallenge(r: Room, p: Player, id: unknown) {
  requirePlay(r, p, false);
  if (typeof id !== "string") throw Error("Panel inválido");
  const t = TERMINALS.find((t) => t.id === id);
  if (!t || distance(p, t) > 90 || !lineOfSight(p, t))
    throw Error("Acercate al panel");
  if (p.role !== "crew" || !p.tasks.some((t) => t.id === id && !t.done))
    throw Error("No tenés una tarea pendiente aquí");
  if (r.sabotage?.kind === "communications")
    throw Error("Repará Comunicaciones primero");
  const seed = shuffle([0, 1, 2, 3]);
  p.dx = p.dy = 0;
  return (p.challenge = {
    id,
    kind: t.kind,
    seed,
    step: 0,
    startedAt: r.time,
    lastAt: r.time,
  });
}
export function taskInput(r: Room, p: Player, data: any) {
  if (
    p.challenge &&
    data?.id === p.challenge.id &&
    data?.action?.type === "cancel"
  ) {
    p.challenge = undefined;
    return { complete: false };
  }
  requirePlay(r, p, false);
  const c = p.challenge;
  if (!c || data?.id !== c.id) throw Error("Tarea no iniciada");
  const t = TERMINALS.find((t) => t.id === c.id)!;
  if (distance(p, t) > 90 || !lineOfSight(p, t))
    throw Error("Panel fuera de alcance");
  if (data.action?.type === "cancel") {
    p.challenge = undefined;
    return { complete: false };
  }
  if (r.sabotage?.kind === "communications")
    throw Error("Comunicaciones fuera de servicio");
  const a = data.action;
  if (!a || typeof a !== "object") throw Error("Entrada inválida");
  if (r.time - c.lastAt < 0.12) throw Error("Esperá un instante");
  let valid = false,
    needed = 4;
  switch (c.kind) {
    case "wires":
      valid = a.value === c.seed[c.step];
      break;
    case "card":
      needed = 1;
      valid =
        Number.isFinite(a.duration) &&
        a.duration >= 0.65 &&
        a.duration <= 1.6 &&
        r.time - c.startedAt >= a.duration;
      break;
    case "download":
      needed = 1;
      valid = a.value === "confirm" && r.time - c.startedAt >= 6;
      break;
    case "asteroids":
      needed = 8;
      valid = a.value === c.step;
      break;
    case "shields":
      needed = 4;
      valid = a.value === c.seed[c.step];
      break;
    case "engines":
    case "navigation":
      needed = 1;
      valid =
        Number.isFinite(a.value) && Math.abs(a.value - c.seed[0] * 25) < 4;
      break;
    case "samples":
      needed = 1;
      valid = a.value === c.seed[0] && r.time - c.startedAt >= 5;
      break;
    case "filter":
      needed = 6;
      valid = a.value === c.step;
      break;
    case "distributor":
      needed = 3;
      valid =
        Number.isFinite(a.value) &&
        Math.abs(a.value - 50) < 8 &&
        r.time - c.startedAt >= c.step + 1;
      break;
    default:
      valid = a.value === c.seed[c.step];
  }
  if (!valid) throw Error("Intentá nuevamente");
  c.step++;
  c.lastAt = r.time;
  if (c.step >= needed) {
    const assigned = p.tasks.find((t) => t.id === c.id)!;
    assigned.done = true;
    p.challenge = undefined;
    evaluate(r);
    return { complete: true };
  }
  return { challenge: { ...c }, complete: false };
}
export function snapshot(r: Room, viewer?: Player) {
  const admin = !viewer;
  const publicRoster = r.phase !== "playing";
  const vision =
    r.sabotage?.kind === "lights" && viewer?.role === "crew"
      ? 140
      : viewer?.role === "impostor"
        ? 540
        : 400;
  const visible = (p: { x: number; y: number }) =>
    !viewer ||
    !viewer.alive ||
    (distance(viewer, p) <= vision && lineOfSight(viewer, p));
  const ps = [...r.players.values()];
  const tasks = ps.filter((p) => p.role === "crew").flatMap((p) => p.tasks);
  return {
    code: r.code,
    visionRadius: vision,
    admin,
    phase: r.phase,
    paused: r.paused,
    locked: r.locked,
    settings: r.settings,
    me: viewer?.id ?? "admin",
    players: ps
      .filter(
        (p) =>
          admin ||
          p.id === viewer?.id ||
          publicRoster ||
          (!p.vented && (p.alive || !viewer!.alive) && visible(p)),
      )
      .map((p) => ({
        id: p.id,
        name: p.name,
        color: p.color,
        x: publicRoster && !admin ? spawn().x : p.x,
        y: publicRoster && !admin ? spawn().y : p.y,
        alive: p.alive,
        connected: p.connected,
        vented: p.vented,
        role:
          admin ||
          r.phase === "ended" ||
          p.id === viewer?.id ||
          (viewer?.role === "impostor" && p.role === "impostor")
            ? p.role
            : undefined,
      })),
    bodies: r.bodies.filter(visible),
    tasks: viewer?.tasks ?? [],
    progress: { done: tasks.filter((t) => t.done).length, total: tasks.length },
    sabotage: r.sabotage
      ? {
          kind: r.sabotage.kind,
          remaining: r.sabotage.remaining,
          panels: r.sabotage.panels,
        }
      : null,
    meeting: r.meeting
      ? {
          remaining: r.meeting.remaining,
          stage: r.meeting.stage,
          votes: r.meeting.votes.size,
          eligible: ps.filter((p) => p.alive).length,
          messages: r.meeting.messages,
          voted: viewer ? r.meeting.votes.has(viewer.id) : false,
        }
      : null,
    winner: r.winner,
    reason: r.reason,
    remaining: r.remaining,
    killCooldown: viewer?.killCooldown ?? 0,
    sabotageCooldown: r.sabotageCooldown,
    emergencies: viewer?.emergency ?? 0,
    notice: r.notice,
    meetingResult: r.meetingResult,
    serverTime: r.time,
    doors: r.sabotage?.kind === "doors" ? DOORS : [],
  };
}
