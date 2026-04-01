import type { Connect, PreviewServer, ViteDevServer } from "vite";
import { loadEnv } from "vite";
import type { IncomingMessage, ServerResponse } from "node:http";
import { Readable } from "node:stream";
import { buildGroqPayload, GROQ_URL } from "./src/lib/groqProxyShared";

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on("data", (c) => chunks.push(Buffer.from(c)));
    req.on("end", () => resolve(Buffer.concat(chunks).toString("utf8")));
    req.on("error", reject);
  });
}

function attachGroqMiddleware(
  middlewares: Connect.Server,
  mode: string,
  envDir: string,
) {
  middlewares.use(async (req, res, next) => {
    const url = req.url ?? "";
    if (!url.startsWith("/api/groq")) {
      next();
      return;
    }
    if (req.method !== "POST") {
      res.statusCode = 405;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(JSON.stringify({ error: "Method not allowed" }));
      return;
    }

    const env = loadEnv(mode, envDir, "GROQ_");
    const key = (env.GROQ_API_KEY ?? process.env.GROQ_API_KEY)?.trim();
    if (!key) {
      res.statusCode = 500;
      res.setHeader("Content-Type", "application/json; charset=utf-8");
      res.end(
        JSON.stringify({
          error:
            "GROQ_API_KEY em falta. Crie o ficheiro .env na raiz do projeto com uma linha GROQ_API_KEY=gsk_... (obtida em console.groq.com) e reinicie o servidor (npm run dev).",
        }),
      );
      return;
    }

    const httpRes = res as ServerResponse;
    try {
      const raw = await readBody(req);
      const body = JSON.parse(raw || "{}") as { content?: string; stream?: boolean };
      const content = typeof body.content === "string" ? body.content.trim() : "";
      const wantsStream = body.stream === true;
      if (!content) {
        httpRes.statusCode = 400;
        httpRes.setHeader("Content-Type", "application/json; charset=utf-8");
        httpRes.end(JSON.stringify({ error: "Mensagem vazia" }));
        return;
      }

      const groqPayload = buildGroqPayload(content, wantsStream);

      const groqRes = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(groqPayload),
      });

      if (wantsStream) {
        if (!groqRes.ok) {
          const rawJson = await groqRes.text();
          let errMsg = "Erro na API Groq";
          try {
            const errData = JSON.parse(rawJson) as { error?: { message?: string } };
            errMsg = errData.error?.message ?? errMsg;
          } catch {
            /* ignore */
          }
          httpRes.statusCode = groqRes.status >= 400 ? groqRes.status : 502;
          httpRes.setHeader("Content-Type", "application/json; charset=utf-8");
          httpRes.end(JSON.stringify({ error: errMsg }));
          return;
        }

        if (!groqRes.body) {
          httpRes.statusCode = 502;
          httpRes.setHeader("Content-Type", "application/json; charset=utf-8");
          httpRes.end(JSON.stringify({ error: "Resposta vazia da API Groq" }));
          return;
        }

        httpRes.statusCode = 200;
        httpRes.setHeader("Content-Type", "text/event-stream; charset=utf-8");
        httpRes.setHeader("Cache-Control", "no-cache");
        httpRes.setHeader("Connection", "keep-alive");
        Readable.fromWeb(groqRes.body as import("node:stream/web").ReadableStream).pipe(httpRes);
        return;
      }

      const rawJson = await groqRes.text();
      let data: {
        choices?: { message?: { content?: string } }[];
        error?: { message?: string };
      };
      try {
        data = JSON.parse(rawJson) as typeof data;
      } catch {
        httpRes.statusCode = 502;
        httpRes.setHeader("Content-Type", "application/json; charset=utf-8");
        httpRes.end(JSON.stringify({ error: "Resposta inválida da API Groq" }));
        return;
      }

      if (!groqRes.ok) {
        httpRes.statusCode = groqRes.status >= 400 ? groqRes.status : 502;
        httpRes.setHeader("Content-Type", "application/json; charset=utf-8");
        httpRes.end(
          JSON.stringify({
            error: data.error?.message ?? "Erro na API Groq",
          }),
        );
        return;
      }

      const text = data.choices?.[0]?.message?.content ?? "";
      httpRes.statusCode = 200;
      httpRes.setHeader("Content-Type", "application/json; charset=utf-8");
      httpRes.end(JSON.stringify({ text }));
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao gerar resposta";
      httpRes.statusCode = 500;
      httpRes.setHeader("Content-Type", "application/json; charset=utf-8");
      httpRes.end(JSON.stringify({ error: msg }));
    }
  });
}

export function groqProxyPlugin() {
  return {
    name: "groq-proxy",
    configureServer(server: ViteDevServer) {
      attachGroqMiddleware(server.middlewares, server.config.mode, server.config.envDir);
    },
    configurePreviewServer(server: PreviewServer) {
      attachGroqMiddleware(server.middlewares, server.config.mode, server.config.envDir);
    },
  };
}
