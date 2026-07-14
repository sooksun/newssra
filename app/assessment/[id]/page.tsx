import { notFound } from "next/navigation";
import AssessmentForm from "@/components/AssessmentForm";
import { getAssessment } from "@/lib/repo";
import { canAccessAssessment, requireUser } from "@/lib/auth";
import { ROLE_LABELS } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function AssessmentPage({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();

  const raw = (await params).id;
  const id = Number.parseInt(raw, 10);
  if (!Number.isInteger(id) || id <= 0) notFound();

  const record = await getAssessment(id);
  if (!record) notFound();
  // school เข้าได้เฉพาะโรงเรียนตน — ไม่มีสิทธิ์ให้ถือเสมือนไม่พบ (ไม่เปิดเผยว่ามีอยู่จริง)
  if (!canAccessAssessment(user, record.ownerSchoolCode)) notFound();

  return (
    <AssessmentForm
      id={record.id}
      initial={record.state}
      user={{ name: user.name, roleLabel: ROLE_LABELS[user.role] }}
    />
  );
}
