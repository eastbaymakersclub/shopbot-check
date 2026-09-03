"use client";

import { useEffect, useRef } from "react";
import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import type { AnalysisConfig, AnalysisResult } from "../lib/sbp";
import { mapShopBotPoint, mapShopBotY, segmentExceedsMachineTravel } from "../lib/viewer-coordinates";

export type ViewerMode = "orbit" | "top" | "machine";

interface ToolpathViewerProps {
  result: AnalysisResult | null;
  config: AnalysisConfig;
  selectedLine: number | null;
  mode: ViewerMode;
}

export function ToolpathViewer({ result, config, selectedLine, mode }: ToolpathViewerProps) {
  const hostRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x090d0c);
    scene.fog = new THREE.FogExp2(0x090d0c, 0.008);

    const camera = new THREE.PerspectiveCamera(42, 1, 0.01, 2000);
    const renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.outputColorSpace = THREE.SRGBColorSpace;
    host.appendChild(renderer.domElement);

    const controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.07;
    controls.screenSpacePanning = true;
    controls.minDistance = 0.2;
    controls.maxDistance = 500;

    const machine = config.machine.limits;
    const machineWidth = machine.x.max - machine.x.min;
    const machineHeight = machine.y.max - machine.y.min;
    const tableY = config.stock.zOrigin === "top" ? -config.stock.thickness : 0;
    const gridSize = Math.max(machineWidth, machineHeight);
    const grid = new THREE.GridHelper(gridSize, 24, 0x36524b, 0x1e2a26);
    grid.position.set((machine.x.min + machine.x.max) / 2, tableY - 0.01, mapShopBotY((machine.y.min + machine.y.max) / 2));
    scene.add(grid);

    const outlinePoints = [
      new THREE.Vector3(machine.x.min, tableY, mapShopBotY(machine.y.min)),
      new THREE.Vector3(machine.x.max, tableY, mapShopBotY(machine.y.min)),
      new THREE.Vector3(machine.x.max, tableY, mapShopBotY(machine.y.max)),
      new THREE.Vector3(machine.x.min, tableY, mapShopBotY(machine.y.max)),
      new THREE.Vector3(machine.x.min, tableY, mapShopBotY(machine.y.min)),
    ];
    const outline = new THREE.Line(
      new THREE.BufferGeometry().setFromPoints(outlinePoints),
      new THREE.LineBasicMaterial({ color: 0x65c4e4, transparent: true, opacity: 0.72 }),
    );
    scene.add(outline);

    const stock = result?.effectiveStock ?? config.stock;
    const stockSurface = stock.zOrigin === "top" ? 0 : stock.thickness;
    const stockGeometry = new THREE.BoxGeometry(stock.width, stock.thickness, stock.height);
    const stockMesh = new THREE.Mesh(
      stockGeometry,
      new THREE.MeshBasicMaterial({ color: 0xa9864f, transparent: true, opacity: 0.08, depthWrite: false }),
    );
    stockMesh.position.set(
      stock.x + stock.width / 2,
      stockSurface - stock.thickness / 2,
      mapShopBotY(stock.y + stock.height / 2),
    );
    scene.add(stockMesh);
    const stockEdges = new THREE.LineSegments(
      new THREE.EdgesGeometry(stockGeometry),
      new THREE.LineBasicMaterial({ color: 0xa9864f, transparent: true, opacity: 0.38 }),
    );
    stockEdges.position.copy(stockMesh.position);
    scene.add(stockEdges);

    if (result?.segments.length) {
      const positions: number[] = [];
      const colors: number[] = [];
      const machineLimit = config.machine.limits;
      const color = new THREE.Color();
      for (const segment of result.segments) {
        positions.push(
          ...mapShopBotPoint(segment.from, config.workOffset),
          ...mapShopBotPoint(segment.to, config.workOffset),
        );
        const outside = segmentExceedsMachineTravel(segment.from, segment.to, config.workOffset, machineLimit);
        if (segment.line === selectedLine || outside) color.setHex(0xff3531);
        else if (segment.kind === "jog") color.setHex(0xf4a80c);
        else if (segment.engaged) color.setHex(segment.arc ? 0xb8ff62 : 0x4fd063);
        else color.setHex(0x65c4e4);
        colors.push(color.r, color.g, color.b, color.r, color.g, color.b);
      }
      const geometry = new THREE.BufferGeometry();
      geometry.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
      geometry.setAttribute("color", new THREE.Float32BufferAttribute(colors, 3));
      const path = new THREE.LineSegments(geometry, new THREE.LineBasicMaterial({ vertexColors: true }));
      scene.add(path);
    }

    const axisLength = Math.min(4, Math.max(1, Math.max(machineWidth, machineHeight) / 12));
    const axesGeometry = new THREE.BufferGeometry();
    axesGeometry.setAttribute("position", new THREE.Float32BufferAttribute([
      0, 0, 0, axisLength, 0, 0,
      0, 0, 0, 0, 0, -axisLength,
      0, 0, 0, 0, axisLength, 0,
    ], 3));
    axesGeometry.setAttribute("color", new THREE.Float32BufferAttribute([
      1, 0.2, 0.18, 1, 0.2, 0.18,
      0.3, 0.82, 0.39, 0.3, 0.82, 0.39,
      0.4, 0.77, 0.9, 0.4, 0.77, 0.9,
    ], 3));
    const axes = new THREE.LineSegments(axesGeometry, new THREE.LineBasicMaterial({ vertexColors: true }));
    axes.position.set(config.workOffset.x, stockSurface + 0.02, mapShopBotY(0, config.workOffset.y));
    scene.add(axes);

    const fitCamera = () => {
      const useMachine = mode === "machine" || !result?.segments.length;
      const bounds = useMachine
        ? { minX: machine.x.min, maxX: machine.x.max, minY: machine.y.min, maxY: machine.y.max, minZ: tableY, maxZ: tableY + Math.max(1, stock.thickness) }
        : {
            minX: result.bounds.minX + config.workOffset.x,
            maxX: result.bounds.maxX + config.workOffset.x,
            minY: result.bounds.minY + config.workOffset.y,
            maxY: result.bounds.maxY + config.workOffset.y,
            minZ: result.bounds.minZ,
            maxZ: result.bounds.maxZ,
          };
      const center = new THREE.Vector3(
        (bounds.minX + bounds.maxX) / 2,
        (bounds.minZ + bounds.maxZ) / 2,
        mapShopBotY((bounds.minY + bounds.maxY) / 2),
      );
      const spanX = Math.max(0.5, bounds.maxX - bounds.minX);
      const spanY = Math.max(0.5, bounds.maxY - bounds.minY);
      const spanZ = Math.max(0.5, bounds.maxZ - bounds.minZ);
      const size = Math.max(spanX, spanY, spanZ * 3);
      if (mode === "top") {
        camera.position.set(center.x, center.y + size * 1.75, center.z);
        camera.up.set(0, 0, -1);
      } else {
        camera.position.set(center.x + size * 1.08, center.y + size * 0.82, center.z + size * 1.08);
        camera.up.set(0, 1, 0);
      }
      camera.near = Math.max(0.01, size / 500);
      camera.far = Math.max(100, size * 20);
      camera.updateProjectionMatrix();
      controls.target.copy(center);
      controls.update();
    };
    fitCamera();

    let resizeFrame = 0;
    const resize = () => {
      cancelAnimationFrame(resizeFrame);
      resizeFrame = requestAnimationFrame(() => {
        const width = Math.max(1, host.clientWidth);
        const height = Math.max(1, host.clientHeight);
        renderer.setSize(width, height, false);
        camera.aspect = width / height;
        camera.updateProjectionMatrix();
      });
    };
    const observer = new ResizeObserver(resize);
    observer.observe(host);
    resize();

    let frame = 0;
    const animate = () => {
      controls.update();
      renderer.render(scene, camera);
      frame = requestAnimationFrame(animate);
    };
    animate();

    return () => {
      cancelAnimationFrame(frame);
      cancelAnimationFrame(resizeFrame);
      observer.disconnect();
      controls.dispose();
      scene.traverse((object) => {
        if (object instanceof THREE.Mesh || object instanceof THREE.Line || object instanceof THREE.LineSegments) {
          object.geometry?.dispose();
          const materials = Array.isArray(object.material) ? object.material : [object.material];
          materials.forEach((material) => material?.dispose());
        }
      });
      renderer.dispose();
      renderer.domElement.remove();
    };
  }, [config, mode, result, selectedLine]);

  return <div ref={hostRef} className="three-host" role="img" aria-label="Interactive three-dimensional ShopBot toolpath" />;
}
