"use client";

import { Environment, OrbitControls } from "@react-three/drei";
import { useFrame, useThree, type ThreeEvent } from "@react-three/fiber";
import { EffectComposer, N8AO, ToneMapping } from "@react-three/postprocessing";
import { ToneMappingMode } from "postprocessing";
import { useEffect, useLayoutEffect, useMemo, useRef } from "react";
import { MathUtils, MeshBasicMaterial, Plane, PlaneGeometry, Raycaster, RingGeometry, Shape, ShapeGeometry, TOUCH, Vector2, Vector3, type DirectionalLight, type Group, type Material, type Mesh } from "three";
import { doorSwing } from "@/lib/domain/fit";
import { FURNITURE } from "@/lib/domain/furniture";
import { contains, rectangle } from "@/lib/domain/geometry";
import { rowWidthMm, topMm } from "@/lib/domain/layout";
import type { Fixture } from "@/lib/domain/room";
import { buildFixture } from "../model/fixtures";
import { buildFurniture, type BedHost } from "../model/furniture";
import type { Part } from "../model/parts";
import { buildShell, roomView, SLAB_MM, slabBounds } from "../model/shell";
import { itemTones } from "../model/tones";
import type { RoomItemData, RoomPresetData } from "../types";
import { mergeParts, MM } from "./geometry";
import { contactShadowMaterial, invalidRingMaterial, materialFor, ringMaterial, selectedRingMaterial } from "./materials";

export interface SceneItem {
  data: RoomItemData;
  /** Drops in when it mounts. Items already in the room appear in place. */
  animate: boolean;
  /** Follows the pointer or the keyboard while the student moves it, with no glide. */
  held: boolean;
}

/** A floor plan point in millimeters. */
export interface PlanPoint {
  x: number;
  y: number;
}

export interface DragStart {
  key: string;
  pointerId: number;
  clientX: number;
  clientY: number;
  /** Height of the plane the pointer slides on, so a lamp on a desk tracks the pointer exactly. */
  elevationMm: number;
}

export interface RoomSceneProps {
  preset: RoomPresetData;
  items: readonly SceneItem[];
  ringKey: string | null;
  focusKey: string | null;
  reducedMotion: boolean;
  onHover: (key: string | null) => void;
  onSelect: (key: string) => void;
  onLanded: (key: string) => void;
  onReady: () => void;
  onAnchor: (point: { x: number; y: number } | null) => void;
  /** Items can be picked up and dragged across the floor. */
  editable?: boolean;
  /** The item with the selection outline, and whether its current spot fails the fit check. */
  outline?: { key: string; invalid: boolean } | null;
  drag?: DragStart | null;
  onGrab?: (start: DragStart) => void;
  onDragMove?: (point: PlanPoint) => void;
  onDragEnd?: () => void;
}

const HDR = "/hdr/studio-small-08.hdr";
const ELEVATION = MathUtils.degToRad(40);
/**
 * Calibrated against the flat face recipe from the approved flow boards. Top
 * faces show the base color, faces turned to the left of the screen 7% Ink,
 * and faces turned to the right 18% Ink. The studio HDR is dark overhead, so
 * the key light sits high, a little left of and in front of the room.
 */
const KEY_LIGHT = { intensity: 2.3, color: "#FFFAF4", left: 0.27, front: 0.1 } as const;
const ENVIRONMENT_INTENSITY = 0.62;
const DROP_HEIGHT = 0.9;
const FALL_S = 0.34;
const SETTLE_S = 0.42;
const SHADOW_OPACITY = 0.34;

/**
 * The default view turns this far from the diagonal toward the side wall,
 * the long wall in every preset, so the room reads along its length and the
 * tall pieces by the door hide less of the middle.
 */
const VIEW_TURN = MathUtils.degToRad(10);

interface CameraView {
  /** Horizontal unit vector from the room toward the camera. */
  toward: Vector3;
  azimuth: number;
}

