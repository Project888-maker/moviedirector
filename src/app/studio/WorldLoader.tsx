export const LOADING_STEPS = [
  "Network checked",
  "Machine found",
  "Connected",
  "Building world",
  "Generating first scene",
] as const;

// A hand-drawn looking wireframe globe: meridians sweep around (animated rx) over fixed parallels.
function Globe({ className, seed }: { className: string; seed: number }) {
  const meridians = Array.from({ length: 7 }, (_, i) => i);
  const parallels = [-70, -40, -12, 15, 42, 68];
  return (
    <svg className={`globe ${className}`} viewBox="-110 -110 220 220" aria-hidden="true">
      <g transform={`rotate(${seed * 23 - 18})`} fill="none" stroke="currentColor" strokeWidth="1.1">
        <ellipse rx="100" ry="97" />
        <ellipse rx="97" ry="100" transform="rotate(8)" />
        {parallels.map((y, i) => {
          const r = Math.sqrt(100 * 100 - y * y);
          return <ellipse key={y} cy={y} rx={r} ry={r * 0.16 + ((i + seed) % 3)} transform={`rotate(${((i * 7 + seed) % 9) - 4})`} />;
        })}
        {meridians.map((i) => (
          <ellipse key={i} rx="100" ry="99" transform={`rotate(${i * 3 - 9})`}>
            <animate
              attributeName="rx"
              values="100;0;100"
              dur={`${7 + (seed % 3)}s`}
              begin={`${-(i * (7 + (seed % 3))) / meridians.length}s`}
              repeatCount="indefinite"
            />
          </ellipse>
        ))}
      </g>
    </svg>
  );
}

/** Full-bleed loading screen shown while the realtime session spins up. */
export default function WorldLoader({ stage }: { stage: number }) {
  return (
    <div className="world-loader" role="status" aria-live="polite">
      <Globe className="globe-top" seed={1} />
      <Globe className="globe-bottom" seed={2} />
      <Globe className="globe-left" seed={3} />
      <Globe className="globe-right" seed={4} />
      <ol className="loader-steps">
        {LOADING_STEPS.map((label, index) => (
          <li key={label} className={index < stage ? "done" : index === stage ? "current" : "todo"}>
            {label}
          </li>
        ))}
      </ol>
    </div>
  );
}
