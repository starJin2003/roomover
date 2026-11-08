import { site } from "@/lib/site";

export default function HomePage() {
  return (
    <main className="mx-auto flex min-h-screen w-full max-w-3xl flex-col justify-center px-6 py-24">
      <h1 className="text-2xl font-semibold sm:text-3xl">{site.name}</h1>
      <p className="mt-6 text-base text-flint sm:text-lg">{site.tagline}</p>
    </main>
  );
}
