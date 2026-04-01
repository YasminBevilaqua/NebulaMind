import { SYSTEM_PROMPT } from "./nebulaSystemPrompt";

export const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";

/** Corpo enviado à API Groq (dev proxy + Vercel serverless). */
export function buildGroqPayload(content: string, wantsStream: boolean) {
  return {
    model: "llama-3.1-8b-instant",
    messages: [
      { role: "system" as const, content: SYSTEM_PROMPT },
      { role: "user" as const, content },
    ],
    max_tokens: 1024,
    temperature: 0.65,
    ...(wantsStream ? { stream: true as const } : {}),
  };
}
