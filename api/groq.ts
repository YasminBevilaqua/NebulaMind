export const runtime = "nodejs";

import { buildGroqPayload, GROQ_URL } from "../src/lib/groqProxyShared";

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method !== "POST") {
      return new Response(JSON.stringify({ error: "Method not allowed" }), {
        status: 405,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const key = process.env.GROQ_API_KEY?.trim();
    if (!key) {
      return new Response(
        JSON.stringify({
          error: "GROQ_API_KEY is not configured on the server.",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        },
      );
    }

    let body: { content?: string; stream?: boolean };
    try {
      body = (await request.json()) as { content?: string; stream?: boolean };
    } catch {
      return new Response(JSON.stringify({ error: "Invalid JSON body" }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const content = typeof body.content === "string" ? body.content.trim() : "";
    const wantsStream = body.stream === true;
    if (!content) {
      return new Response(JSON.stringify({ error: "Mensagem vazia" }), {
        status: 400,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    const groqPayload = buildGroqPayload(content, wantsStream);

    let groqRes: Response;
    try {
      groqRes = await fetch(GROQ_URL, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${key}`,
        },
        body: JSON.stringify(groqPayload),
      });
    } catch (err) {
      const msg = err instanceof Error ? err.message : "Erro ao contactar a API Groq";
      return new Response(JSON.stringify({ error: msg }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

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
        return new Response(JSON.stringify({ error: errMsg }), {
          status: 500,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      }

      if (!groqRes.body) {
        return new Response(JSON.stringify({ error: "Resposta vazia da API Groq" }), {
          status: 500,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        });
      }

      return new Response(groqRes.body, {
        status: 200,
        headers: {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
          Connection: "keep-alive",
        },
      });
    }

    const rawJson = await groqRes.text();
    let data: {
      choices?: { message?: { content?: string } }[];
      error?: { message?: string };
    };
    try {
      data = JSON.parse(rawJson) as typeof data;
    } catch {
      return new Response(JSON.stringify({ error: "Resposta inválida da API Groq" }), {
        status: 500,
        headers: { "Content-Type": "application/json; charset=utf-8" },
      });
    }

    if (!groqRes.ok) {
      return new Response(
        JSON.stringify({
          error: data.error?.message ?? "Erro na API Groq",
        }),
        {
          status: 500,
          headers: { "Content-Type": "application/json; charset=utf-8" },
        },
      );
    }

    const text = data.choices?.[0]?.message?.content ?? "";
    return new Response(JSON.stringify({ text }), {
      status: 200,
      headers: { "Content-Type": "application/json; charset=utf-8" },
    });
  },
};
