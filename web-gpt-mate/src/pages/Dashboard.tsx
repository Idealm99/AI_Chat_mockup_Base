import { useState } from "react";
import { useNavigate } from "react-router-dom";
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
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";

const Dashboard = () => {
  const navigate = useNavigate();
  const [searchQuery, setSearchQuery] = useState("");

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = searchQuery.trim();
    if (!trimmed) return;
    navigate(`/chat?q=${encodeURIComponent(trimmed)}`);
  };

  const handleOpenWorkspace = () => {
    navigate("/chat");
  };

  const handleProjectClick = (projectId: string) => {
    navigate(`/chat?project=${encodeURIComponent(projectId)}`);
  };

  const agents = [
    { name: "OpenTargets", status: "active", icon: Target },
    { name: "AlphaFold", status: "active", icon: Dna },
    { name: "ChEMBL", status: "syncing", icon: Pill },
    { name: "Reactome", status: "active", icon: Network },
    { name: "UniProt", status: "active", icon: Database },
    { name: "PubChem", status: "syncing", icon: Pill },
    { name: "DrugBank", status: "active", icon: Pill },
    { name: "STRING", status: "active", icon: Network },
  ] as const;

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
          <Button variant="ghost" size="icon" className="text-primary hover:bg-primary/10">
            <Activity className="h-5 w-5" />
          </Button>
          <Button
            variant="ghost"
            size="icon"
            className="text-muted-foreground hover:bg-muted/50 hover:text-primary"
            onClick={handleOpenWorkspace}
          >
            <MessageSquare className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:bg-muted/50">
            <Database className="h-5 w-5" />
          </Button>
          <Button variant="ghost" size="icon" className="text-muted-foreground hover:bg-muted/50">
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
              {agents.map((agent) => (
                <div
                  key={agent.name}
                  className="glass-card-hover flex cursor-pointer flex-col items-center gap-2 rounded-xl p-4"
                >
                  <agent.icon className="h-8 w-8 text-primary" />
                  <span className="text-center text-sm font-medium text-foreground">{agent.name}</span>
                  <div className="flex items-center gap-1">
                    <div
                      className={`status-pulse h-2 w-2 rounded-full ${
                        agent.status === "active" ? "bg-status-active glow-emerald" : "bg-status-warning"
                      }`}
                    />
                    <span
                      className={`text-xs ${
                        agent.status === "active" ? "text-status-active" : "text-status-warning"
                      }`}
                    >
                      {agent.status === "active" ? "Active" : "Syncing"}
                    </span>
                  </div>
                </div>
              ))}
            </div>
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
