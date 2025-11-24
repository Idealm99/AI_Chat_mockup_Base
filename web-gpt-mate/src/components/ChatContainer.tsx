import { useEffect, useRef } from "react";
import ChatMessage from "./ChatMessage";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Message } from "@/types/chat";

interface ChatContainerProps {
  messages: Message[];
  isLoading?: boolean;
}

const ChatContainer = ({ messages, isLoading }: ChatContainerProps) => {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [messages]);

  return (
    <ScrollArea className="h-full">
      <div ref={scrollRef} className="mx-auto flex h-full w-full max-w-5xl flex-col gap-6 pb-32">
        {isLoading && (
          <div className="flex justify-center pt-4">
            <div className="h-10 w-10 animate-spin rounded-full border-2 border-cyan-400/40 border-t-cyan-200" />
          </div>
        )}
        {messages.length === 0 && !isLoading ? (
          <div className="flex flex-1 items-center justify-center">
            <div className="w-full max-w-3xl rounded-3xl border border-dashed border-slate-700/70 bg-slate-900/60 p-10 text-center shadow-[0_45px_80px_-55px_rgba(6,182,212,0.55)]">
              <h1 className="text-3xl font-semibold tracking-tight text-slate-100">JW Research AI Ready</h1>
              <p className="mt-3 text-sm text-slate-400">
                왼쪽 패널에서 새 대화를 시작하거나 아래 템플릿으로 연구 여정을 빠르게 열어보세요.
              </p>
              <div className="mt-8 grid grid-cols-1 gap-3 text-left sm:grid-cols-2">
                {[
                  "신약 후보 물질 요약",
                  "임상 데이터 비교 분석",
                  "생물학적 경로 매핑",
                  "독성 리스크 진단",
                ].map((template) => (
                  <div
                    key={template}
                    className="rounded-2xl border border-slate-800/70 bg-slate-900/70 px-5 py-4 text-sm text-slate-200 shadow-inner transition hover:border-cyan-400/30 hover:text-cyan-200"
                  >
                    {template}
                  </div>
                ))}
              </div>
            </div>
          </div>
        ) : (
          <div className="flex flex-col gap-6">
            {messages.map((message) => (
              <ChatMessage
                key={message.id}
                message={message.text}
                isUser={message.isUser}
                timestamp={message.timestamp}
                reasoningSteps={message.reasoningSteps}
                isThinking={message.isThinking}
                references={message.references}
              />
            ))}
          </div>
        )}
      </div>
    </ScrollArea>
  );
};

export default ChatContainer;
