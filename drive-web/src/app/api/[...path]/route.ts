import { NextRequest } from "next/server";
import { API_INTERNAL_URL } from "@/lib/config";

/**
 * Route Handler "catch-all" que atua como BFF entre o navegador e a
 * drive-api (Express), que só escuta em 127.0.0.1:3001 e nunca é exposta
 * diretamente à internet (spec §20).
 *
 * O navegador só fala com esta mesma origem (Next.js), então cookies
 * SameSite funcionam sem fricção e o CORS fica trivial (spec §21, §24) —
 * este proxy só repassa Cookie / Set-Cookie entre as duas pontas.
 */

const HOP_BY_HOP_REQUEST_HEADERS = new Set([
  "host",
  "connection",
  "content-length", // recalculado pelo fetch a partir do body
]);

const HOP_BY_HOP_RESPONSE_HEADERS = new Set([
  "connection",
  "keep-alive",
  "transfer-encoding",
  "content-encoding",
]);

async function proxy(req: NextRequest, path: string[]): Promise<Response> {
  const targetUrl = new URL(`/api/${path.join("/")}`, API_INTERNAL_URL);
  targetUrl.search = req.nextUrl.search;

  const headers = new Headers();
  req.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_REQUEST_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value);
    }
  });
  // Repassa o IP real do cliente para o rate limiting / logs da API.
  headers.set("x-forwarded-for", req.headers.get("x-forwarded-for") ?? req.ip ?? "");
  headers.set("x-forwarded-proto", req.headers.get("x-forwarded-proto") ?? "https");

  const hasBody = !["GET", "HEAD"].includes(req.method);

  const apiResponse = await fetch(targetUrl, {
    method: req.method,
    headers,
    body: hasBody ? req.body : undefined,
    // Necessário no runtime Node (undici) para permitir corpo em streaming.
    // @ts-expect-error - propriedade específica do Node fetch (undici)
    duplex: hasBody ? "half" : undefined,
    redirect: "manual",
    cache: "no-store",
  });

  const responseHeaders = new Headers();
  apiResponse.headers.forEach((value, key) => {
    if (!HOP_BY_HOP_RESPONSE_HEADERS.has(key.toLowerCase())) {
      responseHeaders.set(key, value);
    }
  });

  return new Response(apiResponse.body, {
    status: apiResponse.status,
    headers: responseHeaders,
  });
}

export async function GET(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
export async function POST(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
export async function PATCH(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
export async function PUT(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
export async function DELETE(req: NextRequest, { params }: { params: { path: string[] } }) {
  return proxy(req, params.path);
}
