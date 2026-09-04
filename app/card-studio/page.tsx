import type { Metadata } from "next";
import { CardStudio } from "@/components/card-studio/card-studio";

export const metadata: Metadata = {
  title: "Card Studio · Gin Rummy",
  description: "Create and publish custom face-card artwork for Gin Rummy.",
};

export default function CardStudioPage() {
  return <CardStudio />;
}
