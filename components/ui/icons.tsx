import type { ReactNode, SVGProps } from "react";

type IconProps = Omit<SVGProps<SVGSVGElement>, "children">;

function Icon({ children, className = "size-5", ...rest }: IconProps & { children: ReactNode }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`shrink-0 ${className}`}
      {...rest}
    >
      {children}
    </svg>
  );
}

export function ArrowRightIcon(props: IconProps) {
  return <Icon {...props}><path d="M4 10h12M11 5l5 5-5 5" /></Icon>;
}

export function ChevronDownIcon(props: IconProps) {
  return <Icon {...props}><path d="M5 7.5l5 5 5-5" /></Icon>;
}

export function CameraIcon(props: IconProps) {
  return (
    <Icon {...props}>
      <path d="M3 6.5h3l1.5-2h5l1.5 2h3v9H3z" />
      <circle cx="10" cy="11" r="2.8" />
    </Icon>
  );
}

export function MinusIcon(props: IconProps) {
  return <Icon {...props}><path d="M5 10h10" /></Icon>;
}

export function PlusIcon(props: IconProps) {
  return <Icon {...props}><path d="M5 10h10M10 5v10" /></Icon>;
}
