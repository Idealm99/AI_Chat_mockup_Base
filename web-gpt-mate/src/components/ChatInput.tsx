import { useState } from "react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Send } from "lucide-react";

interface ChatInputProps {
  onSendMessage: (message: string) => void;
  disabled?: boolean;
}

const ChatInput = ({ onSendMessage, disabled }: ChatInputProps) => {
  const [message, setMessage] = useState("");

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (message.trim() && !disabled) {
      onSendMessage(message);
      setMessage("");
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  return (
    <form
      onSubmit={handleSubmit}
      className="relative mx-auto flex w-full max-w-5xl items-center rounded-[32px] border border-slate-800/70 bg-slate-950/60 px-5 py-4 shadow-[0_18px_60px_-45px_rgba(14,165,233,0.65)] backdrop-blur-xl"
    >
      <Textarea
        value={message}
        onChange={(e) => setMessage(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="지금 분석하고 싶은 연구 주제를 입력하세요..."
        disabled={disabled}
        className="mr-4 max-h-[240px] min-h-[64px] flex-1 resize-none border-none bg-transparent text-sm text-slate-200 placeholder:text-slate-500 focus-visible:ring-0"
        rows={1}
      />
      <Button
        type="submit"
        disabled={!message.trim() || disabled}
        size="icon"
        className="h-14 w-14 rounded-2xl border border-cyan-500/40 bg-gradient-to-br from-cyan-500/70 via-cyan-400/80 to-emerald-400/70 text-slate-900 transition hover:from-cyan-400 hover:via-cyan-300 hover:to-emerald-300"
      >
        <Send className="h-5 w-5" />
      </Button>
    </form>
  );
};

export default ChatInput;
