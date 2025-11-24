import { useEffect, useMemo, useRef, useState } from "react";
import ForceGraph2D, { ForceGraphMethods } from "react-force-graph-2d";
import type { LinkObject, NodeObject } from "react-force-graph-2d";

interface KnowledgeGraphNode extends NodeObject {
  id: string;
  label: string;
  group: "target" | "pathway" | "compound";
  level: number;
}

interface KnowledgeGraphLink extends LinkObject {
  source: string;
  target: string;
  strength: number;
}

const KNOWLEDGE_GRAPH_DATA = {
  nodes: [
    { id: "KRAS", label: "KRAS", group: "target", level: 0 },
    { id: "PI3K", label: "PI3K", group: "pathway", level: 1 },
    { id: "EGFR", label: "EGFR", group: "target", level: 1 },
    { id: "MEK", label: "MEK", group: "pathway", level: 2 },
    { id: "RAF", label: "RAF", group: "pathway", level: 2 },
    { id: "ERK", label: "ERK", group: "pathway", level: 3 },
    { id: "mTOR", label: "mTOR", group: "pathway", level: 2 },
    { id: "AKT", label: "AKT", group: "pathway", level: 3 },
    { id: "STAT3", label: "STAT3", group: "target", level: 2 },
    { id: "Selumetinib", label: "Selumetinib", group: "compound", level: 3 },
    { id: "Sotorasib", label: "Sotorasib", group: "compound", level: 3 },
  ] satisfies KnowledgeGraphNode[],
  links: [
    { source: "KRAS", target: "PI3K", strength: 1 },
    { source: "KRAS", target: "EGFR", strength: 0.8 },
    { source: "KRAS", target: "RAF", strength: 0.9 },
    { source: "PI3K", target: "mTOR", strength: 0.8 },
    { source: "PI3K", target: "AKT", strength: 0.9 },
    { source: "RAF", target: "MEK", strength: 0.9 },
    { source: "MEK", target: "ERK", strength: 0.85 },
    { source: "ERK", target: "STAT3", strength: 0.7 },
    { source: "STAT3", target: "EGFR", strength: 0.75 },
    { source: "MEK", target: "Selumetinib", strength: 0.95 },
    { source: "KRAS", target: "Sotorasib", strength: 0.98 },
  ] satisfies KnowledgeGraphLink[],
};

const groupColor = {
  target: "#2dd4bf",
  pathway: "#38bdf8",
  compound: "#facc15",
} satisfies Record<KnowledgeGraphNode["group"], string>;

interface KnowledgeGraphPanelProps {
  isActive?: boolean;
}

const KnowledgeGraphPanel = ({ isActive = true }: KnowledgeGraphPanelProps) => {
  const graphRef = useRef<ForceGraphMethods>();
  const canvasContainerRef = useRef<HTMLDivElement>(null);
  const [dimensions, setDimensions] = useState({ width: 0, height: 0 });
  const fittedRef = useRef(false);

  useEffect(() => {
    const container = canvasContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver((entries) => {
      const entry = entries[0];
      if (!entry) return;
      const { width, height } = entry.contentRect;
      setDimensions({ width, height });
    });

    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const graphData = useMemo(() => KNOWLEDGE_GRAPH_DATA, []);

  useEffect(() => {
    if (!isActive) {
      fittedRef.current = false;
      return;
    }
    if (!graphRef.current || !dimensions.width || !dimensions.height || fittedRef.current) {
      return;
    }
    const timeout = window.setTimeout(() => {
      graphRef.current?.zoomToFit(400, 40);
      fittedRef.current = true;
    }, 250);
    return () => window.clearTimeout(timeout);
  }, [dimensions, isActive]);

  return (
    <section className="rounded-2xl border border-cyan-500/20 bg-gradient-to-br from-slate-900/80 via-slate-950/60 to-slate-900/40 p-5 shadow-[0_20px_45px_-28px_rgba(6,182,212,0.45)]">
      <span className="text-[11px] uppercase tracking-[0.28em] text-cyan-300/80">Knowledge Graph</span>
      <div className="mt-2 flex items-center justify-between gap-3">
        <p className="text-xs uppercase tracking-[0.18em] text-slate-500">Related Entities</p>
        <div className="flex items-center gap-2 text-[10px] uppercase tracking-[0.24em] text-slate-500/80">
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-cyan-300/90" /> Pathway</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-emerald-300/90" /> Target</span>
          <span className="flex items-center gap-1"><span className="h-2 w-2 rounded-full bg-amber-300/90" /> Compound</span>
        </div>
      </div>
      <div
        ref={canvasContainerRef}
        className="mt-4 h-64 w-full overflow-hidden rounded-2xl border border-cyan-500/10 bg-slate-950/80"
      >
        {isActive ? (
          dimensions.width > 0 && dimensions.height > 0 && (
            <ForceGraph2D
              ref={graphRef}
              width={dimensions.width}
              height={dimensions.height}
              graphData={graphData}
              backgroundColor="rgba(2,6,23,0)"
              linkColor={() => "rgba(34,211,238,0.35)"}
              linkDirectionalParticles={2}
              linkDirectionalParticleSpeed={() => 0.0025}
              linkWidth={(link) => (typeof link === "object" && "strength" in link ? (link as KnowledgeGraphLink).strength * 1.2 : 1)}
              nodeRelSize={6}
              cooldownTicks={120}
              onEngineStop={() => {
                if (!fittedRef.current) {
                  graphRef.current?.zoomToFit(400, 40);
                  fittedRef.current = true;
                }
              }}
              nodeCanvasObject={(node, ctx, globalScale) => {
                const n = node as KnowledgeGraphNode;
                const label = n.label;
                const fontSize = 12 / globalScale;
                const paddingX = 10;
                const paddingY = 6;
                const textWidth = ctx.measureText(label).width;
                const width = textWidth + paddingX * 2;
                const height = fontSize + paddingY * 2;
                const x = (node.x ?? 0) - width / 2;
                const y = (node.y ?? 0) - height / 2;
                const radius = 18 / globalScale;

                ctx.beginPath();
                ctx.fillStyle = `${groupColor[n.group]}33`;
                ctx.strokeStyle = `${groupColor[n.group]}66`;
                ctx.lineWidth = 1.5 / globalScale;
                const r = Math.min(radius, height / 2);
                ctx.moveTo(x + r, y);
                ctx.arcTo(x + width, y, x + width, y + height, r);
                ctx.arcTo(x + width, y + height, x, y + height, r);
                ctx.arcTo(x, y + height, x, y, r);
                ctx.arcTo(x, y, x + width, y, r);
                ctx.closePath();
                ctx.fill();
                ctx.stroke();

                ctx.fillStyle = "#e2f5f9";
                ctx.textAlign = "center";
                ctx.textBaseline = "middle";
                ctx.font = `${fontSize}px 'Inter', 'Pretendard', sans-serif`;
                ctx.fillText(label, node.x ?? 0, node.y ?? 0);
              }}
            />
          )
        ) : (
          <div className="flex h-full w-full items-center justify-center text-xs text-cyan-200/80">
            첫 번째 응답이 준비되면 관계 그래프를 생성합니다.
          </div>
        )}
      </div>
    </section>
  );
};

export default KnowledgeGraphPanel;
