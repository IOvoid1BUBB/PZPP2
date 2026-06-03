import { RouteMapLazy } from "@/components/map/RouteMapLazy";

type PageProps = {
  params: Promise<{ id: string }>;
};

export default async function SessionMapPage({ params }: PageProps) {
  const { id } = await params;

  return (
    <section className="grid gap-4">
      <header>
        <h1 className="text-2xl font-semibold">Mapa trasy</h1>
        <p className="text-sm text-[var(--ui-text-secondary)]">
          Sesja: {id}
        </p>
      </header>

      <RouteMapLazy sessionId={id} />
    </section>
  );
}
