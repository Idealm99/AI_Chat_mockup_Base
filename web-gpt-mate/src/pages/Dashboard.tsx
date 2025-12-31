import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { LucideIcon } from "lucide-react";
import {
  Search,
  Activity,
  FileText,
  Zap,
  Database,
  Network,
  Target,
  Dna,
  Pill,
  MessageSquare,
  Sparkles,
  Radar,
  GitBranch,
  CalendarClock,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getMcpStatus, McpServerStatus } from "@/lib/api";
import { getPortalBaseUrl } from "@/lib/portal";

const FALLBACK_AGENTS = [
  { name: "OpenTargets", status: "active", icon: Target },
  { name: "AlphaFold", status: "active", icon: Dna },
  { name: "ChEMBL", status: "inactive", icon: Pill },
  { name: "Reactome", status: "active", icon: Network },
  { name: "UniProt", status: "active", icon: Database },
  { name: "PubChem", status: "inactive", icon: Pill },
  { name: "DrugBank", status: "active", icon: Pill },
  { name: "STRING", status: "active", icon: Network },
] as const;

const MCP_ICON_MAP: Record<string, LucideIcon> = {
  OpenTargets: Target,
  "OpenTargets-MCP-Server": Target,
  AlphaFold: Dna,
  "AlphaFold-MCP-Server": Dna,
  ChEMBL: Pill,
  "ChEMBL-MCP-Server": Pill,
  Reactome: Network,
  "Reactome-MCP-Server": Network,
  UniProt: Database,
  "UniProt-MCP-Server": Database,
  "Augmented-Nature-UniProt-MCP-Server": Database,
  PubChem: Pill,
  "PubChem-MCP-Server": Pill,
  DrugBank: Pill,
  "DrugBank-MCP-Server": Pill,
  STRING: Network,
  "STRING-MCP-Server": Network,
  "STRING-db-MCP-Server": Network,
  KEGG: Network,
  "KEGG-MCP-Server": Network,
  GeneOntology: Network,
  "GeneOntology-MCP-Server": Network,
  ClinicalTrials: FileText,
  "ClinicalTrials-MCP-Server": FileText,
  OpenFDA: FileText,
  "OpenFDA-MCP-Server": FileText,
  PDB: Database,
  "PDB-MCP-Server": Database,
  "NCBI-Datasets-MCP-Server": Database,
  "OpenGenes-MCP-Server": Dna,
  "BioThings-MCP-Server": Network,
  "ProteinAtlas-MCP-Server": Database,
  "Ensembl-MCP-Server": Dna,
  "SureChEMBL-MCP-Server": Pill,
};

type DisplayAgent = {
  key: string;
  label: string;
  Icon: LucideIcon;
  isActive: boolean;
  statusText: string;
  detail?: string;
};