function cameraView(preset: RoomPresetData): CameraView {
  const { toward } = roomView(preset.geometry);
  const azimuth = Math.atan2(toward.x, toward.z) + Math.sign(toward.x) * VIEW_TURN;
  return { toward: new Vector3(Math.sin(azimuth), 0, Math.cos(azimuth)), azimuth };
}

/** Converts a floor plan point in millimeters to scene meters, centered on the room. */
function useRoomSpace(preset: RoomPresetData) {
  return useMemo(
    () => ({
      x: (mm: number) => (mm - preset.widthMm / 2) * MM,
      z: (mm: number) => (mm - preset.depthMm / 2) * MM,
    }),
    [preset.widthMm, preset.depthMm],
  );
}

function Model({ parts, cast = true }: { parts: readonly Part[]; cast?: boolean }) {
  const meshes = useMemo(() => mergeParts(parts), [parts]);
  useEffect(() => () => meshes.forEach((mesh) => mesh.geometry.dispose()), [meshes]);
  return (
    <>
      {meshes.map((mesh) => (
        <mesh key={mesh.key} geometry={mesh.geometry} material={materialFor(mesh.look)} castShadow={cast && mesh.look.finish !== "glass"} receiveShadow />
      ))}
    </>
  );
}

const unitPlane = new PlaneGeometry(1, 1).rotateX(-Math.PI / 2);

/** A soft shadow pressed under an item, stretched past its footprint. */
function ContactShadow({ width, depth, y = 0.0015, opacity = SHADOW_OPACITY, meshRef }: { width: number; depth: number; y?: number; opacity?: number; meshRef?: React.Ref<Mesh> }) {
  const material = useMemo(() => contactShadowMaterial(opacity), [opacity]);
  useEffect(() => () => material.dispose(), [material]);
  return <mesh ref={meshRef} geometry={unitPlane} material={material} position={[0, y, 0]} scale={[width * 1.45, 1, depth * 1.45]} renderOrder={1} />;
}

function FixtureModel({ fixture, space }: { fixture: Fixture; space: ReturnType<typeof useRoomSpace> }) {
  const parts = useMemo(() => buildFixture(fixture), [fixture]);
  return (
    <group position={[space.x(fixture.xMm), 0, space.z(fixture.yMm)]} rotation={[0, MathUtils.degToRad(-fixture.rotationDeg), 0]}>
      <Model parts={parts} />
      <ContactShadow width={fixture.widthMm * MM} depth={fixture.depthMm * MM} opacity={SHADOW_OPACITY * 0.8} />
    </group>
  );
}

function bedUnder(preset: RoomPresetData, item: RoomItemData): BedHost | undefined {
  const point = [{ x: item.layout.xMm, y: item.layout.yMm }];
  const bed = preset.geometry.fixtures.find(
    (fixture) => fixture.kind === "bed" && contains(rectangle(fixture.xMm, fixture.yMm, fixture.widthMm, fixture.depthMm, fixture.rotationDeg), point),
  );
  return bed === undefined ? undefined : { width: bed.widthMm, length: bed.depthMm };
}

const isBedding = (item: RoomItemData) => item.layout.placement === "bed" && item.layout.elevationMm > 0;

interface ItemProps {
  preset: RoomPresetData;
  entry: SceneItem;
  space: ReturnType<typeof useRoomSpace>;
  reducedMotion: boolean;
  editable: boolean;
  onHover: (key: string | null) => void;
  onSelect: (key: string) => void;
  onLanded: (key: string) => void;
  onGrab?: (start: DragStart) => void;
}

const GLIDE_S = 0.32;

/** The shortest turn from one heading to another, in radians. */
const shortestTurn = (from: number, to: number) => from + ((((to - from) % (Math.PI * 2)) + Math.PI * 3) % (Math.PI * 2)) - Math.PI;

/**
 * An item drops in with gravity, squashes on contact, and springs back to its
 * true size while its contact shadow darkens and tightens under it. When the
 * agent moves it, it glides to the new spot. When the student holds it, it
 * follows without delay.
 */
