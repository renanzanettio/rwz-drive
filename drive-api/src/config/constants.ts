export const SESSION_COOKIE_NAME = "rwz_session";

// Extensões que nunca devem ser aceitas, independentemente do conteúdo detectado.
export const BLOCKED_EXTENSIONS = new Set([
  ".exe", ".sh", ".apk", ".bat", ".cmd", ".msi", ".com", ".scr",
  ".ps1", ".vbs", ".vbe", ".js", ".jse", ".wsf", ".wsh", ".jar",
  ".dll", ".so", ".dylib", ".app", ".deb", ".rpm",
]);

// Tipos de preview suportados na v1 (usado só como dica para o frontend).
export const PREVIEWABLE_IMAGE_MIME = new Set([
  "image/jpeg", "image/png", "image/webp", "image/gif",
]);

export const PREVIEWABLE_VIDEO_MIME = new Set([
  "video/mp4", "video/webm",
]);
