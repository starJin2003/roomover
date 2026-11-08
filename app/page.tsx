import { site } from "@/lib/site";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-24">
      <h1 className="text-3xl font-extrabold tracking-tight sm:text-4xl">{site.name}</h1>
      <p className="mt-6 text-lg text-flint sm:text-xl">{site.tagline}</p>
    </main>
  );
}