function PlacedItem({ preset, entry, space, reducedMotion, editable, onHover, onSelect, onLanded, onGrab }: ItemProps) {
  const { layout } = entry.data;
  const bedding = isBedding(entry.data);
  const host = bedding ? bedUnder(preset, entry.data) : undefined;
  const { furnitureType, widthMm, depthMm, heightMm, pieces } = layout;
  const { colors, color } = entry.data;
  const parts = useMemo(
    () => buildFurniture(furnitureType, { width: widthMm, depth: depthMm, height: heightMm }, pieces, itemTones(colors, color), host),
    // The bed host is rebuilt on every render, so its size stands in for it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [furnitureType, widthMm, depthMm, heightMm, pieces, colors, color, host?.width, host?.length],
  );
  const width = rowWidthMm(layout) * MM;
  const depth = layout.depthMm * MM;
  const spread = width * 1.45;
  const depthSpread = depth * 1.45;
  const frame = useRef<Group>(null);
  const body = useRef<Group>(null);
  const shadow = useRef<Mesh>(null);
  const drop = useRef({ start: -1, done: !entry.animate || reducedMotion });
  const glide = useRef<{ start: number; from: Vector3; turnFrom: number } | null>(null);
  const settled = useRef(false);
  const invalidate = useThree((state) => state.invalidate);
  const get = useThree((state) => state.get);
  const landed = useRef(onLanded);
  useLayoutEffect(() => {
    landed.current = onLanded;
  });

  const target = useMemo(() => new Vector3(space.x(layout.xMm), layout.elevationMm * MM, space.z(layout.yMm)), [space, layout.xMm, layout.yMm, layout.elevationMm]);
  const heading = MathUtils.degToRad(-layout.rotationDeg);

  useEffect(() => {
    if (drop.current.done) landed.current(layout.key);
  }, [layout.key]);

  // A new spot from the agent glides in. A spot the student holds is set at once.
  useLayoutEffect(() => {
    const group = frame.current;
    if (group === null) return;
    if (!settled.current || entry.held || reducedMotion) {
      settled.current = true;
      glide.current = null;
      group.position.copy(target);
      group.rotation.y = heading;
    } else if (group.position.distanceTo(target) > 1e-6 || group.rotation.y !== heading) {
      glide.current = { start: -1, from: group.position.clone(), turnFrom: group.rotation.y };
    }
    invalidate();
  }, [target, heading, entry.held, reducedMotion, invalidate]);

  useFrame(() => {
    const motion = glide.current;
    if (motion !== null && frame.current !== null) {
      const now = performance.now() / 1000;
      if (motion.start < 0) motion.start = now;
      const p = Math.min(1, (now - motion.start) / GLIDE_S);
      const eased = 1 - (1 - p) ** 3;
      frame.current.position.lerpVectors(motion.from, target, eased);
      frame.current.rotation.y = MathUtils.lerp(motion.turnFrom, shortestTurn(motion.turnFrom, heading), eased);
      if (p >= 1) {
        frame.current.rotation.y = heading;
        glide.current = null;
      }
      invalidate();
    }

    const state = drop.current;
    if (state.done || body.current === null) return;
    const now = performance.now() / 1000;
    if (state.start < 0) state.start = now;
    const t = now - state.start;
    const shadowMaterial = shadow.current?.material as MeshBasicMaterial | undefined;
    if (t < FALL_S) {
      const p = t / FALL_S;
      body.current.position.y = DROP_HEIGHT * (1 - p * p);
      body.current.scale.set(1, 1, 1);
      if (shadowMaterial) shadowMaterial.opacity = SHADOW_OPACITY * p ** 1.5;
      shadow.current?.scale.set(spread * (0.55 + 0.45 * p), 1, depthSpread * (0.55 + 0.45 * p));
    } else {
      const s = t - FALL_S;
      const squash = 1 - 0.12 * Math.exp(-7.5 * s) * Math.cos(22 * s);
      body.current.position.y = 0;
      body.current.scale.set(1 + (1 - squash) * 0.5, squash, 1 + (1 - squash) * 0.5);
      if (shadowMaterial) shadowMaterial.opacity = SHADOW_OPACITY;
      shadow.current?.scale.set(spread, 1, depthSpread);
      if (s >= SETTLE_S) {
        body.current.scale.set(1, 1, 1);
        state.done = true;
        landed.current(layout.key);
      }
    }
    invalidate();
  });

  const flat = layout.furnitureType === "rug" || layout.furnitureType === "round_rug" || bedding;
  const startHidden = entry.animate && !reducedMotion;

  return (
    <group
      ref={frame}
      onPointerOver={(event: ThreeEvent<PointerEvent>) => {
        event.stopPropagation();
        onHover(layout.key);
      }}
      onPointerOut={() => onHover(null)}
      onPointerDown={(event: ThreeEvent<PointerEvent>) => {
        if (!editable || onGrab === undefined || event.button !== 0) return;
        event.stopPropagation();
        // Orbit controls see the same press, so they stop before the first move turns the room.
        const { controls } = get();
        if (isEnabled(controls)) controls.enabled = false;
        onGrab({ key: layout.key, pointerId: event.pointerId, clientX: event.nativeEvent.clientX, clientY: event.nativeEvent.clientY, elevationMm: layout.elevationMm });
      }}
      onClick={(event: ThreeEvent<MouseEvent>) => {
        if (editable) return;
        event.stopPropagation();
        onSelect(layout.key);
      }}
    >
      <group ref={body} position={[0, startHidden ? DROP_HEIGHT : 0, 0]}>
        <Model parts={parts} cast={layout.furnitureType !== "rug" && layout.furnitureType !== "round_rug"} />
      </group>
      {!flat && <ContactShadow width={width} depth={depth} opacity={startHidden ? 0 : SHADOW_OPACITY} meshRef={shadow} />}
    </group>
  );
}

