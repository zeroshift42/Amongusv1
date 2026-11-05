import Phaser from "phaser";
import { io } from "socket.io-client";
import {
  WORLD,
  ROOMS,
  FLOORS,
  TERMINALS,
  VENTS,
  COLORS,
  distance,
} from "../shared/world.js";
import "./style.css";
type Data = Record<string, any>;
const $ = (q: string) => document.querySelector(q) as HTMLElement;
const esc = (v: any) =>
  String(v ?? "").replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ]!,
  );
const socket = io({ autoConnect: false });
let state: Data | null = null,
  myId = "",
  isAdmin = false,
  chosenColor = 0,
  modal = "",
  challenge: Data | null = null,
  scene: ShipScene,
  game: Phaser.Game;
let remembered = JSON.parse(sessionStorage.getItem("nave26.session") || "null"),
  mapOpen = false,
  audioOn = false,
  lastPhase = "",
  lastAlive = true,
  taskBusy = false,
  joystick = { x: 0, y: 0 };
let soundContext: AudioContext | undefined;
let lastUi = "";
let cinematicTimer: ReturnType<typeof setTimeout> | undefined;
const taskNames: Record<string, string> = {
  wires: "Conectar cables",
  cables: "Conectar cables",
  card: "Deslizar tarjeta",
  download: "Descargar datos",
  asteroids: "Destruir asteroides",
  shields: "Activar escudos",
  engines: "Alinear motores",
  engine: "Alinear motores",
  samples: "Analizar muestras",
  sample: "Analizar muestras",
  filters: "Limpiar filtros",
  filter: "Limpiar filtros",
  distributor: "Calibrar distribuidor",
  navigation: "Estabilizar dirección",
  direction: "Estabilizar dirección",
};
function sound(freq = 640) {
  if (!audioOn) return;
  soundContext ??= new AudioContext();
  const o = soundContext.createOscillator(),
    g = soundContext.createGain();
  o.connect(g);
  g.connect(soundContext.destination);
  o.frequency.value = freq;
  g.gain.setValueAtTime(0.06, soundContext.currentTime);
  g.gain.exponentialRampToValueAtTime(0.001, soundContext.currentTime + 0.14);
  o.start();
  o.stop(soundContext.currentTime + 0.15);
}
function toast(message: string) {
  $("#toast").textContent = message;
  $("#toast").classList.add("show");
  setTimeout(() => $("#toast").classList.remove("show"), 4200);
}
function request(event: string, payload: Data = {}): Promise<Data> {
  return new Promise((resolve) => {
    socket.timeout(6000).emit(event, payload, (err: any, result: Data) => {
      if (err) {
        toast("La conexión está tardando. Intentá nuevamente.");
        resolve({ ok: false });
        return;
      }
      if (!result?.ok) toast(result?.error || "No se pudo realizar la acción.");
      resolve(result || { ok: false });
    });
  });
}
function astronaut(color: string, size = 92) {
  return `<svg width="${size}" height="${size}" viewBox="0 0 100 110" aria-hidden="true"><ellipse cx="50" cy="103" rx="31" ry="6" fill="#000" opacity=".25"/><rect x="13" y="41" width="22" height="43" rx="9" fill="${color}" stroke="#080e1c" stroke-width="6"/><path d="M28 81V38C28 4 81 6 81 37V91Q81 104 65 101L63 83H49L48 101Q28 106 28 91Z" fill="${color}" stroke="#080e1c" stroke-width="6"/><path d="M34 37Q34 18 54 19" fill="none" stroke="#fff" opacity=".25" stroke-width="7" stroke-linecap="round"/><rect x="46" y="31" width="43" height="29" rx="13" fill="#8bc9df" stroke="#080e1c" stroke-width="6"/><path d="M55 38H75" stroke="#e5f8ff" stroke-width="7" stroke-linecap="round"/></svg>`;
}
$("#app").innerHTML =
  `<div id="space"></div><div id="game"></div><div id="entry"><header class="brand"><span class="orbit">✦</span> NAVE <b>26</b><small>MISIÓN: CONFIAR EN NADIE</small></header><main class="entry-layout"><section class="intro"><div class="eyebrow"><i></i> DEDUCCIÓN SOCIAL · MULTIJUGADOR</div><h1>Una tripulación.<br>Un <em>secreto.</em></h1><p>Repará la nave, observá a tus compañeros y descubrí quién está saboteando la misión.</p><div class="hero-crew"><div>${astronaut("#ff5866", 155)}</div><div>${astronaut("#50d7cb", 205)}</div><div>${astronaut("#ffd36b", 135)}</div><span class="orbit-line"></span></div><div class="features"><span>◎ Hasta 26 jugadores</span><span>◈ Salas privadas</span><span>✦ Sin cuentas</span></div></section><section class="entry-card"><div class="tabs"><button class="active" data-tab="join">Soy tripulante</button><button data-tab="teacher">Soy docente</button></div><form id="join-form"><h2>Preparado para despegar</h2><p class="muted">Pedile el código de sala al docente.</p><label>Tu apodo<input id="name" maxlength="18" placeholder="Ej. Cometa" autocomplete="off" required></label><label>Código de sala<input id="code" maxlength="8" placeholder="XXXXXXXX" autocomplete="off" autocapitalize="characters" required></label><label>Elegí tu traje</label><div id="colors" class="colors"></div><div class="identity-preview" id="identity-preview"></div><button class="primary wide" type="submit">Unirme a la tripulación <span>→</span></button></form><form id="teacher-form" hidden><h2>Centro de control</h2><p class="muted">Creá una sala y acompañá la partida como observador.</p><label>Clave docente<input id="password" type="password" autocomplete="current-password" required></label><label>Impostores<select id="initial-impostors"><option>1</option><option>2</option><option selected>3</option><option>4</option></select></label><button class="primary wide" type="submit">Crear una sala <span>→</span></button><p class="footnote">La clave se configura en el servidor. No se necesitan datos personales de estudiantes.</p></form></section></main><footer>UNA AVENTURA ESPACIAL ORIGINAL <span>Controles de teclado y pantalla táctil</span></footer></div><div id="hud" hidden><header class="game-top"><div class="mini-brand">✦ NAVE <b>26</b></div><div class="room-badge">SALA <b id="room-code"></b><button id="copy-code" title="Copiar código">⧉</button></div><div id="net-status"><i></i> CONECTADO</div><button id="settings-button" aria-label="Opciones">⚙</button></header><aside class="task-list" id="task-list"></aside><div id="room-label"></div><div id="status-banner"></div><div id="actions" class="actions"></div><div id="joystick"><div></div></div><div class="keyboard-hint">WASD / ↑↓←→ mover <span>E usar · R reportar · Q eliminar · Tab mapa</span></div><button id="map-button" class="map-button">▧ <span>Mapa</span></button><div id="admin-panel" hidden></div></div><div id="overlay" hidden></div><div id="task-modal" hidden></div><div id="toast" role="status"></div><div id="flash"></div>`;
