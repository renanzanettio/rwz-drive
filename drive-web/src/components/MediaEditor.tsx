"use client";

import { useState } from "react";
import { ApiError, filesApi, mediaApi, type MediaCatalog, type MediaTitle } from "@/lib/api-client";
import { DrivePicker } from "./DrivePicker";
import styles from "./MediaDialogs.module.css";

export function MediaEditor({ title, onSaved, onCancel }: {
  title: MediaTitle; onSaved: (catalog: MediaCatalog) => void; onCancel: () => void;
}) {
  const [name, setName] = useState(title.name);
  const [description, setDescription] = useState(title.description);
  const [cover, setCover] = useState(title.cover_file_id);
  const [season, setSeason] = useState(title.seasons[0].id);
  const [orders, setOrders] = useState(Object.fromEntries(title.seasons.map((s) => [s.id, s.episodes.map((e) => e.id)])));
  const [names, setNames] = useState(Object.fromEntries(title.seasons.flatMap((s) => s.episodes.map((e) => [e.id, e.title]))));
  const [picker, setPicker] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const ids = orders[season];
  function move(index: number, step: number) {
    const next = [...ids];
    [next[index], next[index + step]] = [next[index + step], next[index]];
    setOrders({ ...orders, [season]: next });
  }
  async function upload(file: File) {
    if (!file.type.startsWith("image/")) { setError("Escolha uma imagem."); return; }
    setBusy(true);
    setError("");
    try {
      const image = await filesApi.uploadSingle(file, title.folder_id);
      setCover(image.id);
    } catch (err) { setError(err instanceof Error ? err.message : "Falha no envio."); }
    finally { setBusy(false); }
  }
  async function save(event: React.FormEvent) {
    event.preventDefault();
    setBusy(true);
    setError("");
    try {
      onSaved(await mediaApi.updateTitle(title.id, { name, description, cover_file_id: cover,
        episode_order: title.seasons.flatMap((s) => orders[s.id]), episode_titles: names }));
    } catch (err) { setError(err instanceof ApiError ? err.message : "Não foi possível salvar."); }
    finally { setBusy(false); }
  }
  return <>
    <div className={styles.overlay} onClick={() => { if (!busy) onCancel(); }}>
      <form className={styles.dialog} role="dialog" aria-modal="true" aria-label="Editar título" onSubmit={save} onClick={(e) => e.stopPropagation()}>
        <div className={styles.heading}><h2>Editar {title.kind === "series" ? "série" : "filme"}</h2>
          <button type="button" className={styles.button} disabled={busy} onClick={onCancel}>Fechar</button></div>
        {error && <p role="alert" className={styles.error}>{error}</p>}
        <label>Nome<input value={name} maxLength={255} required onChange={(e) => setName(e.target.value)} /></label>
        <label>Descrição<textarea value={description} maxLength={4000} rows={3} onChange={(e) => setDescription(e.target.value)} /></label>
        <div className={styles.coverRow}>
          {cover && <img src={filesApi.streamUrl(cover)} alt="Capa selecionada" className={styles.cover} />}
          <div className={styles.actions}>
            <button type="button" className={styles.button} disabled={busy} onClick={() => setPicker(true)}>Escolher capa do Drive</button>
            <label className={styles.button}>Enviar capa<input type="file" accept="image/*" hidden disabled={busy}
              onChange={(e) => { const file = e.target.files?.[0]; if (file) void upload(file); e.target.value = ""; }} /></label>
            <button type="button" className={styles.button} disabled={busy || !cover} onClick={() => setCover(null)}>Usar capa da pasta</button>
          </div>
        </div>
        <h3>Nomes e ordem dos episódios</h3>
        {title.seasons.length > 1 && <label>Temporada<select value={season} onChange={(e) => setSeason(e.target.value)}>
          {title.seasons.map((s) => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>}
        <ol className={styles.orderList}>{ids.map((id, index) => <li key={id}>
          <span>{index + 1}</span><input aria-label={"Nome do episódio " + (index+1)} value={names[id]} maxLength={255} required
            onChange={(e) => setNames({ ...names, [id]: e.target.value })} />
          <button type="button" aria-label={"Subir " + names[id]} disabled={index === 0} onClick={() => move(index,-1)}>↑</button>
          <button type="button" aria-label={"Descer " + names[id]} disabled={index === ids.length-1} onClick={() => move(index,1)}>↓</button>
        </li>)}</ol>
        <div className={styles.actions}><button type="button" className={styles.button} disabled={busy} onClick={onCancel}>Cancelar</button>
          <button type="submit" className={styles.primary} disabled={busy}>{busy ? "Salvando…" : "Salvar alterações"}</button></div>
      </form>
    </div>
    {picker && <DrivePicker mode="image" onImage={(file) => { setCover(file.id); setPicker(false); }} onCancel={() => setPicker(false)} />}
  </>;
}
