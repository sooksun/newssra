import type { Flag } from "@/lib/types";

export function FlagItem({ flag }: { flag: Flag }) {
  return (
    <div className={`flag ${flag.tone}`}>
      <strong>{flag.code}</strong>
      <span>{flag.text}</span>
    </div>
  );
}

export function FlagList({ flags }: { flags: Flag[] }) {
  if (!flags.length) return null;
  return (
    <div className="flag-list">
      {flags.map((flag, index) => (
        <FlagItem key={`${flag.code}-${flag.id ?? "all"}-${index}`} flag={flag} />
      ))}
    </div>
  );
}
