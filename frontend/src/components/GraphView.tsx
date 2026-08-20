import { useEffect, useRef } from "react";
import cytoscape, { type Core } from "cytoscape";
import type { GraphData, GraphEdge, GraphNode } from "../types";

interface Props {
  data: GraphData;
  onNodeSelect: (node: GraphNode | null) => void;
  selectedNodeId: string | null;
}

const RELATION_COLORS: Record<string, string> = {};
const PALETTE = [
  "#7c4dff", "#03dac6", "#ff6d00", "#e91e63", "#00bcd4",
  "#8bc34a", "#ff5722", "#9c27b0", "#ffc107", "#2196f3",
];
let colorIdx = 0;

function relColor(type: string): string {
  if (!RELATION_COLORS[type]) {
    RELATION_COLORS[type] = PALETTE[colorIdx % PALETTE.length];
    colorIdx++;
  }
  return RELATION_COLORS[type];
}

export default function GraphView({ data, onNodeSelect, selectedNodeId }: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const cyRef = useRef<Core | null>(null);

  useEffect(() => {
    if (!containerRef.current) return;

    const degree: Record<string, number> = {};
    for (const e of data.edges) {
      degree[e.source] = (degree[e.source] ?? 0) + 1;
      degree[e.target] = (degree[e.target] ?? 0) + 1;
    }
    const maxDeg = Math.max(1, ...Object.values(degree));
    // sqrt scale anchored so degree=1 → 15px, degree=maxDeg → 80px
    const nodeSize = (id: string) => {
      const d = degree[id] ?? 1;
      return 15 + 65 * Math.sqrt((d - 1) / Math.max(1, maxDeg - 1));
    };

    const cy = cytoscape({
      container: containerRef.current,
      elements: [
        ...data.nodes.map((n: GraphNode) => ({
          data: { id: n.id, label: n.name, role: n.role ?? "both", degree: degree[n.id] ?? 0, size: nodeSize(n.id) },
        })),
        ...data.edges.map((e: GraphEdge) => ({
          data: {
            id: e.id,
            source: e.source,
            target: e.target,
            type: e.type,
            weight: e.weight,
            color: relColor(e.type),
          },
        })),
      ],
      layout: {
        name: "cose",
        animate: false,
        nodeRepulsion: () => 8000,
        idealEdgeLength: () => 100,
        gravity: 0.25,
        numIter: 300,
      },
      style: [
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
            "text-background-color": "#1e1e2e",
            "text-background-opacity": 0.7,
            "text-background-padding": "3px",
            "text-background-shape": "roundrectangle",
          },
        },
        {
          selector: "node[role = 'source']",
          style: { "background-color": "#7c4dff" },
        },
        {
          selector: "node[role = 'target']",
          style: { "background-color": "#e91e63" },
        },
        {
          selector: "node[role = 'both']",
          style: { "background-color": "#ff6d00" },
        },
        {
          selector: "node:selected",
          style: {
            "background-color": "#03dac6",
            "border-color": "#ffffff",
            "border-width": 3,
          },
        },
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
        {
          selector: "edge:selected",
          style: { "width": 4, opacity: 1 },
        },
      ],
      minZoom: 0.1,
      maxZoom: 5,
      wheelSensitivity: 0.3,
    });

    cy.on("tap", "node", (e) => {
      const n = e.target;
      onNodeSelect({ id: n.id(), name: n.data("label"), dataset_id: "", role: n.data("role") ?? "both" });
    });
    cy.on("tap", (e) => {
      if (e.target === cy) onNodeSelect(null);
    });

    cyRef.current = cy;
    return () => {
      cy.destroy();
      cyRef.current = null;
    };
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  // Highlight selected node
  useEffect(() => {
    const cy = cyRef.current;
    if (!cy) return;
    cy.nodes().unselect();
    if (selectedNodeId) {
      cy.getElementById(selectedNodeId).select();
    }
  }, [selectedNodeId]);

  return (
    <div
      ref={containerRef}
      style={{ width: "100%", height: "100%", background: "#0d0d1a", borderRadius: 10 }}
    />
  );
}
