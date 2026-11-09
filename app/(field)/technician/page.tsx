import type { Metadata } from "next";
import { TechnicianWebApp } from "@/components/technician-web-app";

export const metadata: Metadata = {
  title: "BITA Field Technician App",
};

export default function TechnicianAppPage() {
  return <TechnicianWebApp />;
}
