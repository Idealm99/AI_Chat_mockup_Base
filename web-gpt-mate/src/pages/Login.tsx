import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";

const Login = () => {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const navigate = useNavigate();
  const { toast } = useToast();

  const handleLogin = (e: React.FormEvent) => {
    e.preventDefault();
    setIsLoading(true);

    // 하드코딩된 로그인 정보 검증
    if (username === "genon" && password === "1234") {
      localStorage.setItem("isAuthenticated", "true");
      localStorage.setItem("username", username);
      toast({
        title: "로그인 성공",
        description: "환영합니다!",
      });
      navigate("/");
    } else {
      toast({
        title: "로그인 실패",
        description: "아이디 또는 비밀번호가 올바르지 않습니다.",
        variant: "destructive",
      });
    }
    setIsLoading(false);
  };

  return (
    <div className="relative min-h-screen overflow-hidden bg-slate-950 text-slate-100">
      <div className="pointer-events-none absolute inset-0">
        <div className="absolute -top-56 -left-40 h-[420px] w-[420px] rounded-full bg-cyan-500/20 blur-[120px]" />
        <div className="absolute bottom-[-120px] right-[-80px] h-[360px] w-[360px] rounded-full bg-emerald-400/10 blur-[110px]" />
        <div className="absolute inset-0 bg-[radial-gradient(circle_at_top,_rgba(12,91,199,0.1),_transparent)]" />
      </div>

      <div className="relative z-10 flex min-h-screen flex-col items-center justify-center px-6 py-16 lg:px-12">
        <div className="flex w-full max-w-6xl flex-col gap-12 lg:flex-row lg:items-center">
          <div className="mx-auto max-w-xl text-center lg:mx-0 lg:w-1/2 lg:text-left">
            <span className="inline-flex items-center gap-2 rounded-full border border-cyan-500/40 bg-cyan-500/10 px-4 py-1 text-[11px] font-semibold uppercase tracking-[0.28em] text-cyan-200">
              JW Research AI
            </span>
            <h1 className="mt-6 text-4xl font-bold leading-snug text-slate-50 sm:text-5xl">
              MCP Command Center에<br className="hidden sm:block" /> 접속하세요
            </h1>
            <p className="mt-5 text-base text-slate-400 sm:text-lg">
              지식 그래프 탐색, AlphaFold 분석, 임상 리서치를 통합한 연구 허브에 로그인해 전문가용 데이터를 활용해 보세요.
            </p>
            <div className="mt-8 grid gap-4 text-left sm:grid-cols-2">
              {["지식 그래프 기반 인사이트", "AlphaFold 단백질 시각화", "실시간 리포트 생성", "보안 연구 환경"].map((feature) => (
                <div key={feature} className="rounded-2xl border border-slate-800/80 bg-slate-900/60 p-4 shadow-[0_18px_48px_-36px_rgba(34,211,238,0.45)]">
                  <p className="text-sm font-semibold text-cyan-200">{feature}</p>
                </div>
              ))}
            </div>
          </div>

          <Card className="mx-auto w-full max-w-lg rounded-3xl border border-cyan-500/25 bg-slate-900/70 shadow-[0_28px_70px_-32px_rgba(34,211,238,0.55)] backdrop-blur-xl">
            <CardHeader className="space-y-6 px-8 pt-8">
              <div className="flex flex-col gap-2 text-center">
                <span className="text-xs font-semibold uppercase tracking-[0.3em] text-cyan-300/80">
                  Secure Access
                </span>
                <h2 className="text-2xl font-semibold text-slate-50">JW MCP 로그인</h2>
                <p className="text-sm text-slate-400">
                  인증된 연구원만 접근할 수 있는 커맨드 센터입니다.
                </p>
              </div>
            </CardHeader>
            <CardContent className="px-8 pb-10">
              <form onSubmit={handleLogin} className="space-y-6">
                <div className="space-y-2">
                  <Label htmlFor="username" className="text-xs uppercase tracking-[0.2em] text-slate-400">
                    아이디
                  </Label>
                  <Input
                    id="username"
                    type="text"
                    placeholder="genon"
                    value={username}
                    onChange={(e) => setUsername(e.target.value)}
                    disabled={isLoading}
                    required
                    className="h-12 rounded-xl border border-cyan-500/30 bg-slate-950/60 text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:ring-0"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="password" className="text-xs uppercase tracking-[0.2em] text-slate-400">
                    비밀번호
                  </Label>
                  <Input
                    id="password"
                    type="password"
                    placeholder="비밀번호를 입력하세요"
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    disabled={isLoading}
                    required
                    className="h-12 rounded-xl border border-cyan-500/30 bg-slate-950/60 text-slate-100 placeholder:text-slate-500 focus:border-cyan-400 focus:ring-0"
                  />
                </div>
                <Button
                  type="submit"
                  className="group h-12 w-full rounded-xl border border-cyan-500/50 bg-gradient-to-r from-cyan-500/70 via-sky-500/70 to-emerald-500/70 text-sm font-semibold uppercase tracking-[0.25em] text-slate-950 transition hover:from-cyan-400 hover:via-sky-400 hover:to-emerald-400"
                  disabled={isLoading}
                >
                  {isLoading ? (
                    <span className="flex items-center justify-center gap-2">
                      <Loader2 className="h-4 w-4 animate-spin" /> 로그인 중...
                    </span>
                  ) : (
                    "Access Console"
                  )}
                </Button>
              </form>
              <div className="mt-6 space-y-2 rounded-2xl border border-slate-800/80 bg-slate-900/60 p-4 text-center text-xs text-slate-400">
                <p className="font-semibold tracking-[0.28em] text-slate-500/80">테스트 계정</p>
                <p>
                  아이디 <span className="font-semibold text-slate-200">genon</span> / 비밀번호 <span className="font-semibold text-slate-200">1234</span>
                </p>
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </div>
  );
};

export default Login;