interface Switchable {
  enabled: boolean;
}

const isEnabled = (controls: unknown): controls is Switchable => typeof controls === "object" && controls !== null && "enabled" in controls;

function ringGeometry(layout: RoomItemData["layout"]) {
  const margin = 70;
  const band = 34;
  if (FURNITURE[layout.furnitureType].round && layout.pieces === 1) {
    const radius = (Math.max(layout.widthMm, layout.depthMm) / 2 + margin) * MM;
    return new RingGeometry(radius - band * MM, radius, 72).rotateX(-Math.PI / 2);
  }
  const outer = roundedRect((rowWidthMm(layout) + margin * 2) * MM, (layout.depthMm + margin * 2) * MM, 90 * MM);
  outer.holes.push(roundedRect((rowWidthMm(layout) + (margin - band) * 2) * MM, (layout.depthMm + (margin - band) * 2) * MM, 60 * MM));
  return new ShapeGeometry(outer, 12).rotateX(-Math.PI / 2);
}

/** A flat outline under an item: Sky for the item the agent placed last, Flint while selected, Brick on a spot that fails. */
function ItemRing({ entry, space, material, fade = false, lift = 3 }: { entry: SceneItem; space: ReturnType<typeof useRoomSpace>; material: Material; fade?: boolean; lift?: number }) {
  const { layout } = entry.data;
  const { furnitureType, widthMm, depthMm, pieces } = layout;
  const geometry = useMemo(
    () => ringGeometry(layout),
    // Only the footprint shapes the ring.
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [furnitureType, widthMm, depthMm, pieces],
  );
  useEffect(() => () => geometry.dispose(), [geometry]);

  const mesh = useRef<Mesh>(null);
  const born = useRef(-1);
  const invalidate = useThree((state) => state.invalidate);
  useFrame(() => {
    if (!fade || mesh.current === null) return;
    const now = performance.now() / 1000;
    if (born.current < 0) born.current = now;
    const p = Math.min(1, (now - born.current) / 0.22);
    (mesh.current.material as MeshBasicMaterial).opacity = p;
    mesh.current.scale.setScalar(1.08 - 0.08 * p);
    if (p < 1) invalidate();
  });

  const elevation = layout.placement === "surface" ? layout.elevationMm : 0;
  return (
    <mesh
      ref={mesh}
      geometry={geometry}
      material={material}
      position={[space.x(layout.xMm), (elevation + lift) * MM, space.z(layout.yMm)]}
      rotation={[0, MathUtils.degToRad(-layout.rotationDeg), 0]}
      renderOrder={2}
    />
  );
}

