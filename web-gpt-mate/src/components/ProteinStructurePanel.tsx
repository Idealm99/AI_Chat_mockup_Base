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
import type { StructurePanelData } from "@/types/chat";

interface ViewerConfig {
  backgroundColor: string;
  antialias: boolean;
  cartoonQuality: number;
}

const viewerConfig: ViewerConfig = {
  backgroundColor: "#030712",
  antialias: true,
  cartoonQuality: 20,
};

type GLViewer = {
  addModel: (data: string, format: string) => void;
  setStyle: (selection: Record<string, unknown>, style: Record<string, unknown>) => void;
  addSurface: (surfaceType: unknown, options: Record<string, unknown>) => void;
  center: () => void;
  zoomTo: (selection?: Record<string, unknown>, animationTime?: number, scale?: number) => void;
  render: () => void;
  resize?: () => void;
  removeAllModels?: () => void;
  clear?: () => void;
  translate?: (x: number, y: number, z: number) => void;
  rotate?: (angle: number, axis: unknown) => void;
};

type Vector3Factory = new (...args: number[]) => unknown;

type ThreeDMol = {
  GLViewer: new (element: Element, config: ViewerConfig) => GLViewer;
  SurfaceType: Record<string, unknown>;
  Vector3: Vector3Factory;
};

const Mol3D = $3Dmol as unknown as ThreeDMol;

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
  data?: StructurePanelData;
}

const FALLBACK_PDB_SOURCES = [
  "https://alphafoldserver.com/example/examplefold_pdb_8aw3.pdb",
  "https://alphafoldserver.com/example/examplefold_pdb_8aw3",
  "https://files.rcsb.org/download/8AW3.pdb",
];

const ProteinStructurePanel = ({ isActive = true, data }: ProteinStructurePanelProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const viewerRef = useRef<GLViewer | null>(null);
  const modalContainerRef = useRef<HTMLDivElement>(null);
  const modalViewerRef = useRef<GLViewer | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pdbData, setPdbData] = useState<string | null>(null);
  const [isDialogOpen, setIsDialogOpen] = useState(false);

  useEffect(() => {
    if (!isActive) {
      setStatus("loading");
      setErrorMessage(null);
      setIsDialogOpen(false);
      setPdbData(null);
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
      return;
    }
    if (!data?.pdbUrl) {
      setStatus("loading");
      setErrorMessage(null);
      setPdbData(null);
      if (containerRef.current) {
        containerRef.current.innerHTML = "";
      }
      return;
    }
    let isCancelled = false;

    const loadStructure = async () => {
      if (!containerRef.current) return;

      const element = containerRef.current;
      element.innerHTML = "";

      try {
        setStatus("loading");
        setErrorMessage(null);
        setPdbData(null);

        const viewer = new Mol3D.GLViewer(element, viewerConfig);
        viewerRef.current = viewer;

        let pdbData: string | null = null;
        const fallbackSources = FALLBACK_PDB_SOURCES.filter((url) => url !== data.pdbUrl);
        const pdbSources = [data.pdbUrl, ...fallbackSources];
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
        viewer.addSurface(Mol3D.SurfaceType.VDW, {
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
  }, [isActive, data?.pdbUrl]);

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
    const viewer = new Mol3D.GLViewer(element, {
      ...viewerConfig,
      backgroundColor: "#010712",
    });
    modalViewerRef.current = viewer;
    viewer.addModel(pdbData, "pdb");
    viewer.setStyle({}, { cartoon: { color: "spectrum" } });
    viewer.addSurface(Mol3D.SurfaceType.VDW, {
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
      const viewer = new Mol3D.GLViewer(container, {
        ...viewerConfig,
        backgroundColor: "#010712",
      });
      modalViewerRef.current = viewer;
      viewer.addModel(pdbData, "pdb");
      viewer.setStyle({}, { cartoon: { color: "spectrum" } });
      viewer.addSurface(Mol3D.SurfaceType.VDW, {
        opacity: 0.12,
        color: "#0ea5e9",
      });
      viewer.center();
      viewer.rotate?.(0.04, new Mol3D.Vector3(0, 1, 0));
  viewer.translate?.(0.52, -0.42, 0);
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
            {isActive && !data?.pdbUrl && (
              <span>단백질 구조 URL을 기다리는 중입니다. MCP 결과가 준비되면 자동으로 렌더링합니다.</span>
            )}
            {isActive && data?.pdbUrl && status === "loading" && <span>구조 데이터를 불러오는 중입니다...</span>}
            {isActive && status === "error" && (
              <span className="text-red-300">구조를 불러오지 못했습니다: {errorMessage ?? "알 수 없는 오류가 발생했습니다."}</span>
            )}
            {isActive && status === "ready" && (
              <div className="space-y-1 text-emerald-100/80">
                {data?.target && (
                  <p>
                    <span className="font-medium text-emerald-200">Target:</span> {data.target}
                    {data?.pdbId && ` · PDB ${data.pdbId}`}
                  </p>
                )}
                {data?.compound && (
                  <p>
                    <span className="font-medium text-emerald-200">Compound:</span> {data.compound}
                  </p>
                )}
                {data?.bindingPocket && (
                  <p>
                    <span className="font-medium text-emerald-200">Pocket:</span> {data.bindingPocket}
                  </p>
                )}
              </div>
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