function renderColors() {
  $("#colors").innerHTML = COLORS.map(
    (c, i) =>
      `<button type="button" data-color="${i}" class="color ${i === chosenColor ? "selected" : ""}" style="--color:${c}" aria-label="Color ${i + 1}">${i === chosenColor ? "✓" : ""}</button>`,
  ).join("");
  $("#identity-preview").innerHTML =
    astronaut(COLORS[chosenColor], 56) +
    "<span>LISTO PARA LA MISIÓN<br><small>Tu traje, tu identidad</small></span>";
}
renderColors();
$("#colors").onclick = (e) => {
  const el = (e.target as HTMLElement).closest("[data-color]") as HTMLElement;
  if (el) {
    chosenColor = Number(el.dataset.color);
    renderColors();
    sound();
  }
};
document.querySelectorAll("[data-tab]").forEach((el) =>
  el.addEventListener("click", () => {
    document
      .querySelectorAll("[data-tab]")
      .forEach((x) => x.classList.remove("active"));
    el.classList.add("active");
    ($("#join-form") as HTMLFormElement).hidden =
      (el as HTMLElement).dataset.tab !== "join";
    ($("#teacher-form") as HTMLFormElement).hidden =
      (el as HTMLElement).dataset.tab !== "teacher";
  }),
);
async function connect() {
  if (socket.connected) return;
  socket.connect();
  await new Promise<void>((r) => socket.once("connect", () => r()));
}
async function enter(admin: boolean) {
  await connect();
  const result = await request(
    admin ? "admin:create" : "join",
    admin
      ? {
          password: ($("#password") as HTMLInputElement).value,
          settings: {
            impostors: Number(
              ($("#initial-impostors") as HTMLSelectElement).value,
            ),
          },
        }
      : {
          name: ($("#name") as HTMLInputElement).value.trim(),
          code: ($("#code") as HTMLInputElement).value.trim().toUpperCase(),
          color: chosenColor,
        },
  );
  if (result.ok) {
    isAdmin = admin;
    myId = result.id;
    remembered = {
      code:
        result.code ||
        ($("#code") as HTMLInputElement).value.trim().toUpperCase(),
      token: result.token,
      admin,
    };
    sessionStorage.setItem("nave26.session", JSON.stringify(remembered));
    showGame();
  }
}
$("#join-form").onsubmit = (e) => {
  e.preventDefault();
  void enter(false);
};
$("#teacher-form").onsubmit = (e) => {
  e.preventDefault();
  void enter(true);
};
function showGame() {
  $("#entry").hidden = true;
  $("#hud").hidden = false;
  if (!game)
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: "game",
      backgroundColor: "#080e1c",
      width: innerWidth,
      height: innerHeight,
      scale: {
        mode: Phaser.Scale.RESIZE,
        autoCenter: Phaser.Scale.CENTER_BOTH,
      },
      render: { antialias: true, pixelArt: false },
      scene: [ShipScene],
    });
}
socket.on("connect", async () => {
  $("#net-status").innerHTML = "<i></i> CONECTADO";
  if (remembered) {
    const r = await request(
      remembered.admin ? "admin:resume" : "resume",
      remembered,
    );
    if (r.ok) {
      myId = r.id;
      isAdmin = remembered.admin;
      showGame();
    } else {
      remembered = null;
      sessionStorage.removeItem("nave26.session");
      toast(
        "La sesión ya no está disponible. Pedile un nuevo código al docente.",
      );
    }
  }
});
socket.on("disconnect", () => {
  $("#net-status").innerHTML = '<i class="offline"></i> RECONECTANDO';
  toast("Conexión interrumpida. Estamos intentando recuperar tu lugar.");
});
socket.on("connect_error", () =>
  toast("No se pudo conectar con la nave. Revisá tu conexión."),
);
socket.on("state", (s: Data) => {
  const previous = state;
  state = s;
  if (!myId) myId = s.me;
  const me = s.players.find((p: Data) => p.id === myId);
  if (s.phase !== lastPhase) {
    modal = "";
    challenge = null;
    $("#task-modal").hidden = true;
    if (s.phase === "playing" && lastPhase === "lobby" && me) {
      announce(
        me.role === "impostor" ? "IMPOSTOR" : "TRIPULANTE",
        me.role === "impostor"
          ? "Saboteá la misión sin ser descubierto."
          : "Completá tus tareas. Descubrí a los impostores.",
        me.role === "impostor" ? "#ff5866" : "#50d7cb",
        "role",
        me.color,
      );
      sound(me.role === "impostor" ? 180 : 780);
    }
    lastPhase = s.phase;
  }
  const result = s.meetingResult;
  const newResult =
    previous &&
    result &&
    result.id !== previous.meetingResult?.id &&
    previous.phase === "meeting";
  if (newResult) {
    announce(
      result.player
        ? `${result.player.name} fue expulsado`
        : "NADIE FUE EXPULSADO",
      result.player
        ? "La nave continúa su viaje."
        : "La tripulación decidió seguir investigando.",
      "#9fa9f7",
      result.player ? "ejection" : "skip",
      result.player?.color ?? 0,
    );
  }
  if (s.phase === "lobby") {
    clearTimeout(cinematicTimer);
    $("#flash").className = "";
  }
  if (
    me &&
    !me.alive &&
    lastAlive &&
    !newResult &&
    previous?.phase === "playing"
  ) {
    announce(
      "SOS UN FANTASMA",
      "Todavía podés ayudar completando tus tareas.",
      "#9fa9f7",
      "ghost",
      me.color,
    );
    lastAlive = false;
  }
  if (me) lastAlive = me.alive;
  const ui = JSON.stringify([
    s.phase,
    s.paused,
    s.locked,
    s.settings,
    s.progress,
    s.tasks,
    s.players.map((p: Data) => [
      p.id,
      p.name,
      p.color,
      p.role,
      p.alive,
      p.connected,
    ]),
    Math.ceil(s.killCooldown),
    s.sabotage && [
      s.sabotage.kind,
      Math.ceil(s.sabotage.remaining),
      s.sabotage.panels,
    ],
    s.meeting && { ...s.meeting, remaining: Math.ceil(s.meeting.remaining) },
    s.winner,
    s.reason,
  ]);
  if (ui !== lastUi) {
    lastUi = ui;
    renderHud();
    renderOverlay();
  }
  scene?.sync(s);
});
function announce(
  title: string,
  sub: string,
  color: string,
  kind = "role",
  suit = 0,
) {
  clearTimeout(cinematicTimer);
  const f = $("#flash");
  f.className = "";
  f.innerHTML = `<div class="cinematic ${kind}" style="--accent:${color}" role="status"><div class="cinematic-stars"></div><div class="eyebrow">MISIÓN NAVE 26</div><div class="cinematic-astronaut">${astronaut(COLORS[suit % COLORS.length], 160)}</div><h1>${esc(title)}</h1><p>${esc(sub)}</p><button class="cinematic-dismiss" type="button">Continuar →</button></div>`;
  f.className = "active";
  const dismiss = () => {
    clearTimeout(cinematicTimer);
    f.className = "";
  };
  f.querySelector("button")!.addEventListener("click", dismiss);
  cinematicTimer = setTimeout(dismiss, 3800);
}