/**
 * While the student holds an item, follows the pointer across a level plane
 * at the item's own height and reports floor plan points. Window listeners
 * keep the drag alive when the pointer leaves the canvas.
 */
function DragLayer({ preset, drag, onMove, onEnd }: { preset: RoomPresetData; drag: DragStart; onMove: (point: PlanPoint) => void; onEnd: () => void }) {
  const get = useThree((state) => state.get);
  const moveRef = useRef(onMove);
  const endRef = useRef(onEnd);
  useLayoutEffect(() => {
    moveRef.current = onMove;
    endRef.current = onEnd;
  });

  useEffect(() => {
    const { camera, gl, controls } = get();
    const raycaster = new Raycaster();
    const plane = new Plane(new Vector3(0, 1, 0), -drag.elevationMm * MM);
    const pointer = new Vector2();
    const hit = new Vector3();
    const toPlan = (clientX: number, clientY: number): PlanPoint | null => {
      const rect = gl.domElement.getBoundingClientRect();
      pointer.set(((clientX - rect.left) / rect.width) * 2 - 1, -((clientY - rect.top) / rect.height) * 2 + 1);
      raycaster.setFromCamera(pointer, camera);
      if (raycaster.ray.intersectPlane(plane, hit) === null) return null;
      return { x: hit.x / MM + preset.widthMm / 2, y: hit.z / MM + preset.depthMm / 2 };
    };
    const first = toPlan(drag.clientX, drag.clientY);
    if (first !== null) moveRef.current(first);
    const move = (event: PointerEvent) => {
      if (event.pointerId !== drag.pointerId) return;
      const point = toPlan(event.clientX, event.clientY);
      if (point !== null) moveRef.current(point);
    };
    const end = (event: PointerEvent) => {
      if (event.pointerId === drag.pointerId) endRef.current();
    };
    if (isEnabled(controls)) controls.enabled = false;
    gl.domElement.style.cursor = "grabbing";
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", end);
    window.addEventListener("pointercancel", end);
    return () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", end);
      window.removeEventListener("pointercancel", end);
      if (isEnabled(controls)) controls.enabled = true;
      gl.domElement.style.cursor = "";
    };
  }, [get, drag, preset.widthMm, preset.depthMm]);

  return null;
}

function roundedRect(width: number, depth: number, radius: number): Shape {
  const r = Math.min(radius, width / 2, depth / 2);
  const x = -width / 2;
  const y = -depth / 2;
  const shape = new Shape();
  shape.moveTo(x + r, y);
  shape.lineTo(x + width - r, y);
  shape.quadraticCurveTo(x + width, y, x + width, y + r);
  shape.lineTo(x + width, y + depth - r);
  shape.quadraticCurveTo(x + width, y + depth, x + width - r, y + depth);
  shape.lineTo(x + r, y + depth);
  shape.quadraticCurveTo(x, y + depth, x, y + depth - r);
  shape.lineTo(x, y + r);
  shape.quadraticCurveTo(x, y, x + r, y);
  return shape;
}

const SWING_LOOK = { tone: "swing", finish: "muted" } as const;

