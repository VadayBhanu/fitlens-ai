import { useState } from "react";

export function BeforeAfter({ before, after }: { before: string; after: string }) {
  const [split, setSplit] = useState(50);
  return (
    <div className="compare" style={{ ["--split" as string]: `${split}%` }}>
      <img src={before} alt="Your original photo" />
      <img className="after" src={after} alt="AI try-on result" />
      <div className="handle" />
      <span className="tag" style={{ left: 10 }}>Before</span>
      <span className="tag" style={{ right: 10 }}>FitLens</span>
      <input type="range" min={0} max={100} value={split} onChange={(e) => setSplit(Number(e.target.value))} aria-label="Compare before and after" />
    </div>
  );
}
