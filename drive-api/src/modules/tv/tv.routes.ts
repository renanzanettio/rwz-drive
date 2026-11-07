import { Router } from "express";
import { requireAuth, resolveEffectiveOwner } from "../../middlewares/auth";
import { deleteChannel, getChannel, listChannels, saveChannel } from "./tv.service";

export const tvRouter = Router();
tvRouter.use(requireAuth, resolveEffectiveOwner);
tvRouter.use((_req, res, next) => { res.setHeader("Cache-Control", "private, no-store"); next(); });
tvRouter.get("/", (req, res, next) => {
  try { res.json(listChannels(req.effectiveOwnerId!)); } catch (error) { next(error); }
});
tvRouter.get("/:id", (req, res, next) => {
  try { res.json(getChannel(req.effectiveOwnerId!, req.params.id)); } catch (error) { next(error); }
});
tvRouter.post("/", (req, res, next) => {
  try { res.status(201).json(saveChannel(req.effectiveOwnerId!, req.body ?? {})); } catch (error) { next(error); }
});
tvRouter.put("/:id", (req, res, next) => {
  try { res.json(saveChannel(req.effectiveOwnerId!, req.body ?? {}, req.params.id)); } catch (error) { next(error); }
});
tvRouter.delete("/:id", (req, res, next) => {
  try { deleteChannel(req.effectiveOwnerId!, req.params.id); res.status(204).end(); } catch (error) { next(error); }
});
