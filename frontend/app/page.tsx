import { redirect } from "next/navigation";

/** Główny entrypoint — planner ma boczne menu z linkiem do mapy trasy. */
export default function HomePage() {
  redirect("/planner");
}
