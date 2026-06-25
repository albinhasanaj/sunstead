'use client';

// ── The Tribunal — a first-person 3D renderer for the Mafia game ───────────────
// Raw three.js, mounted imperatively. This component is PURELY a renderer: it
// reflects the page's game state (props) into a scene. It never drives the
// engine, never plays audio, never owns game logic — it only paints what it's
// told and reports clicks/actions back up via callbacks.
//
// Architecture:
//  • One mount effect builds the static room + renderer + render loop, and stores
//    an imperative API in a ref.
//  • A second effect rebuilds/syncs the player figures whenever `players` changes.
//  • Per-frame dynamic state (phase, role, who's speaking, who's accused, the
//    pending turn) is read from a ref the component refreshes every render, so the
//    loop always sees current values without re-subscribing.

import { useEffect, useRef } from 'react';
import * as THREE from 'three';
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js';
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js';
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';

export type ScenePlayer = { id: string; name: string; role: string; alive: boolean; human?: boolean };
export type Props = {
  players: ScenePlayer[];
  phase: string; // 'NIGHT' | 'DISCUSSION' | 'VOTE'
  myId: string | null;
  myRole: string; // 'mafia' | 'villager' | 'detective' | 'doctor' | 'unknown'
  speakingId: string | null;
  accusedId: string | null;
  turn: any | null; // raw request_action payload, or null
  onSelect: (playerId: string) => void;
  onAction: (tool: string, args: any) => void;
  // your private, role-specific knowledge — rendered as obvious overhead tags
  findings?: Record<string, 'mafia' | 'town'>; // detective: investigated → result
  teammates?: string[]; // mafia: your allies' ids
  protectedId?: string | null; // doctor: who you shielded
  killVotes?: Record<string, string[]>; // mafia: target id → names of who voted to kill them
  thinkingIds?: string[]; // seats currently mid-LLM (deliberating) → overhead think bubble
  addresseeId?: string | null; // who you've clicked to address your next line to
};

// ── brand palette ──────────────────────────────────────────────────────────────
const BRAND: Record<string, string> = {
  Claude: '#e0894f',
  GPT: '#19c39c',
  Gemini: '#5b8cff',
  Llama: '#3b7dff',
  Mistral: '#ff8a3d',
  Grok: '#dfe6f2',
  DeepSeek: '#8b9cff',
  Qwen: '#b07cff',
  You: '#ffd27a',
};
const PALETTE = ['#e0894f', '#19c39c', '#5b8cff', '#3b7dff', '#ff8a3d', '#dfe6f2', '#8b9cff', '#b07cff'];
export function colorFor(name: string): string {
  if (BRAND[name]) return BRAND[name];
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return PALETTE[h % PALETTE.length];
}

