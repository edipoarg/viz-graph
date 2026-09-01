import { useEffect, useRef, useState, forwardRef, useImperativeHandle } from "react";
import cytoscape, { type Core, type NodeSingular } from "cytoscape";
import type { GraphData, GraphEdge, GraphNode } from "../types";

export interface GraphViewHandle {
  exportPng: () => void;
}

interface Props {
  data: GraphData;
  onNodeSelect: (node: GraphNode | null) => void;
  selectedNodeId: string | null;
  onHideNode: (nodeId: string) => void;
  relColorMap: Record<string, string>;
}


function calcDegree(edges: GraphEdge[]): Record<string, number> {
  const deg: Record<string, number> = {};
  for (const e of edges) {
    deg[e.source] = (deg[e.source] ?? 0) + 1;
    deg[e.target] = (deg[e.target] ?? 0) + 1;
  }
  return deg;
}

function nodeSize(id: string, deg: Record<string, number>, maxDeg: number): number {
  const d = deg[id] ?? 1;
  return 15 + 65 * Math.sqrt((d - 1) / Math.max(1, maxDeg - 1));
}

const LAYOUT_OPTS = {
  name: "cose",
  animate: false,
  nodeRepulsion: () => 120000,
  idealEdgeLength: () => 250,
  gravity: 0.05,
  numIter: 800,
  coolingFactor: 0.95,
  minTemp: 1.0,
};

const STYLES: cytoscape.StylesheetStyle[] = [
  {
    selector: "node",
    style: {
      "background-color": "#7c4dff",
      "label": "data(label)",
      "color": "#ffffff",
      "font-size": "10px",
      "text-valign": "bottom",
      "text-halign": "center",
      "text-margin-y": 6,
      "width": "data(size)",
      "height": "data(size)",
      "border-width": 2,
      "border-color": "#1e1e2e",
      "text-wrap": "wrap",
      "text-max-width": "120px",
      "min-zoomed-font-size": 6,
      "text-background-color": "#1e1e2e",
      "text-background-opacity": 0.7,
      "text-background-padding": "3px",
      "text-background-shape": "roundrectangle",
    },
  },
  { selector: "node[tipo = 'Sociedad']", style: { "background-color": "#7c4dff" } },
  { selector: "node[tipo = 'PERSONA']",  style: { "background-color": "#ff6d00" } },
  { selector: "node[tipo = ''][role = 'source']", style: { "background-color": "#7c4dff" } },
  { selector: "node[tipo = ''][role = 'target']", style: { "background-color": "#e91e63" } },
  { selector: "node[tipo = ''][role = 'both']",   style: { "background-color": "#ff6d00" } },
  { selector: "node:selected", style: { "background-color": "#03dac6", "border-color": "#ffffff", "border-width": 3 } },
  {
    selector: "edge",
    style: {
      "width": 2,
      "line-color": "data(color)",
      "target-arrow-color": "data(color)",
      "target-arrow-shape": "triangle",
      "curve-style": "bezier",
      "label": "data(type)",
      "font-size": "9px",
      "color": "#aaaaaa",
      "text-rotation": "autorotate",
      "text-margin-y": -8,
      "opacity": 0.8,
    },
  },
  { selector: "edge:selected", style: { "width": 4, opacity: 1 } },
];

