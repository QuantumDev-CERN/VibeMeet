interface SectionHeadProps {
  no?: string;
  label: string;
  onDark?: boolean;
}
export default function SectionHead({ no, label, onDark = false }: SectionHeadProps) {
  return (
    <div className={`sec-head${onDark ? ' sec-head--on-dark' : ''}`}>
      {no && <span className="sec-head__no">{no}</span>}
      <span className="sec-head__label">{label}</span>
      <span className="sec-head__rule" aria-hidden="true" />
    </div>
  );
}