/** The quarter disc each door sweeps, a shade darker than the floor, so the clear zone reads at a glance. */
function DoorSwings({ preset, space }: { preset: RoomPresetData; space: ReturnType<typeof useRoomSpace> }) {
  const swings = useMemo(
    () =>
      preset.geometry.doors
        .filter((door) => door.swing === "in")
        .map((door) => {
          const { hinge, closed, inward } = doorSwing(preset, door);
          const start = Math.atan2(closed.y, closed.x);
          let sweep = Math.atan2(inward.y, inward.x) - start;
          if (sweep > Math.PI) sweep -= Math.PI * 2;
          if (sweep < -Math.PI) sweep += Math.PI * 2;
          // CircleGeometry draws counterclockwise in its own plane. Lying flat flips y, so the angles flip too.
          const thetaStart = sweep > 0 ? -(start + sweep) : -start;
          return { key: `${door.wall}-${door.offsetMm}`, hinge, radius: door.widthMm * MM, thetaStart, thetaLength: Math.abs(sweep) };
        }),
    [preset],
  );
  return (
    <>
      {swings.map((swing) => (
        <mesh key={swing.key} material={materialFor(SWING_LOOK)} position={[space.x(swing.hinge.x), 0.001, space.z(swing.hinge.y)]} rotation={[-Math.PI / 2, 0, 0]} receiveShadow>
          <circleGeometry args={[swing.radius, 32, swing.thetaStart, swing.thetaLength]} />
        </mesh>
      ))}
    </>
  );
}

interface Framing {
  target: Vector3;
  position: Vector3;
  zoom: number;
  azimuth: number;
  polar: number;
}

/** Fits the slab and walls into the canvas from the corner the room view picked. */
function useFraming(preset: RoomPresetData): Framing | null {
  const size = useThree((state) => state.size);
  return useMemo(() => {
    if (size.width === 0 || size.height === 0) return null;
    const area = slabBounds(preset, roomView(preset.geometry));
    const { toward, azimuth } = cameraView(preset);
    const forward = new Vector3(-toward.x * Math.cos(ELEVATION), -Math.sin(ELEVATION), -toward.z * Math.cos(ELEVATION)).normalize();
    const right = new Vector3().crossVectors(forward, new Vector3(0, 1, 0)).normalize();
    const up = new Vector3().crossVectors(right, forward).normalize();
    const xs = [area.minX, area.maxX].map((mm) => (mm - preset.widthMm / 2) * MM);
    const zs = [area.minZ, area.maxZ].map((mm) => (mm - preset.depthMm / 2) * MM);
    const ys = [-SLAB_MM * MM, preset.ceilingHeightMm * MM];
    let minR = Infinity, maxR = -Infinity, minU = Infinity, maxU = -Infinity;
    for (const x of xs) for (const y of ys) for (const z of zs) {
      const corner = new Vector3(x, y, z);
      minR = Math.min(minR, corner.dot(right));
      maxR = Math.max(maxR, corner.dot(right));
      minU = Math.min(minU, corner.dot(up));
      maxU = Math.max(maxU, corner.dot(up));
    }
    const zoom = Math.min(size.width / (maxR - minR), size.height / (maxU - minU)) * 0.9;
    const target = right.clone().multiplyScalar((minR + maxR) / 2).add(up.clone().multiplyScalar((minU + maxU) / 2));
    const position = target.clone().addScaledVector(forward, -12);
    return { target, position, zoom, azimuth, polar: Math.PI / 2 - ELEVATION };
  }, [preset, size.width, size.height]);
}

interface Orbit {
  target: Vector3;
  update: () => void;
}

const isOrbit = (controls: unknown): controls is Orbit =>
  typeof controls === "object" && controls !== null && "target" in controls && "update" in controls;