const Dashboard = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");
  const [agentStatuses, setAgentStatuses] = useState<McpServerStatus[]>([]);
  const [isLoadingAgents, setIsLoadingAgents] = useState(false);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) return;
    navigate(`/chat?q=${encodeURIComponent(trimmed)}`);
  };

  const handleOpenWorkspace = () => {
    navigate("/chat");
  };

  const handlePortalNavigate = (path: string) => {
    const base = getPortalBaseUrl();
    window.location.href = `${base}${path}`;
  };

  const handleProjectClick = (projectId: string) => {
    navigate(`/chat?project=${encodeURIComponent(projectId)}`);
  };

  useEffect(() => {
    let isMounted = true;

    const fetchStatuses = async () => {
      setIsLoadingAgents(true);
      try {
        const response = await getMcpStatus();
        if (isMounted) {
          setAgentStatuses(response.servers ?? []);
        }
      } catch (error) {
        console.error("Failed to load MCP status", error);
        if (isMounted) {
          setAgentStatuses([]);
        }
      } finally {
        if (isMounted) {
          setIsLoadingAgents(false);
        }
      }
    };

    void fetchStatuses();
    const intervalId = window.setInterval(() => void fetchStatuses(), 60000);

    return () => {
      isMounted = false;
      window.clearInterval(intervalId);
    };
  }, []);

  const formatServerName = (name: string) =>
    name.replace(/-MCP-Server$/i, "").replace(/_/g, " ");

  const displayAgents = useMemo<DisplayAgent[]>(() => {
    if (!agentStatuses.length) {
      return FALLBACK_AGENTS.map((agent) => ({
        key: agent.name,
        label: agent.name,
        Icon: agent.icon,
        isActive: agent.status === "active",
        statusText: agent.status === "active" ? "Active" : "Offline",
      }));
    }

    return agentStatuses.map((status) => {
      const label = formatServerName(status.name);
      const Icon = MCP_ICON_MAP[status.name] ?? MCP_ICON_MAP[label] ?? Activity;
      const isActive = Boolean(status.is_active);
      const statusText = isActive ? "Active" : status.status === "idle" ? "Idle" : "Offline";
      return {
        key: status.name,
        label,
        Icon,
        isActive,
        statusText,
        detail: status.tool_count ? `${status.tool_count} tools` : status.message,
      };
    });
  }, [agentStatuses]);

  const insights = [
    { title: "New KRAS pathway discovered in pancreatic cancer", time: "2h ago", icon: Activity },
    { title: "AlphaFold structure prediction completed", time: "4h ago", icon: Dna },
    { title: "Toxicity prediction model updated", time: "1d ago", icon: FileText },
    { title: "Clinical trial data synchronized", time: "2d ago", icon: Database },
  ] as const;

  const quickTools = [
    { name: "3D Structure Viewer", icon: Dna },
    { name: "Toxicity Predictor", icon: Activity },
    { name: "Clinical Trial Search", icon: FileText },
    { name: "Pathway Analyzer", icon: Network },
  ] as const;

  const projects = [
    {
      id: "proj-1",
      title: "Phase 1: Pancreatic Cancer Target Discovery",
      progress: 67,
      status: "In Progress",
      warning: false,
    },
    {
      id: "proj-2",
      title: "ADME/Tox Optimization - JW-2847",
      progress: 89,
      status: "Review Required",
      warning: true,
    },
    {
      id: "proj-3",
      title: "Biomarker Analysis - Immuno-Oncology",
      progress: 34,
      status: "Active",
      warning: false,
    },
  ] as const;

  return (
    <div className="command-center-theme min-h-screen bg-background text-foreground">
      {/* Left Sidebar */}
      <aside className="fixed left-0 top-0 z-10 flex h-full w-20 flex-col items-center gap-6 border-r border-white/10 bg-sidebar-background/60 py-6 backdrop-blur-xl">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl border border-primary/30 bg-primary/20 glow-cyan">
          <span className="text-xl font-bold text-primary">JW</span>
        </div>
        <nav className="flex flex-col gap-4">
          <Button
            variant="ghost"
            size="icon"
            className="text-primary hover:bg-primary/10"
            aria-label="Command Center Overview"
          >
            <Activity className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:bg-muted/50 hover:text-primary"
            onClick={handleOpenWorkspace}
            aria-label="JW Chat"
          >
            <MessageSquare className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:bg-muted/50"
            onClick={() => handlePortalNavigate("/prompt-hub")}
            aria-label="Prompt Hub"
          >
            <Sparkles className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:bg-muted/50"
            onClick={() => handlePortalNavigate("/market-sensing")}
            aria-label="Market Sensing"
          >
            <Radar className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:bg-muted/50"
            onClick={() => handlePortalNavigate("/catalyst")}
            aria-label="Correlation Analysis"
          >
            <GitBranch className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:bg-muted/50"
            onClick={() => handlePortalNavigate("/event-analysis")}
            aria-label="Event Hub"
          >
            <CalendarClock className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:bg-muted/50" aria-label="Data Catalog">
            <Database className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:bg-muted/50" aria-label="Reports">
            <FileText className="h-5 w-5" />
          </Button>
        </nav>
      </aside>

      {/* Main Content */}
      <main className="ml-20 min-h-screen p-8">
        {/* Header */}
        <header className="mb-12 fade-in">
          <h1 className="mb-2 text-4xl font-bold text-foreground">JW Research AI</h1>
          <p className="text-xl text-muted-foreground">MCP Command Center</p>
        </header>

        {/* Hero Search Section */}
        <section className="relative mb-12 fade-in">
          <div className="relative overflow-hidden rounded-3xl glass-card p-12">
            <div className="absolute inset-0 opacity-20">
              <div className="knowledge-graph-animate absolute inset-0 flex items-center justify-center">
                <Network className="h-96 w-96 text-primary" strokeWidth={0.5} />
              </div>
            </div>

            <div className="relative z-10">
              <h2 className="mb-6 text-center text-2xl font-semibold text-foreground">Search Knowledge Graph</h2>
              <form onSubmit={handleSearch} className="mx-auto max-w-3xl">
                <div className="relative">
                  <Search className="absolute left-6 top-1/2 h-6 w-6 -translate-y-1/2 text-primary" />
                  <Input
                    type="text"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    placeholder="Search for Targets, Genes, Drugs, Pathways..."
                    className="glass-card h-16 border border-primary/30 pl-16 pr-6 text-lg focus:border-primary focus:ring-primary"
                  />
                </div>
              </form>
            </div>
          </div>
        </section>

        {/* Bento Grid */}
        <div className="mb-12 grid grid-cols-12 gap-6">
          <div className="col-span-12 rounded-2xl glass-card p-6 fade-in lg:col-span-8">
            <h3 className="mb-4 flex items-center gap-2 text-xl font-semibold text-foreground">
              <Zap className="h-5 w-5 text-primary" />
              MCP Agent Monitor
            </h3>
            <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
              {displayAgents.map((agent) => (
                <div
                  key={agent.key}
                  className="glass-card-hover relative flex cursor-pointer flex-col items-center gap-2 rounded-xl p-4"
                  title={agent.detail ?? agent.statusText}
                >
                  {agent.isActive && (
                    <span
                      className="absolute left-3 top-1/2 hidden -translate-y-1/2 md:flex"
                      aria-hidden="true"
                    >
                      <span className="status-pulse h-2.5 w-2.5 rounded-full bg-status-active shadow-[0_0_8px_rgba(16,185,129,0.8)]" />
                    </span>
                  )}
                  <agent.Icon className="h-8 w-8 text-primary" />
                  <span className="text-center text-sm font-medium text-foreground">{agent.label}</span>
                  <div className="flex items-center gap-2 text-xs">
                    <div
                      className={`status-pulse h-2 w-2 rounded-full ${
                        agent.isActive ? "bg-status-active glow-emerald" : "bg-red-500/80"
                      }`}
                    />
                    <span className={agent.isActive ? "text-status-active" : "text-red-300"}>
                      {agent.statusText}
                    </span>
                  </div>
                  {!agent.isActive && agent.detail && (
                    <p className="text-center text-[11px] text-red-300/80">{agent.detail}</p>
                  )}
                </div>
              ))}
            </div>
            <p className="mt-3 text-xs text-muted-foreground">
              {isLoadingAgents ? "Checking MCP servers..." : "Statuses refresh every 60s."}
            </p>
          </div>

          <div className="col-span-12 rounded-2xl glass-card p-6 fade-in lg:col-span-4">
            <h3 className="mb-4 flex items-center gap-2 text-xl font-semibold text-foreground">
              <Activity className="h-5 w-5 text-primary" />
              Latest Insights
            </h3>
            <div className="space-y-3">
              {insights.map((insight, idx) => (
                <div
                  key={idx}
                  className="glass-card-hover flex cursor-pointer gap-3 rounded-lg p-3"
                >
                  <insight.icon className="mt-0.5 h-5 w-5 flex-shrink-0 text-primary" />
                  <div className="min-w-0 flex-1">
                    <p className="line-clamp-2 text-sm text-foreground">{insight.title}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{insight.time}</p>
                  </div>
                </div>
              ))}
            </div>
          </div>

          <div className="col-span-12 grid grid-cols-2 gap-4 fade-in md:grid-cols-4">
            {quickTools.map((tool) => (
              <div
                key={tool.name}
                className="glass-card-hover flex cursor-pointer flex-col items-center gap-3 rounded-xl p-6"
              >
                <tool.icon className="h-10 w-10 text-primary" />
                <span className="text-center text-sm font-medium text-foreground">{tool.name}</span>
              </div>
            ))}
          </div>
        </div>

        <section className="fade-in">
          <h2 className="mb-6 text-2xl font-semibold text-foreground">Recent Research Sessions</h2>
          <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
            {projects.map((project) => (
              <div
                key={project.id}
                onClick={() => handleProjectClick(project.id)}
                className="glass-card-hover cursor-pointer rounded-2xl p-6"
              >
                <div className="mb-4 flex items-start justify-between">
                  <h3 className="text-lg font-semibold text-foreground">{project.title}</h3>
                  {project.warning && <span className="text-xl text-status-warning">⚠️</span>}
                </div>
                <div className="space-y-2">
                  <div className="flex justify-between text-sm">
                    <span className="text-muted-foreground">Progress</span>
                    <span className="font-medium text-primary">{project.progress}%</span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-secondary">
                    <div
                      className="h-full rounded-full bg-primary transition-all duration-300"
                      style={{ width: `${project.progress}%` }}
                    />
                  </div>
                  <p className="mt-3 text-sm text-muted-foreground">{project.status}</p>
                </div>
              </div>
            ))}
          </div>
        </section>
      </main>
    </div>
  );
};

export default Dashboard;