// ── procedural logo marks (stylized geometric renditions — not official logos) ──
function glow(ctx: CanvasRenderingContext2D, color: string, blur: number) {
  ctx.shadowColor = color;
  ctx.shadowBlur = blur;
}
type Mark = (ctx: CanvasRenderingContext2D, s: number, c: string) => void;
const MARKS: Record<string, Mark> = {
  Claude(ctx, s, c) {
    ctx.save();
    ctx.translate(s / 2, s / 2);
    glow(ctx, c, 40);
    ctx.fillStyle = c;
    for (let i = 0; i < 12; i++) {
      ctx.rotate((Math.PI * 2) / 12);
      ctx.beginPath();
      ctx.moveTo(0, -s * 0.07);
      ctx.lineTo(s * 0.05, -s * 0.34);
      ctx.lineTo(0, -s * 0.4);
      ctx.lineTo(-s * 0.05, -s * 0.34);
      ctx.closePath();
      ctx.fill();
    }
    ctx.restore();
  },
  GPT(ctx, s, c) {
    ctx.save();
    ctx.translate(s / 2, s / 2);
    glow(ctx, c, 36);
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.05;
    ctx.lineCap = 'round';
    for (let i = 0; i < 6; i++) {
      ctx.rotate((Math.PI * 2) / 6);
      ctx.beginPath();
      ctx.ellipse(0, -s * 0.16, s * 0.12, s * 0.22, 0, 0, Math.PI * 2);
      ctx.stroke();
    }
    ctx.restore();
  },
  Gemini(ctx, s, c) {
    ctx.save();
    ctx.translate(s / 2, s / 2);
    glow(ctx, c, 40);
    ctx.fillStyle = c;
    const R = s * 0.4;
    const r = s * 0.06;
    ctx.beginPath();
    for (let i = 0; i < 4; i++) {
      const a = (i * Math.PI) / 2;
      ctx.lineTo(Math.cos(a) * R, Math.sin(a) * R);
      ctx.lineTo(Math.cos(a + Math.PI / 4) * r, Math.sin(a + Math.PI / 4) * r);
    }
    ctx.closePath();
    ctx.fill();
    ctx.restore();
  },
  Llama(ctx, s, c) {
    ctx.save();
    ctx.translate(s / 2, s / 2);
    glow(ctx, c, 36);
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.07;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.arc(-s * 0.16, 0, s * 0.16, 0, Math.PI * 2);
    ctx.arc(s * 0.16, 0, s * 0.16, 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
  },
  Mistral(ctx, s, c) {
    ctx.save();
    ctx.translate(s / 2, s / 2);
    glow(ctx, c, 22);
    const cols = ['#ffd23f', '#ff9d2e', '#ff6b2e', '#e0454f', '#7b2d8e'];
    const u = s * 0.13;
    const x0 = -u * 2.5;
    const y0 = -u * 2;
    for (let r = 0; r < 4; r++)
      for (let q = 0; q < 5; q++) {
        if ((r === 1 && (q === 1 || q === 3)) || (r > 1 && q !== 0 && q !== 2 && q !== 4)) continue;
        ctx.fillStyle = cols[Math.min(r + (q % 2), cols.length - 1)];
        ctx.fillRect(x0 + q * u, y0 + r * u, u * 0.86, u * 0.86);
      }
    ctx.restore();
  },
  Grok(ctx, s, c) {
    ctx.save();
    ctx.translate(s / 2, s / 2);
    glow(ctx, c, 34);
    ctx.strokeStyle = c;
    ctx.lineWidth = s * 0.085;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(-s * 0.24, -s * 0.3);
    ctx.lineTo(s * 0.3, s * 0.3);
    ctx.moveTo(s * 0.24, -s * 0.3);
    ctx.lineTo(-s * 0.3, s * 0.3);
    ctx.stroke();
    ctx.restore();
  },
};
// Any unknown name → its first letter, drawn glowing.
function letterMark(letter: string): Mark {
  return (ctx, s, c) => {
    ctx.save();
    ctx.translate(s / 2, s / 2);
    glow(ctx, c, 30);
    ctx.fillStyle = c;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.font = `700 ${s * 0.5}px ui-monospace, monospace`;
    ctx.fillText(letter.toUpperCase(), 0, 0);
    ctx.restore();
  };
}
function markFor(name: string): Mark {
  return MARKS[name] ?? letterMark(name.charAt(0) || '?');
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

// HEAD SKIN — whole head is the brand colour, with a dark face-panel + logo painted
// at texture centre, so the mark curves with the face (painted on, not floating).
function makeHeadSkin(name: string, color: string) {
  const s = 512;
  const c = document.createElement('canvas');
  c.width = c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = color;
  ctx.fillRect(0, 0, s, s);
  const sh = ctx.createLinearGradient(0, 0, 0, s);
  sh.addColorStop(0, 'rgba(255,255,255,0.12)');
  sh.addColorStop(1, 'rgba(0,0,0,0.4)');
  ctx.fillStyle = sh;
  ctx.fillRect(0, 0, s, s);
  ctx.save();
  ctx.fillStyle = 'rgba(8,10,16,0.85)';
  roundRect(ctx, s * 0.3, s * 0.27, s * 0.4, s * 0.46, 44);
  ctx.fill();
  ctx.restore();
  markFor(name)(ctx, s, color);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// floating name label
function makeName(text: string) {
  const w = 256;
  const h = 72;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.shadowColor = 'rgba(0,0,0,0.7)';
  ctx.shadowBlur = 8;
  ctx.fillStyle = '#eef0f6';
  ctx.font = '700 38px ui-monospace, monospace';
  ctx.fillText(text.toUpperCase(), w / 2, h / 2);
  const tex = new THREE.CanvasTexture(c);
  tex.anisotropy = 8;
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// A glowing overhead pill that screams a player's secret status (MAFIA / CLEAR /
// ALLY / SHIELDED). Drawn on a canvas, mapped onto a billboarded plane.
function makeTagTexture(text: string, color: string) {
  const w = 256;
  const h = 96;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.font = '800 42px ui-monospace, monospace';
  const tw = ctx.measureText(text).width;
  const pad = 30;
  const pw = Math.min(w - 8, tw + pad * 2);
  const px = (w - pw) / 2;
  const py = 16;
  const ph = h - 32;
  const r = ph / 2;
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 26;
  roundRect(ctx, px, py, pw, ph, r);
  ctx.fillStyle = 'rgba(8,10,16,0.94)';
  ctx.fill();
  ctx.restore();
  roundRect(ctx, px, py, pw, ph, r);
  ctx.lineWidth = 3.5;
  ctx.strokeStyle = color;
  ctx.stroke();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, w / 2, h / 2 + 2);
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// A soft "thinking" thought-bubble (rounded cloud + three dots), tinted to the
// agent's brand colour. Billboarded over a seat while its model is deliberating,
// so the slow LLM turns read as visible activity instead of a frozen table.
function makeThinkBubbleTexture(color: string) {
  const w = 256;
  const h = 160;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d')!;
  ctx.fillStyle = 'rgba(10,12,18,0.92)';
  ctx.strokeStyle = color;
  ctx.lineWidth = 4;
  ctx.shadowColor = color;
  ctx.shadowBlur = 22;
  // main cloud
  roundRect(ctx, 34, 18, w - 68, 84, 42);
  ctx.fill();
  ctx.stroke();
  // two trailing tail puffs under the cloud
  ctx.beginPath();
  ctx.arc(w / 2 - 18, 120, 13, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  ctx.beginPath();
  ctx.arc(w / 2 + 6, 142, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
  // three dots inside the cloud
  ctx.shadowBlur = 0;
  ctx.fillStyle = color;
  for (let i = 0; i < 3; i++) {
    ctx.beginPath();
    ctx.arc(w / 2 - 44 + i * 44, 60, 13, 0, Math.PI * 2);
    ctx.fill();
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  tex.anisotropy = 8;
  return tex;
}

// A white targeting reticle (broken ring + corner ticks + centre dot), tinted at
// runtime via the material colour. Billboarded over whoever you're about to pick.
function makeReticleTexture() {
  const s = 256;
  const c = document.createElement('canvas');
  c.width = s;
  c.height = s;
  const ctx = c.getContext('2d')!;
  ctx.translate(s / 2, s / 2);
  ctx.strokeStyle = '#ffffff';
  ctx.fillStyle = '#ffffff';
  ctx.lineCap = 'round';
  ctx.lineWidth = 10;
  for (let i = 0; i < 4; i++) {
    ctx.beginPath();
    const a0 = i * (Math.PI / 2) + 0.35;
    const a1 = (i + 1) * (Math.PI / 2) - 0.35;
    ctx.arc(0, 0, 92, a0, a1);
    ctx.stroke();
  }
  ctx.lineWidth = 8;
  for (let i = 0; i < 4; i++) {
    const a = i * (Math.PI / 2);
    const x = Math.cos(a);
    const y = Math.sin(a);
    ctx.beginPath();
    ctx.moveTo(x * 68, y * 68);
    ctx.lineTo(x * 110, y * 110);
    ctx.stroke();
  }
  ctx.beginPath();
  ctx.arc(0, 0, 7, 0, Math.PI * 2);
  ctx.fill();
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  return tex;
}

// the secret-status tag for a seat, given your private knowledge (null = none)
function tagFor(
  id: string,
  findings: Record<string, 'mafia' | 'town'> | undefined,
  teammates: string[] | undefined,
  protectedId: string | null | undefined,
): { text: string; color: string } | null {
  const f = findings?.[id];
  if (f === 'mafia') return { text: 'MAFIA', color: '#e0454f' };
  if (f === 'town') return { text: 'CLEAR', color: '#34d399' };
  if (teammates?.includes(id)) return { text: 'ALLY', color: '#c084fc' };
  if (protectedId === id) return { text: 'SHIELDED', color: '#2dd4bf' };
  return null;
}

const lerpNum = (a: number, b: number, t: number) => a + (b - a) * t;
function lerpAngle(a: number, b: number, t: number) {
  let d = b - a;
  while (d > Math.PI) d -= 2 * Math.PI;
  while (d < -Math.PI) d += 2 * Math.PI;
  return a + d * t;
}

// One built seat (an AI figure). The human seat has `figure:false` (no mesh — the
// camera sits there) but still carries a position so others can look at "you".
type Seat = {
  id: string;
  name: string;
  human: boolean;
  pos: THREE.Vector3;
  bodyYaw: number;
  grp: THREE.Group | null;
  head: THREE.Group | null;
  skull: THREE.Mesh | null;
  skinMat: THREE.MeshPhysicalMaterial | null;
  bodyMat: THREE.MeshPhysicalMaterial | null;
  ring: THREE.Mesh | null;
  label: THREE.Mesh | null;
  tag: THREE.Mesh | null;
  tagMat: THREE.MeshBasicMaterial | null;
  tagKey: string;
  think: THREE.Mesh | null; // overhead "thinking…" bubble (shown while deliberating)
  baseColor: THREE.Color;
  alive: boolean;
  deathAnim: number; // 0 = upright, 1 = fully collapsed
  deathInit: boolean; // has the one-shot death effect (topple axis + soul burst) fired?
  fallAxis: THREE.Vector3 | null; // axis the figure topples about
};

// What `phase × myRole × awake` should look like. This is the hidden-information
// mechanic made visible: same phase, different render depending on what your seat
// is allowed to know.
type ViewTarget = {
  amb: number;
  ambI: number;
  lamp: number;
  lampI: number;
  fog: number;
  fogD: number;
  bg: number;
  rim: number;
  rimI: number;
  bloom: number;
  hide: boolean;
  label: string;
  labelColor: string;
};
function viewTarget(phase: string, myRole: string, awake: boolean): ViewTarget {
  if (phase === 'NIGHT' && !awake)
    return { amb: 0x000000, ambI: 0, lamp: 0x000000, lampI: 0, fog: 0x000000, fogD: 0.32, bg: 0x000000, rim: 0x000000, rimI: 0, bloom: 0.2, hide: true, label: 'NIGHT — you are asleep', labelColor: '#3a3f50' };
  if (phase === 'NIGHT' && myRole === 'mafia')
    return { amb: 0x401015, ambI: 0.5, lamp: 0xff3838, lampI: 90, fog: 0x14060a, fogD: 0.085, bg: 0x0a0204, rim: 0x4a0a12, rimI: 0.6, bloom: 0.9, hide: false, label: 'NIGHT — choose your target', labelColor: '#ff6b6b' };
  if (phase === 'NIGHT' && myRole === 'detective')
    return { amb: 0x10243f, ambI: 0.55, lamp: 0x6fb4ff, lampI: 120, fog: 0x05101c, fogD: 0.07, bg: 0x030812, rim: 0x2a5ba0, rimI: 0.7, bloom: 0.85, hide: false, label: 'NIGHT — investigate', labelColor: '#7fc4ff' };
  if (phase === 'NIGHT' && myRole === 'doctor')
    return { amb: 0x103a36, ambI: 0.55, lamp: 0x5fe0c8, lampI: 120, fog: 0x05140f, fogD: 0.07, bg: 0x03100c, rim: 0x2aa090, rimI: 0.7, bloom: 0.85, hide: false, label: 'NIGHT — protect', labelColor: '#6fe6cf' };
  if (phase === 'NIGHT')
    // awake spectator / other (watch mode) — a dim, visible night
    return { amb: 0x16203a, ambI: 0.45, lamp: 0x88a0d0, lampI: 110, fog: 0x070a14, fogD: 0.065, bg: 0x05060a, rim: 0x3050a0, rimI: 0.55, bloom: 0.8, hide: false, label: 'NIGHT', labelColor: '#8b93a8' };
  if (phase === 'VOTE')
    return { amb: 0x2a2440, ambI: 0.5, lamp: 0xffd0a0, lampI: 240, fog: 0x0c0a14, fogD: 0.05, bg: 0x080610, rim: 0x6a4fae, rimI: 0.6, bloom: 0.85, hide: false, label: 'VOTE — the table decides', labelColor: '#b79cff' };
  // DISCUSSION (warm day)
  return { amb: 0x2a3350, ambI: 0.4, lamp: 0xffe2b0, lampI: 220, fog: 0x05060a, fogD: 0.05, bg: 0x05060a, rim: 0x4060ff, rimI: 0.5, bloom: 0.75, hide: false, label: 'DISCUSSION', labelColor: '#8b93a8' };
}

const R = 4.2; // seating radius

export default function TribunalScene(props: Props) {
  const mountRef = useRef<HTMLDivElement | null>(null);
  // latest props, refreshed every render so the imperative loop reads current state
  const live = useRef(props);
  live.current = props;

  // imperative API filled by the mount effect, called by the player-sync effect
  const apiRef = useRef<{ syncPlayers: (players: ScenePlayer[], myId: string | null) => void } | null>(null);

  // ── static scene + renderer + loop (built once; disposed on unmount) ──────────
  useEffect(() => {
    const mount = mountRef.current;
    if (!mount) return;

    const width = mount.clientWidth || window.innerWidth;
    const height = mount.clientHeight || window.innerHeight;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = true;
    renderer.shadowMap.type = THREE.PCFSoftShadowMap;
    renderer.toneMapping = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.05;
    mount.appendChild(renderer.domElement);
    renderer.domElement.style.display = 'block';

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x05060a);
    scene.fog = new THREE.FogExp2(0x05060a, 0.05);

    const pmrem = new THREE.PMREMGenerator(renderer);
    const envRT = pmrem.fromScene(new RoomEnvironment(), 0.04);
    scene.environment = envRT.texture;

    const camera = new THREE.PerspectiveCamera(72, width / height, 0.1, 100);

    // ── lighting ──
    const ambient = new THREE.AmbientLight(0x2a3350, 0.4);
    scene.add(ambient);
    const lamp = new THREE.SpotLight(0xffe2b0, 220, 26, Math.PI / 5.5, 0.5, 1.6);
    lamp.position.set(0, 8.5, 0);
    lamp.castShadow = true;
    lamp.shadow.mapSize.set(2048, 2048);
    lamp.shadow.bias = -0.0004;
    scene.add(lamp, lamp.target);
    const rim = new THREE.DirectionalLight(0x4060ff, 0.5);
    rim.position.set(-6, 4, -8);
    scene.add(rim);

    // self-lit glow meshes live here so the loop can hide them all for true black
    const fx = new THREE.Group();
    scene.add(fx);

    const cone = new THREE.Mesh(
      new THREE.ConeGeometry(4.2, 8.5, 48, 1, true),
      new THREE.MeshBasicMaterial({ color: 0xffdca0, transparent: true, opacity: 0.05, side: THREE.DoubleSide, depthWrite: false, blending: THREE.AdditiveBlending }),
    );
    cone.position.set(0, 4.5, 0);
    fx.add(cone);

    // ── environment ──
    const floor = new THREE.Mesh(new THREE.CircleGeometry(60, 80), new THREE.MeshStandardMaterial({ color: 0x06070c, roughness: 0.22, metalness: 0.8 }));
    floor.rotation.x = -Math.PI / 2;
    floor.receiveShadow = true;
    scene.add(floor);
    [6.5, 9.5, 13].forEach((rad, i) => {
      const g = new THREE.Mesh(new THREE.TorusGeometry(rad, 0.012, 8, 160), new THREE.MeshBasicMaterial({ color: 0x1c2b46, transparent: true, opacity: 0.5 - i * 0.12 }));
      g.rotation.x = -Math.PI / 2;
      g.position.y = 0.01;
      fx.add(g);
    });

    const tprofile = [
      [0.0, 0.42], [3.0, 0.42], [3.38, 0.4], [3.42, 0.34], [3.3, 0.3],
      [0.85, 0.24], [0.5, 0.12], [0.46, 0.0], [1.35, -0.0], [1.35, -0.02], [0.0, -0.02],
    ].map((p) => new THREE.Vector2(p[0], p[1]));
    const table = new THREE.Mesh(
      new THREE.LatheGeometry(tprofile, 96),
      new THREE.MeshPhysicalMaterial({ color: 0x0e121b, roughness: 0.18, metalness: 0.5, clearcoat: 1, clearcoatRoughness: 0.25 }),
    );
    table.castShadow = true;
    table.receiveShadow = true;
    scene.add(table);
    const rimRing = new THREE.Mesh(new THREE.TorusGeometry(3.34, 0.03, 16, 200), new THREE.MeshBasicMaterial({ color: 0x3b6ea5 }));
    rimRing.rotation.x = -Math.PI / 2;
    rimRing.position.y = 0.43;
    fx.add(rimRing);
    const emblem = new THREE.Mesh(new THREE.TorusGeometry(0.9, 0.02, 12, 96), new THREE.MeshBasicMaterial({ color: 0x2c3550, transparent: true, opacity: 0.7 }));
    emblem.rotation.x = -Math.PI / 2;
    emblem.position.y = 0.43;
    fx.add(emblem);

    const wire = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 4, 8), new THREE.MeshBasicMaterial({ color: 0x222633 }));
    wire.position.y = 10.3;
    scene.add(wire);
    const shade = new THREE.Mesh(new THREE.ConeGeometry(0.9, 0.7, 32, 1, true), new THREE.MeshStandardMaterial({ color: 0x14171f, side: THREE.DoubleSide, roughness: 0.5, metalness: 0.6 }));
    shade.position.y = 8.3;
    scene.add(shade);
    const bulb = new THREE.Mesh(new THREE.SphereGeometry(0.26, 20, 16), new THREE.MeshBasicMaterial({ color: 0xffe9c2 }));
    bulb.position.y = 8.05;
    fx.add(bulb);

    const pillarMat = new THREE.MeshStandardMaterial({ color: 0x0b0d14, roughness: 0.7, metalness: 0.3 });
    for (let i = 0; i < 12; i++) {
      const a = (i / 12) * Math.PI * 2;
      const rad = 15.5;
      const px = Math.cos(a) * rad;
      const pz = Math.sin(a) * rad;
      const pil = new THREE.Mesh(new THREE.CylinderGeometry(0.55, 0.7, 11, 16), pillarMat);
      pil.position.set(px, 5.0, pz);
      scene.add(pil);
      const strip = new THREE.Mesh(new THREE.BoxGeometry(0.06, 7, 0.06), new THREE.MeshBasicMaterial({ color: 0x223a5e, transparent: true, opacity: 0.55 }));
      strip.position.set(px * 0.95, 5.0, pz * 0.95);
      fx.add(strip);
    }

    const DUST = 480;
    const dpos = new Float32Array(DUST * 3);
    for (let i = 0; i < DUST; i++) {
      const r = Math.sqrt(Math.random()) * 11;
      const a = Math.random() * Math.PI * 2;
      dpos[i * 3] = Math.cos(a) * r;
      dpos[i * 3 + 1] = Math.random() * 7.5;
      dpos[i * 3 + 2] = Math.sin(a) * r;
    }
    const dustGeo = new THREE.BufferGeometry();
    dustGeo.setAttribute('position', new THREE.BufferAttribute(dpos, 3));
    const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: 0x9fb4d8, size: 0.035, transparent: true, opacity: 0.5, depthWrite: false, blending: THREE.AdditiveBlending }));
    fx.add(dust);

    // targeting reticle — a billboarded crosshair shown over the hovered target
    // during your own pick turn (kill / investigate / protect / vote).
    const reticleMat = new THREE.MeshBasicMaterial({ map: makeReticleTexture(), color: 0xff4d4d, transparent: true, depthWrite: false, depthTest: false, blending: THREE.AdditiveBlending });
    const reticle = new THREE.Mesh(new THREE.PlaneGeometry(1.25, 1.25), reticleMat);
    reticle.renderOrder = 999;
    reticle.visible = false;
    scene.add(reticle);

    // ── post-processing ──
    const composer = new EffectComposer(renderer);
    composer.addPass(new RenderPass(scene, camera));
    const bloom = new UnrealBloomPass(new THREE.Vector2(width, height), 0.75, 0.7, 0.62);
    composer.addPass(bloom);
    composer.addPass(new OutputPass());

    // Free orbit/zoom/pan camera — used ONLY in watch mode (spectator). In play
    // mode it's disabled and the camera is locked first-person to the human seat.
    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.08;
    controls.rotateSpeed = 0.5;
    controls.zoomSpeed = 0.8;
    controls.panSpeed = 0.6;
    controls.minDistance = 2.5;
    controls.maxDistance = 18;
    controls.maxPolarAngle = Math.PI * 0.49; // don't dip under the floor
    controls.target.set(0, 1.05, 0);
    controls.enabled = false;
    let controlsReady = false; // becomes true once we've seeded the spectator vantage

    // ── player figures (rebuilt by syncPlayers) ──
    let seats: Seat[] = [];
    const seatById = new Map<string, Seat>();
    // track which textures/geoms/materials we own per build, to dispose on rebuild
    let owned: { dispose: () => void }[] = [];

    const eye = new THREE.Vector3(0, 2.3, R * 1.72); // default spectator eye until seats are built

    function headWorld(s: Seat) {
      return new THREE.Vector3(s.pos.x, s.human ? 1.55 : 1.7, s.pos.z);
    }

    // transient "soul" particle bursts, spawned on death
    type Burst = { pts: THREE.Points; geom: THREE.BufferGeometry; mat: THREE.PointsMaterial; vel: Float32Array; age: number; ttl: number };
    let bursts: Burst[] = [];
    function spawnSoulBurst(seat: Seat) {
      const N = 70;
      const pos = new Float32Array(N * 3);
      const vel = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) {
        pos[i * 3] = seat.pos.x;
        pos[i * 3 + 1] = 1.5 + Math.random() * 0.6;
        pos[i * 3 + 2] = seat.pos.z;
        const a = Math.random() * Math.PI * 2;
        const out = 0.3 + Math.random() * 0.8;
        vel[i * 3] = Math.cos(a) * out;
        vel[i * 3 + 1] = 1.0 + Math.random() * 2.0; // mostly rising
        vel[i * 3 + 2] = Math.sin(a) * out;
      }
      const geom = new THREE.BufferGeometry();
      geom.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      // pale, slightly brand-tinted soul
      const col = seat.baseColor.clone().lerp(new THREE.Color(0xffffff), 0.55);
      const mat = new THREE.PointsMaterial({ color: col, size: 0.13, transparent: true, opacity: 0.95, depthWrite: false, blending: THREE.AdditiveBlending });
      const pts = new THREE.Points(geom, mat);
      scene.add(pts);
      bursts.push({ pts, geom, mat, vel, age: 0, ttl: 1.7 });
    }
    function clearBursts() {
      for (const b of bursts) {
        scene.remove(b.pts);
        b.geom.dispose();
        b.mat.dispose();
      }
      bursts = [];
    }

    function clearFigures() {
      for (const s of seats) {
        if (s.grp) scene.remove(s.grp);
        if (s.label) scene.remove(s.label);
        if (s.ring) scene.remove(s.ring);
        s.tagMat?.map?.dispose(); // dynamic tag textures aren't tracked in `owned`
      }
      clearBursts();
      for (const o of owned) o.dispose();
      owned = [];
      seats = [];
      seatById.clear();
    }

    function buildFigures(players: ScenePlayer[], myId: string | null) {
      clearFigures();
      const N = players.length;
      const FRONT = Math.PI / 2;
      players.forEach((pl, i) => {
        const a = FRONT + (i / N) * Math.PI * 2;
        const x = Math.cos(a) * R;
        const z = Math.sin(a) * R;
        const bodyYaw = Math.atan2(-x, -z); // face table centre
        const human = !!pl.human || (myId != null && pl.id === myId);
        const color = colorFor(pl.name);
        const baseColor = new THREE.Color(color);

        if (human) {
          // You ARE the camera — no figure, just a seat record so others look at you.
          const seat: Seat = { id: pl.id, name: pl.name, human: true, pos: new THREE.Vector3(x, 0, z), bodyYaw, grp: null, head: null, skull: null, skinMat: null, bodyMat: null, ring: null, label: null, tag: null, tagMat: null, tagKey: '', think: null, baseColor, alive: pl.alive, deathAnim: pl.alive ? 0 : 1, deathInit: !pl.alive, fallAxis: null };
          seats.push(seat);
          seatById.set(pl.id, seat);
          return;
        }

        const grp = new THREE.Group();
        grp.position.set(x, 0, z);
        scene.add(grp);

        const bodyMat = new THREE.MeshPhysicalMaterial({ color: baseColor.clone(), roughness: 0.32, metalness: 0.3, clearcoat: 1, clearcoatRoughness: 0.3 });
        const bprofile = [
          [0.0, 0.2], [0.4, 0.22], [0.46, 0.45], [0.4, 0.78], [0.34, 1.0],
          [0.46, 1.18], [0.58, 1.34], [0.52, 1.44], [0.22, 1.5], [0.15, 1.62], [0.13, 1.72], [0.0, 1.74],
        ].map((p) => new THREE.Vector2(p[0], p[1]));
        const bustGeo = new THREE.LatheGeometry(bprofile, 64);
        const bust = new THREE.Mesh(bustGeo, bodyMat);
        bust.castShadow = true;
        grp.add(bust);

        const head = new THREE.Group();
        head.position.y = 1.86;
        head.rotation.y = bodyYaw;
        grp.add(head);
        const skin = makeHeadSkin(pl.name, color);
        const skinMat = new THREE.MeshPhysicalMaterial({ map: skin, roughness: 0.4, metalness: 0.2, clearcoat: 0.7, clearcoatRoughness: 0.3, emissive: 0xffffff, emissiveMap: skin, emissiveIntensity: 0 });
        const skullGeo = new THREE.SphereGeometry(0.32, 40, 28);
        const skull = new THREE.Mesh(skullGeo, skinMat);
        skull.scale.set(1, 1.1, 0.95);
        skull.rotation.y = -Math.PI / 2; // bring painted logo to the front
        skull.castShadow = true;
        head.add(skull);

        const nameTex = makeName(pl.name);
        const labelMat = new THREE.MeshBasicMaterial({ map: nameTex, transparent: true, depthWrite: false });
        const labelGeo = new THREE.PlaneGeometry(0.95, 0.27);
        const label = new THREE.Mesh(labelGeo, labelMat);
        label.position.set(x, 2.45, z);
        scene.add(label);

        const ringGeo = new THREE.RingGeometry(0.5, 0.62, 48);
        const ringMat = new THREE.MeshBasicMaterial({ color: 0x2a3148, transparent: true, opacity: 0.22, side: THREE.DoubleSide });
        const ring = new THREE.Mesh(ringGeo, ringMat);
        ring.rotation.x = -Math.PI / 2;
        ring.position.set(x, 0.37, z);
        scene.add(ring);

        // overhead secret-status tag (hidden until you learn something about them).
        // Lives inside grp so it inherits visibility (e.g. hidden during blackout).
        const tagMat = new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false });
        const tagGeo = new THREE.PlaneGeometry(1.2, 0.45);
        const tag = new THREE.Mesh(tagGeo, tagMat);
        tag.position.set(0, 2.84, 0);
        tag.visible = false;
        grp.add(tag);

        // overhead "thinking…" thought-bubble (shown only while this model is mid-LLM)
        const thinkTex = makeThinkBubbleTexture(color);
        const thinkMat = new THREE.MeshBasicMaterial({ map: thinkTex, transparent: true, depthWrite: false });
        const thinkGeo = new THREE.PlaneGeometry(0.92, 0.575);
        const think = new THREE.Mesh(thinkGeo, thinkMat);
        think.position.set(0, 3.18, 0);
        think.visible = false;
        grp.add(think);

        owned.push(bustGeo, bodyMat, skullGeo, skinMat, skin, nameTex, labelMat, labelGeo, ringGeo, ringMat, tagGeo, tagMat, thinkTex, thinkMat, thinkGeo);

        const seat: Seat = { id: pl.id, name: pl.name, human: false, pos: new THREE.Vector3(x, 0, z), bodyYaw, grp, head, skull, skinMat, bodyMat, ring, label, tag, tagMat, tagKey: '', think, baseColor, alive: pl.alive, deathAnim: pl.alive ? 0 : 1, deathInit: !pl.alive, fallAxis: null };
        // a figure built already-dead (e.g. reconnect) starts collapsed, no replay
        if (!pl.alive) {
          const outward = new THREE.Vector3(x, 0, z).normalize();
          seat.fallAxis = new THREE.Vector3().crossVectors(new THREE.Vector3(0, 1, 0), outward).normalize();
          grp.quaternion.setFromAxisAngle(seat.fallAxis, Math.PI * 0.5);
          grp.position.y = -0.12;
        }
        seats.push(seat);
        seatById.set(pl.id, seat);
      });

      // camera eye = the human seat, nudged slightly outside the ring; else spectator
      const me = seats.find((s) => s.human);
      if (me) eye.set(me.pos.x * 1.18, 1.65, me.pos.z * 1.18);
      else eye.set(0, 2.3, R * 1.72);
    }

    // applies per-player alive/role state from props onto existing seats
    function applyState(players: ScenePlayer[]) {
      for (const pl of players) {
        const s = seatById.get(pl.id);
        if (!s) continue;
        const wasAlive = s.alive;
        s.alive = pl.alive;
        // Freshly dead → just flip the flag; the render loop plays the collapse +
        // soul-burst + desaturation as a one-shot animation (deathInit/deathAnim).
        if (!s.human && !wasAlive && pl.alive) {
          // (defensive) revived → restore
          s.bodyMat?.color.copy(s.baseColor);
          s.skinMat?.color.set(0xffffff);
          s.deathAnim = 0;
          s.deathInit = false;
          if (s.grp) {
            s.grp.quaternion.identity();
            s.grp.position.set(s.pos.x, 0, s.pos.z);
          }
        }
      }
    }

    // signature so we only rebuild geometry when the roster identity changes
    let sig = '';
    apiRef.current = {
      syncPlayers(players, myId) {
        const nextSig = players.map((p) => p.id).join('|') + '::' + (myId ?? '');
        if (nextSig !== sig) {
          sig = nextSig;
          buildFigures(players, myId);
        }
        applyState(players);
      },
    };
    // build immediately if props already have players (e.g. fast SSE)
    apiRef.current.syncPlayers(live.current.players, live.current.myId);

    // ── interaction: raycast faces ──
    const ray = new THREE.Raycaster();
    const ndc = new THREE.Vector2();
    let hoveredId: string | null = null; // seat under the cursor during a pick turn
    function selectAt(e: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
      ray.setFromCamera(ndc, camera);
      // raycast the whole figure group (bust + head + skull) of every living AI seat.
      // (invisible objects are skipped by three, so blackout clicks naturally miss.)
      const groups = seats.filter((s) => !s.human && s.alive && s.grp).map((s) => s.grp!);
      const hit = ray.intersectObjects(groups, true)[0];
      if (hit) {
        let obj: THREE.Object3D | null = hit.object;
        let seat: Seat | undefined;
        while (obj && !seat) {
          seat = seats.find((s) => s.grp === obj);
          obj = obj.parent;
        }
        if (seat && seat.alive && !seat.human) live.current.onSelect(seat.id);
      } else {
        live.current.onSelect(''); // empty space → deselect
      }
    }
    // Distinguish a click (select a face) from a drag (orbit the camera in watch
    // mode), so dragging to look around never accidentally selects/deselects.
    let downX = 0;
    let downY = 0;
    function onPointerDown(e: PointerEvent) {
      downX = e.clientX;
      downY = e.clientY;
    }
    function onPointerUp(e: PointerEvent) {
      if (Math.hypot(e.clientX - downX, e.clientY - downY) <= 6) selectAt(e);
    }
    renderer.domElement.addEventListener('pointerdown', onPointerDown);
    renderer.domElement.addEventListener('pointerup', onPointerUp);

    // mouse free-look — turns your head by moving the look TARGET (never the camera
    // position, which would mirror the world). Not inverted.
    const par = new THREE.Vector2(0, 0);
    function onPointerMove(e: PointerEvent) {
      const rect = renderer.domElement.getBoundingClientRect();
      par.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
      par.y = ((e.clientY - rect.top) / rect.height) * 2 - 1;
      // hover-pick: while it's your own target turn, track which seat the cursor is
      // over so the loop can snap the reticle to it.
      const lp = live.current;
      if (lp.turn && lp.turn.agent === lp.myId) {
        ndc.x = ((e.clientX - rect.left) / rect.width) * 2 - 1;
        ndc.y = -((e.clientY - rect.top) / rect.height) * 2 + 1;
        ray.setFromCamera(ndc, camera);
        const groups = seats.filter((s) => !s.human && s.alive && s.grp).map((s) => s.grp!);
        const hit = ray.intersectObjects(groups, true)[0];
        let found: Seat | undefined;
        if (hit) {
          let obj: THREE.Object3D | null = hit.object;
          while (obj && !found) {
            found = seats.find((s) => s.grp === obj);
            obj = obj.parent;
          }
        }
        hoveredId = found ? found.id : null;
      } else {
        hoveredId = null;
      }
    }
    renderer.domElement.addEventListener('pointermove', onPointerMove);

    // ── loop ──
    const aim = new THREE.Vector3(0, 1.3, 0);
    const target = new THREE.Vector3(0, 1.3, 0);
    const tmpFwd = new THREE.Vector3();
    const tmpRight = new THREE.Vector3();
    const UP = new THREE.Vector3(0, 1, 0);
    const cAmb = new THREE.Color();
    const cLamp = new THREE.Color();
    const cRim = new THREE.Color();
    const cFog = new THREE.Color();
    const cBg = new THREE.Color();
    const cBulbOn = new THREE.Color();
    const cBulbOff = new THREE.Color(0x101010);
    const cWork = new THREE.Color(); // scratch colour for per-seat lerps
    let t = 0;
    let raf = 0;

    function animate() {
      raf = requestAnimationFrame(animate);
      t += 0.0015;
      const p = live.current;
      const isSpectator = p.myId == null;
      const awake = isSpectator || p.myRole === 'mafia' || !!p.turn;
      const v = viewTarget(p.phase, p.myRole, awake);

      if (isSpectator) {
        // Watch mode: free orbit/zoom/pan around the table.
        if (!controlsReady) {
          camera.position.copy(eye); // seed from the default spectator vantage
          controls.target.set(0, 1.05, 0);
          controls.enabled = true;
          controls.update();
          controlsReady = true;
        }
        controls.update();
      } else {
        // Play mode: locked first-person from your seat; the mouse pans/tilts.
        if (controls.enabled) controls.enabled = false;
        controlsReady = false;
        const forwardAngle = Math.atan2(-eye.z, -eye.x);
        tmpFwd.set(Math.cos(forwardAngle), 0, Math.sin(forwardAngle));
        tmpRight.copy(tmpFwd).cross(UP); // camera right
        target.copy(eye).addScaledVector(tmpFwd, 6).addScaledVector(tmpRight, par.x * 7);
        target.y = 1.35 - par.y * 1.6;
        aim.lerp(target, 0.12);
        camera.position.copy(eye);
        camera.lookAt(aim);
      }

      // ease lights/fog/bloom/background toward the role-filtered target
      const fog = scene.fog as THREE.FogExp2;
      fog.color.lerp(cFog.set(v.fog), 0.06);
      fog.density += (v.fogD - fog.density) * 0.06;
      (scene.background as THREE.Color).lerp(cBg.set(v.bg), 0.06);
      ambient.color.lerp(cAmb.set(v.amb), 0.06);
      ambient.intensity += (v.ambI - ambient.intensity) * 0.06;
      lamp.color.lerp(cLamp.set(v.lamp), 0.06);
      lamp.intensity += (v.lampI - lamp.intensity) * 0.06;
      rim.color.lerp(cRim.set(v.rim), 0.06);
      rim.intensity += (v.rimI - rim.intensity) * 0.06;
      bloom.strength += (v.bloom - bloom.strength) * 0.06;
      (bulb.material as THREE.MeshBasicMaterial).color.lerp(v.lampI > 5 ? cBulbOn.set(v.lamp) : cBulbOff, 0.06);

      // whoever holds the floor (accused first, else current speaker) is the focus
      const focus = p.accusedId ? seatById.get(p.accusedId) : p.speakingId ? seatById.get(p.speakingId) : undefined;
      const hide = v.hide;
      fx.visible = !hide;

      // Mafia night ritual: from a Mafia seat, the town is "asleep" (dimmed, heads
      // bowed) while your allies stay lit — the digital "open your eyes" moment.
      const mafiaNight = !isSpectator && p.phase === 'NIGHT' && p.myRole === 'mafia';

      for (const s of seats) {
        if (!s.grp || !s.head || !s.ring || !s.label) continue; // human seat = no figure
        s.grp.visible = !hide;
        s.label.visible = !hide;
        s.ring.visible = !hide;
        if (hide) continue;

        // night ritual: allies stay in colour & awake; the sleeping town dims out.
        const isAlly = mafiaNight && (p.teammates?.includes(s.id) ?? false);
        const sleeping = mafiaNight && !isAlly && s.alive;
        if (s.alive && s.bodyMat) s.bodyMat.color.lerp(sleeping ? cWork.set(0x0e1118) : s.baseColor, 0.06);

        // ── death: collapse + topple outward + a rising "soul" burst (one-shot) ──
        if (!s.alive) {
          if (!s.deathInit) {
            s.deathInit = true;
            const outward = new THREE.Vector3(s.pos.x, 0, s.pos.z).normalize();
            s.fallAxis = new THREE.Vector3().crossVectors(UP, outward).normalize();
            spawnSoulBurst(s);
          }
          if (s.deathAnim < 1) s.deathAnim = Math.min(1, s.deathAnim + 0.02);
          const e = 1 - Math.pow(1 - s.deathAnim, 3); // easeOutCubic
          if (s.fallAxis) s.grp.quaternion.setFromAxisAngle(s.fallAxis, e * Math.PI * 0.5);
          s.grp.position.set(s.pos.x, -e * 0.12, s.pos.z);
          s.head.rotation.x = lerpNum(s.head.rotation.x, 0.6, 0.12); // head lolls
          if (s.skinMat) s.skinMat.emissiveIntensity = lerpNum(s.skinMat.emissiveIntensity, 0, 0.12);
          // desaturate body + head as they fall
          if (s.bodyMat) s.bodyMat.color.lerp(cAmb.set(0x3a3d46), 0.08);
          if (s.skinMat) s.skinMat.color.lerp(cLamp.set(0x6a6d76), 0.08);
        } else {
          // turn head toward the focal person; the focal person looks at the table
          let yaw = s.bodyYaw;
          if (focus && focus.id !== s.id) {
            const tp = headWorld(focus);
            yaw = Math.atan2(tp.x - s.pos.x, tp.z - s.pos.z);
          }
          s.head.rotation.y = lerpAngle(s.head.rotation.y, yaw, 0.07);
        }

        const talking = !p.accusedId && p.speakingId === s.id && s.alive;
        // sleeping town bow their heads; everyone else holds talking/idle pitch.
        const headPitch = sleeping ? 0.5 : talking ? Math.sin(t * 34) * 0.05 : 0;
        if (s.alive) s.head.rotation.x = lerpNum(s.head.rotation.x, headPitch, sleeping ? 0.08 : 0.18);

        // awake allies get a soft pulse; sleeping town go dark.
        const glowI = talking ? 0.45 + Math.sin(t * 18) * 0.2 : p.accusedId === s.id ? 0.5 : isAlly ? 0.22 + Math.sin(t * 5) * 0.08 : 0;
        if (s.skinMat) s.skinMat.emissiveIntensity = lerpNum(s.skinMat.emissiveIntensity, glowI, 0.12);

        // who voted to kill this seat (Mafia, at night, from your seat only)
        const killVoters = !isSpectator && p.phase === 'NIGHT' && p.myRole === 'mafia' ? p.killVotes?.[s.id] : undefined;
        const isKillTarget = !!killVoters && killVoters.length > 0;

        // ring colour: accused (amber) > dead (red) > speaking (cyan) > kill-target (red) > idle
        const rm = s.ring.material as THREE.MeshBasicMaterial;
        if (p.accusedId === s.id) {
          rm.color.set(0xf0b54a);
          rm.opacity = 0.5;
        } else if (!s.alive) {
          rm.color.set(0xe0454f);
          rm.opacity = 0.4;
        } else if (talking) {
          rm.color.set(0x5fd0ff);
          rm.opacity = 0.42 + Math.sin(t * 16) * 0.1;
        } else if (isKillTarget) {
          rm.color.set(0xe0454f);
          rm.opacity = 0.5 + Math.sin(t * 7) * 0.14;
        } else if (isAlly) {
          rm.color.set(0xc084fc);
          rm.opacity = 0.4 + Math.sin(t * 5) * 0.12;
        } else if (sleeping) {
          rm.color.set(0x161b27);
          rm.opacity = 0.1;
        } else {
          rm.color.set(0x2a3148);
          rm.opacity = 0.22;
        }

        // billboard the name label toward the camera
        s.label.rotation.y = Math.atan2(camera.position.x - s.label.position.x, camera.position.z - s.label.position.z);

        // overhead secret-status tag — your private role knowledge, made obvious.
        // Only ever shown to a seated player (never the watch-mode spectator).
        if (s.tag && s.tagMat) {
          let want = isSpectator ? null : tagFor(s.id, p.findings, p.teammates, p.protectedId);
          // kill-vote marker takes over a town target's tag during the Mafia night
          if (!want && isKillTarget) want = { text: `⚔ ${killVoters!.join('·')}`, color: '#e0454f' };
          const key = want ? want.text : '';
          if (key !== s.tagKey) {
            s.tagKey = key;
            s.tagMat.map?.dispose();
            if (want) {
              s.tagMat.map = makeTagTexture(want.text, want.color);
              s.tagMat.needsUpdate = true;
              s.tag.visible = true;
            } else {
              s.tagMat.map = null;
              s.tagMat.needsUpdate = true;
              s.tag.visible = false;
            }
          }
          if (s.tag.visible) {
            s.tag.rotation.y = Math.atan2(camera.position.x - s.pos.x, camera.position.z - s.pos.z);
            const pulse = 1 + Math.sin(t * 9) * 0.05;
            s.tag.scale.set(pulse, pulse, 1);
          }
        }

        // overhead "thinking…" bubble — visible while this model is mid-LLM. Hidden
        // once it starts speaking (the line itself is the payoff) or when it dies.
        if (s.think) {
          const wantThink = s.alive && !talking && (p.thinkingIds?.includes(s.id) ?? false);
          if (wantThink !== s.think.visible) s.think.visible = wantThink;
          if (wantThink) {
            s.think.rotation.y = Math.atan2(camera.position.x - s.pos.x, camera.position.z - s.pos.z);
            const bob = Math.sin(t * 16) * 0.04;
            s.think.position.y = 3.18 + bob;
            const pulse = 1 + Math.sin(t * 12) * 0.06;
            s.think.scale.set(pulse, pulse, 1);
            const tm = s.think.material as THREE.MeshBasicMaterial;
            tm.opacity = 0.8 + Math.sin(t * 12) * 0.2;
          }
        }
      }

      // ── targeting reticle: snaps to whoever you hover during your pick turn ──
      {
        const myT = p.turn && p.turn.agent === p.myId ? p.turn : null;
        const legal: string[] = myT?.legal ?? [];
        const pickTool = ['mafia_propose_kill', 'investigate', 'protect', 'vote'].find((x) => legal.includes(x));
        let aimSeat: Seat | undefined;
        if (pickTool) {
          const hov = hoveredId ? seatById.get(hoveredId) : undefined;
          aimSeat = hov && hov.alive && !hov.human ? hov : p.accusedId ? seatById.get(p.accusedId) : undefined;
        }
        if (aimSeat && aimSeat.grp) {
          const col = pickTool === 'mafia_propose_kill' ? 0xff4d4d : pickTool === 'investigate' ? 0x6fb4ff : pickTool === 'protect' ? 0x5fe0c8 : 0xf0b54a;
          const hw = headWorld(aimSeat);
          reticle.position.set(hw.x, hw.y + 0.5, hw.z);
          reticle.quaternion.copy(camera.quaternion);
          reticleMat.color.set(col);
          const pulse = 1 + Math.sin(t * 10) * 0.08;
          reticle.scale.set(pulse, pulse, 1);
          reticle.visible = true;
        } else {
          reticle.visible = false;
        }
      }

      // advance soul bursts (rise, slow, fade), retiring expired ones
      for (let bi = bursts.length - 1; bi >= 0; bi--) {
        const b = bursts[bi];
        b.age += 0.016;
        const ba = b.geom.attributes.position.array as Float32Array;
        for (let j = 0; j < b.vel.length; j += 3) {
          ba[j] += b.vel[j] * 0.016;
          ba[j + 1] += b.vel[j + 1] * 0.016;
          ba[j + 2] += b.vel[j + 2] * 0.016;
          b.vel[j + 1] -= 1.1 * 0.016; // ease the rise
        }
        b.geom.attributes.position.needsUpdate = true;
        b.mat.opacity = Math.max(0, 0.95 * (1 - b.age / b.ttl));
        if (b.age >= b.ttl) {
          scene.remove(b.pts);
          b.geom.dispose();
          b.mat.dispose();
          bursts.splice(bi, 1);
        }
      }

      // drift dust upward
      const arr = dustGeo.attributes.position.array as Float32Array;
      for (let i = 1; i < arr.length; i += 3) {
        arr[i] += 0.004;
        if (arr[i] > 7.5) arr[i] = 0;
      }
      dustGeo.attributes.position.needsUpdate = true;

      composer.render();
    }
    animate();

    // ── resize ──
    function onResize() {
      const w = mount!.clientWidth || window.innerWidth;
      const h = mount!.clientHeight || window.innerHeight;
      camera.aspect = w / h;
      camera.updateProjectionMatrix();
      renderer.setSize(w, h);
      composer.setSize(w, h);
    }
    window.addEventListener('resize', onResize);
    const ro = new ResizeObserver(onResize);
    ro.observe(mount);

    // ── cleanup (StrictMode-safe: one live renderer, fully disposed) ──
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener('resize', onResize);
      ro.disconnect();
      renderer.domElement.removeEventListener('pointerdown', onPointerDown);
      renderer.domElement.removeEventListener('pointerup', onPointerUp);
      renderer.domElement.removeEventListener('pointermove', onPointerMove);
      controls.dispose();
      apiRef.current = null;
      clearFigures();
      scene.traverse((obj) => {
        const mesh = obj as THREE.Mesh;
        if (mesh.geometry) mesh.geometry.dispose();
        const m = (mesh as any).material;
        if (Array.isArray(m)) m.forEach((mm: THREE.Material) => mm.dispose());
        else if (m) (m as THREE.Material).dispose();
      });
      dustGeo.dispose();
      reticleMat.map?.dispose();
      envRT.texture.dispose();
      pmrem.dispose();
      composer.dispose();
      renderer.dispose();
      if (renderer.domElement.parentNode === mount) mount.removeChild(renderer.domElement);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // ── sync player figures whenever the roster / alive-state changes ─────────────
  useEffect(() => {
    apiRef.current?.syncPlayers(props.players, props.myId);
  }, [props.players, props.myId]);

  return (
    <div style={{ position: 'absolute', inset: 0 }}>
      <div ref={mountRef} style={{ position: 'absolute', inset: 0 }} />
      <PhaseBanner {...props} />
      <ActionOverlay {...props} />
      <ActionStyles />
    </div>
  );
}

