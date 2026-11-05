import { initials } from "./format";

export default function Avatar({
  id, name, hasPhoto, size,
}: {
  id: number;
  name: string;
  hasPhoto: boolean;
  size: number;
}) {
  if (hasPhoto) {
    return (
      // eslint-disable-next-line @next/next/no-img-element
      <img
        src={`/api/photo/${id}`}
        alt={name}
        width={size}
        height={size}
        className="shrink-0 rounded-full border border-line object-cover"
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <div
      aria-hidden
      className="flex shrink-0 items-center justify-center rounded-full border border-line bg-wash font-serif text-muted"
      style={{ width: size, height: size, fontSize: Math.round(size * 0.4) }}
    >
      {initials(name)}
    </div>
  );
}
