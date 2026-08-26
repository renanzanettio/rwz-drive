"use client";

import { useState, type FormEvent } from "react";
import styles from "@/app/drive/drive.module.css";

export function PromptModal({
  title,
  initialValue = "",
  confirmLabel = "Salvar",
  onConfirm,
  onCancel,
}: {
  title: string;
  initialValue?: string;
  confirmLabel?: string;
  onConfirm: (value: string) => void;
  onCancel: () => void;
}) {
  const [value, setValue] = useState(initialValue);

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const trimmed = value.trim();
    if (trimmed.length === 0) return;
    onConfirm(trimmed);
  }

  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.modalTitle}>{title}</h2>
        <form onSubmit={handleSubmit}>
          <input
            className={styles.modalInput}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoFocus
            onFocus={(e) => e.currentTarget.select()}
          />
          <div className={styles.modalActions}>
            <button type="button" className={styles.btn} onClick={onCancel}>
              Cancelar
            </button>
            <button type="submit" className={`${styles.btn} ${styles.btnPrimary}`}>
              {confirmLabel}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

export function ConfirmModal({
  title,
  description,
  confirmLabel = "Confirmar",
  danger = false,
  onConfirm,
  onCancel,
}: {
  title: string;
  description?: string;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className={styles.overlay} onClick={onCancel}>
      <div className={styles.modal} onClick={(e) => e.stopPropagation()}>
        <h2 className={styles.modalTitle}>{title}</h2>
        {description && <p style={{ color: "var(--text-dim)", fontSize: 13.5, marginBottom: 18 }}>{description}</p>}
        <div className={styles.modalActions}>
          <button type="button" className={styles.btn} onClick={onCancel}>
            Cancelar
          </button>
          <button
            type="button"
            className={`${styles.btn} ${danger ? styles.btnDanger : styles.btnPrimary}`}
            onClick={onConfirm}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
