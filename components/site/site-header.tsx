import Link from "next/link";

/** The bar on every screen: the name, which leads home, and the demo buyer everyone acts as. */
export function SiteHeader({ person = "Jordan Ellis" }: { person?: string }) {
  const initials = person
    .split(" ")
    .map((part) => part[0])
    .join("");
  return (
    <header className="mx-auto flex w-full max-w-[1360px] items-center justify-between gap-4 px-4 py-3 sm:px-10 sm:py-5">
      <Link href="/" className="-mx-2 inline-flex min-h-11 items-center rounded-md px-2 text-lg font-semibold">
        Roomover
      </Link>
      <p className="flex items-center gap-3 text-sm text-flint">
        <span className="max-sm:sr-only">{person}</span>
        <span aria-hidden="true" className="grid size-8 place-items-center rounded-full bg-paper text-xs font-semibold text-ink shadow-ring">
          {initials}
        </span>
      </p>
    </header>
  );
}
