import { useState, type ReactNode } from "react";
import { RefreshCcw, Loader2, ExternalLink } from "lucide-react";
import { Button } from "@/components/ui/button";

interface PortalEmbedProps {
  title: string;
  description?: string;
  src: string;
  badge?: string;
  sidebarTrigger?: ReactNode;
}

const PortalEmbed = ({ title, description, src, badge, sidebarTrigger }: PortalEmbedProps) => {
  const [isLoading, setIsLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const handleReload = () => {
    setIsLoading(true);
    setReloadKey((prev) => prev + 1);
  };

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <header className="border-b border-slate-800/60 bg-slate-900/60/80 px-6 py-4 backdrop-blur-lg">
        <div className="flex flex-wrap items-center gap-4">
          {sidebarTrigger}
          <div className="space-y-1">
            <p className="text-xs uppercase tracking-[0.3em] text-cyan-400">JW Research Portal</p>
            <div className="flex items-center gap-3 text-white">
              <h1 className="text-xl font-semibold">{title}</h1>
              {badge && (
                <span className="rounded-full border border-cyan-500/40 bg-cyan-500/10 px-3 py-0.5 text-xs text-cyan-100">
                  {badge}
                </span>
              )}
            </div>
            {description && <p className="text-sm text-slate-300">{description}</p>}
          </div>
          <div className="ml-auto flex items-center gap-2">
            <Button variant="ghost" size="sm" className="gap-2 text-slate-200" onClick={handleReload}>
              <RefreshCcw className="h-4 w-4" /> 새로 고침
            </Button>
            <Button asChild variant="outline" size="sm" className="gap-2 border-slate-700/70 text-slate-100">
              <a href={src} target="_blank" rel="noreferrer">
                새 창에서 열기
                <ExternalLink className="h-4 w-4" />
              </a>
            </Button>
          </div>
        </div>
      </header>
      <div className="relative flex-1 overflow-hidden bg-slate-900/40">
        {isLoading && (
          <div className="absolute inset-0 z-10 flex items-center justify-center bg-slate-950/40">
            <div className="flex items-center gap-2 rounded-full border border-cyan-500/40 bg-slate-900/80 px-4 py-2 text-sm text-cyan-100">
              <Loader2 className="h-4 w-4 animate-spin" />
              포털 화면을 불러오는 중...
            </div>
          </div>
        )}
        <iframe
          key={reloadKey}
          src={src}
          title={title}
          className="h-full w-full border-0"
          onLoad={() => setIsLoading(false)}
        />
      </div>
    </div>
  );
};

export default PortalEmbed;
