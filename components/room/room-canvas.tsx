"use client";

import { Canvas } from "@react-three/fiber";
import { Suspense } from "react";
import { RoomScene, type RoomSceneProps } from "./scene/room-scene";

export interface RoomCanvasProps extends RoomSceneProps {
  /** Renders every frame while a placement plays, and only on change otherwise. */
  playing: boolean;
}

/**
 * The WebGL canvas, loaded on the client after the page. It clears to
 * transparent, so the page's table color shows through unchanged and the
 * room shares one table with the interface.
 */
export default function RoomCanvas({ playing, ...scene }: RoomCanvasProps) {
  return (
    <Canvas
      orthographic
      shadows="percentage"
      flat
      dpr={[1, 2]}
      frameloop={playing ? "always" : "demand"}
      gl={{ antialias: false, alpha: true, stencil: false, powerPreference: "high-performance" }}
      camera={{ near: 0.1, far: 40, position: [6, 5, 6], zoom: 100 }}
      onCreated={({ gl }) => gl.setClearColor(0x000000, 0)}
      onPointerMissed={() => scene.onHover(null)}
    >
      <Suspense fallback={null}>
        <RoomScene {...scene} />
      </Suspense>
    </Canvas>
  );
}