function Rig({ framing, touchLocked }: { framing: Framing; touchLocked: boolean }) {
  const get = useThree((state) => state.get);

  useEffect(() => {
    const { camera, controls, invalidate } = get();
    camera.position.copy(framing.position);
    camera.zoom = framing.zoom;
    camera.lookAt(framing.target);
    camera.updateProjectionMatrix();
    if (isOrbit(controls)) {
      controls.target.copy(framing.target);
      controls.update();
    }
    invalidate();
  }, [get, framing]);

  // One finger scrolls the page on phones and two fingers turn and zoom the room. While an item is selected for moving, one finger drags it.
  useEffect(() => {
    const { events } = get();
    if (events.connected instanceof HTMLElement) events.connected.style.touchAction = touchLocked ? "none" : "pan-y";
  }, [get, touchLocked]);

  return (
    <OrbitControls
      makeDefault
      enablePan={false}
      enableDamping
      dampingFactor={0.12}
      rotateSpeed={0.5}
      zoomSpeed={0.6}
      minZoom={framing.zoom * 0.9}
      maxZoom={framing.zoom * 1.9}
      minAzimuthAngle={framing.azimuth - 0.38}
      maxAzimuthAngle={framing.azimuth + 0.38}
      minPolarAngle={framing.polar - 0.12}
      maxPolarAngle={framing.polar + 0.14}
      touches={{ ONE: undefined, TWO: TOUCH.DOLLY_ROTATE }}
    />
  );
}

/** Key light from the upper left of the screen, wherever the camera stands. */
function KeyLight({ preset }: { preset: RoomPresetData }) {
  const light = useRef<DirectionalLight>(null);
  const position = useMemo(() => {
    const { toward } = cameraView(preset);
    const right = new Vector3().crossVectors(new Vector3(-toward.x, 0, -toward.z), new Vector3(0, 1, 0)).normalize();
    return right.multiplyScalar(-KEY_LIGHT.left).add(new Vector3(0, 1, 0)).add(toward.clone().multiplyScalar(KEY_LIGHT.front)).normalize().multiplyScalar(9);
  }, [preset]);
  const reach = (Math.max(preset.widthMm, preset.depthMm) / 2 + 900) * MM;
  useEffect(() => {
    const shadow = light.current?.shadow;
    if (shadow === undefined) return;
    Object.assign(shadow.camera, { left: -reach, right: reach, top: reach, bottom: -reach, near: 1, far: 20 });
    shadow.camera.updateProjectionMatrix();
  }, [reach]);
  return (
    <directionalLight
      ref={light}
      position={position}
      intensity={KEY_LIGHT.intensity}
      color={KEY_LIGHT.color}
      castShadow
      shadow-mapSize={[2048, 2048]}
      shadow-radius={5}
      shadow-bias={-0.0004}
      shadow-normalBias={0.02}
    />
  );
}

/** Reports where the focused item's tag should point, in canvas pixels. */
function TagAnchor({ entry, space, onAnchor }: { entry: SceneItem | undefined; space: ReturnType<typeof useRoomSpace>; onAnchor: RoomSceneProps["onAnchor"] }) {
  const camera = useThree((state) => state.camera);
  const size = useThree((state) => state.size);
  const invalidate = useThree((state) => state.invalidate);
  const last = useRef<string>("");
  const point = useMemo(() => new Vector3(), []);

  useEffect(() => {
    if (entry === undefined) {
      last.current = "";
      onAnchor(null);
    }
    invalidate();
  }, [entry, onAnchor, invalidate]);

  useFrame(() => {
    if (entry === undefined) return;
    const { layout } = entry.data;
    point.set(space.x(layout.xMm), (topMm(layout) + 60) * MM, space.z(layout.yMm)).project(camera);
    const x = Math.round(((point.x + 1) / 2) * size.width);
    const y = Math.round(((1 - point.y) / 2) * size.height);
    const key = `${layout.key}:${x}:${y}`;
    if (key !== last.current) {
      last.current = key;
      onAnchor({ x, y });
    }
  });
  return null;
}

function ReadyProbe({ onReady }: { onReady: () => void }) {
  const fired = useRef(false);
  useFrame(() => {
    if (fired.current) return;
    fired.current = true;
    requestAnimationFrame(onReady);
  });
  return null;
}