// ── HTML overlay: phase banner ──────────────────────────────────────────────────
function PhaseBanner(props: Props) {
  const isSpectator = props.myId == null;
  const awake = isSpectator || props.myRole === 'mafia' || !!props.turn;
  const v = viewTarget(props.phase, props.myRole, awake);
  return (
    <div
      style={{
        position: 'absolute',
        left: '50%',
        top: 14,
        transform: 'translateX(-50%)',
        fontSize: 12,
        letterSpacing: '0.34em',
        textTransform: 'uppercase',
        color: v.labelColor,
        textShadow: '0 0 16px currentColor',
        pointerEvents: 'none',
        fontFamily: 'ui-monospace, monospace',
        whiteSpace: 'nowrap',
      }}
    >
      {v.label}
    </div>
  );
}

// Defined, weighty, game-like action buttons (layered gradient, hover lift,
// pressed state, a red danger variant for the mafia kill).
function ActionStyles() {
  return (
    <style>{`
.tribunal-action{
  position:relative; appearance:none; cursor:pointer; font:inherit;
  font-size:13px; font-weight:600; letter-spacing:.06em; text-transform:uppercase;
  color:#f4f6fb; padding:13px 24px; border-radius:12px; border:1px solid rgba(150,168,210,.35);
  background:
    linear-gradient(180deg, rgba(255,255,255,.10), rgba(255,255,255,0) 42%),
    linear-gradient(180deg, #2b3350, #1a2036);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.18),
              inset 0 -2px 6px rgba(0,0,0,.45),
              0 6px 18px rgba(0,0,0,.5);
  text-shadow:0 1px 2px rgba(0,0,0,.6);
  transition: transform .08s ease, box-shadow .15s ease, filter .15s ease, border-color .15s ease;
}
.tribunal-action:hover:not(:disabled){ transform:translateY(-2px); border-color:rgba(170,190,235,.7);
  filter:brightness(1.12); box-shadow: inset 0 1px 0 rgba(255,255,255,.22),
    inset 0 -2px 6px rgba(0,0,0,.45), 0 10px 26px rgba(0,0,0,.6), 0 0 22px 2px rgba(120,150,255,.35); }
.tribunal-action:active:not(:disabled){ transform:translateY(1px) scale(.99);
  box-shadow: inset 0 2px 6px rgba(0,0,0,.6), 0 3px 8px rgba(0,0,0,.5); filter:brightness(.95); }
.tribunal-action:disabled{ cursor:default; color:#7e879b; filter:none; transform:none;
  border-color:rgba(120,130,160,.2);
  background:linear-gradient(180deg,#1a1e2c,#141826);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.05), inset 0 -1px 3px rgba(0,0,0,.4); text-shadow:none; }
.tribunal-action--danger{
  color:#ffe7e7; border-color:rgba(255,120,120,.5);
  background:
    linear-gradient(180deg, rgba(255,255,255,.12), rgba(255,255,255,0) 42%),
    linear-gradient(180deg, #6e1d22, #45121a);
  box-shadow: inset 0 1px 0 rgba(255,180,180,.25),
              inset 0 -2px 6px rgba(0,0,0,.5), 0 6px 18px rgba(120,0,0,.45),
              0 0 22px rgba(220,40,40,.25); }
.tribunal-action--danger:hover:not(:disabled){ border-color:rgba(255,140,140,.85);
  box-shadow: inset 0 1px 0 rgba(255,180,180,.3), 0 10px 26px rgba(140,0,0,.55),
              0 0 30px rgba(230,50,50,.4); }
.tribunal-action--join{
  color:#1a1206; border-color:rgba(255,200,110,.65);
  background:
    linear-gradient(180deg, rgba(255,255,255,.35), rgba(255,255,255,0) 45%),
    linear-gradient(180deg, #ffcf6e, #f0a93a);
  text-shadow:none;
  box-shadow: inset 0 1px 0 rgba(255,255,255,.5),
              inset 0 -2px 6px rgba(120,70,0,.4), 0 6px 18px rgba(0,0,0,.5),
              0 0 22px rgba(240,170,60,.3); }
.tribunal-action--join:hover:not(:disabled){ border-color:rgba(255,215,140,.95);
  box-shadow: inset 0 1px 0 rgba(255,255,255,.6), 0 10px 26px rgba(0,0,0,.55),
              0 0 30px rgba(245,180,70,.5); }
`}</style>
  );
}

