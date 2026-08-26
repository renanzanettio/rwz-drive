import styles from "@/app/drive/drive.module.css";

export function Toast({ message, variant = "default" }: { message: string; variant?: "default" | "danger" }) {
  return <div className={`${styles.toast} ${variant === "danger" ? styles.toastDanger : ""}`}>{message}</div>;
}
