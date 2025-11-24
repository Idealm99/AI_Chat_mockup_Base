import { useEffect, useRef, useState } from "react";
import * as $3Dmol from "3dmol";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/components/ui/dialog";

const viewerConfig = {
  backgroundColor: "#030712",
  antialias: true,
  cartoonQuality: 20,
};

const syncCanvasToContainer = (element: HTMLDivElement | null) => {
  if (!element) return;
  const canvas = element.querySelector("canvas");
  if (!canvas) return;

  Object.assign(canvas.style, {
    width: "100%",
    height: "100%",
    maxWidth: "100%",
    maxHeight: "100%",
    position: "absolute",
    inset: "0",
  });
};

interface ProteinStructurePanelProps {
  isActive?: boolean;
}

const ProteinStructurePanel = ({ isActive = true }: ProteinStructurePanelProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<any>(null);
  const modalContainerRef = useRef<HTMLDivElement>(null);
  const modalViewerRef = useRef<any>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pdbData, setPdbData] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    if (!isActive) {
      setStatus("loading");
      setErrorMessage(null);
      setIsDialogOpen(false);
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

        setPdbData(pdbData);
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
        viewer.zoomTo({}, 0, 1.45);
        viewer.render();
        syncCanvasToContainer(element);
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
      syncCanvasToContainer(containerRef.current);
    });

    observer.observe(containerRef.current);
    return () => observer.disconnect();
  }, []);

  useEffect(() => {
    if (!isDialogOpen || !modalContainerRef.current || !pdbData) {
      if (!isDialogOpen && modalViewerRef.current) {
        try {
          modalViewerRef.current.removeAllModels?.();
          modalViewerRef.current.clear?.();
        } catch (error) {
          console.warn("Failed to dispose modal viewer", error);
        }
        modalViewerRef.current = null;
      }
      return;
    }

    const element = modalContainerRef.current;
    element.innerHTML = "";
    const viewer = new ($3Dmol as any).GLViewer(element, {
      ...viewerConfig,
      backgroundColor: "#010712",
    });
    modalViewerRef.current = viewer;
    viewer.addModel(pdbData, "pdb");
    viewer.setStyle({}, { cartoon: { color: "spectrum" } });
    viewer.addSurface(($3Dmol as any).SurfaceType.VDW, {
      opacity: 0.12,
      color: "#0ea5e9",
    });
    viewer.center();
    viewer.zoomTo();
    viewer.render();
    syncCanvasToContainer(element);

    return () => {
      if (modalViewerRef.current) {
        try {
          modalViewerRef.current.removeAllModels?.();
          modalViewerRef.current.clear?.();
        } catch (error) {
          console.warn("Failed to dispose modal viewer", error);
        }
        modalViewerRef.current = null;
      }
    };
  }, [isDialogOpen, pdbData]);

  useEffect(() => {
    if (!isDialogOpen || !modalViewerRef.current || !modalContainerRef.current) {
      return;
    }
    const observer = new ResizeObserver(() => {
      modalViewerRef.current?.resize?.();
      modalViewerRef.current?.render?.();
      syncCanvasToContainer(modalContainerRef.current);
    });
    observer.observe(modalContainerRef.current);
    return () => observer.disconnect();
  }, [isDialogOpen]);

  useEffect(() => {
    if (!isDialogOpen || !pdbData) {
      return;
    }

    let rafId: number | null = null;
    const initViewer = () => {
      const container = modalContainerRef.current;
      if (!container) {
        rafId = requestAnimationFrame(initViewer);
        return;
      }

      container.innerHTML = "";
      const viewer = new ($3Dmol as any).GLViewer(container, {
        ...viewerConfig,
        backgroundColor: "#010712",
      });
      modalViewerRef.current = viewer;
      viewer.addModel(pdbData, "pdb");
      viewer.setStyle({}, { cartoon: { color: "spectrum" } });
      viewer.addSurface(($3Dmol as any).SurfaceType.VDW, {
        opacity: 0.12,
        color: "#0ea5e9",
      });
      viewer.center();
      viewer.rotate(0.04, new ($3Dmol as any).Vector3(0, 1, 0));
      viewer.translate(0.52, -0.42, 0);
      viewer.zoomTo({}, 0, 1.72);
      viewer.render();
      syncCanvasToContainer(container);
    };

    initViewer();

    return () => {
      if (rafId !== null) {
        cancelAnimationFrame(rafId);
      }
      if (modalViewerRef.current) {
        try {
          modalViewerRef.current.removeAllModels?.();
          modalViewerRef.current.clear?.();
        } catch (error) {
          console.warn("Failed to dispose modal viewer", error);
        }
        modalViewerRef.current = null;
      }
    };
  }, [isDialogOpen, pdbData]);

  return (
    <section className="rounded-2xl border border-emerald-500/20 bg-slate-900/70 p-5 shadow-[0_20px_45px_-28px_rgba(16,185,129,0.35)]">
      <Dialog open={isDialogOpen} onOpenChange={setIsDialogOpen}>
        <div className="flex items-center justify-between">
          <span className="text-[11px] uppercase tracking-[0.28em] text-emerald-300/80">Protein Structure</span>
          <DialogTrigger asChild>
            <Button
              size="sm"
              variant="outline"
              className="h-8 rounded-full border-emerald-500/40 bg-emerald-500/10 text-[11px] font-semibold uppercase tracking-[0.2em] text-emerald-200"
              disabled={!isActive || status !== "ready"}
            >
              크게 보기
            </Button>
          </DialogTrigger>
        </div>
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
        <DialogContent className="max-w-[1100px] border border-emerald-500/30 bg-slate-950/95 p-6 shadow-[0_35px_90px_-35px_rgba(16,185,129,0.55)]">
          <DialogHeader>
            <DialogTitle className="text-slate-100">AlphaFold 구조 미리보기</DialogTitle>
          </DialogHeader>
          <div
            ref={modalContainerRef}
            className="relative h-[540px] w-full overflow-hidden rounded-xl border border-emerald-500/20 bg-gradient-to-br from-slate-950 via-slate-900 to-slate-950"
          />
        </DialogContent>
      </Dialog>
    </section>
  );
};

export default ProteinStructurePanel;