const GraphView = forwardRef<GraphViewHandle, Props>(function GraphView(
  { data, onNodeSelect, selectedNodeId, onHideNode, relColorMap },
  ref
) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);
  const positionsRef = useRef<Record<string, { x: number; y: number }>>({});
  const [hoverBtn, setHoverBtn] = useState<{ id: string; x: number; y: number } | null>(null);
  const hideTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  const onNodeSelectRef = useRef(onNodeSelect);
  const onHideNodeRef = useRef(onHideNode);
  const selectedNodeIdRef = useRef(selectedNodeId);
  useEffect(() => { onNodeSelectRef.current = onNodeSelect; }, [onNodeSelect]);
  useEffect(() => { onHideNodeRef.current = onHideNode; }, [onHideNode]);
  useEffect(() => { selectedNodeIdRef.current = selectedNodeId; }, [selectedNodeId]);

  // ── Recreate Cytoscape on data change, preserving node positions ──────────
  useEffect(() => {
    if (!containerRef.current || data.nodes.length === 0) return;

    const saved = positionsRef.current;

    // Save positions and viewport from previous instance before destroying
    let prevViewport: { zoom: number; pan: { x: number; y: number } } | null = null;
    if (cyRef.current) {
      cyRef.current.nodes().forEach((n) => {
        saved[n.id()] = { ...n.position() };
      });
      prevViewport = { zoom: cyRef.current.zoom(), pan: { ...cyRef.current.pan() } };
      cyRef.current.destroy();
      cyRef.current = null;
    }

    const deg = calcDegree(data.edges);
    const maxDeg = Math.max(1, ...Object.values(deg));

    // Detect fresh search (no overlap with saved positions) vs expansion/undo
    const hasOverlap = data.nodes.some((n) => saved[n.id]);

    // For fresh search, clear stale positions
    if (!hasOverlap) positionsRef.current = {};

    // Pre-position new nodes around the selected anchor
    const newNodes = data.nodes.filter((n) => !saved[n.id]);
    if (hasOverlap && newNodes.length > 0) {
      const anchorId = selectedNodeIdRef.current ?? "";
      const anchor = saved[anchorId] ?? { x: 400, y: 300 };
      const R = Math.max(200, newNodes.length * 15);
      newNodes.forEach((n, i) => {
        saved[n.id] = {
          x: anchor.x + R * Math.cos((2 * Math.PI * i) / newNodes.length),
          y: anchor.y + R * Math.sin((2 * Math.PI * i) / newNodes.length),
        };
      });
    }

    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...data.nodes.map((n) => ({
          data: {
            id: n.id, label: n.name, role: n.role ?? "both",
            tipo: n.tipo ?? "", cuit: n.cuit ?? "", actividad: n.actividad_descripcion ?? "",
            degree: deg[n.id] ?? 0, size: nodeSize(n.id, deg, maxDeg),
          },
          ...(hasOverlap && saved[n.id] ? { position: saved[n.id] } : {}),
        })),
        ...data.edges.map((e) => ({
          data: {
            id: e.id, source: e.source, target: e.target,
            type: e.type, weight: e.weight, color: relColorMap[e.type] ?? "#aaaaaa",
          },
        })),
      ],
      layout: hasOverlap
        ? { name: "preset" }
        // CoSE crashes with no edges; use circle for seed-only results
        : data.edges.length > 0
          ? LAYOUT_OPTS
          : { name: "circle", animate: false, padding: 60 },
      style: STYLES,
      minZoom: 0.05,
      maxZoom: 5,
      wheelSensitivity: 0.3,
      pixelRatio: window.devicePixelRatio ?? 1,
      boxSelectionEnabled: true,
    });

    // Save positions after layout completes
    cy.nodes().forEach((n) => { positionsRef.current[n.id()] = { ...n.position() }; });

    // Fit all nodes into view after a fresh search
    if (!hasOverlap) {
      cy.fit(undefined, 40);
      if (cy.zoom() < 0.15) cy.zoom(0.15);
    }

    // Restore viewport on expansion so zoom level is preserved
    if (hasOverlap && prevViewport) {
      cy.zoom(prevViewport.zoom);
      cy.pan(prevViewport.pan);
    }

    // Fit viewport when new nodes were added (expansion)
    if (hasOverlap && newNodes.length > 0) cy.fit(undefined, 40);

    // ── Drag neighbors ────────────────────────────────────────────────────
    let dragStartPos: { x: number; y: number } | null = null;
    const neighborStartPos = new Map<string, { x: number; y: number }>();

    cy.on("grabon", "node", (e) => {
      const node = e.target as NodeSingular;
      dragStartPos = { ...node.position() };
      neighborStartPos.clear();
      node.neighborhood("node").forEach((nb: NodeSingular) => {
        neighborStartPos.set(nb.id(), { ...nb.position() });
      });
    });
    cy.on("drag", "node", (e) => {
      if (!dragStartPos) return;
      const node = e.target as NodeSingular;
      const cur = node.position();
      const dx = cur.x - dragStartPos.x;
      const dy = cur.y - dragStartPos.y;
      node.neighborhood("node").forEach((nb: NodeSingular) => {
        const sp = neighborStartPos.get(nb.id());
        if (sp && !nb.grabbed()) nb.position({ x: sp.x + dx * 0.85, y: sp.y + dy * 0.85 });
      });
    });
    cy.on("free", "node", () => {
      // Persist updated positions after drag
      cy.nodes().forEach((n) => { positionsRef.current[n.id()] = { ...n.position() }; });
      dragStartPos = null;
      neighborStartPos.clear();
    });

    // ── X button on hover ─────────────────────────────────────────────────
    cy.on("mouseover", "node", (e) => {
      clearTimeout(hideTimerRef.current);
      const node = e.target as NodeSingular;
      const rp = node.renderedPosition();
      const r = node.renderedOuterHeight() / 2;
      setHoverBtn({ id: node.id(), x: rp.x + r * 0.75, y: rp.y - r * 0.75 });
    });
    cy.on("mouseout", "node", () => {
      hideTimerRef.current = setTimeout(() => setHoverBtn(null), 300);
    });
    cy.on("viewport", () => setHoverBtn(null));

    cy.on("tap", "node", (e) => {
      const n = e.target;
      onNodeSelectRef.current({
        id: n.id(), name: n.data("label"), dataset_id: "",
        role: n.data("role") ?? "both",
        tipo: n.data("tipo") || undefined,
        cuit: n.data("cuit") || undefined,
        actividad_descripcion: n.data("actividad") || undefined,
      });
    });
    cy.on("tap", (e) => { if (e.target === cy) onNodeSelectRef.current(null); });

    // Box-select: zoom viewport to the selected region then deselect
    cy.on("boxend", () => {
      const sel = cy.$(":selected");
      if (sel.length > 0) {
        cy.fit(sel, 60);
        sel.unselect();
      }
    });

    cyRef.current = cy;
    return () => {
      if (cyRef.current) {
        cyRef.current.nodes().forEach((n) => { positionsRef.current[n.id()] = { ...n.position() }; });
        cyRef.current.destroy();
        cyRef.current = null;
      }
    };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Export full graph ───────────────────────────────────────────────
  useImperativeHandle(ref, () => ({
    exportPng() {
      const cy = cyRef.current;
      if (!cy) return;
      const dataUrl = cy.png({ full: true, scale: 2 });
      const a = document.createElement("a");
      a.href = dataUrl;
      a.download = "red.png";
      a.click();
    },
  }));

  // ── Highlight selected node ───────────────────────────────────────────────
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().unselect();
    if (selectedNodeId) cy.getElementById(selectedNodeId).select();
  }, [selectedNodeId]);

  return (
    <div style={{ position: "relative", width: "100%", height: "100%" }}>
      <div
        ref={containerRef}
        style={{ width: "100%", height: "100%", background: "#0d0d1a", borderRadius: 10 }}
      />

      {/* Zoom controls */}
      <div style={{
        position: "absolute", bottom: 16, right: 16, zIndex: 50,
        display: "flex", flexDirection: "column", gap: 4,
      }}>
        {(["⊕", "⊖", "⊡"] as const).map((icon, i) => (
          <button
            key={icon}
            title={["Acercar", "Alejar", "Ajustar todo"][i]}
            onClick={() => {
              const cy = cyRef.current;
              if (!cy) return;
              if (i === 0) cy.zoom({ level: cy.zoom() * 1.3, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
              else if (i === 1) cy.zoom({ level: cy.zoom() * 0.77, renderedPosition: { x: cy.width() / 2, y: cy.height() / 2 } });
              else cy.fit(undefined, 40);
            }}
            style={{
              width: 30, height: 30, borderRadius: 6,
              background: "#1e1e3a", border: "1px solid #3a3a5a",
              color: "#ccc", cursor: "pointer", fontSize: 16,
              display: "flex", alignItems: "center", justifyContent: "center",
            }}
          >
            {icon}
          </button>
        ))}
      </div>
      {hoverBtn && (
        <button
          onMouseEnter={() => clearTimeout(hideTimerRef.current)}
          onMouseLeave={() => { hideTimerRef.current = setTimeout(() => setHoverBtn(null), 300); }}
          onClick={() => { onHideNodeRef.current(hoverBtn.id); setHoverBtn(null); }}
          style={{
            position: "absolute",
            left: hoverBtn.x,
            top: hoverBtn.y,
            transform: "translate(-50%, -50%)",
            width: 18, height: 18,
            borderRadius: "50%",
            background: "#e53935",
            border: "none",
            color: "#fff",
            cursor: "pointer",
            fontSize: 11,
            fontWeight: "bold",
            lineHeight: 1,
            padding: 0,
            zIndex: 100,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          ✕
        </button>
      )}
    </div>
  );
});

export default GraphView;
