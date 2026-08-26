import { PublicFolderView } from "@/components/PublicFolderView";

export default function PublicFolderPage({ params }: { params: { token: string } }) {
  return <PublicFolderView token={params.token} />;
}