function SlabShadow({ preset }: { preset: RoomPresetData }) {
  const area = slabBounds(preset, roomView(preset.geometry));
  const width = (area.maxX - area.minX) * MM;
  const depth = (area.maxZ - area.minZ) * MM;
  return (
    <group position={[((area.minX + area.maxX) / 2 - preset.widthMm / 2) * MM, -SLAB_MM * MM - 0.002, ((area.minZ + area.maxZ) / 2 - preset.depthMm / 2) * MM + 0.12]}>
      <ContactShadow width={width * 0.86} depth={depth * 0.86} opacity={0.22} y={0} />
    </group>
  );
}

export function RoomScene({
  preset,
  items,
  ringKey,
  focusKey,
  reducedMotion,
  onHover,
  onSelect,
  onLanded,
  onReady,
  onAnchor,
  editable = false,
  outline = null,
  drag = null,
  onGrab,
  onDragMove,
  onDragEnd,
}: RoomSceneProps) {
  const space = useRoomSpace(preset);
  const framing = useFraming(preset);
  const shell = useMemo(() => buildShell(preset, roomView(preset.geometry)), [preset]);
  // The studio turns with the camera, so the shading matches from every corner.
  const environmentRotation = useMemo<[number, number, number]>(() => [0, cameraView(preset).azimuth, 0], [preset]);
  const ring = items.find((entry) => entry.data.layout.key === ringKey);
  const focused = items.find((entry) => entry.data.layout.key === focusKey);
  const outlined = outline === null ? undefined : items.find((entry) => entry.data.layout.key === outline.key);
  const invalidate = useThree((state) => state.invalidate);

  useEffect(() => {
    invalidate();
  }, [items, ringKey, outline, invalidate]);

  return (
    <>
      <Environment files={HDR} environmentIntensity={ENVIRONMENT_INTENSITY} environmentRotation={environmentRotation} />
      <KeyLight preset={preset} />
      {framing !== null && <Rig framing={framing} touchLocked={editable && outline !== null} />}

      <group position={[-preset.widthMm * MM * 0.5, 0, -preset.depthMm * MM * 0.5]}>
        <Model parts={shell} cast={false} />
      </group>
      <SlabShadow preset={preset} />
      <DoorSwings preset={preset} space={space} />
      {preset.geometry.fixtures.map((fixture, index) => (
        <FixtureModel key={`${fixture.label}-${index}`} fixture={fixture} space={space} />
      ))}
      {items.map((entry) => (
        <PlacedItem
          key={entry.data.layout.key}
          preset={preset}
          entry={entry}
          space={space}
          reducedMotion={reducedMotion}
          editable={editable}
          onHover={onHover}
          onSelect={onSelect}
          onLanded={onLanded}
          onGrab={onGrab}
        />
      ))}
      {ring !== undefined && ring !== outlined && <ItemRing key={`ring-${ring.data.layout.key}`} entry={ring} space={space} material={ringMaterial} fade />}
      {outlined !== undefined && outline !== null && (
        <ItemRing key={`outline-${outlined.data.layout.key}`} entry={outlined} space={space} material={outline.invalid ? invalidRingMaterial : selectedRingMaterial} lift={4} />
      )}
      {drag !== null && onDragMove !== undefined && onDragEnd !== undefined && <DragLayer preset={preset} drag={drag} onMove={onDragMove} onEnd={onDragEnd} />}
      <TagAnchor entry={focused} space={space} onAnchor={onAnchor} />

      <EffectComposer multisampling={4} enableNormalPass={false}>
        <N8AO aoRadius={0.4} distanceFalloff={0.6} intensity={1.4} quality="medium" halfRes />
        <ToneMapping mode={ToneMappingMode.NEUTRAL} />
      </EffectComposer>
      <ReadyProbe onReady={onReady} />
    </>
  );
}

