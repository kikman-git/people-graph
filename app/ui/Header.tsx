import Link from "next/link";

export default function Header() {
  return (
    <header className="mx-auto flex w-full max-w-5xl items-center justify-between px-4 pb-2 pt-6">
      <Link href="/" className="flex items-center gap-2.5 text-ink hover:text-ink">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent font-serif text-[17px] font-semibold text-white">
          人
        </span>
        <span className="font-serif text-[22px] font-medium leading-none">People</span>
      </Link>
      <nav className="flex items-center gap-4 text-sm">
        <Link href="/map" className="text-muted hover:text-ink">
          Map
        </Link>
        <Link href="/tags" className="text-muted hover:text-ink">
          Tags
        </Link>
      </nav>
    </header>
  );
}
