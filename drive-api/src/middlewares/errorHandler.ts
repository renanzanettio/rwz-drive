import type { NextFunction, Request, Response } from "express";
import { env } from "../config/env";
import { logError } from "../utils/logger";

export class HttpError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

// eslint-disable-next-line @typescript-eslint/no-unused-vars
export function errorHandler(err: unknown, req: Request, res: Response, next: NextFunction): void {
  logError(`${req.method} ${req.path}`, err);

  if (err instanceof HttpError) {
    res.status(err.status).json({ error: err.message });
    return;
  }

  // Nunca retornar stack trace / detalhes internos ao cliente (spec §25).
  const status = 500;
  const body = env.isProduction
    ? { error: "Não foi possível processar a solicitação." }
    : { error: err instanceof Error ? err.message : "Erro desconhecido." };

  res.status(status).json(body);
}

export function notFoundHandler(req: Request, res: Response): void {
  res.status(404).json({ error: "Rota não encontrada." });
}
