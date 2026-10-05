import { Avatar } from "./avatar";
export function ChampionIdentity({
  name,
  src,
  fallbackSrc,
  children,
}: {
  name: string;
  src?: string;
  fallbackSrc?: string;
  children?: React.ReactNode;
}) {
  return (
    <span className="champion-identity">
      <Avatar decorative champion name={name} src={src} fallbackSrc={fallbackSrc} size={40} />
      <span className="champion-description">
        <strong>{name}</strong>
        {children && <span>{children}</span>}
      </span>
    </span>
  );
}
