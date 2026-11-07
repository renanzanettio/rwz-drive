"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import styles from "@/app/drive/drive.module.css";
import {
  authApi,
  driveApi,
  filesApi,
  foldersApi,
  searchApi,
  storageApi,
  ApiError,
  type FileItem,
  type FolderItem,
  type StorageUsage,
  type WatchProgress,
} from "@/lib/api-client";
import { toUploadItems, type UploadBatchProgress } from "@/lib/upload";
import { setImpersonation, clearImpersonation } from "@/lib/impersonation";
import { formatBytes, formatDate, formatDuration, fileKind } from "@/lib/format";
import {
  FolderIcon,
  FileIcon,
  ImageIcon,
  VideoIcon,
  PdfIcon,
  SearchIcon,
  PlusIcon,
  MenuDotsIcon,
  HamburgerIcon,
  DownloadIcon,
  TrashIcon,
  EditIcon,
  MoveIcon,
  ShareIcon,
  UploadIcon,
  UsersIcon,
} from "./icons";
import { PromptModal, ConfirmModal } from "./Modals";
import { MoveModal } from "./MoveModal";
import { ShareModal } from "./ShareModal";
import { SharesPanel } from "./SharesPanel";
import { UsersPanel } from "./UsersPanel";
import { Toast } from "./Toast";
import { MediaPanel } from "./MediaPanel";
import { TVPanel } from "./TVPanel";
import { StoragePanel } from "./StoragePanel";
import { VideoPlayer } from "./VideoPlayer";
import { MusicProvider } from "./MusicProvider";
import { MusicPanel } from "./MusicPanel";

interface CurrentUser {
  id: string;
  username: string;
  email: string | null;
  role: "admin" | "user";
}

type Crumb = { id: string | null; name: string };
type MainView = "drive" | "shares" | "users" | "media" | "tv" | "storage" | "music";

type PendingAction =
  | { type: "new-folder" }
  | { type: "rename-folder"; folder: FolderItem }
  | { type: "rename-file"; file: FileItem }
  | { type: "delete-folder"; folder: FolderItem }
  | { type: "delete-file"; file: FileItem }
  | { type: "move-folder"; folder: FolderItem }
  | { type: "move-file"; file: FileItem }
  | { type: "share-folder"; folder: FolderItem }
  | { type: "share-file"; file: FileItem }
  | null;

