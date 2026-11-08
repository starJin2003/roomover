import { site } from "@/lib/site";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-24">
      <h1 className="text-5xl font-semibold tracking-tight sm:text-7xl">{site.name}</h1>
      <p className="mt-6 text-xl text-foreground/70 sm:text-2xl">{site.tagline}</p>
    </main>
  );
}
