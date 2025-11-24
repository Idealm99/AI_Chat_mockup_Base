import { useEffect, useRef, useState } from "react";
import * as $3Dmol from "3dmol";

const viewerConfig = {
  backgroundColor: "#030712",
  antialias: true,
  cartoonQuality: 20,
};

interface ProteinStructurePanelProps {
  isActive?: boolean;
}

const ProteinStructurePanel = ({ isActive = true }: ProteinStructurePanelProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);

  useEffect(() => {
    if (!isActive) {
      setStatus("loading");
      setErrorMessage(null);
      return;
    }
    let isCancelled = false;

    const loadStructure = async () => {
      if (!containerRef.current) return;

      const element = containerRef.current;
      element.innerHTML = "";

      try {
        const viewer = new ($3Dmol as any).GLViewer(element, viewerConfig);
        viewerRef.current = viewer;

        const pdbSources = [
          "https://alphafoldserver.com/example/examplefold_pdb_8aw3.pdb",
          "https://alphafoldserver.com/example/examplefold_pdb_8aw3",
          "https://files.rcsb.org/download/8AW3.pdb",
        ];

        let pdbData: string | null = null;
        for (const source of pdbSources) {
          try {
            const response = await fetch(source, { mode: "cors" });
            if (!response.ok) {
              continue;
            }
            const text = await response.text();
            if (!text || text.trim().startsWith("<")) {
              continue;
            }
            pdbData = text;
            break;
          } catch (error) {
            console.warn("Failed to fetch PDB source", source, error);
          }
        }

        if (!pdbData) {
          throw new Error("PDB 데이터를 가져오지 못했습니다.");
        }

        viewer.addModel(pdbData, "pdb");
        if (isCancelled) {
          return;
        }
        viewer.setStyle({}, { cartoon: { color: "spectrum" } });
        viewer.addSurface(($3Dmol as any).SurfaceType.VDW, {
          opacity: 0.15,
          color: "#0ea5e9",
        });
        viewer.center();
        viewer.zoomTo();
        viewer.render();
        viewer.zoom(1.1, 500);
        setStatus("ready");
      } catch (error) {
        console.error("Protein viewer error", error);
        if (!isCancelled) {
          setStatus("error");
          setErrorMessage(error instanceof Error ? error.message : "알 수 없는 오류가 발생했습니다.");
        }
      }
    };

    void loadStructure();

    return () => {
      isCancelled = true;
      if (viewerRef.current) {
        try {
          viewerRef.current.removeAllModels?.();
          viewerRef.current.clear?.();
        } catch (error) {
          console.warn("Failed to dispose viewer", error);
        }
      }
      viewerRef.current = null;
    };
  }, [isActive]);

  useEffect(() => {
  if (!viewerRef.current || !containerRef.current) return;

    const observer = new ResizeObserver(() => {
      viewerRef.current?.resize?.();
      viewerRef.current?.render?.();
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  return (
    <section className="rounded-2xl border border-emerald-500/20 bg-slate-900/70 p-5 shadow-[0_20px_45px_-28px_rgba(16,185,129,0.35)]">
      <span className="text-[11px] uppercase tracking-[0.28em] text-emerald-300/80">Protein Structure</span>
      <div className="mt-3 rounded-2xl border border-emerald-500/20 bg-gradient-to-br from-emerald-500/5 via-slate-900/60 to-emerald-500/5 p-4">
        <div
          ref={containerRef}
          className="relative h-60 w-full overflow-hidden rounded-xl border border-emerald-500/10 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950"
        />
        <div className="mt-3 text-xs text-emerald-200/80">
          {!isActive && <span>AI 응답이 생성되면 AlphaFold 구조를 불러옵니다.</span>}
          {isActive && status === "loading" && <span>AlphaFold 모델을 불러오는 중입니다...</span>}
          {isActive && status === "error" && (
            <span className="text-red-300">구조를 불러오지 못했습니다: {errorMessage}</span>
          )}
        </div>
      </div>
    </section>
  );
};

export default ProteinStructurePanel;
