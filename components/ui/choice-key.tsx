import Link from "next/link";
import { ArrowRightIcon } from "./icons";

interface ChoiceKeyProps {
  href: string;
  title: string;
  description: string;
  tone?: "primary" | "secondary";
}

const TONE = {
  primary: "bg-key text-paper shadow-choice-ink key-press:shadow-choice-ink-down",
  secondary: "bg-paper text-ink shadow-choice-paper key-press:shadow-choice-paper-down",
} as const;

/** One of the two large keys on Home. */
export function ChoiceKey({ href, title, description, tone = "secondary" }: ChoiceKeyProps) {
  return (
    <Link
      href={href}
      className={`relative flex w-full flex-col gap-1 rounded-xl px-6 pt-6 pb-8 transition-[translate,box-shadow] duration-(--duration-press) ease-out key-hover:-translate-y-px key-press:translate-y-0.5 key-focus:outline-2 key-focus:outline-offset-2 key-focus:outline-ink ${TONE[tone]}`}
    >
      <span className="pr-8 text-lg font-semibold">{title}</span>
      <span className={`text-sm ${tone === "primary" ? "text-paper" : "text-flint"}`}>{description}</span>
      <ArrowRightIcon className="absolute top-7 right-6 size-5" />
    </Link>
  );
}
