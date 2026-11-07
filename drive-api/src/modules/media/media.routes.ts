import { Router } from "express";
import { requireAuth, resolveEffectiveOwner } from "../../middlewares/auth";
import { ensureMediaFolders, getMediaCatalog } from "./media.service";

import { addSource, removeSource, updateTitle, updateVideo, videoDetails, addSubtitle, removeSubtitle, subtitleText } from "./media-settings.service";

export const mediaRouter = Router();
mediaRouter.use(requireAuth, resolveEffectiveOwner);
mediaRouter.use((_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

mediaRouter.get("/", (req, res, next) => {
  try {
    res.json(getMediaCatalog(req.effectiveOwnerId!));
  } catch (error) {
    next(error);
  }
});

mediaRouter.post("/setup", (req, res, next) => {
  try {
    ensureMediaFolders(req.effectiveOwnerId!);
    res.json(getMediaCatalog(req.effectiveOwnerId!));
  } catch (error) {
    next(error);
  }
});

mediaRouter.post("/sources", (req, res, next) => {
  try { res.json(addSource(req.effectiveOwnerId!, req.body ?? {})); } catch (error) { next(error); }
});
mediaRouter.delete("/sources/:id", (req, res, next) => {
  try { res.json(removeSource(req.effectiveOwnerId!, req.params.id)); } catch (error) { next(error); }
});
mediaRouter.patch("/titles/:id", (req, res, next) => {
  try { res.json(updateTitle(req.effectiveOwnerId!, req.params.id, req.body ?? {})); } catch (error) { next(error); }
});
mediaRouter.get("/files/:id", (req, res, next) => {
  try { res.json(videoDetails(req.effectiveOwnerId!, req.params.id)); } catch (error) { next(error); }
});
mediaRouter.patch("/files/:id", (req, res, next) => {
  try { res.json(updateVideo(req.effectiveOwnerId!, req.params.id, req.body ?? {})); } catch (error) { next(error); }
});
mediaRouter.post("/files/:id/subtitles", async (req, res, next) => {
  try { res.json(await addSubtitle(req.effectiveOwnerId!, req.params.id, req.body ?? {})); } catch (error) { next(error); }
});
mediaRouter.delete("/files/:id/subtitles/:subtitle", (req, res, next) => {
  try { res.json(removeSubtitle(req.effectiveOwnerId!, req.params.id, req.params.subtitle)); } catch (error) { next(error); }
});
mediaRouter.get("/files/:id/subtitles/:subtitle", async (req, res, next) => {
  try {
    res.type("text/vtt").send(await subtitleText(req.effectiveOwnerId!, req.params.id, req.params.subtitle));
  } catch (error) { next(error); }
});