// ── HTML overlay: action buttons, derived from the pending `turn` payload ─────────
// Shows only the legal target-based actions for this phase/role. Free-text actions
// (DISCUSSION speech, mafia whispers) are handled by the page's ActionBar.
type ActionDef = { tool: string; label: string; danger?: boolean; targets: { id: string; name: string }[] };
function ActionOverlay(props: Props) {
  const { turn, accusedId, players, onAction } = props;
  // only the human's own turn drives buttons
  if (!turn || turn.agent !== props.myId) return null;
  const legal: string[] = turn.legal ?? [];
  const sel = accusedId ? players.find((p) => p.id === accusedId) : null;
  const selName = sel?.name ?? '';

  const defs: ActionDef[] = [];
  if (legal.includes('mafia_propose_kill')) defs.push({ tool: 'mafia_propose_kill', label: selName ? `Kill ${selName}` : 'Pick a target', danger: true, targets: turn.killTargets ?? [] });
  if (legal.includes('investigate')) defs.push({ tool: 'investigate', label: selName ? `Investigate ${selName}` : 'Pick someone to investigate', targets: turn.investigateTargets ?? [] });
  if (legal.includes('protect')) defs.push({ tool: 'protect', label: selName ? `Protect ${selName}` : 'Pick someone to protect', targets: turn.protectTargets ?? [] });
  if (legal.includes('vote')) defs.push({ tool: 'vote', label: selName ? `Vote out ${selName}` : 'Pick someone to vote', targets: turn.alive ?? [] });

  if (defs.length === 0) return null;

  return (
    <div
      style={{
        // raised above the caption (which sits at the very bottom)
        position: 'absolute',
        left: '50%',
        bottom: 22,
        transform: 'translateX(-50%)',
        display: 'flex',
        gap: 10,
        flexWrap: 'wrap',
        justifyContent: 'center',
        fontFamily: 'ui-monospace, monospace',
      }}
    >
      {defs.map((d) => {
        const enabled = !!accusedId && d.targets.some((tg) => tg.id === accusedId);
        return (
          <button
            key={d.tool}
            disabled={!enabled}
            onClick={enabled ? () => onAction(d.tool, { target: accusedId }) : undefined}
            data-kind={d.danger ? 'danger' : undefined}
            className={`tribunal-action${d.danger ? ' tribunal-action--danger' : ''}`}
          >
            {d.label}
          </button>
        );
      })}
    </div>
  );
}

