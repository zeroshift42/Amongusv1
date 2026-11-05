export interface Point {
  x: number;
  y: number;
}
export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}
export const WORLD = { width: 2400, height: 1800 };
export const ROOMS = [
  {
    id: "cafeteria",
    name: "Cafetería",
    x: 900,
    y: 100,
    w: 600,
    h: 400,
    color: 0x396979,
  },
  {
    id: "weapons",
    name: "Armería",
    x: 1740,
    y: 150,
    w: 420,
    h: 320,
    color: 0x745b78,
  },
  {
    id: "navigation",
    name: "Navegación",
    x: 1860,
    y: 670,
    w: 420,
    h: 350,
    color: 0x3e6587,
  },
  {
    id: "oxygen",
    name: "Oxígeno",
    x: 1430,
    y: 600,
    w: 320,
    h: 280,
    color: 0x4f7e6d,
  },
  {
    id: "shields",
    name: "Escudos",
    x: 1800,
    y: 1230,
    w: 400,
    h: 330,
    color: 0x77714b,
  },
  {
    id: "communications",
    name: "Comunicaciones",
    x: 1330,
    y: 1350,
    w: 330,
    h: 330,
    color: 0x665b87,
  },
  {
    id: "storage",
    name: "Almacén",
    x: 870,
    y: 1060,
    w: 390,
    h: 550,
    color: 0x7c704f,
  },
  {
    id: "admin",
    name: "Administración",
    x: 1050,
    y: 650,
    w: 300,
    h: 290,
    color: 0x825567,
  },
  {
    id: "electrical",
    name: "Electricidad",
    x: 450,
    y: 1070,
    w: 300,
    h: 350,
    color: 0x7c7347,
  },
  {
    id: "medical",
    name: "Enfermería",
    x: 530,
    y: 600,
    w: 310,
    h: 310,
    color: 0x4b7d81,
  },
  {
    id: "security",
    name: "Seguridad",
    x: 130,
    y: 680,
    w: 280,
    h: 300,
    color: 0x5e796e,
  },
  {
    id: "reactor",
    name: "Reactor",
    x: 70,
    y: 1100,
    w: 260,
    h: 450,
    color: 0x765a91,
  },
  {
    id: "engines",
    name: "Motores",
    x: 110,
    y: 140,
    w: 520,
    h: 330,
    color: 0x825d50,
  },
];
// Connected, wide circulation spine with loops; all edges are resolved by server.
export const CORRIDORS: Rect[] = [
  { x: 550, y: 270, w: 1320, h: 130 },
  { x: 930, y: 400, w: 130, h: 790 },
  { x: 310, y: 520, w: 1690, h: 130 },
  { x: 1870, y: 370, w: 130, h: 1010 },
  { x: 310, y: 340, w: 130, h: 960 },
  { x: 650, y: 840, w: 130, h: 400 },
  { x: 300, y: 940, w: 1700, h: 130 },
  { x: 1200, y: 780, w: 130, h: 650 },
  { x: 650, y: 1290, w: 1300, h: 130 },
  { x: 720, y: 550, w: 130, h: 110 },
  { x: 1500, y: 820, w: 130, h: 170 },
  { x: 390, y: 760, w: 190, h: 120 },
  { x: 240, y: 1250, w: 270, h: 130 },
  { x: 1060, y: 440, w: 140, h: 260 },
  { x: 1450, y: 1290, w: 130, h: 160 },
];
export const FLOORS: Rect[] = [...ROOMS, ...CORRIDORS];
export const TERMINALS = [
  { id: "wires", room: "electrical", x: 540, y: 1150, kind: "wires" },
  { id: "card", room: "admin", x: 1230, y: 740, kind: "card" },
  {
    id: "download",
    room: "communications",
    x: 1460,
    y: 1450,
    kind: "download",
  },
  { id: "asteroids", room: "weapons", x: 1990, y: 260, kind: "asteroids" },
  { id: "shields", room: "shields", x: 2030, y: 1410, kind: "shields" },
  { id: "engines", room: "engines", x: 250, y: 280, kind: "engines" },
  { id: "samples", room: "medical", x: 650, y: 700, kind: "samples" },
  { id: "filter", room: "oxygen", x: 1550, y: 690, kind: "filter" },
  { id: "distributor", room: "reactor", x: 190, y: 1410, kind: "distributor" },
  { id: "navigation", room: "navigation", x: 2120, y: 810, kind: "navigation" },
];
export const VENTS = [
  { id: "v1", x: 500, y: 320 },
  { id: "v2", x: 760, y: 800 },
  { id: "v3", x: 620, y: 1320 },
  { id: "v4", x: 1590, y: 800 },
  { id: "v5", x: 2130, y: 900 },
  { id: "v6", x: 1920, y: 1480 },
];
export const COLORS = [
  "#ef4a57",
  "#42c8ed",
  "#f4d44b",
  "#a76af5",
  "#63d68c",
  "#f29c49",
  "#fa91c7",
  "#e7edf7",
  "#4c70e5",
  "#8bce45",
  "#6d4d43",
  "#8c9bad",
  "#a83249",
  "#2b9395",
  "#c9ac63",
  "#713ab6",
  "#25894e",
  "#bd632e",
  "#b84f99",
  "#bacad3",
  "#303c9d",
  "#c0e883",
  "#cf9674",
  "#585c73",
  "#ffb6a3",
  "#8ae2c0",
];
export const distance = (a: Point, b: Point) =>
  Math.hypot(a.x - b.x, a.y - b.y);
function inside(x: number, y: number) {
  return FLOORS.some(
    (r) => x >= r.x && x <= r.x + r.w && y >= r.y && y <= r.y + r.h,
  );
}
export function walkable(x: number, y: number) {
  return [
    [-15, -15],
    [15, -15],
    [-15, 15],
    [15, 15],
  ].every(([dx, dy]) => inside(x + dx, y + dy));
}
export function lineOfSight(a: Point, b: Point) {
  const n = Math.ceil(distance(a, b) / 10);
  for (let i = 0; i <= n; i++) {
    const t = n ? i / n : 0;
    if (!inside(a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t)) return false;
  }
  return true;
}