function player() {
  return state?.players.find((p: Data) => p.id === myId);
}
function nearest<T extends { x: number; y: number }>(
  list: T[],
  range: number,
): T | undefined {
  const p = player();
  if (!p) return;
  return list
    .filter((t) => distance(p, t) <= range)
    .sort((a, b) => distance(p, a) - distance(p, b))[0];
}
function renderHud() {
  if (!state) return;
  $("#room-code").textContent = state.code;
  const p = player();
  const done = state.progress?.done || 0,
    total = state.progress?.total || 0;
  $("#task-list").innerHTML =
    `<div class="eyebrow">${isAdmin ? "VISTA DEL DOCENTE" : p?.role === "impostor" ? "OBJETIVO · SABOTEAR" : !p?.alive ? "FANTASMA · SEGUÍ AYUDANDO" : "OBJETIVO · REPARAR"}</div><h3>${isAdmin ? "Misión en curso" : p?.role === "impostor" ? "Pasá desapercibido" : "Tareas de la nave"}<span>${done}/${total}</span></h3><div class="progress"><i style="width:${total ? (done / total) * 100 : 0}%"></i></div>${(
      state.tasks || []
    )
      .map((t: Data) => {
        const term = TERMINALS.find((x) => x.id === t.id);
        const room = ROOMS.find((x) => x.id === term?.room);
        return `<div class="task-row ${t.done ? "done" : ""}"><span>${t.done ? "✓" : "◇"}</span><div>${esc(taskNames[term?.kind || ""] || term?.kind)}<small>${esc(room?.name || "Terminal")}</small></div></div>`;
      })
      .join(
        "",
      )}${p?.role === "impostor" ? '<p class="footnote">Las tareas son de cobertura. Usá las ventilaciones para moverte.</p>' : ""}`;
  const sb = state.sabotage;
  $("#status-banner").innerHTML = state.paused
    ? "<b>Ⅱ PARTIDA EN PAUSA</b><small>Esperá la indicación del docente.</small>"
    : sb
      ? `<b>⚠ ${esc(({ lights: "APAGÓN", oxygen: "OXÍGENO CRÍTICO", reactor: "REACTOR INESTABLE", communications: "SIN COMUNICACIONES", doors: "PUERTAS BLOQUEADAS" } as Data)[sb.kind] || sb.kind)}</b><small>${Math.ceil(sb.remaining)} s · Buscá los paneles marcados</small>`
      : "";
  $("#status-banner").classList.toggle("visible", !!state.paused || !!sb);
  if (isAdmin) {
    $("#admin-panel").hidden = false;
    $("#actions").innerHTML = "";
    renderAdmin();
    return;
  }
  $("#admin-panel").hidden = true;
  const playing = state.phase === "playing" && !state.paused;
  const imp = p?.role === "impostor" && p?.alive;
  $("#actions").innerHTML =
    `<button data-action="use" ${!playing ? "disabled" : ""}><span>⌁</span>USAR<kbd>E</kbd></button><button data-action="report" ${!playing || !p?.alive ? "disabled" : ""}><span>◉</span>REPORTAR<kbd>R</kbd></button>${imp ? `<button class="danger" data-action="kill" ${!playing || state.killCooldown > 0 ? "disabled" : ""}><span>${state.killCooldown > 0 ? Math.ceil(state.killCooldown) : "✕"}</span>ELIMINAR<kbd>Q</kbd></button><button data-action="sabotage" ${!playing ? "disabled" : ""}><span>ϟ</span>SABOTEAR</button><button data-action="vent" ${!playing ? "disabled" : ""}><span>▤</span>CONDUCTO</button>` : ""}`;
}
let adminRoster = "";
function renderAdmin() {
  if (!state) return;
  const signature = JSON.stringify([
    state.phase,
    state.paused,
    state.locked,
    state.players.map((p: Data) => [p.id, p.connected, p.alive, p.role]),
  ]);
  if (signature === adminRoster) return;
  adminRoster = signature;
  $("#admin-panel").innerHTML =
    `<div class="eyebrow">CENTRO DE CONTROL</div><h3>${state.players.filter((p: Data) => p.connected).length}/26 tripulantes</h3><div class="admin-buttons">${state.phase === "lobby" ? '<button class="primary" data-admin="start">▶ Iniciar partida</button>' : state.phase === "ended" ? '<button class="primary" data-admin="reset">↻ Nueva partida</button>' : `<button data-admin="${state.paused ? "resume" : "pause"}">${state.paused ? "▶ Reanudar" : "Ⅱ Pausar"}</button><button data-admin="end">Finalizar</button>`}<button data-admin="${state.locked ? "unlock" : "lock"}">${state.locked ? "🔓 Abrir acceso" : "🔒 Cerrar acceso"}</button>${state.phase === "lobby" ? '<button id="configuration">⚙ Configuración</button>' : ""}</div><div class="admin-roster">${state.players.map((p: Data) => `<div><i style="background:${COLORS[p.color % COLORS.length]}"></i><span>${esc(p.name)}<small>${!p.connected ? "Desconectado" : !p.alive ? "Fantasma" : p.role === "impostor" ? "Impostor" : "Tripulante"}</small></span><button data-kick="${esc(p.id)}" aria-label="Expulsar ${esc(p.name)}">×</button></div>`).join("")}</div>`;
}
$("#admin-panel").onclick = (e) => {
  const el = (e.target as HTMLElement).closest("button") as HTMLElement;
  if (el?.dataset.admin) void request("admin", { action: el.dataset.admin });
  if (el?.dataset.kick)
    void request("admin", { action: "kick", id: el.dataset.kick });
  if (el?.id === "configuration") settingsDialog();
};
$("#copy-code").onclick = () => {
  void navigator.clipboard?.writeText(state?.code || "");
  toast("Código de sala: " + state?.code);
};
function settingsDialog() {
  modal = "settings";
  const s = state?.settings || {};
  $("#overlay").hidden = false;
  $("#overlay").innerHTML =
    `<section class="dialog"><button class="close" data-close>×</button><div class="eyebrow">PREPARAR MISIÓN</div><h2>Reglas de la partida</h2><form id="configuration-form"><div class="settings-grid">${[
      ["impostors", "Impostores", 1, 4, 3],
      ["tasks", "Tareas por tripulante", 1, 10, 3],
      ["discussion", "Discusión (segundos)", 5, 120, 60],
      ["voting", "Votación (segundos)", 5, 90, 45],
      ["killCooldown", "Espera para eliminar (segundos)", 10, 90, 30],
      ["duration", "Duración máxima (segundos)", 300, 2400, 1200],
    ]
      .map(
        ([key, label, min, max, def]) =>
          `<label>${label}<input name="${key}" type="number" min="${min}" max="${max}" value="${s[String(key)] ?? def}"></label>`,
      )
      .join(
        "",
      )}</div><label class="check"><input type="checkbox" name="chat" ${s.chat !== false ? "checked" : ""}> Habilitar frases de comunicación</label><button class="primary wide">Guardar configuración</button></form></section>`;
  $("#configuration-form").onsubmit = async (e) => {
    e.preventDefault();
    const f = new FormData(e.target as HTMLFormElement),
      settings: Data = {};
    for (const [k, v] of f) settings[k] = k === "chat" ? true : Number(v);
    settings.chat = f.has("chat");
    if ((await request("admin", { action: "settings", settings })).ok)
      closeOverlay();
  };
}
function closeOverlay() {
  modal = "";
  $("#overlay").hidden = true;
  renderOverlay();
}
$("#overlay").onclick = (e) => {
  const el = (e.target as HTMLElement).closest("button") as HTMLElement;
  if (el?.hasAttribute("data-close")) closeOverlay();
  if (el?.dataset.vote !== undefined)
    void request("vote", { target: el.dataset.vote || null });
  if (el?.dataset.vent) {
    void request("action", { type: "vent", target: el.dataset.vent });
    closeOverlay();
  }
  if (el?.dataset.sabotage) {
    void request("action", { type: "sabotage", kind: el.dataset.sabotage });
    closeOverlay();
  }
  if (el?.dataset.admin) void request("admin", { action: el.dataset.admin });
};
function renderOverlay() {
  if (!state || modal) return;
  const ov = $("#overlay");
  if (state.phase === "lobby") {
    ov.hidden = false;
    ov.className = "lobby-overlay";
    ov.innerHTML = `<section class="lobby-card"><div class="eyebrow">SALA DE ESPERA</div><h2>Tu tripulación está llegando<span class="dots">…</span></h2><p>${isAdmin ? "Compartí el código y comenzá cuando estén todos." : "El docente dará inicio a la misión. Prepará tu coartada."}</p><div class="big-code">${esc(state.code)}</div><div class="crew-grid">${state.players.map((p: Data) => `<div class="crew-member ${!p.connected ? "disconnected" : ""}">${astronaut(COLORS[p.color % COLORS.length], 62)}<span>${esc(p.name)}</span>${p.id === myId ? "<small>VOS</small>" : ""}</div>`).join("") || "<p>Esperando al primer tripulante…</p>"}</div><div class="lobby-bottom"><span><i></i> ${state.players.length} / 26 a bordo</span><span>${state.settings?.impostors || 3} impostores · ${state.settings?.tasks || 3} tareas</span></div>${isAdmin ? '<button class="primary wide" data-admin="start">Iniciar misión →</button>' : ""}</section>`;
    return;
  }
  if (state.phase === "meeting") {
    ov.hidden = false;
    ov.className = "";
    const m = state.meeting || {};
    ov.innerHTML = `<section class="meeting-dialog"><div class="meeting-heading"><div><div class="eyebrow">TODOS A LA MESA</div><h2>¿Quién es el impostor?</h2></div><div class="meeting-clock"><b>${Math.ceil(m.remaining || 0)}</b><span>${m.stage === "discussion" ? "DISCUSIÓN" : "VOTACIÓN"}</span></div></div><div class="meeting-body"><div><div class="vote-grid">${state.players.map((p: Data) => `<button class="vote-player ${!p.alive ? "dead" : ""}" data-vote="${esc(p.id)}" ${isAdmin || !player()?.alive || !p.alive || m.stage !== "voting" || m.voted ? "disabled" : ""}>${astronaut(COLORS[p.color % COLORS.length], 48)}<span>${esc(p.name)}<small>${!p.alive ? "Fantasma" : !p.connected ? "Sin conexión" : "A bordo"}</small></span></button>`).join("")}</div><div class="vote-footer"><button data-vote="" ${isAdmin || !player()?.alive || m.stage !== "voting" || m.voted ? "disabled" : ""}>Saltar votación</button><span>${m.voted ? "✓ Voto registrado" : m.stage === "discussion" ? "Escuchá a tus compañeros antes de votar" : `${m.votes || 0} / ${m.eligible || 0} votos`}</span></div></div><aside class="meeting-chat"><h3>Comunicaciones</h3><div class="messages">${(m.messages || []).map((x: Data) => `<p><b>${esc(x.name)}</b>${esc(x.text)}</p>`).join("") || '<p class="muted">Compartí tus pistas con la tripulación.</p>'}</div>${!isAdmin && player()?.alive ? `<button id="quick-chat" class="wide">＋ Compartir una pista</button>` : ""}</aside></div></section>`;
    $("#quick-chat")?.addEventListener("click", chatDialog);
    return;
  }
  if (state.phase === "ended") {
    ov.hidden = false;
    ov.className = "";
    ov.innerHTML = `<section class="results dialog"><div class="eyebrow">MISIÓN FINALIZADA</div><h1>${state.winner === "Tripulantes" ? "¡Victoria tripulante!" : state.winner === "Impostores" ? "¡Victoria impostora!" : "Fin de la misión"}</h1><p>${esc(state.reason || "La tripulación ha vuelto a casa.")}</p><div class="results-crew">${state.players.map((p: Data) => `<div>${astronaut(COLORS[p.color % COLORS.length], 65)}<b>${esc(p.name)}</b><small class="${p.role === "impostor" ? "red" : ""}">${p.role === "impostor" ? "IMPOSTOR" : "TRIPULANTE"}</small></div>`).join("")}</div><p>Tareas completadas: ${state.progress?.done || 0} / ${state.progress?.total || 0}</p>${isAdmin ? '<button class="primary wide" data-admin="reset">Preparar otra misión →</button>' : '<p class="muted">El docente puede preparar una nueva partida.</p>'}</section>`;
    return;
  }
  ov.hidden = true;
  ov.className = "";
}
function chatDialog() {
  modal = "chat";
  $("#overlay").innerHTML =
    `<section class="dialog"><button class="close" data-close>×</button><h2>Compartí una pista</h2><label>Tripulante<select id="chat-target"><option value="">Elegir…</option>${state!.players
      .filter((p: Data) => p.alive)
      .map((p: Data) => `<option value="${esc(p.id)}">${esc(p.name)}</option>`)
      .join(
        "",
      )}</select></label><label>Habitación<select id="chat-room">${ROOMS.map((r) => `<option value="${r.id}">${r.name}</option>`).join("")}</select></label><div class="phrase-grid">${["Vi a alguien en…", "Encontré un cuerpo", "Estaba haciendo tareas", "Tengo una sospecha", "¿Dónde estabas?", "No tengo pruebas", "Creo que fue…", "Propongo saltar la votación"].map((p, i) => `<button data-phrase="${i}">${p}</button>`).join("")}</div></section>`;
  document.querySelectorAll("[data-phrase]").forEach((b) =>
    b.addEventListener("click", async () => {
      await request("chat", {
        phrase: Number((b as HTMLElement).dataset.phrase),
        target: ($("#chat-target") as HTMLSelectElement).value,
        room: ($("#chat-room") as HTMLSelectElement).value,
      });
      closeOverlay();
    }),
  );
}
async function interact(type: string) {
  if (!state || state.paused || state.phase !== "playing" || isAdmin) return;
  if (type === "use") {
    if (state.sabotage) {
      const panel = nearest(TERMINALS, 110);
      if (panel) {
        await request("action", { type: "repair", target: panel.id });
        return;
      }
    }
    const t = nearest(TERMINALS, 100);
    if (t) {
      const r = await request("task:start", { id: t.id });
      if (r.ok && r.challenge) {
        challenge = { ...r.challenge, id: r.challenge.id || t.id };
        renderTask();
      }
      return;
    }
    const cafe = ROOMS.find((r) => r.id === "cafeteria") || ROOMS[0];
    if (
      distance(player(), { x: cafe.x + cafe.w / 2, y: cafe.y + cafe.h / 2 }) <
      130
    ) {
      await request("action", { type: "emergency" });
      return;
    }
    toast("Acercate a una terminal o al botón de emergencia.");
    return;
  }
  if (type === "vent" && player()?.vented) {
    modal = "vent";
    $("#overlay").hidden = false;
    $("#overlay").innerHTML =
      `<section class="dialog"><button class="close" data-close>×</button><h2>Elegí una salida</h2><div class="phrase-grid">${VENTS.map(
        (v) => {
          const room = ROOMS.find(
            (r) =>
              v.x >= r.x && v.x <= r.x + r.w && v.y >= r.y && v.y <= r.y + r.h,
          );
          return `<button data-vent="${v.id}">${esc(room?.name || v.id)}</button>`;
        },
      ).join("")}</div></section>`;
    return;
  }
  if (type === "sabotage") {
    modal = "sabotage";
    $("#overlay").hidden = false;
    $("#overlay").innerHTML =
      `<section class="dialog"><button class="close" data-close>×</button><div class="eyebrow red">CONTROL IMPOSTOR</div><h2>Sabotear la nave</h2><div class="sabotage-grid">${[
        ["lights", "ϟ", "Apagar luces"],
        ["oxygen", "◌", "Agotar oxígeno"],
        ["reactor", "☢", "Desestabilizar reactor"],
        ["communications", "⌁", "Cortar comunicaciones"],
        ["doors", "▥", "Bloquear puertas"],
      ]
        .map(
          ([id, icon, label]) =>
            `<button data-sabotage="${id}"><span>${icon}</span>${label}</button>`,
        )
        .join("")}</div></section>`;
    return;
  }
  const target =
    type === "kill"
      ? nearest<Data & { x: number; y: number }>(
          state.players.filter(
            (p: Data) => p.id !== myId && p.alive && p.role !== "impostor",
          ),
          100,
        )?.id
      : type === "report"
        ? nearest<Data & { x: number; y: number }>(state.bodies || [], 160)?.id
        : type === "vent"
          ? nearest(VENTS, 100)?.id
          : undefined;
  await request("action", { type, target });
}
$("#actions").onclick = (e) => {
  const b = (e.target as HTMLElement).closest("[data-action]") as HTMLElement;
  if (b) void interact(b.dataset.action!);
};
$("#settings-button").onclick = () => {
  modal = "menu";
  $("#overlay").hidden = false;
  $("#overlay").innerHTML =
    `<section class="dialog"><button class="close" data-close>×</button><h2>Opciones de la nave</h2><button id="audio-toggle" class="wide">Sonido: ${audioOn ? "activado" : "desactivado"}</button><label>Calidad visual<select id="quality"><option value="high">Alta</option><option value="medium" selected>Equilibrada</option><option value="low">Baja</option></select></label><p class="muted">Movimiento: WASD o flechas.<br>E: usar · R: reportar · Q: eliminar.<br>Tab: mapa · Escape: cerrar.</p><button id="leave" class="wide danger">Salir de la sala</button></section>`;
  $("#audio-toggle").onclick = () => {
    audioOn = !audioOn;
    $("#audio-toggle").textContent =
      "Sonido: " + (audioOn ? "activado" : "desactivado");
    sound();
  };
  $("#quality").onchange = (e) => {
    document.body.dataset.quality = (e.target as HTMLSelectElement).value;
  };
  $("#leave").onclick = () => {
    sessionStorage.removeItem("nave26.session");
    location.reload();
  };
};
function toggleMap() {
  mapOpen = !mapOpen;
  scene?.setMap(mapOpen);
  $("#map-button").classList.toggle("active", mapOpen);
}
$("#map-button").onclick = toggleMap;
window.addEventListener("keydown", (e) => {
  if (
    ["INPUT", "SELECT", "TEXTAREA"].includes((e.target as HTMLElement).tagName)
  )
    return;
  if (e.key === "Tab" && state) {
    e.preventDefault();
    toggleMap();
  }
  if (e.key === "Escape") {
    cancelTask();
    closeOverlay();
    if (mapOpen) toggleMap();
  }
  if (e.repeat || modal || challenge) return;
  if (e.key.toLowerCase() === "e") void interact("use");
  if (e.key.toLowerCase() === "r") void interact("report");
  if (e.key.toLowerCase() === "q") void interact("kill");
});
const joy = $("#joystick");
let joyPointer: number | null = null;
function updateJoy(e: PointerEvent) {
  const r = joy.getBoundingClientRect(),
    dx = e.clientX - r.x - r.width / 2,
    dy = e.clientY - r.y - r.height / 2,
    l = Math.max(35, Math.hypot(dx, dy));
  joystick = { x: dx / l, y: dy / l };
  (joy.firstElementChild as HTMLElement).style.transform =
    `translate(${joystick.x * 32}px,${joystick.y * 32}px)`;
}
joy.onpointerdown = (e) => {
  joyPointer = e.pointerId;
  joy.setPointerCapture(e.pointerId);
  updateJoy(e);
};
joy.onpointermove = (e) => {
  if (e.pointerId === joyPointer) updateJoy(e);
};
joy.onpointerup = joy.onpointercancel = () => {
  joyPointer = null;
  joystick = { x: 0, y: 0 };
  (joy.firstElementChild as HTMLElement).style.transform = "";
};
let taskTimer: number | undefined, taskAnimation: number | undefined;
function cancelTask() {
  if (challenge)
    void request("task:input", {
      id: challenge.id,
      action: { type: "cancel" },
    });
  challenge = null;
  $("#task-modal").hidden = true;
  clearInterval(taskTimer);
  cancelAnimationFrame(taskAnimation || 0);
}
async function taskSend(action: Data) {
  if (!challenge || taskBusy) return;
  taskBusy = true;
  const r = await request("task:input", { id: challenge.id, action });
  taskBusy = false;
  if (r.ok) {
    sound(920);
    if (r.complete) {
      $("#task-modal").innerHTML =
        '<section class="task-dialog complete-task"><div class="checkmark">✓</div><h2>Tarea completada</h2><p>La nave está un paso más cerca de casa.</p></section>';
      challenge = null;
      clearInterval(taskTimer);
      cancelAnimationFrame(taskAnimation || 0);
      setTimeout(() => ($("#task-modal").hidden = true), 1300);
    } else if (r.challenge) {
      challenge = r.challenge;
      renderTask();
    }
  }
}
function renderTask() {
  if (!challenge) return;
  clearInterval(taskTimer);
  cancelAnimationFrame(taskAnimation || 0);
  const c = challenge,
    kind = c.kind,
    seed = c.seed as number[],
    step = c.step || 0,
    colors = ["#ff6573", "#58d3ed", "#ffd66b", "#a68bfa"];
  $("#task-modal").hidden = false;
  let body = "",
    hint = "";
  if (kind === "wires") {
    hint =
      "Seleccioná el cable iluminado a la izquierda y conectalo con el mismo símbolo a la derecha.";
    body = `<div class="wires-board"><div>${seed.map((v, i) => `<button data-left="${v}" class="wire ${i < step ? "finished" : ""} ${i === step ? "current" : ""}" style="--wire:${colors[v]}" ${i !== step ? "disabled" : ""}>${["●", "▲", "■", "◆"][v]}<i></i></button>`).join("")}</div><div class="wire-lines">${seed
      .slice(0, step)
      .map(
        (v, i) =>
          `<span style="top:${i * 65 + 25}px;background:${colors[v]}"></span>`,
      )
      .join("")}</div><div>${[...seed]
      .reverse()
      .map(
        (v) =>
          `<button data-right="${v}" class="wire right" style="--wire:${colors[v]}"><i></i>${["●", "▲", "■", "◆"][v]}</button>`,
      )
      .join("")}</div></div>`;
  } else if (kind === "card") {
    hint =
      "Arrastrá la tarjeta de izquierda a derecha. Ni muy rápido, ni muy lento.";
    body =
      '<div class="card-reader"><div class="reader-screen" id="reader-status">DESLIZAR TARJETA →</div><div class="card-track"><div id="swipe-card"><span>NAVE 26</span><b>✦</b><small>TRIPULACIÓN AUTORIZADA</small></div></div><div class="reader-lights">● ● ●</div></div>';
  } else if (kind === "download") {
    hint =
      "Mantené el enlace hasta que termine la transferencia y verificá los datos.";
    body =
      '<div class="download-art"><span>▰</span><div class="data-dots">· · · · ·</div><span>▥</span></div><div class="progress large"><i id="download-progress"></i></div><p id="download-status">Estableciendo enlace…</p><button id="download-confirm" class="primary wide" disabled>Verificar transferencia</button>';
  } else if (kind === "asteroids") {
    hint = "Apuntá y destruí los 8 asteroides antes de que alcancen la nave.";
    body = `<div class="asteroid-field"><div class="crosshair">＋</div><button id="asteroid" style="left:${15 + ((step * 37) % 65)}%;top:${15 + ((step * 23) % 55)}%;transform:rotate(${step * 47}deg)">⬡</button><span class="radar-line"></span></div><div class="task-meter">ASTEROIDES DESTRUIDOS <b>${step} / 8</b></div>`;
  } else if (kind === "shields") {
    hint =
      "Activá los escudos en el orden indicado. Los símbolos evitan depender del color.";
    body = `<div class="shield-sequence">${seed.map((v, i) => `<span class="${i < step ? "done" : i === step ? "current" : ""}">${["●", "▲", "■", "◆"][v]}</span>`).join("")}</div><div class="shield-grid">${[0, 1, 2, 3].map((v) => `<button data-shield="${v}" style="--wire:${colors[v]}" class="${seed.slice(0, step).includes(v) ? "lit" : ""}">${["●", "▲", "■", "◆"][v]}</button>`).join("")}</div>`;
  } else if (kind === "engines" || kind === "navigation") {
    hint =
      kind === "engines"
        ? "Ajustá el motor hasta alinear su señal con la marca de referencia."
        : "Estabilizá el rumbo haciendo coincidir la mira con el objetivo.";
    body = `<div class="alignment ${kind}"><div class="target-line" style="left:${10 + seed[0] * 0.8 * 25}%"><span>OBJETIVO</span></div><div id="alignment-dot" style="left:50%">${kind === "engines" ? "▰" : "⊕"}</div><div class="align-grid"></div></div><input id="align-slider" type="range" min="0" max="100" value="50"><button id="align-confirm" class="primary wide">${kind === "engines" ? "Alinear motor" : "Fijar rumbo"}</button>`;
  } else if (kind === "samples") {
    hint =
      "Esperá el análisis y seleccioná la muestra que tiene un color diferente.";
    body = `<div class="samples">${[0, 1, 2, 3].map((v) => `<button data-sample="${v}" disabled><div class="test-tube"><i style="background:#6acdd5"></i></div><span>${String.fromCharCode(65 + v)}</span></button>`).join("")}</div><p id="sample-status">Analizando muestras…</p>`;
  } else if (kind === "filter") {
    hint = "Arrastrá cada residuo hacia el depósito de reciclaje.";
    body = `<div class="filter-board"><div class="filter-vents">▤ ▤ ▤<br>▤ ▤ ▤<br>▤ ▤ ▤</div><div id="debris" style="left:${20 + ((step * 17) % 45)}%;top:${15 + ((step * 23) % 40)}%">${["✦", "❋", "✧", "❈", "✺", "✶"][step]}</div><div id="trash">↓<small>DEPÓSITO</small></div></div><p>Residuos retirados: ${step} / 6</p>`;
  } else if (kind === "distributor") {
    hint =
      "Detené el indicador cuando esté dentro de la franja verde. Calibrá los tres circuitos.";
    body = `<div class="circuits">${[0, 1, 2].map((i) => `<span class="${i < step ? "done" : ""}">${i < step ? "✓" : i + 1}</span>`).join("")}</div><div class="calibrator"><div class="calibration-goal"></div><div id="needle"></div></div><button id="calibrate" class="primary wide">Calibrar circuito ${step + 1}</button>`;
  } else {
    hint = "Completá el circuito en el orden indicado.";
    body = `<div class="shield-grid">${seed.map((v) => `<button data-generic="${v}">${v + 1}</button>`).join("")}</div>`;
  }
  $("#task-modal").innerHTML =
    `<section class="task-dialog"><button id="task-close" class="close" aria-label="Cerrar tarea">×</button><div class="eyebrow">TERMINAL DE LA NAVE</div><h2>${esc(taskNames[kind] || "Estabilizar dirección")}</h2><p class="muted">${hint}</p>${body}<div class="task-footer">${state?.paused ? "Ⅱ PARTIDA EN PAUSA" : "CONEXIÓN SEGURA CON EL SERVIDOR"}<span>ESC para cerrar</span></div></section>`;
  $("#task-close").onclick = cancelTask;
  if (kind === "wires") {
    let selected = -1;
    document.querySelectorAll("[data-left]").forEach(
      (el) =>
        ((el as HTMLElement).onclick = () => {
          selected = Number((el as HTMLElement).dataset.left);
          el.classList.add("chosen");
          sound();
        }),
    );
    document.querySelectorAll("[data-right]").forEach(
      (el) =>
        ((el as HTMLElement).onclick = () => {
          const val = Number((el as HTMLElement).dataset.right);
          if (selected !== val) {
            toast("Buscá el mismo símbolo en ambos extremos.");
            return;
          }
          void taskSend({ value: val });
        }),
    );
  }
  if (kind === "shields")
    document.querySelectorAll("[data-shield]").forEach(
      (el) =>
        ((el as HTMLElement).onclick = () =>
          void taskSend({
            value: Number((el as HTMLElement).dataset.shield),
          })),
    );
  if (kind === "card") {
    let start = 0,
      origin = 0;
    const card = $("#swipe-card");
    card.onpointerdown = (e) => {
      start = performance.now();
      origin = e.clientX;
      card.setPointerCapture(e.pointerId);
    };
    card.onpointermove = (e) => {
      if (start)
        card.style.transform = `translateX(${Math.max(0, Math.min(240, e.clientX - origin))}px)`;
    };
    card.onpointerup = (e) => {
      if (!start) return;
      const duration = (performance.now() - start) / 1000;
      start = 0;
      card.style.transform = "";
      if (e.clientX - origin < 150) {
        $("#reader-status").textContent = "DESLIZÁ HASTA EL FINAL →";
        return;
      }
      $("#reader-status").textContent =
        duration < 0.65
          ? "DEMASIADO RÁPIDO"
          : duration > 1.6
            ? "DEMASIADO LENTO"
            : "LEYENDO TARJETA…";
      void taskSend({ duration });
    };
    card.onpointercancel = () => {
      start = 0;
      card.style.transform = "";
    };
  }
  if (kind === "download") {
    const progress = () => {
      const elapsed = (state?.serverTime || 0) - c.startedAt,
        percent = Math.min(100, (elapsed / 6) * 100);
      if (!$("#download-progress")) return;
      $("#download-progress").style.width = percent + "%";
      $("#download-status").textContent =
        percent >= 100
          ? "Transferencia lista. Verificá los datos."
          : `Descargando datos… ${Math.floor(percent)}%`;
      ($("#download-confirm") as HTMLButtonElement).disabled = percent < 100;
    };
    progress();
    taskTimer = window.setInterval(progress, 100);
    $("#download-confirm").onclick = () => void taskSend({ value: "confirm" });
  }
  if (kind === "asteroids")
    $("#asteroid").onclick = () => void taskSend({ value: step });
  if (kind === "engines" || kind === "navigation") {
    const slider = $("#align-slider") as HTMLInputElement;
    slider.oninput = () =>
      ($("#alignment-dot").style.left = 10 + Number(slider.value) * 0.8 + "%");
    $("#align-confirm").onclick = () =>
      void taskSend({ value: Number(slider.value) });
  }
  if (kind === "samples") {
    const update = () => {
      if (!$("#sample-status")) return;
      const done = (state?.serverTime || 0) - c.startedAt >= 5;
      $("#sample-status").textContent = done
        ? "Análisis completo. Encontrá la anomalía."
        : `Analizando… ${Math.max(0, Math.ceil(5 - ((state?.serverTime || 0) - c.startedAt)))} s`;
      document.querySelectorAll("[data-sample]").forEach((el) => {
        (el as HTMLButtonElement).disabled = !done;
        if (done)
          (el.querySelector("i") as HTMLElement).style.background =
            Number((el as HTMLElement).dataset.sample) === seed[0]
              ? "#f6719b"
              : "#6acdd5";
      });
    };
    update();
    taskTimer = window.setInterval(update, 150);
    document.querySelectorAll("[data-sample]").forEach(
      (el) =>
        ((el as HTMLElement).onclick = () =>
          void taskSend({
            value: Number((el as HTMLElement).dataset.sample),
          })),
    );
  }
  if (kind === "filter") {
    const debris = $("#debris");
    let active = false;
    debris.onpointerdown = (e) => {
      active = true;
      debris.setPointerCapture(e.pointerId);
    };
    debris.onpointermove = (e) => {
      if (!active) return;
      const rect = debris.parentElement!.getBoundingClientRect();
      debris.style.left = e.clientX - rect.x - 22 + "px";
      debris.style.top = e.clientY - rect.y - 22 + "px";
    };
    debris.onpointerup = (e) => {
      active = false;
      const r = $("#trash").getBoundingClientRect();
      if (
        e.clientX >= r.x &&
        e.clientX <= r.right &&
        e.clientY >= r.y &&
        e.clientY <= r.bottom
      )
        void taskSend({ value: step });
    };
    debris.onpointercancel = () => (active = false);
  }
  if (kind === "distributor") {
    let value = 0;
    const start = performance.now();
    const animate = (t: number) => {
      if (!$("#needle")) return;
      value = (Math.sin((t - start) / 550) + 1) * 50;
      $("#needle").style.left = value + "%";
      taskAnimation = requestAnimationFrame(animate);
    };
    taskAnimation = requestAnimationFrame(animate);
    $("#calibrate").onclick = () => void taskSend({ value });
  }
  document.querySelectorAll("[data-generic]").forEach(
    (el) =>
      ((el as HTMLElement).onclick = () =>
        void taskSend({
          value: Number((el as HTMLElement).dataset.generic),
        })),
  );
}
interface Avatar {
  root: Phaser.GameObjects.Container;
  g: Phaser.GameObjects.Graphics;
  label: Phaser.GameObjects.Text;
  data: Data;
  tx: number;
  ty: number;
  face: number;
  phase: number;
  moving: number;
}
class ShipScene extends Phaser.Scene {
  avatars = new Map<string, Avatar>();
  markers = new Map<string, Phaser.GameObjects.Container>();
  bodyGraphics!: Phaser.GameObjects.Graphics;
  doorGraphics!: Phaser.GameObjects.Graphics;
  keys: any;
  lastMove = 0;
  worldReady = false;
  currentState: Data | null = null;
  constructor() {
    super("ship");
  }
  create() {
    scene = this;
    this.cameras.main.setBounds(
      -180,
      -180,
      WORLD.width + 360,
      WORLD.height + 360,
    );
    const g = this.add.graphics();
    g.fillStyle(0x080e1c);
    g.fillRect(-500, -500, WORLD.width + 1000, WORLD.height + 1000);
    let rand = 731;
    const random = () => {
      rand = (rand * 16807) % 2147483647;
      return rand / 2147483647;
    };
    for (let i = 0; i < 350; i++) {
      g.fillStyle(i % 3 === 0 ? 0x8ac6d4 : 0x8a97b5, 0.25 + random() * 0.5);
      g.fillCircle(
        random() * (WORLD.width + 800) - 400,
        random() * (WORLD.height + 800) - 400,
        random() * 1.5 + 0.4,
      );
    }
    // A continuous hull, using the same floor union as authoritative collision geometry.
    for (const f of FLOORS) {
      g.fillStyle(0x111a28);
      g.fillRoundedRect(f.x - 14, f.y - 14, f.w + 28, f.h + 28, 12);
      g.fillStyle(0x263345);
      g.fillRect(f.x, f.y, f.w, f.h);
    }
    for (const r of ROOMS) {
      g.fillStyle(r.color, 0.35);
      g.fillRect(r.x + 3, r.y + 3, r.w - 6, r.h - 6);
      g.lineStyle(1, 0x8192aa, 0.13);
      for (let x = r.x + 20; x < r.x + r.w; x += 40)
        g.lineBetween(x, r.y + 8, x, r.y + r.h - 8);
      for (let y = r.y + 20; y < r.y + r.h; y += 40)
        g.lineBetween(r.x + 8, y, r.x + r.w - 8, y);
      g.fillStyle(r.color, 0.14);
      g.fillRect(r.x + 12, r.y + 12, r.w - 24, 44);
      this.add
        .text(r.x + r.w / 2, r.y + 30, r.name.toLocaleUpperCase("es"), {
          fontFamily: "Arial",
          fontSize: "15px",
          fontStyle: "bold",
          color: "#b6cbd6",
          letterSpacing: 3,
        })
        .setOrigin(0.5)
        .setDepth(1);
      this.decorate(g, r);
    }
    const inside = (x: number, y: number) =>
      FLOORS.some(
        (f) => x >= f.x && x <= f.x + f.w && y >= f.y && y <= f.y + f.h,
      );
    g.lineStyle(7, 0x101724, 1);
    for (const f of FLOORS) {
      for (let x = f.x; x < f.x + f.w; x += 10) {
        if (!inside(x + 5, f.y - 1)) g.lineBetween(x, f.y, x + 10, f.y);
        if (!inside(x + 5, f.y + f.h + 1))
          g.lineBetween(x, f.y + f.h, x + 10, f.y + f.h);
      }
      for (let y = f.y; y < f.y + f.h; y += 10) {
        if (!inside(f.x - 1, y + 5)) g.lineBetween(f.x, y, f.x, y + 10);
        if (!inside(f.x + f.w + 1, y + 5))
          g.lineBetween(f.x + f.w, y, f.x + f.w, y + 10);
      }
    }
    g.lineStyle(2, 0x5f8591, 0.65);
    for (const f of FLOORS) {
      for (let x = f.x; x < f.x + f.w; x += 10) {
        if (!inside(x + 5, f.y - 1)) g.lineBetween(x, f.y + 5, x + 10, f.y + 5);
        if (!inside(x + 5, f.y + f.h + 1))
          g.lineBetween(x, f.y + f.h - 5, x + 10, f.y + f.h - 5);
      }
      for (let y = f.y; y < f.y + f.h; y += 10) {
        if (!inside(f.x - 1, y + 5)) g.lineBetween(f.x + 5, y, f.x + 5, y + 10);
        if (!inside(f.x + f.w + 1, y + 5))
          g.lineBetween(f.x + f.w - 5, y, f.x + f.w - 5, y + 10);
      }
    }
    for (const v of VENTS) {
      g.fillStyle(0x0b111c);
      g.fillRoundedRect(v.x - 25, v.y - 16, 50, 32, 5);
      g.lineStyle(3, 0x687e8d);
      g.strokeRoundedRect(v.x - 25, v.y - 16, 50, 32, 5);
      for (let y = -9; y <= 9; y += 6)
        g.lineBetween(v.x - 18, v.y + y, v.x + 18, v.y + y);
    }
    for (const t of TERMINALS) {
      const base = this.add.graphics();
      base.fillStyle(0x0c1520);
      base.fillRoundedRect(-28, -26, 56, 45, 6);
      base.lineStyle(3, 0x637887);
      base.strokeRoundedRect(-28, -26, 56, 45, 6);
      base.fillStyle(0x80dccb);
      base.fillRoundedRect(-20, -19, 40, 24, 3);
      base.lineStyle(2, 0x1f666a);
      base.lineBetween(-13, -9, 10, -9);
      base.lineBetween(-13, -3, 3, -3);
      base.fillStyle(0x96c4ce);
      base.fillCircle(-12, 12, 2);
      base.fillCircle(-3, 12, 2);
      base.fillCircle(7, 12, 2);
      const indicator = this.add
        .text(0, -53, "◇", {
          fontFamily: "Arial",
          fontSize: "31px",
          fontStyle: "bold",
          color: "#ffe17c",
        })
        .setOrigin(0.5);
      const marker = this.add.container(t.x, t.y, [base, indicator]);
      marker.setDepth(3);
      this.markers.set(t.id, marker);
    }
    this.bodyGraphics = this.add.graphics().setDepth(4);
    this.doorGraphics = this.add.graphics().setDepth(5);
    this.keys = this.input.keyboard!.addKeys("W,A,S,D,UP,DOWN,LEFT,RIGHT");
    this.input.keyboard!.removeCapture(["W", "A", "S", "D", "E", "R", "Q"]);
    this.worldReady = true;
    this.setMap(isAdmin || mapOpen);
    if (state) this.sync(state);
  }
  decorate(g: Phaser.GameObjects.Graphics, r: any) {
    const x = r.x,
      y = r.y,
      w = r.w,
      h = r.h;
    g.lineStyle(3, 0x172333);
    g.fillStyle(0x172333, 0.8);
    if (r.id === "cafeteria") {
      for (const [dx, dy] of [
        [130, 140],
        [460, 140],
        [130, 310],
        [460, 310],
      ]) {
        g.fillStyle(0x151e2c);
        g.fillEllipse(x + dx, y + dy + 7, 118, 66);
        g.fillStyle(0x456e88);
        g.fillEllipse(x + dx, y + dy, 118, 66);
        g.lineStyle(5, 0x1b2d44);
        g.strokeEllipse(x + dx, y + dy, 118, 66);
        g.fillStyle(0x7597aa);
        g.fillEllipse(x + dx - 18, y + dy - 9, 18, 9);
        g.fillStyle(0xd3b477);
        g.fillRect(x + dx + 17, y + dy - 8, 13, 12);
      }
      g.fillStyle(0x152239);
      g.fillEllipse(x + w / 2, y + h / 2 + 10, 100, 64);
      g.fillStyle(0x64849d);
      g.fillEllipse(x + w / 2, y + h / 2, 100, 64);
      g.fillStyle(0x243346);
      g.fillRoundedRect(x + w / 2 - 21, y + h / 2 - 21, 42, 33, 5);
      g.fillStyle(0xff6573);
      g.fillEllipse(x + w / 2, y + h / 2 - 8, 26, 15);
      this.add
        .text(x + w / 2, y + h / 2 + 42, "EMERGENCIA", {
          fontFamily: "Arial",
          fontSize: "10px",
          color: "#f4c5ca",
          letterSpacing: 1,
        })
        .setOrigin(0.5);
    } else if (r.id === "engines") {
      g.fillStyle(0x1b2939);
      g.fillRoundedRect(x + w - 180, y + 75, 130, 175, 30);
      g.fillStyle(0xa96847);
      g.fillRoundedRect(x + w - 167, y + 90, 104, 146, 28);
      g.fillStyle(0x2b3746);
      g.fillRect(x + w - 177, y + 133, 124, 22);
      g.fillRect(x + w - 177, y + 180, 124, 22);
      g.fillStyle(0x61d9df, 0.7);
      g.fillRoundedRect(x + w - 145, y + 105, 61, 12, 6);
    } else if (r.id === "reactor") {
      g.fillStyle(0x263047);
      g.fillRoundedRect(x + 50, y + 75, w - 100, 160, 20);
      g.fillStyle(0x9e79dd, 0.5);
      g.fillRoundedRect(x + 75, y + 88, w - 150, 132, 20);
      g.lineStyle(8, 0x4b5678);
      for (let i = 0; i < 4; i++)
        g.lineBetween(x + 45, y + 100 + i * 35, x + w - 45, y + 100 + i * 35);
    } else if (r.id === "storage") {
      for (const [dx, dy] of [
        [60, 110],
        [170, 140],
        [80, 235],
        [240, 270],
        [120, 370],
      ]) {
        g.fillStyle(0x202a35);
        g.fillRoundedRect(x + dx, y + dy, 68, 68, 4);
        g.fillStyle(0x6a7766);
        g.fillRoundedRect(x + dx + 5, y + dy + 5, 58, 55, 3);
        g.lineStyle(3, 0x3e4d43);
        g.strokeRect(x + dx + 13, y + dy + 12, 43, 39);
        g.lineBetween(x + dx + 13, y + dy + 12, x + dx + 56, y + dy + 51);
      }
    } else if (r.id === "medical") {
      for (let i = 0; i < 2; i++) {
        g.fillStyle(0x233342);
        g.fillRoundedRect(x + 70 + i * 130, y + h - 100, 85, 70, 7);
        g.fillStyle(0xb2ced5);
        g.fillRoundedRect(x + 75 + i * 130, y + h - 103, 75, 61, 7);
        g.fillStyle(0x75b0c0);
        g.fillRoundedRect(x + 80 + i * 130, y + h - 98, 65, 18, 4);
      }
      g.fillStyle(0x88d3c5);
      g.fillRect(x + w - 44, y + 80, 20, 7);
      g.fillRect(x + w - 37, y + 73, 7, 20);
    } else if (r.id === "oxygen") {
      g.fillStyle(0x193a35);
      g.fillEllipse(x + w - 65, y + h - 65, 65, 80);
      g.fillStyle(0x65a681);
      g.fillEllipse(x + w - 65, y + h - 77, 50, 55);
      g.lineStyle(5, 0x273a3c);
      g.strokeEllipse(x + w - 65, y + h - 65, 65, 80);
    } else if (r.id === "navigation") {
      g.fillStyle(0x15273a);
      g.fillRoundedRect(x + w - 85, y + 60, 65, h - 95, 15);
      for (let i = 0; i < 4; i++) {
        g.fillStyle(0x5aaac3, 0.6);
        g.fillRoundedRect(x + w - 74, y + 78 + i * 55, 40, 32, 5);
      }
    } else {
      g.fillStyle(0x172333);
      g.fillRoundedRect(x + 30, y + h - 63, w - 60, 36, 6);
      for (let i = 0; i < Math.floor((w - 80) / 52); i++) {
        g.fillStyle(i % 2 ? 0x618c92 : 0x627eaa, 0.7);
        g.fillRoundedRect(x + 40 + i * 52, y + h - 57, 40, 21, 3);
      }
    }
  }
  sync(s: Data) {
    if (!this.worldReady) return;
    this.currentState = s;
    const visible = new Set(s.players.map((p: Data) => p.id));
    for (const [id, a] of this.avatars) {
      if (!visible.has(id)) {
        a.root.destroy();
        this.avatars.delete(id);
      }
    }
    for (const p of s.players) {
      let a = this.avatars.get(p.id);
      if (!a) {
        const g = this.add.graphics();
        const label = this.add
          .text(0, -58, p.name, {
            fontFamily: "Arial",
            fontSize: "13px",
            fontStyle: "bold",
            color: "#eef6ff",
            stroke: "#101823",
            strokeThickness: 4,
          })
          .setOrigin(0.5);
        const root = this.add.container(p.x, p.y, [g, label]).setDepth(10);
        a = {
          root,
          g,
          label,
          data: p,
          tx: p.x,
          ty: p.y,
          face: 1,
          phase: Math.random() * 6,
          moving: 0,
        };
        this.avatars.set(p.id, a);
      }
      a.tx = p.x;
      a.ty = p.y;
      a.data = p;
      a.label.setText(
        p.name + (isAdmin && p.role === "impostor" ? " · I" : ""),
      );
      a.label.setColor(p.id === myId ? "#ffe393" : "#edf6ff");
      a.root.setAlpha(p.vented ? 0.12 : p.alive ? 1 : 0.45);
    }
    this.bodyGraphics.clear();
    for (const b of s.bodies || []) {
      const color = Phaser.Display.Color.HexStringToColor(
        COLORS[b.color % COLORS.length],
      ).color;
      this.bodyGraphics.fillStyle(0, 0.22);
      this.bodyGraphics.fillEllipse(b.x, b.y + 8, 48, 19);
      this.bodyGraphics.fillStyle(color);
      this.bodyGraphics.fillRoundedRect(b.x - 23, b.y - 12, 44, 22, 9);
      this.bodyGraphics.lineStyle(4, 0x0d1520);
      this.bodyGraphics.strokeRoundedRect(b.x - 23, b.y - 12, 44, 22, 9);
      this.bodyGraphics.fillStyle(0xc3e3ed);
      this.bodyGraphics.fillRoundedRect(b.x + 4, b.y - 10, 20, 13, 6);
      this.bodyGraphics.lineStyle(2, 0xf7d784);
      this.bodyGraphics.lineBetween(b.x - 7, b.y - 25, b.x - 7, b.y - 34);
    }
    this.doorGraphics.clear();
    for (const d of s.doors || []) {
      this.doorGraphics.fillStyle(0x9a354b, 0.9);
      this.doorGraphics.fillRect(d.x, d.y, d.w, d.h);
      this.doorGraphics.lineStyle(2, 0xffa575);
      this.doorGraphics.strokeRect(d.x, d.y, d.w, d.h);
    }
    for (const [id, marker] of this.markers) {
      const t = s.tasks.find((t: Data) => t.id === id);
      (marker.list[1] as Phaser.GameObjects.Text)
        .setText(s.sabotage ? "⚠" : t && !t.done ? "◇" : "")
        .setColor(s.sabotage ? "#ff6573" : "#ffe17c");
    }
  }
  setMap(open: boolean) {
    if (!this.worldReady) return;
    const cam = this.cameras.main;
    if (open || isAdmin) {
      cam.setZoom(
        Math.min(
          this.scale.width / (WORLD.width + 180),
          this.scale.height / (WORLD.height + 180),
        ),
      );
      cam.centerOn(WORLD.width / 2, WORLD.height / 2);
    } else {
      cam.setZoom(innerWidth < 700 ? 0.9 : 1.15);
    }
    $("#game").classList.toggle("map-view", open || isAdmin);
  }
  update(time: number, delta: number) {
    if (!this.worldReady) return;
    const dt = Math.min(delta, 80) / 1000;
    for (const a of this.avatars.values()) {
      const dx = a.tx - a.root.x,
        dy = a.ty - a.root.y;
      const moved = Math.hypot(dx, dy);
      if (moved > 200) {
        a.root.setPosition(a.tx, a.ty);
      } else {
        const smooth = 1 - Math.exp(-16 * dt);
        a.root.x += dx * smooth;
        a.root.y += dy * smooth;
      }
      a.moving = Phaser.Math.Linear(a.moving, moved > 1 ? 1 : 0, 0.2);
      if (Math.abs(dx) > 0.3) a.face = dx > 0 ? 1 : -1;
      a.phase += dt * (a.moving > 0.1 ? 12 : 2.5);
      this.drawAvatar(a, time);
      a.root.setDepth(10 + a.root.y / 10000);
    }
    const me = this.avatars.get(myId);
    if (me && !mapOpen && !isAdmin) {
      this.cameras.main.centerOn(me.root.x, me.root.y);
      const r = ROOMS.find(
        (r) =>
          me.root.x >= r.x &&
          me.root.x <= r.x + r.w &&
          me.root.y >= r.y &&
          me.root.y <= r.y + r.h,
      );
      $("#room-label").textContent = r?.name || "Pasillos de la nave";
    } else
      $("#room-label").textContent = isAdmin
        ? "Vista de supervisión"
        : mapOpen
          ? "Plano de la nave"
          : "";
    if (time - this.lastMove > 50) {
      this.lastMove = time;
      let x = 0,
        y = 0;
      if (
        !modal &&
        !challenge &&
        !isAdmin &&
        state?.phase === "playing" &&
        !state.paused &&
        !["INPUT", "SELECT", "TEXTAREA"].includes(
          document.activeElement?.tagName || "",
        )
      ) {
        x =
          (this.keys.D.isDown || this.keys.RIGHT.isDown ? 1 : 0) -
          (this.keys.A.isDown || this.keys.LEFT.isDown ? 1 : 0) +
          joystick.x;
        y =
          (this.keys.S.isDown || this.keys.DOWN.isDown ? 1 : 0) -
          (this.keys.W.isDown || this.keys.UP.isDown ? 1 : 0) +
          joystick.y;
        const n = Math.max(1, Math.hypot(x, y));
        x /= n;
        y /= n;
      }
      if (socket.connected && state && !isAdmin) socket.emit("move", { x, y });
    }
    for (const m of this.markers.values()) {
      const text = m.list[1] as Phaser.GameObjects.Text;
      text.y = -50 + Math.sin(time / 350) * 4;
    }
  }
  drawAvatar(a: Avatar, time: number) {
    const g = a.g,
      p = a.data,
      phase = a.phase,
      walk = a.moving,
      color = Phaser.Display.Color.HexStringToColor(
        COLORS[p.color % COLORS.length],
      ).color,
      dark = Phaser.Display.Color.IntegerToColor(color).darken(28).color;
    g.clear();
    g.fillStyle(0x02060c, 0.28);
    g.fillEllipse(0, 12, 42, 14);
    const bob = p.alive
      ? Math.sin(phase) * walk * 2 + Math.sin(time / 550) * 0.7
      : Math.sin(time / 450 + a.phase) * 5 - 5;
    const face = a.face;
    g.fillStyle(dark);
    g.lineStyle(3.5, 0x0b1320);
    g.fillRoundedRect(-face * 21 - 7, -23 + bob, 16, 27, 5);
    g.strokeRoundedRect(-face * 21 - 7, -23 + bob, 16, 27, 5);
    if (p.alive) {
      const left = Math.sin(phase) * 7 * walk,
        right = -left;
      g.fillStyle(dark);
      g.fillRoundedRect(-16, -1 + bob + left, 14, 19, 5);
      g.strokeRoundedRect(-16, -1 + bob + left, 14, 19, 5);
      g.fillStyle(color);
      g.fillRoundedRect(3, -1 + bob + right, 14, 19, 5);
      g.strokeRoundedRect(3, -1 + bob + right, 14, 19, 5);
      g.fillStyle(color);
      g.fillRoundedRect(-19, -43 + bob, 38, 48, 17);
      g.strokeRoundedRect(-19, -43 + bob, 38, 48, 17);
    } else {
      g.fillStyle(color, 0.65);
      g.beginPath();
      g.moveTo(-19, 5 + bob);
      g.lineTo(-19, -25 + bob);
      g.arc(0, -25 + bob, 19, Math.PI, Math.PI * 2);
      g.lineTo(19, 10 + bob);
      g.lineTo(9, 3 + bob);
      g.lineTo(0, 12 + bob);
      g.lineTo(-9, 3 + bob);
      g.closePath();
      g.fillPath();
      g.strokePath();
    }
    g.fillStyle(0xffffff, 0.15);
    g.fillEllipse(-7, -31 + bob, 13, 17);
    const vx = face > 0 ? -4 : -24;
    g.fillStyle(0x719bad);
    g.fillRoundedRect(vx, -32 + bob, 30, 21, 8);
    g.strokeRoundedRect(vx, -32 + bob, 30, 21, 8);
    g.fillStyle(0xbde9f0);
    g.fillRoundedRect(vx + 3, -29 + bob, 24, 10, 5);
    g.fillStyle(0xf0feff, 0.9);
    g.fillRoundedRect(vx + 6, -28 + bob, 13, 4, 2);
    g.fillStyle(0xe9f8ff, 0.7);
    g.fillCircle(0, -2 + bob, 2.2);
  }
}
if (remembered) {
  socket.connect();
}
window.addEventListener("blur", () => {
  joystick = { x: 0, y: 0 };
  if (socket.connected) socket.emit("move", { x: 0, y: 0 });
});
