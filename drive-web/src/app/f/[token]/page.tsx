import { PublicFileView } from "@/components/PublicFileView";

export default function PublicFilePage({ params }: { params: { token: string } }) {
  return <PublicFileView token={params.token} />;
}