// ── A small circular avatar that paints the same brand colour + logo mark as the
// 3D heads, so captions and the transcript share the figures' identity. ──────────
export function PlayerFace({ name, size = 40 }: { name: string; size?: number }) {
  const ref = useRef<HTMLCanvasElement | null>(null);
  useEffect(() => {
    const cv = ref.current;
    if (!cv) return;
    const s = size * 2; // draw at 2× for crispness
    cv.width = s;
    cv.height = s;
    const ctx = cv.getContext('2d');
    if (!ctx) return;
    const color = colorFor(name);
    ctx.clearRect(0, 0, s, s);
    ctx.save();
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s / 2, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = color;
    ctx.fillRect(0, 0, s, s);
    const sh = ctx.createLinearGradient(0, 0, 0, s);
    sh.addColorStop(0, 'rgba(255,255,255,0.18)');
    sh.addColorStop(1, 'rgba(0,0,0,0.45)');
    ctx.fillStyle = sh;
    ctx.fillRect(0, 0, s, s);
    ctx.fillStyle = 'rgba(8,10,16,0.82)';
    roundRect(ctx, s * 0.26, s * 0.24, s * 0.48, s * 0.52, s * 0.12);
    ctx.fill();
    markFor(name)(ctx, s, color);
    ctx.restore();
  }, [name, size]);
  return <canvas ref={ref} style={{ width: size, height: size, borderRadius: '50%', display: 'block', flexShrink: 0 }} aria-hidden />;
}
