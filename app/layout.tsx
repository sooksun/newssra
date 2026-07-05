import type { Metadata } from "next";
import { Sarabun } from "next/font/google";
import "./globals.css";

const sarabun = Sarabun({
  weight: ["300", "400", "500", "600", "700", "800"],
  subsets: ["thai", "latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "แบบประเมินคัดกรองโรงเรียนพื้นที่พิเศษ พ.ส.ศ.",
  description: "ระบบคัดกรองสถานศึกษาพื้นที่ลักษณะพิเศษ เพื่อรับเงินเพิ่ม พ.ส.ศ.",
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="th">
      <body className={sarabun.className}>{children}</body>
    </html>
  );
}