export function DriveApp({ user }: { user: CurrentUser }) {
  const router = useRouter();

  const [breadcrumb, setBreadcrumb] = useState<Crumb[]>([{ id: null, name: "Meu Drive" }]);
  const currentFolderId = breadcrumb[breadcrumb.length - 1].id;
  const [mainView, setMainView] = useState<MainView>("drive");
  const [impersonating, setImpersonatingState] = useState<{ userId: string; username: string } | null>(null);

  const [folders, setFolders] = useState<FolderItem[]>([]);
  const [files, setFiles] = useState<FileItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [usage, setUsage] = useState<StorageUsage | null>(null);

  const [searchQuery, setSearchQuery] = useState("");
  const [searchResults, setSearchResults] = useState<{ files: FileItem[]; folders: FolderItem[] } | null>(null);

  const [openMenuId, setOpenMenuId] = useState<string | null>(null);
  const [newMenuOpen, setNewMenuOpen] = useState(false);
  const [userMenuOpen, setUserMenuOpen] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [pendingAction, setPendingAction] = useState<PendingAction>(null);
  const [preview, setPreview] = useState<FileItem | null>(null);
  const [toast, setToast] = useState<{ message: string; danger?: boolean } | null>(null);
  const [dragOver, setDragOver] = useState(false);
  const [uploadProgress, setUploadProgress] = useState<UploadBatchProgress | null>(null);

  const [sortOrder, setSortOrder] = useState("name");
  const [selectionMode, setSelectionMode] = useState(false);
  const [selection, setSelection] = useState<{ files: string[]; folders: string[] }>({ files: [], folders: [] });
  const [batchModal, setBatchModal] = useState<"move" | "trash" | null>(null);
  const [batchBusy, setBatchBusy] = useState(false);

  const fileInputRef = useRef<HTMLInputElement>(null);
  const folderInputRef = useRef<HTMLInputElement>(null);
  const dragCounter = useRef(0);
  const searchRequestRef = useRef(0);

  function notify(message: string, danger = false) {
    setToast({ message, danger });
    setTimeout(() => setToast(null), 3500);
  }

  const loadFolder = useCallback(async (folderId: string | null) => {
    setLoading(true);
    try {
      const [foldersRes, filesRes] = await Promise.all([
        foldersApi.list(folderId),
        filesApi.list(folderId),
      ]);
      setFolders(foldersRes.folders);
      setFiles(filesRes.files);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Não foi possível carregar a pasta.", true);
    } finally {
      setLoading(false);
    }
  }, []);

  const loadUsage = useCallback(async () => {
    try {
      setUsage(await storageApi.usage());
    } catch {
      /* silencioso — não é crítico para a navegação */
    }
  }, []);

  useEffect(() => {
    if (searchResults) return;
    loadFolder(currentFolderId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentFolderId]);

  useEffect(() => {
    loadUsage();
  }, [loadUsage, folders.length, files.length]);

  // ---------- Visualizar como outro usuário (admin) ----------
  function viewAsUser(userId: string, username: string) {
    setImpersonation(userId, username);
    setImpersonatingState({ userId, username });
    setMainView("drive");
    setBreadcrumb([{ id: null, name: `Drive de ${username}` }]);
    setSearchResults(null);
    setSearchQuery("");
    loadFolder(null);
    loadUsage();
  }

  function stopImpersonating() {
    clearImpersonation();
    setImpersonatingState(null);
    setBreadcrumb([{ id: null, name: "Meu Drive" }]);
    setSearchResults(null);
    setSearchQuery("");
    loadFolder(null);
    loadUsage();
  }

  function navigateTo(folderId: string | null, name: string) {
    setSearchResults(null);
    setSearchQuery("");
    setSidebarOpen(false);
    if (folderId === null) {
      setBreadcrumb([{ id: null, name: "Meu Drive" }]);
      return;
    }
    setBreadcrumb((trail) => [...trail, { id: folderId, name }]);
  }

  function navigateToCrumb(index: number) {
    setSearchResults(null);
    setSearchQuery("");
    setBreadcrumb((trail) => trail.slice(0, index + 1));
  }

  async function handleSearch(q: string) {
    const requestId = ++searchRequestRef.current;
    setSearchQuery(q);
    setSelection({ files: [], folders: [] });
    if (mainView !== "drive") return;
    if (q.trim().length === 0) {
      setSearchResults(null);
      return;
    }
    try {
      const results = await searchApi.search(q.trim());
      if (requestId === searchRequestRef.current) setSearchResults(results);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Falha na busca.", true);
    }
  }

  useEffect(() => {
    searchRequestRef.current += 1;
    setSelection({ files: [], folders: [] });
    setSelectionMode(false);
    setBatchModal(null);
  }, [currentFolderId, mainView]);

  function toggleSelection(kind: "files" | "folders", id: string) {
    setSelection((previous) => ({
      ...previous,
      [kind]: previous[kind].includes(id) ? previous[kind].filter((item) => item !== id) : [...previous[kind], id],
    }));
  }

  async function batchAction(action: "move" | "trash", target: string | null = null) {
    if (batchBusy) return;
    setBatchBusy(true);
    try {
      await driveApi.batch(action, selection.files, selection.folders, target);
      setSelection({ files: [], folders: [] });
      setBatchModal(null);
      if (searchResults && searchQuery.trim()) setSearchResults(await searchApi.search(searchQuery.trim()));
      else await loadFolder(currentFolderId);
      await loadUsage();
      notify(action === "move" ? "Itens movidos." : "Itens excluídos.");
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Não foi possível alterar os itens selecionados.", true);
    } finally { setBatchBusy(false); }
  }

  function openTV() {
    setMainView("tv");
    setSidebarOpen(false);
    setSearchQuery("");
    setSearchResults(null);
  }

  // ---------- Upload ----------
  async function uploadFiles(fileList: FileList | File[]) {
    const items = toUploadItems(fileList);
    if (items.length === 0) return;

    try {
      const results = await filesApi.upload(items, currentFolderId, setUploadProgress);
      const okCount = results.filter((r) => r.success).length;
      const failed = results.filter((r) => !r.success);

      if (failed.length === 0) {
        notify(okCount === 1 ? "Arquivo enviado." : `${okCount} arquivos enviados.`);
      } else {
        notify(`${okCount} enviado(s), ${failed.length} falharam (${failed[0].error ?? "erro"}).`, true);
      }

      await loadFolder(currentFolderId);
      await loadUsage();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Falha no upload.", true);
    } finally {
      setUploadProgress(null);
    }
  }

  function handleDrop(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current = 0;
    setDragOver(false);
    if (e.dataTransfer.files?.length) {
      uploadFiles(e.dataTransfer.files);
    }
  }

  function handleDragEnter(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current += 1;
    setDragOver(true);
  }

  function handleDragLeave(e: React.DragEvent) {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current <= 0) setDragOver(false);
  }

  // ---------- Ações de pasta/arquivo ----------
  async function createFolder(name: string) {
    try {
      await foldersApi.create(name, currentFolderId);
      notify("Pasta criada.");
      loadFolder(currentFolderId);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Não foi possível criar a pasta.", true);
    } finally {
      setPendingAction(null);
    }
  }

  async function renameFolder(folder: FolderItem, name: string) {
    try {
      await foldersApi.rename(folder.id, name);
      notify("Pasta renomeada.");
      loadFolder(currentFolderId);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Não foi possível renomear.", true);
    } finally {
      setPendingAction(null);
    }
  }

  async function renameFile(file: FileItem, name: string) {
    try {
      await filesApi.rename(file.id, name);
      notify("Arquivo renomeado.");
      loadFolder(currentFolderId);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Não foi possível renomear.", true);
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteFolder(folder: FolderItem) {
    try {
      await foldersApi.remove(folder.id);
      notify("Pasta excluída.");
      loadFolder(currentFolderId);
      loadUsage();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Não foi possível excluir.", true);
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteFile(file: FileItem) {
    try {
      await filesApi.remove(file.id);
      notify("Arquivo excluído.");
      loadFolder(currentFolderId);
      loadUsage();
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Não foi possível excluir.", true);
    } finally {
      setPendingAction(null);
    }
  }

  async function moveFolder(folder: FolderItem, targetId: string | null) {
    try {
      await foldersApi.move(folder.id, targetId);
      notify("Pasta movida.");
      loadFolder(currentFolderId);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Não foi possível mover.", true);
    } finally {
      setPendingAction(null);
    }
  }

  async function moveFile(file: FileItem, targetId: string | null) {
    try {
      await filesApi.move(file.id, targetId);
      notify("Arquivo movido.");
      loadFolder(currentFolderId);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Não foi possível mover.", true);
    } finally {
      setPendingAction(null);
    }
  }

  async function handleLogout() {
    try {
      await authApi.logout();
    } finally {
      router.push("/login");
      router.refresh();
    }
  }

  function iconFor(mime: string) {
    const kind = fileKind(mime);
    if (kind === "image") return <ImageIcon size={20} />;
    if (kind === "video") return <VideoIcon size={20} />;
    if (kind === "pdf") return <PdfIcon size={20} />;
    return <FileIcon size={20} />;
  }

  function openFile(file: FileItem) {
    if(file.mime_type.startsWith("audio/")||file.mime_type==="application/ogg"){
      setMainView("music");setSearchQuery("");setSearchResults(null);
      window.dispatchEvent(new CustomEvent("rwz-music-open",{detail:file.id}));return;
    }
    const kind = fileKind(file.mime_type);
    if (kind === "image" || kind === "video") {
      setPreview(file);
    } else {
      window.location.href = filesApi.downloadUrl(file.id);
    }
  }

  function updateWatchProgress(progress: WatchProgress) {
    const update = (items: FileItem[]) => items.map((file) => file.id === progress.file_id ? {
      ...file,
      watch_position_seconds: progress.position_seconds,
      watch_duration_seconds: progress.duration_seconds,
      watch_completed_at: progress.completed_at,
      watch_updated_at: progress.updated_at,
    } : file);
    setFiles(update);
    setSearchResults((previous) => previous && { ...previous, files: update(previous.files) });
  }

  function closePreview() {
    setPreview(null);
  }

  async function openMediaFolder(folderId: string) {
    try {
      const { breadcrumb: trail } = await foldersApi.breadcrumb(folderId);
      setBreadcrumb([{ id: null, name: impersonating ? `Drive de ${impersonating.username}` : "Meu Drive" },
        ...trail.map((folder) => ({ id: folder.id, name: folder.name }))]);
      setSearchQuery("");
      setSearchResults(null);
      setMainView("drive");
      await loadFolder(folderId);
    } catch (err) {
      notify(err instanceof ApiError ? err.message : "Não foi possível abrir a pasta.", true);
    }
  }

  const usagePct = usage ? Math.min(100, Math.round((usage.usedBytes / usage.quotaBytes) * 100)) : 0;
  const usageLevel = usagePct >= 95 ? styles.btnDanger : usagePct >= 80 ? "warn" : "";

  const showingSearch = searchResults !== null;
  const collator = new Intl.Collator("pt-BR", { numeric: true, sensitivity: "base" });
  const visibleFolders = [...(showingSearch ? searchResults!.folders : folders)].sort((a,b) =>
    (sortOrder === "size" ? (b.size_bytes ?? 0)-(a.size_bytes ?? 0) : sortOrder === "date" ? b.updated_at.localeCompare(a.updated_at) : 0)
    || collator.compare(a.name,b.name));
  const visibleFiles = [...(showingSearch ? searchResults!.files : files)].sort((a,b) =>
    (sortOrder === "size" ? b.size-a.size : sortOrder === "date" ? b.updated_at.localeCompare(a.updated_at) : 0)
    || collator.compare(a.original_name,b.original_name));
  const selectedCount = selection.files.length + selection.folders.length;
  const isEmpty = !loading && visibleFolders.length === 0 && visibleFiles.length === 0;

  return (
    <MusicProvider key={impersonating?.userId??user.id} scope={impersonating?.userId??user.id}>
    <div className={styles.shell}>
      <div
        className={`${styles.sidebarBackdrop} ${sidebarOpen ? styles.sidebarBackdropOpen : ""}`}
        onClick={() => setSidebarOpen(false)}
      />
      <aside className={`${styles.sidebar} ${sidebarOpen ? styles.sidebarOpen : ""}`}>
        <div className={styles.brand}>
          <div className={styles.brandMark}>RWZ</div>
          <span className={styles.brandName}>RWZ Drive</span>
        </div>

        <div style={{ position: "relative" }}>
          <button className={styles.newButton} onClick={() => {
            if (mainView !== "drive") {
              setSearchQuery("");
              setSearchResults(null);
              void loadFolder(currentFolderId);
            }
            setMainView("drive");
            setNewMenuOpen((v) => !v);
          }}>
            <PlusIcon size={16} />
            Novo
          </button>
          {newMenuOpen && (
            <div className={styles.newMenu} onMouseLeave={() => setNewMenuOpen(false)}>
              <button
                className={styles.newMenuItem}
                onClick={() => {
                  setNewMenuOpen(false);
                  setPendingAction({ type: "new-folder" });
                }}
              >
                <FolderIcon size={16} /> Nova pasta
              </button>
              <button
                className={styles.newMenuItem}
                onClick={() => {
                  setNewMenuOpen(false);
                  fileInputRef.current?.click();
                }}
              >
                <FileIcon size={16} /> Enviar arquivos
              </button>
              <button
                className={styles.newMenuItem}
                onClick={() => {
                  setNewMenuOpen(false);
                  folderInputRef.current?.click();
                }}
              >
                <UploadIcon size={16} /> Enviar pasta
              </button>
            </div>
          )}
        </div>

        <nav>
          <button
            className={`${styles.navItem} ${mainView === "drive" ? styles.navItemActive : ""}`}
            onClick={() => {
              setMainView("drive");
              setSidebarOpen(false);
              setSearchQuery("");
              setSearchResults(null);
              void loadFolder(currentFolderId);
            }}
          >
            <FolderIcon size={16} /> {impersonating ? `Drive de ${impersonating.username}` : "Meu Drive"}
          </button>
          <button
            className={`${styles.navItem} ${mainView === "media" ? styles.navItemActive : ""}`}
            onClick={() => {
              setMainView("media");
              setSidebarOpen(false);
              setSearchQuery("");
              setSearchResults(null);
            }}
          >
            <VideoIcon size={16} /> Séries e filmes
          </button>
          <button className={`${styles.navItem} ${mainView === "tv" ? styles.navItemActive : ""}`} onClick={openTV}>
            <VideoIcon size={16} /> Modo TV
          </button>
          <button className={`${styles.navItem} ${mainView === "music" ? styles.navItemActive : ""}`} onClick={()=>{setMainView("music");setSearchQuery("");setSearchResults(null);setSidebarOpen(false);}}>
            <span aria-hidden="true">♫</span> Músicas
          </button>
          <button className={`${styles.navItem} ${mainView === "storage" ? styles.navItemActive : ""}`}
            onClick={() => { setMainView("storage"); setSidebarOpen(false); }}>
            <FolderIcon size={16} /> Espaço por pasta
          </button>
          <button
            className={`${styles.navItem} ${mainView === "shares" ? styles.navItemActive : ""}`}
            onClick={() => setMainView("shares")}
          >
            <ShareIcon size={16} /> Compartilhamentos
          </button>
          {user.role === "admin" && (
            <button
              className={`${styles.navItem} ${mainView === "users" ? styles.navItemActive : ""}`}
              onClick={() => setMainView("users")}
            >
              <UsersIcon size={16} /> Usuários
            </button>
          )}
        </nav>

        {impersonating && (
          <div className={styles.impersonationBanner}>
            <div>
              Vendo como <strong>{impersonating.username}</strong>
            </div>
            <button className={styles.btn} onClick={stopImpersonating}>
              Voltar ao meu Drive
            </button>
          </div>
        )}

        <div className={styles.sidebarFooter}>
          <div className={styles.storageBox}>
            <div className={styles.storageLabel}>Armazenamento</div>
            <div className={styles.storageBar}>
              <div
                className={styles.storageBarFill}
                style={{
                  width: `${usagePct}%`,
                  background: usagePct >= 95 ? "var(--danger)" : usagePct >= 80 ? "#e5a84d" : undefined,
                }}
              />
            </div>
            <div className={styles.storageText}>
              {usage ? `${formatBytes(usage.usedBytes)} de ${formatBytes(usage.quotaBytes)}` : "..."}
            </div>
          </div>
        </div>
      </aside>

      <div className={styles.main}>
        <div className={styles.topbar}>
          <button className={styles.hamburger} onClick={() => setSidebarOpen((v) => !v)}>
            <HamburgerIcon size={18} />
          </button>

          <div className={styles.searchWrap}>
            <span className={styles.searchIcon}>
              <SearchIcon size={16} />
            </span>
            <input
              className={styles.searchInput}
              placeholder={mainView === "media" ? "Buscar séries, filmes e episódios..." : mainView === "music" ? "Buscar músicas, artistas e álbuns..." : "Buscar arquivos e pastas..."}
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
            />
          </div>

          <div className={styles.userMenu}>
            <button className={styles.userAvatar} onClick={() => setUserMenuOpen((v) => !v)}>
              {user.username.slice(0, 2).toUpperCase()}
            </button>
            {userMenuOpen && (
              <div className={styles.userDropdown} onMouseLeave={() => setUserMenuOpen(false)}>
                <div className={styles.userDropdownName}>{user.username}</div>
                <button className={styles.dropdownItem} onClick={handleLogout}>
                  Sair
                </button>
              </div>
            )}
          </div>
        </div>

        <div
          className={`${styles.content} ${dragOver && mainView === "drive" ? styles.contentDragOver : ""}`}
          onDragEnter={mainView === "drive" ? handleDragEnter : undefined}
          onDragOver={mainView === "drive" ? (e) => e.preventDefault() : undefined}
          onDragLeave={mainView === "drive" ? handleDragLeave : undefined}
          onDrop={mainView === "drive" ? handleDrop : undefined}
        >
          {mainView === "shares" ? (
            <SharesPanel notify={notify} />
          ) : mainView === "users" ? (
            <UsersPanel notify={notify} onViewAsUser={viewAsUser} />
          ) : mainView === "media" ? (
            <MediaPanel key={impersonating?.userId ?? user.id} query={searchQuery} onOpenFolder={openMediaFolder} onOpenTV={openTV} />
          ) : mainView === "tv" ? (
            <TVPanel key={impersonating?.userId ?? user.id} />
          ) : mainView === "storage" ? (
            <StoragePanel key={impersonating?.userId ?? user.id} onOpenFolder={openMediaFolder} />
          ) : mainView === "music" ? (
            <MusicPanel query={searchQuery} onOpenDrive={()=>{setMainView("drive");setSearchQuery("");setSearchResults(null);void loadFolder(currentFolderId);}} onOpenFolder={openMediaFolder}/>
          ) : (
            <>
          <input
            ref={fileInputRef}
            type="file"
            multiple
            hidden
            onChange={(e) => {
              if (e.target.files?.length) uploadFiles(e.target.files);
              e.target.value = "";
            }}
          />
          <input
            ref={folderInputRef}
            type="file"
            multiple
            hidden
            // @ts-expect-error - atributo não padronizado, suportado pelos navegadores baseados em Chromium/Safari
            webkitdirectory=""
            onChange={(e) => {
              if (e.target.files?.length) uploadFiles(e.target.files);
              e.target.value = "";
            }}
          />

          {!showingSearch && (
            <div className={styles.breadcrumbs}>
              {breadcrumb.map((crumb, idx) => (
                <span key={crumb.id ?? "root"} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {idx > 0 && <span>/</span>}
                  {idx === breadcrumb.length - 1 ? (
                    <span className={styles.breadcrumbCurrent}>{crumb.name}</span>
                  ) : (
                    <button className={styles.breadcrumbItem} onClick={() => navigateToCrumb(idx)}>
                      {crumb.name}
                    </button>
                  )}
                </span>
              ))}
            </div>
          )}

          {showingSearch && <h1 className={styles.sectionTitle}>Resultados para "{searchQuery}"</h1>}

          <div className={styles.fileToolbar}>
            <label>Ordenar<select value={sortOrder} onChange={(event) => setSortOrder(event.target.value)}>
              <option value="name">Nome (A–Z)</option><option value="date">Atualizados recentemente</option>
              <option value="size">Maior tamanho</option></select></label>
            <button type="button" className={styles.btn} onClick={() => {
              setSelectionMode(!selectionMode); setSelection({ files: [], folders: [] });
            }}>{selectionMode ? "Concluir seleção" : "Selecionar itens"}</button>
            {selectionMode && <>
              <button type="button" className={styles.btn} disabled={visibleFiles.length+visibleFolders.length > 1000}
                onClick={() => setSelection({ files: visibleFiles.map((file) => file.id), folders: visibleFolders.map((folder) => folder.id) })}>Selecionar todos</button>
              <span>{selectedCount} selecionados</span>
              <button type="button" className={styles.btn} disabled={!selectedCount || batchBusy} onClick={() => setBatchModal("move")}>Mover selecionados</button>
              <button type="button" className={`${styles.btn} ${styles.btnDanger}`} disabled={!selectedCount || batchBusy} onClick={() => setBatchModal("trash")}>Excluir selecionados</button>
            </>}
          </div>

          {isEmpty && (
            <div className={styles.emptyState}>
              <FolderIcon size={40} />
              <div className={styles.emptyStateTitle} style={{ marginTop: 14 }}>
                {showingSearch ? "Nada encontrado" : "Esta pasta está vazia"}
              </div>
              <p>{showingSearch ? "Tente outro termo de busca." : "Arraste arquivos aqui ou use o botão Novo."}</p>
            </div>
          )}

          {!isEmpty && (
            <div className={styles.grid}>
              {visibleFolders.map((folder) => (
                <div
                  key={folder.id}
                  className={`${styles.card} ${selection.folders.includes(folder.id) ? styles.cardSelected : ""}`}
                  onClick={() => selectionMode ? toggleSelection("folders",folder.id) : navigateTo(folder.id, folder.name)}
                >
                  {selectionMode && <input type="checkbox" className={styles.itemCheckbox}
                    aria-label={"Selecionar pasta " + folder.name} checked={selection.folders.includes(folder.id)}
                    onClick={(event) => event.stopPropagation()} onChange={() => toggleSelection("folders",folder.id)} />}
                  <div className={styles.cardIcon} style={{ background: "var(--accent-soft)", color: "var(--accent)" }}>
                    <FolderIcon size={20} />
                  </div>
                  <div className={styles.cardName}>{folder.name}</div>
                  <div className={styles.cardMeta}>{folder.size_bytes === undefined ? "Pasta" : formatBytes(folder.size_bytes) + " · " + folder.file_count + (folder.file_count === 1 ? " arquivo" : " arquivos")}</div>

                  <div className={styles.cardActions}>
                    <button
                      className={styles.cardMenuBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId(openMenuId === folder.id ? null : folder.id);
                      }}
                    >
                      <MenuDotsIcon size={14} />
                    </button>
                    {openMenuId === folder.id && (
                      <div className={styles.dropdown} onMouseLeave={() => setOpenMenuId(null)}>
                        <button
                          className={styles.dropdownItem}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(null);
                            setPendingAction({ type: "rename-folder", folder });
                          }}
                        >
                          <EditIcon size={14} /> Renomear
                        </button>
                        <button
                          className={styles.dropdownItem}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(null);
                            setPendingAction({ type: "move-folder", folder });
                          }}
                        >
                          <MoveIcon size={14} /> Mover
                        </button>
                        <button
                          className={styles.dropdownItem}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(null);
                            setPendingAction({ type: "share-folder", folder });
                          }}
                        >
                          <ShareIcon size={14} /> Compartilhar
                        </button>
                        <button
                          className={styles.dropdownItem}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(null);
                            window.location.href = foldersApi.downloadZipUrl(folder.id);
                          }}
                        >
                          <DownloadIcon size={14} /> Baixar (.zip)
                        </button>
                        <button
                          className={`${styles.dropdownItem} ${styles.dropdownItemDanger}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(null);
                            setPendingAction({ type: "delete-folder", folder });
                          }}
                        >
                          <TrashIcon size={14} /> Excluir
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}

              {visibleFiles.map((file) => (
                <div key={file.id} className={`${styles.card} ${selection.files.includes(file.id) ? styles.cardSelected : ""}`}
                  onClick={() => selectionMode ? toggleSelection("files",file.id) : openFile(file)}>
                  {selectionMode && <input type="checkbox" className={styles.itemCheckbox}
                    aria-label={"Selecionar arquivo " + file.original_name} checked={selection.files.includes(file.id)}
                    onClick={(event) => event.stopPropagation()} onChange={() => toggleSelection("files",file.id)} />}
                  {fileKind(file.mime_type) === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={filesApi.streamUrl(file.id)} alt={file.original_name} className={styles.cardThumb} />
                  ) : (
                    <div className={styles.cardIcon} style={{ background: "var(--bg-hover)", color: "var(--text-dim)" }}>
                      {iconFor(file.mime_type)}
                    </div>
                  )}
                  <div className={styles.cardName}>{file.original_name}</div>
                  <div className={styles.cardMeta}>
                    {formatBytes(file.size)}
                    {file.watch_completed_at && " · Assistido"}
                    {fileKind(file.mime_type) === "video" &&
                      !!file.watch_position_seconds &&
                      !file.watch_completed_at &&
                      !!file.watch_duration_seconds &&
                      ` · ${formatDuration(file.watch_position_seconds)} de ${formatDuration(file.watch_duration_seconds)}`}
                  </div>
                  {fileKind(file.mime_type) === "video" &&
                    !!file.watch_position_seconds &&
                    !file.watch_completed_at &&
                    !!file.watch_duration_seconds && (
                      <div className={styles.cardProgressTrack}>
                        <div
                          className={styles.cardProgressFill}
                          style={{
                            width: `${Math.min(100, (file.watch_position_seconds / file.watch_duration_seconds) * 100)}%`,
                          }}
                        />
                      </div>
                    )}

                  <div className={styles.cardActions}>
                    <button
                      className={styles.cardMenuBtn}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenMenuId(openMenuId === file.id ? null : file.id);
                      }}
                    >
                      <MenuDotsIcon size={14} />
                    </button>
                    {openMenuId === file.id && (
                      <div className={styles.dropdown} onMouseLeave={() => setOpenMenuId(null)}>
                        <button
                          className={styles.dropdownItem}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(null);
                            window.location.href = filesApi.downloadUrl(file.id);
                          }}
                        >
                          <DownloadIcon size={14} /> Baixar
                        </button>
                        <button
                          className={styles.dropdownItem}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(null);
                            setPendingAction({ type: "rename-file", file });
                          }}
                        >
                          <EditIcon size={14} /> Renomear
                        </button>
                        <button
                          className={styles.dropdownItem}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(null);
                            setPendingAction({ type: "move-file", file });
                          }}
                        >
                          <MoveIcon size={14} /> Mover
                        </button>
                        <button
                          className={styles.dropdownItem}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(null);
                            setPendingAction({ type: "share-file", file });
                          }}
                        >
                          <ShareIcon size={14} /> Compartilhar
                        </button>
                        <button
                          className={`${styles.dropdownItem} ${styles.dropdownItemDanger}`}
                          onClick={(e) => {
                            e.stopPropagation();
                            setOpenMenuId(null);
                            setPendingAction({ type: "delete-file", file });
                          }}
                        >
                          <TrashIcon size={14} /> Excluir
                        </button>
                      </div>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
            </>
          )}
        </div>
      </div>

      {batchModal === "move" && <MoveModal excludeFolderIds={selection.folders}
        onCancel={() => { if (!batchBusy) setBatchModal(null); }}
        onMove={(id) => { if (!batchBusy) void batchAction("move",id); }} />}
      {batchModal === "trash" && <ConfirmModal title={"Excluir " + selectedCount + " itens?"}
        description="As pastas selecionadas e seu conteúdo serão excluídos do Drive."
        confirmLabel={batchBusy ? "Excluindo…" : "Excluir selecionados"} danger
        onCancel={() => { if (!batchBusy) setBatchModal(null); }} onConfirm={() => { if (!batchBusy) void batchAction("trash"); }} />}

      {/* ---------- Modais ---------- */}
      {pendingAction?.type === "new-folder" && (
        <PromptModal title="Nova pasta" confirmLabel="Criar" onConfirm={createFolder} onCancel={() => setPendingAction(null)} />
      )}
      {pendingAction?.type === "rename-folder" && (
        <PromptModal
          title="Renomear pasta"
          initialValue={pendingAction.folder.name}
          confirmLabel="Salvar"
          onConfirm={(name) => renameFolder(pendingAction.folder, name)}
          onCancel={() => setPendingAction(null)}
        />
      )}
      {pendingAction?.type === "rename-file" && (
        <PromptModal
          title="Renomear arquivo"
          initialValue={pendingAction.file.original_name}
          confirmLabel="Salvar"
          onConfirm={(name) => renameFile(pendingAction.file, name)}
          onCancel={() => setPendingAction(null)}
        />
      )}
      {pendingAction?.type === "delete-folder" && (
        <ConfirmModal
          title="Excluir pasta"
          description={`Tem certeza que deseja excluir "${pendingAction.folder.name}" e todo o seu conteúdo?`}
          confirmLabel="Excluir"
          danger
          onConfirm={() => deleteFolder(pendingAction.folder)}
          onCancel={() => setPendingAction(null)}
        />
      )}
      {pendingAction?.type === "delete-file" && (
        <ConfirmModal
          title="Excluir arquivo"
          description={`Tem certeza que deseja excluir "${pendingAction.file.original_name}"?`}
          confirmLabel="Excluir"
          danger
          onConfirm={() => deleteFile(pendingAction.file)}
          onCancel={() => setPendingAction(null)}
        />
      )}
      {pendingAction?.type === "move-folder" && (
        <MoveModal
          excludeFolderId={pendingAction.folder.id}
          onMove={(targetId) => moveFolder(pendingAction.folder, targetId)}
          onCancel={() => setPendingAction(null)}
        />
      )}
      {pendingAction?.type === "move-file" && (
        <MoveModal onMove={(targetId) => moveFile(pendingAction.file, targetId)} onCancel={() => setPendingAction(null)} />
      )}
      {pendingAction?.type === "share-folder" && (
        <ShareModal
          mode="create"
          type="folder"
          targetId={pendingAction.folder.id}
          targetName={pendingAction.folder.name}
          onCancel={() => setPendingAction(null)}
          onSaved={() => {
            setPendingAction(null);
            setMainView("shares");
          }}
          notify={notify}
        />
      )}
      {pendingAction?.type === "share-file" && (
        <ShareModal
          mode="create"
          type="file"
          targetId={pendingAction.file.id}
          targetName={pendingAction.file.original_name}
          onCancel={() => setPendingAction(null)}
          onSaved={() => {
            setPendingAction(null);
            setMainView("shares");
          }}
          notify={notify}
        />
      )}

      {/* ---------- Preview ---------- */}
      {preview && (
        <div className={styles.previewOverlay} onClick={closePreview}>
          <button className={styles.previewClose} onClick={closePreview}>
            ✕
          </button>
          <div onClick={(e) => e.stopPropagation()}>
            {fileKind(preview.mime_type) === "image" ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={filesApi.streamUrl(preview.id)} alt={preview.original_name} className={styles.previewImg} />
            ) : (
              <VideoPlayer
                key={preview.id}
                fileId={preview.id}
                title={preview.original_name}
                className={styles.previewVideo}
                onProgress={updateWatchProgress}
              />
            )}
          </div>
          <div className={styles.previewCaption}>
            {preview.original_name} · {formatBytes(preview.size)} · {formatDate(preview.created_at)}
          </div>
        </div>
      )}

      {/* ---------- Toast & upload progress ---------- */}
      {toast && <Toast message={toast.message} variant={toast.danger ? "danger" : "default"} />}

      {uploadProgress && (
        <div className={styles.uploadProgress}>
          <div className={styles.uploadProgressTitle}>
            {uploadProgress.retrying
              ? `Conexão instável, tentando de novo: ${uploadProgress.currentFile}`
              : uploadProgress.currentFile
              ? `Enviando (${uploadProgress.completed + 1}/${uploadProgress.total}): ${uploadProgress.currentFile}`
              : "Upload concluído"}
          </div>
          <div className={styles.storageBar}>
            <div
              className={styles.storageBarFill}
              style={{
                width: `${Math.round(((uploadProgress.completed + uploadProgress.currentFilePct / 100) / uploadProgress.total) * 100)}%`,
                background: uploadProgress.retrying ? "#e5a84d" : undefined,
              }}
            />
          </div>
        </div>
      )}
    </div>
    </MusicProvider>
  );
}
