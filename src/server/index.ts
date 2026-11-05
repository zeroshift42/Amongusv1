import express from "express";
import { createServer } from "node:http";
import { Server, Socket } from "socket.io";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes } from "node:crypto";
import { COLORS, ROOMS } from "../shared/world.js";
import {
  act,
  createRoom,
  defaults,
  finish,
  newChallenge,
  passwordMatches,
  snapshot,
  spawn,
  start,
  taskInput,
  tick,
  token,
  validSettings,
  type Player,
  type Room,
} from "./game.js";

export function createGameServer({
  adminPassword,
}: {
  adminPassword: string;
  port?: number;
}) {
  if (!adminPassword || adminPassword.length < 12)
    throw Error("ADMIN_PASSWORD debe tener al menos 12 caracteres.");
  const app = express();
  app.disable("x-powered-by");
  app.set("trust proxy", 1);
  app.use((_req, res, next) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    res.setHeader(
      "Content-Security-Policy",
      "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data: blob:; connect-src 'self' ws: wss:; font-src 'self' data:; media-src 'self' blob:; frame-ancestors 'none'",
    );
    next();
  });
  app.get("/health", (_req, res) => res.json({ ok: true, service: "nave-26" }));
  app.use(express.static(resolve("dist/client")));
  app.get("*", (_req, res) => res.sendFile(resolve("dist/client/index.html")));
  const http = createServer(app);
  const io = new Server(http, {
    maxHttpBufferSize: 16_384,
    pingTimeout: 20000,
    pingInterval: 10000,
    serveClient: false,
    allowRequest: (req, cb) => {
      const origin = req.headers.origin;
      if (!origin) return cb(null, true);
      try {
        const url = new URL(origin);
        cb(null, url.host === req.headers.host);
      } catch {
        cb("Origen inválido", false);
      }
    },
  });
  const rooms = new Map<string, Room>();
  const authAttempts = new Map<string, { count: number; until: number }>();
  const connections = new Map<string, number>();
  const ipOf = (s: Socket) => s.handshake.address;
  function limitAuth(s: Socket) {
    const ip = ipOf(s),
      now = Date.now();
    let entry = authAttempts.get(ip);
    if (!entry || now > entry.until) {
      entry = { count: 0, until: now + 60000 };
      authAttempts.set(ip, entry);
    }
    entry.count++;
    if (entry.count > 120)
      throw Error("Demasiados intentos. Esperá un minuto.");
  }
  function attached(s: Socket): {
    room: Room;
    player?: Player;
    admin: boolean;
  } {
    const room = rooms.get(s.data.code);
    if (!room)
      throw Error("La sesión terminó. Pedile una nueva sala al docente.");
    const admin = s.data.admin === true && room.adminSocket === s.id;
    const player = room.players.get(s.data.id);
    if (!admin && (!player || player.socketId !== s.id))
      throw Error("Sesión inválida");
    return { room, player, admin };
  }
  function student(s: Socket) {
    const a = attached(s);
    if (a.admin || !a.player) throw Error("Esta acción es de jugadores");
    return { room: a.room, player: a.player };
  }
  function roomCode(data: any) {
    if (
      !data ||
      typeof data.code !== "string" ||
      !/^([A-F0-9]{8})$/.test(data.code.toUpperCase())
    )
      throw Error("Código inválido");
    const room = rooms.get(data.code.toUpperCase());
    if (!room) throw Error("Sala no encontrada o servidor reiniciado");
    return room;
  }
  function unused(s: Socket) {
    if (s.data.code)
      throw Error(
        "Ya estás dentro de una sala. Recargá para cambiar de sesión.",
      );
  }
  function associate(s: Socket, r: Room, p?: Player) {
    s.data.code = r.code;
    s.data.id = p?.id;
    s.data.admin = !p;
    r.lastActive = Date.now();
    if (p) {
      if (p.socketId && p.socketId !== s.id)
        io.sockets.sockets.get(p.socketId)?.disconnect(true);
      p.socketId = s.id;
      p.connected = true;
      p.disconnectedAt = 0;
    } else {
      if (r.adminSocket && r.adminSocket !== s.id)
        io.sockets.sockets.get(r.adminSocket)?.disconnect(true);
      r.adminSocket = s.id;
    }
    s.emit("state", snapshot(r, p));
  }
  io.use((s, next) => {
    const ip = ipOf(s);
    if ((connections.get(ip) ?? 0) >= 160)
      return next(Error("Límite de conexiones"));
    connections.set(ip, (connections.get(ip) ?? 0) + 1);
    next();
  });
  io.on("connection", (s) => {
    let window = Date.now(),
      count = 0;
    const bind = (name: string, fn: (data: any) => any) =>
      s.on(name, (data: any, ack?: Function) => {
        const now = Date.now();
        if (now - window > 1000) {
          window = now;
          count = 0;
        }
        count++;
        if (count > 80) {
          if (typeof ack === "function")
            ack({ ok: false, error: "Demasiadas acciones" });
          return;
        }
        try {
          const result = fn(data);
          if (typeof ack === "function") ack({ ok: true, ...result });
        } catch (e) {
          if (typeof ack === "function")
            ack({
              ok: false,
              error: e instanceof Error ? e.message : "Solicitud inválida",
            });
        }
      });
    bind("admin:create", (d) => {
      limitAuth(s);
      unused(s);
      if (!passwordMatches(d?.password, adminPassword))
        throw Error("Credencial docente incorrecta");
      if (rooms.size >= 50) throw Error("Servidor lleno");
      let code: string;
      do {
        code = randomBytes(4).toString("hex").toUpperCase();
      } while (rooms.has(code));
      const r = createRoom(code, s.id, d?.settings);
      rooms.set(code, r);
      associate(s, r);
      return { code, token: r.adminToken, id: "admin" };
    });
    bind("admin:resume", (d) => {
      limitAuth(s);
      unused(s);
      const r = roomCode(d);
      if (typeof d.token !== "string" || d.token !== r.adminToken)
        throw Error("Sesión docente inválida");
      associate(s, r);
      return { id: "admin", code: r.code };
    });
    bind("join", (d) => {
      limitAuth(s);
      unused(s);
      const r = roomCode(d);
      if (r.phase !== "lobby" || r.locked)
        throw Error("El ingreso está cerrado");
      if (r.players.size >= 26) throw Error("Sala completa (26 estudiantes)");
      if (
        typeof d.name !== "string" ||
        d.name.trim().length < 1 ||
        d.name.trim().length > 18 ||
        !/^[-\p{L}\p{N} _]+$/u.test(d.name.trim())
      )
        throw Error(
          "Apodo inválido: usá letras, números o espacios (18 caracteres)",
        );
      const name = d.name.trim();
      if (
        [...r.players.values()].some(
          (p) => p.name.toLocaleLowerCase() === name.toLocaleLowerCase(),
        )
      )
        throw Error("Ese apodo ya está en uso");
      if (!Number.isInteger(d.color) || d.color < 0 || d.color >= COLORS.length)
        throw Error("Color inválido");
      const used = new Set([...r.players.values()].map((p) => p.color));
      const color = used.has(d.color)
        ? COLORS.findIndex((_, i) => !used.has(i))
        : d.color;
      const p: Player = {
        id: randomBytes(8).toString("hex"),
        token: token(),
        name,
        color,
        ...spawn(),
        alive: true,
        connected: true,
        role: "crew",
        socketId: s.id,
        dx: 0,
        dy: 0,
        inputAt: 0,
        disconnectedAt: 0,
        tasks: [],
        killCooldown: 0,
        emergency: 1,
        vented: false,
        lastChat: -100,
      };
      r.players.set(p.id, p);
      associate(s, r, p);
      return { id: p.id, token: p.token, code: r.code };
    });
    bind("resume", (d) => {
      limitAuth(s);
      unused(s);
      const r = roomCode(d);
      if (typeof d.token !== "string") throw Error("Sesión inválida");
      const p = [...r.players.values()].find((p) => p.token === d.token);
      if (
        !p ||
        (p.disconnectedAt && Date.now() - p.disconnectedAt > 10 * 60 * 1000)
      )
        throw Error("La sesión venció. Pedile ayuda al docente.");
      associate(s, r, p);
      return { id: p.id, code: r.code };
    });
    bind("admin", (d) => {
      const { room: r, admin } = attached(s);
      if (!admin) throw Error("Acceso exclusivo del docente");
      if (!d || typeof d.action !== "string") throw Error("Acción inválida");
      switch (d.action) {
        case "start":
          start(r);
          break;
        case "pause":
          if (!["playing", "meeting"].includes(r.phase))
            throw Error("No hay partida activa");
          r.paused = true;
          break;
        case "resume":
          r.paused = false;
          break;
        case "end":
          finish(r, "Sin ganador", "El docente finalizó la partida.");
          break;
        case "reset":
          r.phase = "lobby";
          r.paused = false;
          r.locked = false;
          r.meeting = null;
          r.sabotage = null;
          r.bodies = [];
          r.winner = r.reason = undefined;
          r.time = 0;
          r.remaining = r.settings.duration;
          r.notice = "Listos para una nueva misión";
          for (const p of r.players.values()) {
            Object.assign(p, spawn());
            p.alive = true;
            p.role = "crew";
            p.tasks = [];
            p.vented = false;
            p.challenge = undefined;
            p.dx = p.dy = 0;
          }
          break;
        case "lock":
          r.locked = true;
          break;
        case "unlock":
          r.locked = false;
          break;
        case "settings":
          if (r.phase !== "lobby")
            throw Error("Ajustá las reglas antes de comenzar");
          r.settings = validSettings(d.settings, r.settings);
          break;
        case "kick": {
          const p = r.players.get(d.id);
          if (!p) throw Error("Jugador no encontrado");
          r.players.delete(p.id);
          io.sockets.sockets.get(p.socketId)?.emit("kicked");
          io.sockets.sockets.get(p.socketId)?.disconnect(true);
          break;
        }
        default:
          throw Error("Acción docente desconocida");
      }
      return {};
    });
    bind("move", (d) => {
      const { room: r, player: p } = student(s);
      if (
        !d ||
        !Number.isFinite(d.x) ||
        !Number.isFinite(d.y) ||
        Math.abs(d.x) > 1 ||
        Math.abs(d.y) > 1
      )
        throw Error("Movimiento inválido");
      if (r.phase !== "playing" || r.paused || p.vented || p.challenge) {
        p.dx = p.dy = 0;
        return {};
      }
      p.dx = d.x;
      p.dy = d.y;
      p.inputAt = Date.now();
      return {};
    });
    bind("action", (d) => {
      const { room, player } = student(s);
      act(room, player, d);
      return {};
    });
    bind("vote", (d) => {
      const { room: r, player: p } = student(s);
      if (
        r.phase !== "meeting" ||
        r.paused ||
        !p.alive ||
        r.meeting?.stage !== "voting"
      )
        throw Error("No podés votar ahora");
      if (r.meeting.votes.has(p.id)) throw Error("Ya votaste");
      if (
        !d ||
        !(
          d.target === null ||
          (typeof d.target === "string" && r.players.get(d.target)?.alive)
        )
      )
        throw Error("Voto inválido");
      r.meeting.votes.set(p.id, d.target);
      return {};
    });
    bind("chat", (d) => {
      const { room: r, player: p } = student(s);
      if (
        r.phase !== "meeting" ||
        r.paused ||
        !p.alive ||
        !r.settings.chat ||
        !r.meeting
      )
        throw Error("Comunicación no disponible");
      if (r.time - p.lastChat < 2)
        throw Error("Esperá antes de enviar otra frase");
      if (!d || !Number.isInteger(d.phrase) || d.phrase < 0 || d.phrase > 7)
        throw Error("Frase inválida");
      const target = r.players.get(d.target)?.name ?? "alguien";
      const location = ROOMS.find((x) => x.id === d.room)?.name ?? "la nave";
      const phrases = [
        `Vi a ${target} en ${location}.`,
        "Encontré un cuerpo.",
        "Estaba haciendo tareas.",
        `Tengo una sospecha sobre ${target}.`,
        "¿Dónde estabas?",
        "No tengo pruebas.",
        `Creo que fue ${target}.`,
        "Propongo saltar la votación.",
      ];
      r.meeting.messages.push({ name: p.name, text: phrases[d.phrase] });
      if (r.meeting.messages.length > 60) r.meeting.messages.shift();
      p.lastChat = r.time;
      return {};
    });
    bind("task:start", (d) => {
      const { room, player } = student(s);
      return { challenge: newChallenge(room, player, d?.id) };
    });
    bind("task:input", (d) => {
      const { room, player } = student(s);
      return taskInput(room, player, d);
    });
    s.on("disconnect", () => {
      const ip = ipOf(s);
      const remaining = (connections.get(ip) ?? 1) - 1;
      if (remaining > 0) connections.set(ip, remaining);
      else connections.delete(ip);
      const r = rooms.get(s.data.code);
      const p = r?.players.get(s.data.id);
      if (p?.socketId === s.id) {
        p.connected = false;
        p.disconnectedAt = Date.now();
        p.dx = p.dy = 0;
        p.challenge = undefined;
      }
      if (r) r.lastActive = Date.now();
    });
  });
  let ticks = 0;
  const interval = setInterval(() => {
    ticks++;
    for (const r of rooms.values()) {
      for (const p of r.players.values())
        if (
          !p.connected &&
          p.disconnectedAt &&
          Date.now() - p.disconnectedAt > 10 * 60 * 1000
        ) {
          r.players.delete(p.id);
          r.meeting?.votes.delete(p.id);
          r.notice = `La plaza de ${p.name} venció tras 10 minutos sin conexión.`;
        }
      tick(r, 0.05);
      if (ticks % 2 === 0) {
        if (r.adminSocket)
          io.sockets.sockets.get(r.adminSocket)?.emit("state", snapshot(r));
        for (const p of r.players.values())
          if (p.connected)
            io.sockets.sockets.get(p.socketId)?.emit("state", snapshot(r, p));
      }
      if (
        Date.now() - r.lastActive > 2 * 60 * 60 * 1000 &&
        !io.sockets.sockets.has(r.adminSocket) &&
        ![...r.players.values()].some((p) => p.connected)
      )
        rooms.delete(r.code);
    }
    for (const [k, v] of authAttempts)
      if (Date.now() > v.until) authAttempts.delete(k);
  }, 50);
  return {
    http,
    io,
    rooms,
    listen: (port = 0) =>
      new Promise<number>((resolve, reject) => {
        http.once("error", reject);
        http.listen(port, "0.0.0.0", () => {
          http.removeListener("error", reject);
          const a = http.address();
          resolve(typeof a === "object" && a ? a.port : port);
        });
      }),
    close: () =>
      new Promise<void>((resolve) => {
        clearInterval(interval);
        io.close(() => resolve());
      }),
  };
}
if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  const server = createGameServer({
    adminPassword: process.env.ADMIN_PASSWORD ?? "",
  });
  server
    .listen(
      Number(process.env.PORT) ||
        Number(process.argv[process.argv.indexOf("--port") + 1]) ||
        3000,
    )
    .then((port) => console.log(`NAVE 26 escucha en 0.0.0.0:${port}`));
}
