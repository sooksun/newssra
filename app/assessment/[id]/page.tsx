import { notFound } from "next/navigation";
import AssessmentForm from "@/components/AssessmentForm";
import { getAssessment } from "@/lib/repo";

export const dynamic = "force-dynamic";

export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const raw = (await params).id;
  const id = Number.parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const record = await getAssessment(id);
  if (!record) notFound();

  return <AssessmentForm id={record.id} initial={record.state} />;
}
